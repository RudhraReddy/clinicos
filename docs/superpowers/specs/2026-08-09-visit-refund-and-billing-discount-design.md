# Visit Fee Refund & Billing Discount — Design

Date: 2026-08-09
Status: Implemented (commits 7549c8e, 6921017)

Two independent, money-in-flow features, designed together but implemented and
shipped as separate units of work:

- **Feature A — Visit Fee Refund**: frontdesk can refund all or part of a
  visit's collected fee.
- **Feature B — Billing Discount**: frontdesk/admin can apply a percent or
  flat-₹ discount to a bill while creating it.

---

## Feature A: Visit Fee Refund

### Problem

A visit's fee (`Visit.amount_paid`) is collected at check-in/checkout. Money
sometimes needs to go back to the patient — in full or in part. Today the
only way to reflect that is editing `amount_paid` down directly in
`EditVisitDialog`, which is indistinguishable from "the patient only ever
paid this much" — there is no record that money was collected *and then
returned*.

### Data model

`Backend_db/models.py`, `Visit`:

- New column `refund_amount` (Integer, default `0`, not null). Cumulative
  amount refunded against this visit's fee.
- `amount_paid` keeps its existing meaning: total originally collected. It is
  never decremented directly by a refund — only by the dedicated refund
  action (see below), and never below its current stored value once any
  refund exists (see Frontend section).
- Net amount actually retained by the clinic is always
  `amount_paid − refund_amount`.
- `payment_status` gains a new possible value: `'refunded'`. This is a
  derived field (already computed automatically today from
  `amount_paid`/`visiting_fee`, not manually chosen) — the derivation gets one
  new branch, checked first: if `refund_amount > 0`, status is `'refunded'`,
  regardless of whether the refund was partial or full. (The exact split is
  always visible via the two raw numbers wherever both are shown — see
  Frontend — so a single status value is enough; it is not further split into
  "partially refunded" vs "fully refunded".)
- Migration: add `refund_amount` via `_apply_migrations()` in `app.py`,
  following the same additive-column pattern used for `walk_in_age`/
  `walk_in_sex`.

### Backend

New endpoint: `POST /api/visits/<visit_id>/refund`

- Body: `{ "amount": number }`.
- `@require_auth`. Additionally rejects (403) if `g.current_user['role'] ==
  'doctor'` — refunds are frontdesk + admin only.
- Validation (400 on failure):
  - `amount` must be a positive number.
  - `visit.refund_amount + amount` must not exceed `visit.amount_paid`
    (cannot refund more than was actually collected).
- On success: increments `visit.refund_amount` by `amount`, recomputes
  `payment_status` (→ `'refunded'`), commits.
- Logs via the existing `log_activity` audit-trail helper: `action='REFUND'`,
  `resource_type='visit'`, `resource_id=visit_id`, label including the
  refunded amount. No reason field is captured — just the number, per
  requirements.
- No change to `visiting_fee` or any inventory/bill records — this endpoint
  only touches the visit's own fee tracking.

`routes/daily_summary.py`:

- `visit_fee` changes from `float(v.amount_paid)` to
  `float(v.amount_paid) - float(v.refund_amount or 0)` (net). This lands on
  the visit's own date — a refund issued later still adjusts the total shown
  for the day the visit (and its original fee) actually happened, rather than
  appearing as a separate event on the refund date. Net can never go negative
  given the validation above.

### Frontend

`EditVisitDialog.tsx` — matches a user-supplied mockup of this dialog: a
"Refund" field slot added to the form grid alongside the existing
Date/Time/Status/Visiting Fee/Reason fields, not a separate button flow.

- Displays "Amount Paid" and, whenever `refund_amount > 0`, "Refunded" and a
  computed "Net" underneath it — a read-only summary, always visible together
  once a refund exists.
- New "Refund" field: a checkbox next to the "Refund" label (same row), with
  a number input below it — same visual pattern as the other fields in this
  form. The input starts disabled/greyed out; ticking the checkbox enables
  it, mirroring the existing "Paid in Full" checkbox already in this dialog
  that similarly toggles a related field. Helper text under the input shows
  the remaining refundable cap (`amount_paid − refund_amount`).
- No separate confirm button and no dedicated dialog for this — the refund
  amount is just another field on the form. Clicking the dialog's existing
  **Save** button applies the normal visit-field updates and, if the Refund
  checkbox is ticked with a valid nonzero amount, additionally calls
  `POST /api/visits/<visit_id>/refund` with that amount before closing.
- The Refund field is only shown when `amount_paid > 0`, and is hidden
  entirely for the `doctor` role.
- After a successful save, the checkbox unchecks and the input clears —
  it represents "amount to refund *right now*", not a display of the
  cumulative total (that's what the read-only "Refunded"/"Net" summary is
  for). A later edit can tick it again to refund further, up to the
  then-current remaining cap.
