# Refund Redesign — Design

Date: 2026-08-14
Status: Draft — pending review

Supersedes the refund-settlement half of
`2026-08-09-visit-refund-and-billing-discount-design.md` (Feature A). The
discount feature from that doc is untouched.

## Problem with the current system

Refunds today have 5 settlement modes (`visit_cash`, `visit_upi`,
`billing_cash`, `billing_upi`, `apply_to_bill`), a "pending refund" concept
that can sit unconsumed on a visit indefinitely, a checkbox on the Billing
page to opt into folding that pending refund into whatever bill is being
built, and a separate summary line ("Apply ₹XX pending refund to this bill",
Subtotal / Refund Applied rows) explaining what happened. This is more
machinery than the clinic's actual accounting needs, and the 5-way mode
split doesn't match how the clinic actually thinks about its money.

## The accounting model

Four buckets, unchanged: **Visit Cash**, **Visit UPI**, **Billing Cash**,
**Billing UPI** — visit-fee income and billing income are tracked
completely separately; cash and UPI are tracked separately within each.

**Visit Cash is never touched by a refund.** Every cash refund — regardless
of case — comes out of Billing Cash.

## The 3 refund modes

`RefundMode` shrinks from 5 values to 3: `visit_upi`, `billing_upi`, `cash`.
`apply_to_bill` is deleted as a concept, not just a value — see below.

| Mode | Behavior |
|---|---|
| **Visit UPI** | Always a direct, immediate payout debiting the Visit UPI bucket. Never interacts with a bill, under any circumstance. |
| **Billing UPI** | If this is the visit's **first** bill and it's being created right now, applies to that bill's total (up to the total); any excess is a direct payout debiting Billing UPI. If there's no such bill in progress, the whole amount is a direct payout debiting Billing UPI. |
| **Cash** | Same rule as Billing UPI, but the bucket is always Billing Cash. |

There is no per-case branching in the backend — this table *is* the whole
rule. The three cases from discussion (visit cancelled with no bill,
refund against an existing bill, refund with no bill for some other reason)
all fall out of it automatically based on whether a first bill happens to
be in progress at the moment the refund is submitted.

**Once a visit has any bill, every subsequent refund on it — from anywhere —
is a direct payout.** A bill's total is only ever touched live, during the
one moment its first bill is being created. There is no mechanism to
retroactively reopen an already-saved bill's total. This is what guarantees
a refund never gets folded into a visit's 2nd or later bill.

## Out of scope (deferred)

Per discussion, editing an already-issued refund (raising or lowering a
past refund amount, and reconciling that against a bill that already
consumed it) is **not** part of this round. Each refund submission is a
simple additive event: "refund ₹X more, right now, settled this way." A
visit can be refunded multiple times over its life (e.g. a Visit UPI payout
today, a Cash payout against its first bill next week) — that's just two
separate events — but no individual event can later be revised.

## Data model

`Backend_db/models.py`:

- `Visit.refund_amount` — stays as-is: cumulative total ever refunded
  against this visit, summed across all events. Still capped at
  `visiting_fee`.
- `Visit.refund_mode` — stays as a **denormalized display field**: the mode
  of the most recent event. No longer authoritative for behavior (each
  `VisitRefund` row carries its own mode) — just what the UI shows next to
  "Refunded: ₹X".
