# Split Payment (Cash + UPI) — Design

Date: 2026-08-18
Status: Implemented

## Problem

A bill's payment today is always a single mode (`Bill.payment_type`,
`'CASH' | 'UPI'`, picked from a dropdown at the top of the Billing page). In
practice, patients sometimes pay part cash / part UPI for one bill, and
there's currently no way to record that split — the frontdesk has to pick
one mode and the actual mixed reality goes unrecorded.

## Data model

`Backend_db/models.py`, `Bill`:

- New `cash_amount = db.Column(db.Numeric(10, 2), nullable=True)`
- New `upi_amount = db.Column(db.Numeric(10, 2), nullable=True)`
- `payment_type` **stays**, but changes from "the mode the frontdesk picked"
  to a **derived display label**: `'CASH'` if `upi_amount == 0`, `'UPI'` if
  `cash_amount == 0`, else `'SPLIT'`. Every other reader that just wants a
  simple string (patient billing history, old reports) keeps working
  unchanged; anything that needs the real breakdown reads the two new
  columns directly.

### Migration (`app.py`'s `_apply_migrations()`)

```sql
ALTER TABLE bills ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(10, 2)
ALTER TABLE bills ADD COLUMN IF NOT EXISTS upi_amount NUMERIC(10, 2)
```