- Once `refund_amount > 0`, the existing "Amount Paid" input can no longer be
  edited to a value lower than its current stored value (still editable
  upward, e.g. collecting additional payment later). Attempting to lower it
  shows an inline validation error directing the user to the Refund field
  instead.

Dashboard visit cards (`app/page.tsx` today's list, `app/doctor/page.tsx`
stat strip and visit cards):

- Wherever a visit's fee amount is currently rendered, it switches from raw
  `amount_paid` to the net figure (`amount_paid − refund_amount`). No
  layout/position changes — only the number source.

### Out of scope / explicit non-goals

- No refund reason field.
- No refund payment-mode tracking (cash vs UPI) — a single amount only.
- No changes to `/status` analytics (visit fees are not currently part of
  that page's revenue KPIs).
- No ability to "un-refund" (reduce `refund_amount`) — refunds are additive
  and one-directional.

---

## Feature B: Billing Discount

### Problem

`Bill.total_amount` is always the sum of billed item totals, computed
server-side with no way to reduce it. Frontdesk needs to apply a discount —
either a percentage or a flat ₹ amount — to the whole bill while building it.

### Data model

`Backend_db/models.py`, `Bill`. New columns, all nullable:

- `subtotal_amount` (Numeric(10,2)) — sum of item totals before discount.
  Always populated going forward (equal to `total_amount` when no discount is
  applied).
- `discount_type` (String) — `'percent'` | `'flat'` | `null`.
- `discount_value` (Numeric(10,2)) — the raw number entered (e.g. `10` for
  10%, or `50` for a flat ₹50 off). `null` when no discount was applied.

`total_amount` keeps its existing meaning: the final payable amount. Every
existing downstream reader (Daily Summary's `billing_fee`, dashboard cards,
the printed invoice's headline total) already treats `total_amount` as the
source of truth and needs **no changes** — a discount only changes what value
gets written there at creation time.

`discount_amount` is not stored as its own column — it is always derivable as
`subtotal_amount − total_amount` wherever a display needs it.

### Backend (`routes/billing.py`, `create_bill`)

- Compute `subtotal` from the existing per-item total accumulation (already
  calculated today as `total_calc_amount`).
- Accept optional `discount_type` / `discount_value` in the request body.
- Validation (400 on failure):
  - `discount_type` must be `'percent'` or `'flat'` if `discount_value` is
    present (and vice versa — both or neither).
  - `percent`: `0 ≤ discount_value ≤ 100`.
  - `flat`: `0 ≤ discount_value ≤ subtotal`.
- `discount_amount = subtotal × discount_value / 100` (percent) or
  `discount_value` (flat). `total_amount = subtotal − discount_amount`.
- Store `subtotal_amount`, `discount_type`, `discount_value`, `total_amount`.
- No additional role restriction — same permission as bill creation itself
  (frontdesk + admin, matching who can already reach the New Bill screen).
- Bills have no update/edit endpoint today (confirmed: only `POST`, `GET`,
  `GET .../history`, `GET .../patient/<id>`, `GET .../<id>`, `DELETE`) — a
  discount is therefore only ever set at creation time. An already-created
  bill cannot have a discount added or changed later; this is consistent with
  bills being immutable after creation today, and is not a new restriction
  introduced by this feature.

### Frontend (`app/billing/page.tsx`, New Bill screen)

- A discount control near the bill totals: a two-way `[% | ₹]` mode toggle
  plus a single number input. Live-recomputes and displays a
  Subtotal/Discount/Total breakdown as the user types, before "Create Bill"
  is clicked.
- Included in the `createBill` payload as `discount_type` / `discount_value`
  (omitted entirely when no discount is set).

### Printed invoice (`InvoicePrint.tsx`, `PrintInvoiceDialog.tsx`)

- `PrintInvoiceDialog` fetches `subtotal_amount` / `discount_type` /
  `discount_value` from `GET /api/billing/<invoice_id>` alongside the bill
  data it already loads, and passes them through to `InvoicePrint`.
- `InvoicePrint`'s items table currently ends in a single "Total" row (no
  "Subtotal" row exists in the current implementation, despite older
  documentation describing one — verified against the live component). When
  a discount was applied, two rows are inserted above the existing "Total"
  row: "Subtotal" (`subtotal_amount`) and "Discount (10%)" or "Discount −₹50"
  (the discount amount, labelled by type). When no discount was applied, the
  invoice renders exactly as it does today — a single "Total" row, no visual
  change for the common case.

### Out of scope / explicit non-goals

- No per-line-item discounts — bill-level only.
- No discount approval workflow or role/percentage cap — any user who can
  create a bill can apply any discount from 0 up to the full subtotal.
- No ability to add/change a discount on a bill after it's been created.