- `VisitRefund` — unchanged shape (`visit_id`, `amount`, `mode`,
  `created_at`), still the append-only per-event log and the source of
  truth for Daily Summary's day-by-day attribution. Now logs **every**
  event (previously it skipped logging `apply_to_bill` events since they
  didn't move money at the time) — under the new model every event either
  pays out directly or reduces a bill, either way it's worth a row. A
  bill-reducing event and its overflow payout (if any) are logged as two
  rows sharing the same `visit_id`/timestamp, so Daily Summary's cash/UPI
  split-by-till stays accurate.
- `Bill.visit_refund_applied` — unchanged meaning: how much of a first-bill
  refund was folded into this specific bill's `total_amount`. Still used to
  print the bare `−amount` line (no label) on the invoice — that part of
  `InvoicePrint.tsx` already does exactly what's wanted and needs no change.
- New computed flag needed at read time (not a stored column): **"does
  this visit already have a bill?"** — a simple `EXISTS` query against
  `Bill.visit_id`. Drives both the backend's first-bill check at refund/bill
  time and the frontend's decision whether to show the fold-into-bill UI at
  all (see Frontend section).

### Migration

- `REFUND_MODES` constant in `routes/visits.py` shrinks to `('visit_upi',
  'billing_upi', 'cash')`.
- Historical `visit_refunds.mode` values only ever contain the 4 old payout
  modes (the old code deliberately never logged `apply_to_bill` — see
  `models.py` comment), so the migration is just a merge:
  `UPDATE visit_refunds SET mode = 'cash' WHERE mode IN ('visit_cash',
  'billing_cash')`.
- `visits.refund_mode`, being a live column, *can* hold `'apply_to_bill'`
  historically (it's the "last mode used" field). Since it's now
  display-only, map it to `'billing_upi'` on migration — the closest
  equivalent of what `apply_to_bill` meant. Flagged as a judgment call, not
  load-bearing (nothing reads this for old visits' financial totals, only
  for the label next to "Refunded: ₹X").
- Drop the `refund_remaining` field from the `/visits/<id>` response and
  from `RefundMode`'s consumers — the whole "unconsumed pending refund"
  concept goes away with `apply_to_bill`.

## Backend behavior

**`POST /visits/<id>/refund`** (`routes/visits.py`) — used by the
Visit-edit dialog. Body becomes `{amount, mode}` where `amount` is now an
**increment**, not a new absolute total (this drops the "resubmit the full
desired total" convention along with the decrease-guard logic that existed
to support it). Validates `amount > 0`, `mode` in the 3 values, and
`visit.refund_amount + amount <= visit.amount_paid`. Always resolves as a
direct payout per the mode table above — this endpoint never looks at
whether the visit has a bill. Appends one `VisitRefund` row, bumps
`Visit.refund_amount`/`refund_mode`.

**`POST /billing/create`** (`routes/billing.py`) — gains an optional
`refund: {amount, mode}` in the payload, replacing `apply_visit_refund:
true`. Only meaningful when a `visit_id` is present and the visit has no
existing bill (server re-checks this — the "first bill" flag isn't trusted
from the client). If present: for `billing_upi`/`cash`, `applied =
min(amount, bill_total_after_discount)`, `bill.total_amount -= applied`,
`bill.visit_refund_applied = applied`; if `amount > applied`, the
difference pays out directly the same way `/visits/<id>/refund` would. For
`visit_upi`, the whole amount is always a direct payout — the bill's total
is untouched. Either way, `Visit.refund_amount` goes up by the full
`amount` and a `VisitRefund` row is written (two rows if there was
overflow).

## Frontend

**Visit-edit dialog** (`EditVisitDialog.tsx`) — the refund fields simplify
along with the endpoint: drop the `refundChecked` checkbox (it existed to
support "leave the running total alone" vs "edit it," which no longer
applies to a purely additive model) in favor of a plain amount + mode
input that appends a new refund event when submitted. Mode select still
offers all 3.

**Billing page** (`app/billing/page.tsx`):

- Fix: the **Total** at the bottom is currently only rendered once an item
  is selected — make it always visible regardless of list state.
- Remove the "Apply ₹XX pending refund to this bill" checkbox and its
  supporting `pendingBillRefund`/`applyRefundToBill`/`refund_remaining`
  state entirely.
- Remove the separate Subtotal / Refund Applied breakdown rows. A refund
  entered while building a bill becomes a line in the same items list —
  labeled, with its own delete (✕) button, contributing `−amount` straight
  into the running Total. No separate summary text.
- This "Add Refund" control only appears when a visit is linked **and**
  that visit has no bill yet (using the new has-a-bill flag). It only
  offers **Billing UPI** and **Cash** — Visit UPI never affects a bill's
  total, so offering it here would add a line that visually sits in the
  bill's item list but doesn't move the Total, which is confusing. A Visit
  UPI refund is always done through the Visit-edit dialog instead.
- Like other bill line items, the refund is **staged client-side only**
  until "Create Bill" is clicked — deleting it before submit means nothing
  is ever sent to the backend. On submit, it goes out as the `refund` field
  described above, in the same request that creates the bill (one atomic
  action, not a separate pre-step).
- The existing standalone "Refund" checkbox + amount + mode + "Submit
  Refund" block on this page (a near-duplicate of the Visit-edit dialog,
  usable independent of creating a bill) is proposed for **removal** — it's
  now redundant with the Visit-edit dialog, and having two separate direct-
  payout refund entry points on different pages invites drift. Flagged
  below for explicit confirmation since it wasn't asked for directly.

**Types** (`lib/api.ts`): `RefundMode` narrows to `'visit_upi' |
'billing_upi' | 'cash'`. Drop `refund_remaining` from the `Visit` type.
`createBill()`'s payload gains `refund?: {amount: number, mode: RefundMode}`
replacing `apply_visit_refund`.

## Daily Summary (`routes/daily_summary.py`)

`REFUND_BUCKET_MAP` shrinks to match the 3 modes. It simplifies rather than
just shrinks: `cash` always maps to the Billing Cash bucket now (previously
it had to disambiguate `visit_cash` vs `billing_cash`). The
`billing_refund` bucket (driven by `Bill.visit_refund_applied`, annotating
how much of a bill's total was a folded-in refund) is unaffected — that
mechanism doesn't change, only which modes can produce it (`billing_upi`,
`cash`).

## Open decisions for review

1. **Removing the standalone "Refund" block on the Billing page** (see
   above) — recommended, but confirm you're OK losing that entry point in
   favor of always using the Visit-edit dialog for direct payouts.
2. **Visit UPI not offered in the "Add Refund" bill line-item control** —
   recommended for the reason above; confirm.
3. **Historical `apply_to_bill` → `billing_upi` migration mapping** for the
   display-only `visits.refund_mode` column — confirm this is an acceptable
   best-effort label for old data, since nothing financial depends on it.
4. **Incremental amount, no editing** — confirm dropping the "resubmit a
   new total" convention (and the ability to lower a past refund) is fine
   for this round, per the "ignore updating the refund" scope cut.