Then a one-time, idempotent backfill (only touches rows where both are
still NULL, so it's a no-op on every restart after the first):

```sql
UPDATE bills SET cash_amount = 0, upi_amount = total_amount
  WHERE cash_amount IS NULL AND upi_amount IS NULL AND payment_type = 'UPI'
UPDATE bills SET cash_amount = total_amount, upi_amount = 0
  WHERE cash_amount IS NULL AND upi_amount IS NULL AND COALESCE(payment_type, 'CASH') != 'UPI'
```

i.e. old `'UPI'` rows backfill to `upi_amount = total_amount`; everything
else (`'CASH'`, the legacy `'CARD'` value, or `NULL`) backfills to
`cash_amount = total_amount` — a judgment call for the ambiguous legacy
`CARD` rows, flagged below for confirmation, since there's no cash/UPI
truth to recover for those.

## Backend behavior (`routes/billing.py`)

**`POST /api/billing`** — replaces the `payment_type` field in the payload
with `cash_amount` and `upi_amount` (both required, default `0`). Validates:

- Each is a non-negative number.
- Their sum is within **±₹1** of `final_total` (the same value already
  computed after discount and any folded-in refund, right before it's
  assigned to `new_bill.total_amount`) — covers "sometimes they round it
  off." Outside that tolerance, `400`.

`new_bill.cash_amount`/`upi_amount` are stored as sent (not rescaled to
force an exact match); `payment_type` is derived from them per the rule
above and stored as today for backward-compatible reads.

**`GET /api/billing/history`, `/api/billing/patient/<id>`,
`/api/billing/<invoice_id>`** — each response gains `cash_amount` and
`upi_amount` fields alongside the existing `payment_type`.

**`GET /api/billing/history`'s `payment_type` filter** — changes from
`Bill.payment_type == payment_type.upper()` to:

- `CASH` → `Bill.cash_amount > 0`
- `UPI` → `Bill.upi_amount > 0`
- `SPLIT` (new option) → `Bill.cash_amount > 0 AND Bill.upi_amount > 0`

A split bill matches both `CASH` and `UPI` filters individually (it did
collect cash, and it did collect UPI) — treated as the correct behavior for
"show me every bill with cash in it," not a bug to special-case around.

## Frontend — Billing page (`app/billing/page.tsx`)

**Top "Patient & Actions" row:**
- Payment Type (Cash/UPI) selector — removed.
- **Walk-in Bill** button moves to the row's right side, into the slot
  Create Bill used to occupy.

**Bottom row, three columns (replacing today's single right-aligned
Discount/Total block):**

| Left | Center | Right |
|---|---|---|
| Refund control (relocated from the Items-header area — same amount input, settle-via select, Add Refund button; refund line still shows in/removes from the items table as today) | Payment entry (new) | Discount + Total (unchanged) + **Create Bill** |

**Center — Payment entry**, two rows:
```
Cash  ₹ [input]  [Full amount]
UPI   ₹ [input]  [Full amount]
```
- Each `[Full amount]` button fills that row with the current `finalTotal`
  and zeroes the other row — covers the single-mode case without a separate
  toggle.
- A small live hint under the two rows: `Remaining: ₹X` (`finalTotal -
  cashAmount - upiAmount`), or a green "✓ matches total" state once within
  tolerance.
- **Create Bill** stays disabled unless `|cashAmount + upiAmount -
  finalTotal| <= 1` (mirroring the backend's tolerance, so the button's
  enabled state and the request that's actually about to be sent agree).

`createBill()`'s payload: `payment_type` replaced with `cash_amount`,
`upi_amount`.

**Types** (`lib/api.ts`): `BillingHistoryEntry` gains `cash_amount: number`,
`upi_amount: number`.

## Invoice print (`InvoicePrint.tsx`)

`paymentType` prop's meaning stays "a display string," but now can be
`'SPLIT'`. Rendering:

- Not split (today's behavior, unchanged): `PAYMENT MODE : CASH` (or `UPI`).
- Split: `PAYMENT MODE : SPLIT`, then one more line: `CASH : ₹{cash}   UPI :
  ₹{upi}` (reusing the existing `row`/`Label` helpers already in the file).

`PrintInvoiceDialog.tsx` passes `cashAmount`/`upiAmount` through from the
bill-details response alongside the existing `paymentType`.

## Daily Summary (`routes/daily_summary.py`)

The three spots that currently do `mode = _norm_mode(bill.payment_type); add('billing_fee', mode, amount)` (visit-linked bills, walk-in bills — `payment_type`
is also read for the `discount`/`billing_refund` info buckets, which stay
mode-tagged the same way discount is today, not split) change to attribute
the two portions separately:

```python
add('billing_fee', 'cash', float(bill.cash_amount or 0))
add('billing_fee', 'upi', float(bill.upi_amount or 0))
```

instead of one `add('billing_fee', mode, amount)` call with the bill's full
amount under a single inferred mode. The `billing_fees` list already
returned per-row (used by `WalkInForm.tsx`'s Past Visits panel and the
Daily Summary page's per-row badges) gets up to **two** entries for a split
bill (`{amount: cash_amount, mode: 'cash'}`, `{amount: upi_amount, mode:
'upi'}`) instead of one — the existing badge-list rendering on both
consumers already loops over an array, so this needs no frontend change
beyond what the backend sends.

`discount`/`billing_refund` info-bucket tagging (which mode a discount or
folded-in refund gets attributed to for display) keeps using
`_norm_mode(bill.payment_type)` as today — a discount or refund on a split
bill gets tagged with the bill's overall derived label (`SPLIT` falls
through `_norm_mode`'s `else: 'other'`, i.e. untagged, showing under Total
only, not under Cash or UPI specifically). Flagged below — could instead be
split proportionally, but that's meaningfully more complex for what's
purely an informational annotation.

## Open decisions for review

All three implemented as recommended, no pushback received:

1. Legacy `CARD`/`NULL` `payment_type` rows backfill to `cash_amount = total_amount`.
2. ±₹1 tolerance, enforced both client-side (Create Bill's disabled state) and
   server-side (`routes/billing.py create_bill`).
3. Discount/refund info-bucket tagging on a split bill falls through to
   `_norm_mode`'s `'other'` (untagged in Daily Summary) rather than being
   split proportionally.

## Verification

Implemented and verified end-to-end (2026-08-18): migration backfilled
existing `CASH`/`UPI` rows correctly (checked via direct query); a real
split bill created through the Billing page UI (Cash ₹30 + UPI ₹30.94 on a
₹60.94 total) showed the "✓ Matches total" hint, enabled Create Bill, saved
as `payment_type: 'SPLIT'`, and printed `PAYMENT MODE : SPLIT` /
`CASH : 30.00   UPI : 30.94` on the invoice; `GET /billing/history`'s
`CASH`/`UPI`/`SPLIT` filters all matched correctly against a split bill
created via direct API call; Daily Summary correctly split the bill's
`billing_fee` bucket across `cash`/`upi` and produced two `billing_fees`
entries for the row; the ±₹1 tolerance was confirmed to accept a ₹0.94
mismatch and reject a ₹5 mismatch with a clear error message.
