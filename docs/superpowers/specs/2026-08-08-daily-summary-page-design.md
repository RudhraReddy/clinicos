# Daily Summary Page — Design

**Status:** Approved, not yet implemented.

## Goal

A new page, shared by all three roles (frontdesk, doctor, admin), that shows a single day's
patient-visit and billing activity as a flat table plus a cash/UPI income summary at the top.
Distinct from the existing `/status` page (doctor-only, multi-period analytics dashboard with
inventory/expense breakdowns) — this is a simple daily ledger, not an analytics tool.

## Route & Navigation

- New route: `/daily-summary`, page title "Daily Summary".
- Added to all three nav lists in `frontend/components/layout/Sidebar.tsx` (`staffNavItems`,
  `doctorNavItems`, `adminNavItems`) — frontdesk currently has no Status/Gallery-type page at
  all, so this is a net-new nav entry for that role.
- No role guard on the page itself (consistent with how `/status` has no in-page guard either —
  visibility is controlled purely by nav-list membership plus the fact that nothing else links
  to it). Backend endpoint uses plain `@require_auth` (any logged-in role).
- Follows the inline hamburger-trigger pattern (`useMenu()`), and gets added to
  `AppShell.tsx`'s `INLINE_TRIGGER_ROUTES`.

## Bill → Visit linkage fix (prerequisite)

`Bill.visit_id` exists as a column but is essentially never populated today — verified only one
frontend call site ever navigates to `/billing` with visit context
(`app/page.tsx`'s `handleGoToBilling`), and even that only passes `patient_id`, not `visit_id`.
`billing/page.tsx` already reads a `visit_id` search param and forwards it to `createBill`, so
the fix is narrow:

- `app/page.tsx`: `handleGoToBilling` changes from
  `router.push(\`/billing?patient_id=${visit.patient_id}\`)` to
  `router.push(\`/billing?patient_id=${visit.patient_id}&visit_id=${visit.visit_id}\`)`.

No other call site needs changing (confirmed via repo-wide grep for `/billing` links — every
other one is a bare nav shortcut with no patient/visit context).

**Accepted limitation:** bills created before this fix ships stay unlinked and will show a blank
Billing Fee for their visit's row on this page. `create_bill` already rejects a second bill for
the same `visit_id` (existing dedup check), so the relationship is 1:1 in practice — no need to
handle multiple bills per visit.

## Backend

New blueprint `Backend_db/routes/daily_summary.py`, registered in `routes/__init__.py`.

### `GET /api/daily_summary`

`@require_auth`. Query params:
- `date` (required, `YYYY-MM-DD`) — the day to summarize, IST.
- `location_id` (optional, int or omitted/`all` for all locations) — same convention as
  `GET /api/inventory_analytics?location_id=`.

**Query logic:**
1. Visits: `Visit.query.filter(Visit.visit_date == date, Visit.status != 'deleted')`
   (`'deleted'` is the app's existing soft-delete status — same exclusion `app/page.tsx`
   already applies client-side elsewhere). Optionally `.filter(Visit.location_id == N)`.
2. For each visit, look up its bill: `Bill.query.filter_by(visit_id=visit.visit_id).first()`.
3. Walk-in bills for the day: `Bill.query.filter(func.date(Bill.created_at) == date,
   Bill.patient_id.is_(None))`. Optionally `.filter(Bill.location_id == N)`.
4. Build one row per visit and one row per walk-in bill (walk-in bills never duplicate a visit
   row since they have no `patient_id`/`visit_id`).
5. Visit Fee = `visit.amount_paid` (money actually collected, not `visiting_fee` — a partially
   paid or unpaid visit must not inflate the day's income total). Its payment mode is
   `visit.payment_mode`. If `amount_paid == 0`, the row still appears (patient/reason are still
   useful) but with no fee amount and no payment-mode badge.
6. Billing Fee = the linked (or walk-in) bill's `total_amount`, with `payment_type` as its mode.
   Bills are always paid in full at creation — no partial concept to worry about here.
7. Rows sorted by time ascending (visit's `visit_time`, walk-in bill's `created_at` time),
   visits and walk-ins interleaved into one chronological list.
8. Summary block: cross-tab of `{visit_fee, billing_fee, total}` × `{cash, upi, total}`, computed
   from the same rows (so the UI never has to recompute — the backend is the single source of
   truth for the totals).

Payment mode values in this codebase are `'cash'`/`'upi'` (visits, lowercase) and
`'CASH'`/`'UPI'`/`'CARD'` (bills, uppercase; `'CARD'` exists in the schema/dropdown but the user
confirmed it's never actually used in practice). The endpoint normalizes both to lowercase
`cash`/`upi` keys for the summary; any stray `CARD` (or unrecognized) value is still counted in
the row's own total and in the `total` row/column of the summary, but not added to either the
`cash` or `upi` bucket — so the grand total always reconciles even in that edge case, it just
won't misclassify.

**Response shape:**
```json
{
  "date": "2026-08-08",
  "rows": [
    {
      "type": "visit",
      "visit_id": "0B9B0E39-160226-5QO-760",
      "patient_id": "0B9B0E39",
      "patient_name": "Alice Smith",
      "phone_number": "555-1702",
      "reason": "Follow-up",
      "time": "09:20",
      "visit_fee": 400,
      "visit_fee_mode": "cash",
      "billing_fee": 250,
      "billing_fee_mode": "upi"
    },
    {
      "type": "walkin",
      "invoice_id": "080826-ABC-123",
      "patient_id": null,
      "patient_name": "Jane Doe (Walk-in)",
      "phone_number": null,
      "reason": null,
      "time": "11:05",
      "visit_fee": null,
      "visit_fee_mode": null,
      "billing_fee": 800,
      "billing_fee_mode": "cash"
    }
  ],
  "summary": {
    "visit_fee":   {"cash": 1200, "upi": 400, "total": 1600},
    "billing_fee": {"cash": 800,  "upi": 250, "total": 1050},
    "total":       {"cash": 2000, "upi": 650, "total": 2650}
  }
}
```

### `frontend/lib/api.ts`

New `api.getDailySummary(date: string, locationId?: number | 'all')` calling
`/api/daily_summary?date=...&location_id=...`. New exported types `DailySummaryRow` and
`DailySummaryResponse` mirroring the JSON above.

## Frontend page (`app/daily-summary/page.tsx`)

**Header** (per `docs/page_layout_rules.md` conventions — hamburger, title, no page has 4 nav
buttons+tabs here since this is a standalone page, not part of the 4-page nav-switching set, so
it doesn't need to strictly follow that doc's exact button row, just its card/scroll rules):
- Hamburger + "Daily Summary" title.
- Day switcher: `<` / `>` arrow buttons for prev/next day, plus a single-date `Calendar` popover
  (not `DatePickerWithRange` — this page is single-day only), defaulting to `getTodayIST()`.
- Location dropdown, same component/pattern as `/status`'s location `Select`, default "All",
  populated from `GET /api/admin/locations`.

**Summary card** (top, fixed — not part of the scrolling row table):
A small cross-tab table:

|              | Cash  | UPI   | Total |
|---|---|---|---|
| **Visit Fee**   | ₹x   | ₹y   | ₹x+y |
| **Billing Fee** | ₹a   | ₹b   | ₹a+b |
| **Total**       | ₹x+a | ₹y+b | grand total |

**Row table card** (fills remaining height, internal scroll + sticky header — same pattern just
established for `VisitsTab`):
Columns: **Patient name | Cell number | Visit fee | Billing fee | Reason**. Each fee cell shows
the ₹ amount with a small colored badge for payment mode (green = Cash, blue = UPI), omitted
when there's no fee. Empty-state and loading-state match `VisitsTab`'s existing patterns.

No row click / detail dialog for v1 — this page is read-only reporting, not an entry point into
editing visits or bills (unlike `VisitsTab`, which already has `VisitDetailsDialog` for that).

## Out of scope

- Editing anything from this page.
- Exporting/printing the daily summary (not requested).
- Multi-day ranges (explicitly single-day per the brainstorm).
- Backfilling `visit_id` on historical bills.

## Testing plan

Throwaway backend (`PORT=5050`) + frontend (`-p 3001`) + Playwright, JWT test cookies, per the
project's established convention. Verify:
- A day with a mix of cash/UPI visits and a walk-in bill: row amounts, badges, and summary
  cross-tab all reconcile (`visit_fee.total + billing_fee.total == total.total`, etc.).
- A day with no activity renders the zero-state cleanly (summary shows all ₹0, table shows
  "no visits found"-equivalent).
- Location filter narrows both rows and summary correctly.
- Day switcher (arrows + calendar) navigates and refetches.
- `tsc --noEmit` and `ast.parse` on the new files both pass clean.
