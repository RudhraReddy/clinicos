# Refund Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 5-mode refund system (with its `apply_to_bill`
pending-refund state) with 3 modes (Visit UPI, Billing UPI, Cash) whose
behavior is a single rule per mode, and rework the Billing page's refund UI
from a checkbox + summary-text pattern into a deletable line item in the
bill's items list.

**Architecture:** Backend: `REFUND_MODES` shrinks to 3 values; `/visits/<id>/refund`
becomes a pure direct-payout endpoint taking an incremental amount;
`POST /billing` gains a `refund` field that applies to a visit's bill only
when it's that visit's first bill, with any excess paid out directly —
same math either way, no per-case branching. Frontend: `EditVisitDialog`
loses its refund checkbox (submissions are now purely additive); the
Billing page's refund UI moves from a checkbox/summary-row pattern into an
"Add Refund" control that appends a deletable row to the same items table.

**Tech Stack:** Flask 2 / SQLAlchemy 2.0 (`Backend_db/`), Next.js 16 App
Router / React / TypeScript (`frontend/`). No test suite exists for either
side of this app — verification below is via `curl` against the dev
backend and manual browser checks against the dev frontend (per
`CLAUDE.md`'s documented JWT dev-auth-bypass technique for driving the app
without the TOTP login flow).

**Spec:** `docs/superpowers/specs/2026-08-14-refund-redesign-design.md`

## Global Constraints

- Backend dev server: `cd Backend_db && source venv/bin/activate && python app.py` (port 5000, `/api` prefix).
- Frontend dev server: `cd frontend && npm run dev` (port 3000), proxies `/api/*` to the backend — hit `http://localhost:3000/api/...` in curl, not port 5000 directly, when testing through the proxy; either works for these tasks since both point at the same Flask process.
- Timestamps: always `get_ist_now()`, never `datetime.utcnow()`.
- `_apply_migrations()` in `Backend_db/app.py` runs on every app start and must stay idempotent (`ADD COLUMN IF NOT EXISTS`, `UPDATE ... WHERE` clauses that match nothing once already applied).
- No test suite — every task's verification step is a concrete `curl` command (backend) or an exact manual browser action (frontend) with the expected result spelled out, not "add tests."
- One correction to the spec, discovered while writing this plan: the spec says every refund event gets a `VisitRefund` log row. That's wrong for the portion of a refund that gets folded into a bill — `Bill.visit_refund_applied` + Daily Summary's `billing_refund` bucket already account for that money without it ever leaving a till, and logging it again into `VisitRefund` would cause Daily Summary to double-subtract it from a till bucket it never left. Task 3 below logs a `VisitRefund` row **only** for the portion that becomes a real payout (the overflow beyond what a bill absorbed, or the whole amount when there's no bill to apply to) — matching the original code's same reasoning for why `apply_to_bill` was never logged.

---

### Task 1: Migration — collapse refund mode values, update model comments

**Files:**
- Modify: `Backend_db/app.py:91` (end of the `stmts` list in `_apply_migrations()`)
- Modify: `Backend_db/models.py:164-169` (`Visit.refund_mode` comment), `:192-195` (`Bill.visit_refund_applied` comment), `:213` (`VisitRefund.mode` comment)

**Interfaces:**
- Produces: no new columns, no new functions — just data cleanup and comment accuracy that later tasks' code will match.

- [ ] **Step 1: Add the two backfill statements**

In `Backend_db/app.py`, append to the `stmts` list (right after the existing 2026-08-10 refund-mode block, before the closing `]`):

```python
        # 2026-08-14: refund redesign — 5 modes collapse to 3 (visit_upi,
        # billing_upi, cash). Historical visit_refunds.mode only ever held
        # the 4 old payout codes (apply_to_bill was deliberately never
        # logged there), so merging the two cash variants is a full
        # backfill. visits.refund_mode is a live "most recent mode" display
        # column and can hold 'apply_to_bill' historically — remapped to
        # 'billing_upi' as the closest equivalent (display-only, nothing
        # financial reads this column for old visits). Both idempotent.
        "UPDATE visit_refunds SET mode = 'cash' WHERE mode IN ('visit_cash', 'billing_cash')",
        "UPDATE visits SET refund_mode = 'billing_upi' WHERE refund_mode = 'apply_to_bill'",
    ]
```

(Replace the file's existing closing `    ]` of the `stmts` list with the
block above — i.e. insert these two lines before it.)

- [ ] **Step 2: Update `Visit.refund_mode`'s comment**

In `Backend_db/models.py`, replace:

```python
    # Settlement of the most recent refund — one of 5 codes (see routes/visits.py
    # REFUND_MODES): visit_cash/visit_upi/billing_cash/billing_upi are direct
    # payouts from that specific till; apply_to_bill means the refund is still
    # pending and gets folded into a future bill's total instead of paid out.
    refund_mode = db.Column(db.String(20), nullable=True)
```

with:

```python
    # Mode of the most recent refund event (see routes/visits.py REFUND_MODES:
    # visit_upi, billing_upi, cash) — display-only, not authoritative for
    # behavior. Each event's own VisitRefund row (when it produced a real
    # payout) carries its own mode; a visit can be refunded via different
    # modes across separate events over its life.
    refund_mode = db.Column(db.String(20), nullable=True)
```

- [ ] **Step 3: Update `Bill.visit_refund_applied`'s comment**

Replace:

```python
    # How much of an 'apply_to_bill' visit refund was folded into this bill —
    # total_amount already has this subtracted; this column exists purely so the
    # invoice print and Daily Summary know it happened and can annotate it.
    visit_refund_applied = db.Column(db.Numeric(10, 2), nullable=True)
```

with:

```python
    # How much of a refund was folded into this bill's total at creation time
    # — only ever set on a visit's first bill (see routes/billing.py).
    # total_amount already has this subtracted; this column exists purely so
    # the invoice print and Daily Summary know it happened and can annotate it.
    visit_refund_applied = db.Column(db.Numeric(10, 2), nullable=True)
```

- [ ] **Step 4: Update `VisitRefund.mode`'s comment**

Replace:

```python
    mode = db.Column(db.String(20), nullable=False) # visit_cash, visit_upi, billing_cash, billing_upi
```

with:

```python
    mode = db.Column(db.String(20), nullable=False) # visit_upi, billing_upi, cash — only ever the portion of a refund that was an actual payout (see routes/billing.py)
```

- [ ] **Step 5: Restart the backend and verify the migration ran cleanly**

Run: `cd Backend_db && source venv/bin/activate && python app.py`
Expected: starts without error, logs show no exceptions from
`_apply_migrations()`. Leave it running for later tasks' curl checks (or
restart it per-task — each task's backend steps assume it's running).

- [ ] **Step 6: Verify the backfill against the dev DB**

Run: `psql "$DATABASE_URL" -c "SELECT mode, count(*) FROM visit_refunds GROUP BY mode;"`
Expected: no rows with `mode` in `('visit_cash', 'billing_cash')` — only
`visit_upi`, `billing_upi`, `cash` (plus possibly 0 rows if the table was
already empty).
Run: `psql "$DATABASE_URL" -c "SELECT refund_mode, count(*) FROM visits WHERE refund_mode IS NOT NULL GROUP BY refund_mode;"`
Expected: no rows with `refund_mode = 'apply_to_bill'`.

- [ ] **Step 7: Commit**

```bash
git add Backend_db/app.py Backend_db/models.py
git commit -m "refactor(refund): migrate legacy refund modes, update model comments"
```

---

### Task 2: Backend — `/visits/<id>/refund` becomes a pure direct-payout endpoint

**Files:**
- Modify: `Backend_db/routes/visits.py:12-22` (module constant + `_refund_applied_to_bills` helper — delete the helper entirely), `:193-223` (`get_visit`), `:267-341` (`refund_visit`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `REFUND_MODES = ('visit_upi', 'billing_upi', 'cash')` — Task 3
  duplicates this tuple locally in `routes/billing.py` (see that task's
  note on why). `POST /visits/<id>/refund` body `{amount: number, mode: str}`
  where `amount` is now an **increment**, not a new total. `GET /visits/<id>`
  response gains `has_bill: bool`, loses `refund_remaining`.

- [ ] **Step 1: Shrink `REFUND_MODES` and delete the now-unused helper**

Replace:

```python
# 4 direct-payout settlements (one per till) + apply_to_bill, which doesn't pay
# anything out — it just earmarks the refund to be folded into a future bill.
REFUND_MODES = ('visit_cash', 'visit_upi', 'billing_cash', 'billing_upi', 'apply_to_bill')


def _refund_applied_to_bills(visit_id):
    """Sum of Bill.visit_refund_applied across every bill this visit has ever
    had — i.e. how much of an 'apply_to_bill' refund is already consumed."""
    total = db.session.query(func.coalesce(func.sum(Bill.visit_refund_applied), 0)) \
        .filter(Bill.visit_id == visit_id).scalar()
    return float(total or 0)
```

with:

```python
# Visit UPI is always a direct payout debiting the Visit UPI bucket, never
# touching a bill. Billing UPI and Cash apply to a visit's first bill (if
# one is being created right now) before falling back to a direct payout —
# see routes/billing.py create_bill for that half of the logic. Cash always
# debits Billing Cash; Visit Cash is never touched by a refund.
REFUND_MODES = ('visit_upi', 'billing_upi', 'cash')
```

- [ ] **Step 2: Rewrite `get_visit` — drop `refund_remaining`, add `has_bill`**

Replace:

```python
@visits.route('/visits/<visit_id>', methods=['GET'])
@require_auth
def get_visit(visit_id):
    visit = Visit.query.get_or_404(visit_id)
    patient = Patient.query.get(visit.patient_id)
    refund_amount = float(visit.refund_amount or 0)
    applied = _refund_applied_to_bills(visit_id) if visit.refund_mode == 'apply_to_bill' else 0
    return jsonify({
        'visit_id': visit.visit_id,
        'patient_id': visit.patient_id,
        'patient_name': patient.name if patient else 'Unknown',
        'phone_number': patient.phone_number if patient else None,
        'dob': patient.dob.strftime('%Y-%m-%d') if patient and patient.dob else None,
        'visit_date': visit.visit_date.strftime('%Y-%m-%d') if visit.visit_date else None,
        'visit_time': visit.visit_time.strftime('%H:%M') if visit.visit_time else None,
        'reason': visit.reason,
        'status': visit.status,
        'visiting_fee': visit.visiting_fee,
        'amount_paid': visit.amount_paid,
        'refund_amount': visit.refund_amount or 0,
        'refund_mode': visit.refund_mode,
        # Only meaningful when refund_mode is 'apply_to_bill' — how much of the
        # pending refund hasn't yet been folded into a bill. Drives the "Apply
        # pending refund" checkbox on the Billing page.
        'refund_remaining': round(refund_amount - applied, 2) if visit.refund_mode == 'apply_to_bill' else 0,
        'location_id': visit.location_id,
        'payment_status': visit.payment_status,
        'payment_mode': visit.payment_mode,
        'created_at': visit.created_at.isoformat() if visit.created_at else None,
        'updated_at': visit.updated_at.isoformat() if hasattr(visit, 'updated_at') and visit.updated_at else None
    }), 200
```

with:

```python
@visits.route('/visits/<visit_id>', methods=['GET'])
@require_auth
def get_visit(visit_id):
    visit = Visit.query.get_or_404(visit_id)
    patient = Patient.query.get(visit.patient_id)
    # Drives the Billing page's "Add Refund" control — that fold-into-bill
    # behavior only exists for a visit's first bill, so the frontend needs
    # to know upfront whether one already exists.
    has_bill = db.session.query(Bill.invoice_id).filter(Bill.visit_id == visit_id).first() is not None
    return jsonify({
        'visit_id': visit.visit_id,
        'patient_id': visit.patient_id,
        'patient_name': patient.name if patient else 'Unknown',
        'phone_number': patient.phone_number if patient else None,
        'dob': patient.dob.strftime('%Y-%m-%d') if patient and patient.dob else None,
        'visit_date': visit.visit_date.strftime('%Y-%m-%d') if visit.visit_date else None,
        'visit_time': visit.visit_time.strftime('%H:%M') if visit.visit_time else None,
        'reason': visit.reason,
        'status': visit.status,
        'visiting_fee': visit.visiting_fee,
        'amount_paid': visit.amount_paid,
        'refund_amount': visit.refund_amount or 0,
        'refund_mode': visit.refund_mode,
        'has_bill': has_bill,
        'location_id': visit.location_id,
        'payment_status': visit.payment_status,
        'payment_mode': visit.payment_mode,
        'created_at': visit.created_at.isoformat() if visit.created_at else None,
        'updated_at': visit.updated_at.isoformat() if hasattr(visit, 'updated_at') and visit.updated_at else None
    }), 200
```

- [ ] **Step 3: Rewrite `refund_visit` as a pure incremental direct payout**

Replace the entire function (from the `@visits.route('/visits/<visit_id>/refund'...)` decorator through its closing `}), 200`) with:

```python
@visits.route('/visits/<visit_id>/refund', methods=['POST'])
@require_auth
def refund_visit(visit_id):
    """Issues a direct payout refund on a visit — always debits the mode's
    bucket immediately (visit_upi -> Visit UPI, billing_upi -> Billing UPI,
    cash -> Billing Cash) and never touches any bill, regardless of whether
    the visit has one. `amount` is an increment on top of whatever's already
    been refunded, not a new total — call this again for a second refund
    event on the same visit."""
    if g.current_user.get('role') == 'doctor':
        return jsonify({'error': 'Not authorized to issue refunds'}), 403

    visit = Visit.query.get_or_404(visit_id)
    data = request.get_json() or {}

    try:
        amount = float(data.get('amount'))
    except (TypeError, ValueError):
        return jsonify({'error': 'A refund amount is required'}), 400

    if amount <= 0:
        return jsonify({'error': 'Refund amount must be positive'}), 400

    mode = (data.get('mode') or '').strip().lower()
    if mode not in REFUND_MODES:
        return jsonify({'error': 'A valid refund settlement type is required'}), 400

    previous_total = float(visit.refund_amount or 0)
    amount_paid = float(visit.amount_paid or 0)
    new_total = previous_total + amount
    if new_total > amount_paid:
        return jsonify({'error': f'Cannot refund more than the ₹{amount_paid:.2f} collected for this visit'}), 400

    visit.refund_amount = new_total
    visit.refund_mode = mode
    visit.payment_status = 'refunded'
    visit.updated_at = get_ist_now()
    db.session.add(VisitRefund(visit_id=visit_id, amount=amount, mode=mode))
    db.session.commit()

    log_activity(
        action='REFUND',
        resource_type='visit',
        resource_id=visit_id,
        resource_label=f"{visit_id} — refunded ₹{amount:.2f} via {mode} (total now ₹{new_total:.2f})",
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({
        'message': 'Refund recorded',
        'refund_amount': visit.refund_amount,
        'refund_mode': visit.refund_mode,
        'location_id': visit.location_id,
        'payment_status': visit.payment_status,
    }), 200
```

- [ ] **Step 4: Restart the backend**

Run: `cd Backend_db && source venv/bin/activate && python app.py`
Expected: starts with no import errors (confirms `_refund_applied_to_bills`
wasn't referenced anywhere else — if it was, you'll get a `NameError` at
call time instead of at import time, so also grep for it: `grep -rn
_refund_applied_to_bills Backend_db/` should return nothing).

- [ ] **Step 5: Verify with curl — happy path**

Pick a real `visit_id` from your dev DB with `visiting_fee`/`amount_paid` >
0 (e.g. via `psql "$DATABASE_URL" -c "SELECT visit_id, amount_paid,
refund_amount FROM visits WHERE amount_paid > 0 LIMIT 1;"`), and a dev JWT
per `CLAUDE.md`'s auth-bypass section (role must not be `doctor`).

```bash
curl -s --cookie "auth_token=$JWT" -X POST \
  http://localhost:5000/api/visits/<visit_id>/refund \
  -H 'Content-Type: application/json' \
  -d '{"amount": 10, "mode": "visit_upi"}'
```

Expected: `200`, JSON with `refund_amount` equal to (previous
`refund_amount` + 10), `refund_mode: "visit_upi"`, `payment_status:
"refunded"`.

- [ ] **Step 6: Verify with curl — rejection paths**

```bash
curl -s --cookie "auth_token=$JWT" -X POST \
  http://localhost:5000/api/visits/<visit_id>/refund \
  -H 'Content-Type: application/json' -d '{"amount": 10, "mode": "apply_to_bill"}'
```
Expected: `400`, `{"error": "A valid refund settlement type is required"}`.

```bash
curl -s --cookie "auth_token=$JWT" -X POST \
  http://localhost:5000/api/visits/<visit_id>/refund \
  -H 'Content-Type: application/json' -d '{"amount": 999999, "mode": "cash"}'
```
Expected: `400`, error mentioning "Cannot refund more than".

- [ ] **Step 7: Verify `has_bill` on `GET /visits/<id>`**

```bash
curl -s --cookie "auth_token=$JWT" http://localhost:5000/api/visits/<visit_id> | python3 -m json.tool
```
Expected: response includes `"has_bill": false` (or `true` if that visit
already has a bill in your dev DB) and does **not** include a
`refund_remaining` key at all.

- [ ] **Step 8: Commit**

```bash
git add Backend_db/routes/visits.py
git commit -m "refactor(refund): rewrite /visits/<id>/refund as incremental direct payout"
```

---

### Task 3: Backend — `POST /billing` gains `refund`, replacing `apply_visit_refund`

**Files:**
- Modify: `Backend_db/routes/billing.py:1-11` (imports/module top — add `REFUND_MODES` constant and `VisitRefund` import), `:192-210` (the `apply_visit_refund` block and the fields it sets on `new_bill`), `:224-229` (the JSON response)

**Interfaces:**
- Consumes: `Visit`, `Bill`, `VisitRefund` models (already/newly imported); `visit`, `visit_id`, `final_total`, `invoice_id`, `new_bill` locals already defined earlier in `create_bill` (unchanged by this task).
- Produces: `POST /billing` request body gains optional `refund: {amount: number, mode: 'visit_upi'|'billing_upi'|'cash'}`. Response keeps its existing `visit_refund_applied` key (same meaning as before: how much of this specific bill's total came from a folded-in refund, or `null`).

- [ ] **Step 1: Import what's newly needed and add the local `REFUND_MODES`**

Replace:

```python
from models import Bill, BillItem, Patient, Visit, ProductMaster, InventoryBatch, InventoryHistory, User, Location
from sqlalchemy import func
from utils import generate_invoice_id
from .auth import require_auth, log_activity

billing = Blueprint('billing', __name__)
```

with:

```python
from models import Bill, BillItem, Patient, Visit, VisitRefund, ProductMaster, InventoryBatch, InventoryHistory, User, Location
from sqlalchemy import func
from utils import generate_invoice_id
from .auth import require_auth, log_activity

billing = Blueprint('billing', __name__)

# Kept in sync with routes/visits.py's REFUND_MODES by hand (duplicated
# rather than cross-imported to avoid coupling the billing and visits
# blueprints together).
REFUND_MODES = ('visit_upi', 'billing_upi', 'cash')
```

- [ ] **Step 2: Replace the `apply_visit_refund` block with the new `refund` handling**

Replace:

```python
    # Fold in a pending 'apply_to_bill' visit refund, if the caller opted in.
    # Applies against whatever's left unconsumed (a visit can have several
    # bills — the refund is always spent against the first one(s) created,
    # never split evenly). Floors this bill at ₹0 rather than going negative;
    # any excess simply stays unconsumed for the next bill on this visit.
    refund_applied = None
    if visit and data.get('apply_visit_refund') and visit.refund_mode == 'apply_to_bill':
        already_applied = float(db.session.query(func.coalesce(func.sum(Bill.visit_refund_applied), 0))
                                 .filter(Bill.visit_id == visit_id).scalar() or 0)
        remaining = float(visit.refund_amount or 0) - already_applied
        if remaining > 0:
            refund_applied = min(remaining, final_total)
            final_total -= refund_applied

    new_bill.subtotal_amount = subtotal_amount
    new_bill.discount_type = discount_type
    new_bill.discount_value = discount_value
    new_bill.total_amount = final_total
    new_bill.visit_refund_applied = refund_applied
```

with:

```python
    # A refund entered while creating this bill. Visit UPI is always a pure
    # payout (never touches the bill). Billing UPI and Cash apply to this
    # bill's total first — but only if this is the visit's *first* bill; a
    # bill's total is only ever touched live, at its own creation, so a 2nd+
    # bill never has a refund folded into it even if one is submitted here.
    # Any amount beyond what the bill absorbs (or the whole amount, for a
    # non-first bill or visit_upi) is a direct payout, logged the same way
    # /visits/<id>/refund would log it — only the payout portion gets a
    # VisitRefund row; the applied portion never left a till, so it's
    # accounted for purely via visit_refund_applied + Daily Summary's
    # billing_refund bucket, not logged again here.
    refund_applied = None
    refund_payload = data.get('refund')
    if refund_payload and visit:
        try:
            refund_requested = float(refund_payload.get('amount'))
        except (TypeError, ValueError):
            return jsonify({'error': 'refund.amount must be a number'}), 400
        if refund_requested <= 0:
            return jsonify({'error': 'refund.amount must be positive'}), 400
        refund_mode = (refund_payload.get('mode') or '').strip().lower()
        if refund_mode not in REFUND_MODES:
            return jsonify({'error': 'A valid refund settlement type is required'}), 400

        previous_refund_total = float(visit.refund_amount or 0)
        amount_paid = float(visit.amount_paid or 0)
        new_refund_total = previous_refund_total + refund_requested
        if new_refund_total > amount_paid:
            return jsonify({'error': f'Cannot refund more than the ₹{amount_paid:.2f} collected for this visit'}), 400

        is_first_bill = db.session.query(Bill.invoice_id).filter(
            Bill.visit_id == visit_id, Bill.invoice_id != invoice_id
        ).first() is None

        applied = 0.0
        if is_first_bill and refund_mode in ('billing_upi', 'cash'):
            applied = min(refund_requested, final_total)
            final_total -= applied
        payout = refund_requested - applied

        visit.refund_amount = new_refund_total
        visit.refund_mode = refund_mode
        visit.payment_status = 'refunded'
        visit.updated_at = get_ist_now()
        if payout > 0:
            db.session.add(VisitRefund(visit_id=visit_id, amount=payout, mode=refund_mode))
        if applied > 0:
            refund_applied = applied

    new_bill.subtotal_amount = subtotal_amount
    new_bill.discount_type = discount_type
    new_bill.discount_value = discount_value
    new_bill.total_amount = final_total
    new_bill.visit_refund_applied = refund_applied
```

- [ ] **Step 3: Verify the response block needs no changes**

Read `Backend_db/routes/billing.py` around line 224-229 — confirm it still
reads `'visit_refund_applied': refund_applied` (it does; `refund_applied`
is still the right variable name and still `None` when nothing was
applied). No edit needed here — this step is a check, not a change.

- [ ] **Step 4: Restart the backend**

Run: `cd Backend_db && source venv/bin/activate && python app.py`
Expected: starts cleanly, no import errors.

- [ ] **Step 5: Verify with curl — refund folds into a visit's first bill**

Create a fresh visit with a fee, then create its first bill with a
`refund` that's smaller than the bill total:

```bash
# 1. Create a visit (adjust patient_id to a real one in your dev DB)
curl -s --cookie "auth_token=$JWT" -X POST http://localhost:5000/api/visits \
  -H 'Content-Type: application/json' \
  -d '{"patient_id": "<patient_id>", "visit_date": "2026-08-14", "visiting_fee": 500, "amount_paid": 500, "payment_status": "full"}'
# note the returned visit_id

# 2. Create its first bill with a ₹200 Billing UPI refund folded in
curl -s --cookie "auth_token=$JWT" -X POST http://localhost:5000/api/billing \
  -H 'Content-Type: application/json' \
  -d '{"patient_id": "<patient_id>", "visit_id": "<visit_id>", "location_id": <a_valid_location_id>, "payment_type": "CASH", "items_used": [{"item_id": <a_valid_product_id>, "quantity": 1, "qty": 1, "mrp": 300, "total_value": 300}], "refund": {"amount": 200, "mode": "billing_upi"}}'
```

Expected: `201`, response has `"visit_refund_applied": 200`, `"total":
100` (300 item total − 200 applied). Then:

```bash
curl -s --cookie "auth_token=$JWT" http://localhost:5000/api/visits/<visit_id> | python3 -m json.tool
```

Expected: `refund_amount: 200`, `refund_mode: "billing_upi"`, `has_bill:
true`.

```bash
psql "$DATABASE_URL" -c "SELECT visit_id, amount, mode FROM visit_refunds WHERE visit_id = '<visit_id>';"
```

Expected: **zero rows** — the ₹200 was fully absorbed by the bill (no
payout portion), so no `VisitRefund` row should exist for it.

- [ ] **Step 6: Verify with curl — refund exceeding the bill total produces a payout**

Create a second visit/bill pair, this time with a refund bigger than the
bill's total (e.g. visiting_fee 500, bill item total 100, refund amount
300, mode `cash`):

Expected: response `"visit_refund_applied": 100` (capped at the bill
total), `"total": 0`. Then:

```bash
psql "$DATABASE_URL" -c "SELECT visit_id, amount, mode FROM visit_refunds WHERE visit_id = '<visit_id>';"
```

Expected: **one row**, `amount = 200` (the 300 − 100 overflow),
`mode = 'cash'`.

- [ ] **Step 7: Verify with curl — refund on a visit's 2nd bill never touches that bill's total**

Using the visit_id from Step 5 (which already has one bill), create a
**second** bill for the same visit with another `refund` in the payload
(mode `billing_upi`, amount 50).

Expected: response `"visit_refund_applied": null` — the amount instead
shows up entirely as a payout:

```bash
psql "$DATABASE_URL" -c "SELECT visit_id, amount, mode FROM visit_refunds WHERE visit_id = '<visit_id>' ORDER BY created_at;"
```

Expected: a new row with `amount = 50`, `mode = 'billing_upi'` (in
addition to any row from Step 5/6), and the 2nd bill's own `total_amount`
in the DB is unreduced by it.

- [ ] **Step 8: Commit**

```bash
git add Backend_db/routes/billing.py
git commit -m "feat(refund): fold refunds into a visit's first bill only, in POST /billing"
```

---

### Task 4: Backend — Daily Summary's `REFUND_BUCKET_MAP` for the 3 modes

**Files:**
- Modify: `Backend_db/routes/daily_summary.py:177-190`

**Interfaces:**
- Consumes: `VisitRefund` rows written by Task 2/3 (already only ever hold
  a payout mode/amount, never an applied-to-bill portion).
- Produces: no interface change — same `summary.refund`/`summary.visit_fee`/
  `summary.billing_fee` bucket shapes as before.

- [ ] **Step 1: Update the map and its comment**

Replace:

```python
    # ── Refunds issued today (may belong to visits from any earlier day) ──────
    # Payout refunds are tagged with exactly which till they came out of —
    # subtract from that bucket directly (so "Visit Cash"/"Billing UPI" etc.
    # are true net-of-refunds tally figures), while still logging into the
    # info-only 'refund' bucket (split by cash/upi regardless of source) for
    # at-a-glance reconciliation. 'apply_to_bill' refunds never reach this log
    # at all — see routes/visits.py — they're accounted for via billing_refund
    # above instead, since they never left any till.
    REFUND_BUCKET_MAP = {
        'visit_cash': ('visit_fee', 'cash'),
        'visit_upi': ('visit_fee', 'upi'),
        'billing_cash': ('billing_fee', 'cash'),
        'billing_upi': ('billing_fee', 'upi'),
    }
```

with:

```python
    # ── Refunds issued today (may belong to visits from any earlier day) ──────
    # Payout refunds are tagged with exactly which till they came out of —
    # subtract from that bucket directly (so "Visit Fee"/"Billing Fee" etc.
    # are true net-of-refunds tally figures), while still logging into the
    # info-only 'refund' bucket (split by cash/upi regardless of source) for
    # at-a-glance reconciliation. Cash refunds always debit Billing Cash —
    # Visit Cash is never touched by a refund. A refund folded into a bill
    # never reaches this log at all (see routes/billing.py) — it's accounted
    # for via billing_refund above instead, since it never left any till.
    REFUND_BUCKET_MAP = {
        'visit_upi': ('visit_fee', 'upi'),
        'billing_upi': ('billing_fee', 'upi'),
        'cash': ('billing_fee', 'cash'),
    }
```

- [ ] **Step 2: Restart the backend**

Run: `cd Backend_db && source venv/bin/activate && python app.py`
Expected: starts cleanly.

- [ ] **Step 3: Verify with curl**

Using the `cash` payout refund created in Task 3 Step 6 (or issue a fresh
`cash`-mode refund via `/visits/<id>/refund`), hit Daily Summary for that
visit's date:

```bash
curl -s --cookie "auth_token=$JWT" "http://localhost:5000/api/daily_summary?date=2026-08-14" | python3 -m json.tool
```

Expected: `summary.billing_fee.cash` is reduced by that refund amount
relative to what it'd be without it, `summary.refund.cash` shows the
positive info-only figure, and `summary.visit_fee.cash` is **unaffected**
by it (confirming cash refunds no longer touch Visit Cash).

- [ ] **Step 4: Commit**

```bash
git add Backend_db/routes/daily_summary.py
git commit -m "refactor(refund): update Daily Summary's REFUND_BUCKET_MAP for the 3 modes"
```

---

### Task 5: Frontend — `lib/api.ts` type updates

**Files:**
- Modify: `frontend/lib/api.ts:19-22` (`RefundMode`), `:36-49` (`Visit` interface), `:490-500` (`refundVisit` — confirm doc comment, no signature change)

**Interfaces:**
- Produces: `RefundMode = 'visit_upi' | 'billing_upi' | 'cash'`. `Visit`
  gains `has_bill?: boolean`, loses `refund_remaining?: number`.
  `api.refundVisit(id, amount, mode)` — same signature, `amount` is now
  documented as an increment.

- [ ] **Step 1: Narrow `RefundMode`**

Replace:

```typescript
// The 4 payout codes each name exactly one till the money physically came
// out of; apply_to_bill means the refund is still pending, to be folded into
// a future bill's total instead of paid out directly.
export type RefundMode = 'visit_cash' | 'visit_upi' | 'billing_cash' | 'billing_upi' | 'apply_to_bill' | string;
```

with:

```typescript
// Visit UPI is always a direct payout; Billing UPI and Cash apply to a
// visit's first bill (if one's being created right now) before falling
// back to a direct payout — same rule everywhere this type is used, see
// docs/superpowers/specs/2026-08-14-refund-redesign-design.md. Cash always
// debits Billing Cash, never Visit Cash.
export type RefundMode = 'visit_upi' | 'billing_upi' | 'cash';
```

- [ ] **Step 2: Update the `Visit` interface**

Replace:

```typescript
    refund_amount?: number;
    refund_mode?: RefundMode;
    // Only meaningful when refund_mode is 'apply_to_bill' — how much of the
    // pending refund hasn't yet been folded into a bill.
    refund_remaining?: number;
    payment_status?: string;
```

with:

```typescript
    refund_amount?: number;
    refund_mode?: RefundMode;
    // Whether this visit already has at least one bill — drives the Billing
    // page's "Add Refund" control, which only folds into a bill when it's
    // the visit's first one.
    has_bill?: boolean;
    payment_status?: string;
```

- [ ] **Step 3: Update `refundVisit`'s doc comment**

Find the `refundVisit` method (around line 490-500) and replace its
preceding comment:

```typescript
    // `amount` is the visit's total desired refund (not a delta) — editing an
    // existing refund up or down is just resubmitting a different number.
```

with:

```typescript
    // `amount` is an increment on top of whatever's already been refunded on
    // this visit, not a new total — call again for a second refund event.
```

(Leave the function signature and body untouched — only the comment
changes; the endpoint call shape was already correct.)

- [ ] **Step 4: Verify the frontend still typechecks**

Run: `cd frontend && npx tsc --noEmit`
Expected: fails at this point — `EditVisitDialog.tsx` and
`app/billing/page.tsx` still reference the old 5-mode `<option>` values
and the now-removed `refund_remaining`/`apply_to_bill` usages. That's
expected; Tasks 6 and 7 fix those. Confirm the errors reported are
**only** in those two files (not e.g. `InvoicePrint.tsx` or
`PrintInvoiceDialog.tsx`, which don't touch `RefundMode` at all).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "refactor(refund): narrow RefundMode to 3 values, add Visit.has_bill"
```

---

### Task 6: Frontend — `EditVisitDialog.tsx` drops the refund checkbox

**Files:**
- Modify: `frontend/components/EditVisitDialog.tsx:37-44` (state), `:56-59` (the effect that seeds it), `:80-91` (validation in `handleSubmit`), `:107-109` (the conditional `refundVisit` call), `:242-281` (the JSX block)

**Interfaces:**
- Consumes: `api.refundVisit(id, amount, mode)` from Task 5 (unchanged
  signature). `RefundMode` type from Task 5.
- Produces: no exported interface change — this is a leaf component.

- [ ] **Step 1: Replace the refund state**

Replace:

```typescript
    // Refund reflects the visit's current total refund and is directly editable —
    // reopening a visit that already has a refund pre-checks the box and pre-fills
    // the existing amount/mode, so increasing or decreasing it is just editing the
    // number and saving again. Unchecking the box means "don't touch the refund
    // this save" (not "clear it") — to remove a refund entirely, edit it down to 0.
    const [refundChecked, setRefundChecked] = useState(false)
    const [refundInput, setRefundInput] = useState("")
    const [refundMode, setRefundMode] = useState<"" | RefundMode>("")
```

with:

```typescript
    // A fresh refund event on top of whatever's already been refunded —
    // purely additive, there's no "edit the running total" concept anymore.
    // Left blank, no refund is issued on this save.
    const [refundInput, setRefundInput] = useState("")
    const [refundMode, setRefundMode] = useState<"" | RefundMode>("")
```

- [ ] **Step 2: Simplify the seeding effect**

Replace:

```typescript
            const existingRefund = visit.refund_amount || 0
            setRefundChecked(existingRefund > 0)
            setRefundInput(existingRefund > 0 ? existingRefund.toString() : "")
            setRefundMode(visit.refund_mode || "")
```

with:

```typescript
            setRefundInput("")
            setRefundMode("")
```

- [ ] **Step 3: Update the submit validation**

Replace:

```typescript
        let newRefundTotal: number | null = null
        if (refundChecked) {
            newRefundTotal = parseFloat(refundInput || '0')
            if (!(newRefundTotal >= 0) || newRefundTotal > visitingFee) {
                alert(`Enter a refund amount between ₹0 and ₹${visitingFee.toFixed(2)}`)
                return
            }
            if (newRefundTotal > 0 && !refundMode) {
                alert("Select how this refund is being settled")
                return
            }
        }
```

with:

```typescript
        const refundIncrement = parseFloat(refundInput || '0')
        if (refundIncrement > 0) {
            if (refundedSoFar + refundIncrement > visitingFee) {
                alert(`Enter a refund amount up to ₹${(visitingFee - refundedSoFar).toFixed(2)} (already refunded ₹${refundedSoFar.toFixed(2)})`)
                return
            }
            if (!refundMode) {
                alert("Select how this refund is being settled")
                return
            }
        }
```

- [ ] **Step 4: Update the conditional `refundVisit` call**

Replace:

```typescript
            if (newRefundTotal !== null) {
                await api.refundVisit(visit.visit_id, newRefundTotal, refundMode || undefined)
            }
```

with:

```typescript
            if (refundIncrement > 0) {
                await api.refundVisit(visit.visit_id, refundIncrement, refundMode)
            }
```

- [ ] **Step 5: Replace the refund JSX block**

Replace the entire block from `{canRefund && (` through its matching `)}`
(the checkbox + amount input + mode select):

```jsx
                        {canRefund && (
                            <div className="space-y-2">
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="checkbox"
                                        id="edit-refund-check"
                                        checked={refundChecked}
                                        onChange={(e) => setRefundChecked(e.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                    <label htmlFor="edit-refund-check" className="text-sm font-medium cursor-pointer select-none">
                                        Refund
                                    </label>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <Input
                                        id="edit-refund-amount"
                                        type="number"
                                        value={refundInput}
                                        onChange={(e) => setRefundInput(e.target.value)}
                                        placeholder="0"
                                        disabled={!refundChecked}
                                    />
                                    <select
                                        id="edit-refund-mode"
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        value={refundMode}
                                        onChange={(e) => setRefundMode(e.target.value as RefundMode)}
                                        disabled={!refundChecked}
                                    >
                                        <option value="" disabled>Settle via...</option>
                                        <option value="visit_cash">Visit Cash</option>
                                        <option value="visit_upi">Visit UPI</option>
                                        <option value="billing_cash">Billing Cash</option>
                                        <option value="billing_upi">Billing UPI</option>
                                        <option value="apply_to_bill">Apply to Bill</option>
                                    </select>
                                </div>
                            </div>
                        )}
```

with:

```jsx
                        {canRefund && (
                            <div className="space-y-2">
                                <label htmlFor="edit-refund-amount" className="text-sm font-medium">
                                    Issue a refund
                                </label>
                                <div className="grid grid-cols-2 gap-4">
                                    <Input
                                        id="edit-refund-amount"
                                        type="number"
                                        value={refundInput}
                                        onChange={(e) => setRefundInput(e.target.value)}
                                        placeholder="0"
                                    />
                                    <select
                                        id="edit-refund-mode"
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        value={refundMode}
                                        onChange={(e) => setRefundMode(e.target.value as RefundMode)}
                                    >
                                        <option value="" disabled>Settle via...</option>
                                        <option value="visit_upi">Visit UPI</option>
                                        <option value="billing_upi">Billing UPI</option>
                                        <option value="cash">Cash</option>
                                    </select>
                                </div>
                            </div>
                        )}
```

- [ ] **Step 6: Manual browser verification**

Start both dev servers (`Backend_db`: `python app.py`;
`frontend`: `npm run dev`). Using Playwright MCP (or by hand) with the
JWT-cookie auth-bypass from `CLAUDE.md`:
1. Navigate to `/` (dashboard), open a visit with `visiting_fee > 0` via
   its edit dialog.
2. Confirm no checkbox is rendered — just an "Issue a refund" label,
   amount input, and a 3-option "Settle via..." select (Visit UPI /
   Billing UPI / Cash — no "Visit Cash", "Billing Cash", or "Apply to
   Bill").
3. Enter an amount + select a mode, click "Update Visit".
4. Expected: dialog closes, no error toast/alert. Reopen the same visit's
   edit dialog — "Refunded: ₹X / Net: ₹Y" now shows above the fee fields
   with the amount just entered, and the amount/mode inputs are blank
   again (ready for a second, independent refund event).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/EditVisitDialog.tsx
git commit -m "refactor(refund): drop refund checkbox from EditVisitDialog, make additive"
```

---

### Task 7: Frontend — Billing page refund UI redesign

**Files:**
- Modify: `frontend/app/billing/page.tsx:116-126` (refund-related state),
  `:180-194` (seeding effect + `pendingBillRefund`), `:307-309` (near
  `removeItem`, add a sibling for the refund line), `:325-385`
  (`handleCreateBill`'s payload + reset), `:387-420` (delete
  `handleRefund` entirely), `:422-437` (totals math), `:590-641` (delete
  the old standalone refund block), `:664-802` (items table — append the
  refund row), `:804-878` (totals card — remove old summary rows, fix the
  always-visible bug, add the "Add Refund" control)

**Interfaces:**
- Consumes: `api.createBill(payload)` — payload gains `refund?: {amount:
  number, mode: RefundMode}` replacing `apply_visit_refund`. `Visit.has_bill`
  from Task 5.
- Produces: no exported interface change — this is a page component.

- [ ] **Step 1: Replace the refund-related state block**

Replace:

```typescript
    // Visit refund — only meaningful when Billing was opened from a specific visit
    // (visit_id in the URL, e.g. the dashboard's "Go to Billing" action). A plain
    // patient search doesn't point at any one visit, so there's nothing to refund.
    const [linkedVisit, setLinkedVisit] = useState<Visit | null>(null)
    const [refundChecked, setRefundChecked] = useState(false)
    const [refundValue, setRefundValue] = useState("")
    const [refundMode, setRefundMode] = useState<"" | RefundMode>("")
    const [refundSubmitting, setRefundSubmitting] = useState(false)
    // Only offered when the linked visit has a pending 'apply_to_bill' refund —
    // folds whatever's left of it into this new bill instead of paying it out.
    const [applyRefundToBill, setApplyRefundToBill] = useState(false)
```

with:

```typescript
    // Visit refund — only meaningful when Billing was opened from a specific visit
    // (visit_id in the URL, e.g. the dashboard's "Go to Billing" action). A plain
    // patient search doesn't point at any one visit, so there's nothing to refund.
    const [linkedVisit, setLinkedVisit] = useState<Visit | null>(null)
    // A refund entered while building this bill. Only meaningful for a
    // visit's first bill — see the "Add Refund" control, which is only
    // rendered when linkedVisit.has_bill is false. Staged client-side only:
    // nothing is sent to the backend until "Create Bill" is clicked, so
    // deleting it before then discards it silently. At most one at a time.
    const [refundLine, setRefundLine] = useState<{ amount: number; mode: RefundMode } | null>(null)
    const [refundDraftAmount, setRefundDraftAmount] = useState("")
    const [refundDraftMode, setRefundDraftMode] = useState<"" | RefundMode>("")
```

- [ ] **Step 2: Replace the seeding effect and `pendingBillRefund`**

Replace:

```typescript
    // Refund reflects the visit's current total refund and is directly editable —
    // whenever the linked visit (re)loads, pre-check the box and pre-fill the
    // existing amount/mode if one exists, so increasing/decreasing it is just
    // editing the number and resubmitting.
    useEffect(() => {
        const existingRefund = linkedVisit?.refund_amount || 0
        setRefundChecked(existingRefund > 0)
        setRefundValue(existingRefund > 0 ? existingRefund.toString() : "")
        setRefundMode(linkedVisit?.refund_mode || "")
        setApplyRefundToBill(false)
    }, [linkedVisit])

    // How much of a pending 'apply_to_bill' refund is still unconsumed —
    // drives the "Apply pending refund" checkbox and the live total preview.
    const pendingBillRefund = linkedVisit?.refund_mode === 'apply_to_bill' ? (linkedVisit.refund_remaining || 0) : 0
```

with:

```typescript
    // Whenever the linked visit (re)loads, clear any staged refund draft —
    // it belonged to whatever visit was linked before.
    useEffect(() => {
        setRefundLine(null)
        setRefundDraftAmount("")
        setRefundDraftMode("")
    }, [linkedVisit])

    // The "Add Refund" control only makes sense while building a visit's
    // first bill — once a bill exists, folding a refund into it is no
    // longer possible (see the backend's is_first_bill check), so offering
    // the control at all would be misleading.
    const canAddRefund = !walkInMode && !!linkedVisit && !linkedVisit.has_bill && !refundLine
```

- [ ] **Step 3: Add `removeRefundLine` next to `removeItem`**

Replace:

```typescript
    const removeItem = (index: number) => {
        setBillItems(billItems.filter((_, i) => i !== index))
    }
```

with:

```typescript
    const removeItem = (index: number) => {
        setBillItems(billItems.filter((_, i) => i !== index))
    }

    const addRefundLine = () => {
        const amount = parseFloat(refundDraftAmount || '0')
        if (!(amount > 0) || !refundDraftMode) return
        setRefundLine({ amount, mode: refundDraftMode })
        setRefundDraftAmount("")
        setRefundDraftMode("")
    }

    const removeRefundLine = () => setRefundLine(null)
```

- [ ] **Step 4: Update `handleCreateBill`'s payload and reset**

Replace:

```typescript
                apply_visit_refund: (!walkInMode && pendingBillRefund > 0 && applyRefundToBill) || undefined,
```

with:

```typescript
                refund: refundLine ? { amount: refundLine.amount, mode: refundLine.mode } : undefined,
```

Then replace:

```typescript
            const data = await api.createBill(payload)
            setBillItems([])
            setDiscountValue("")
            setApplyRefundToBill(false)
```

with:

```typescript
            const data = await api.createBill(payload)
            setBillItems([])
            setDiscountValue("")
            setRefundLine(null)
```

- [ ] **Step 5: Delete `handleRefund` entirely**

Remove the whole function (from `const handleRefund = async () => {`
through its closing `}`, roughly lines 387-420 in the original file).

- [ ] **Step 6: Update the totals math**

Replace:

```typescript
    const preRefundTotal = subtotal - discountAmount
    // Never more than what's left of the pending refund, and never more than
    // the bill itself — any excess simply stays unconsumed for a later bill.
    const refundToApply = applyRefundToBill ? Math.min(pendingBillRefund, preRefundTotal) : 0
    const finalTotal = preRefundTotal - refundToApply
```

with:

```typescript
    const preRefundTotal = subtotal - discountAmount
    // Mirrors the backend: capped at the bill's own total, never negative —
    // any excess becomes a direct payout server-side instead of a bill
    // deduction (see routes/billing.py create_bill).
    const refundToApply = refundLine ? Math.min(refundLine.amount, preRefundTotal) : 0
    const finalTotal = preRefundTotal - refundToApply
```

- [ ] **Step 7: Delete the old standalone refund block**

Remove the entire block from `{linkedVisit && !walkInMode && (` (the
checkbox + Value input + Settle-via select + Submit Refund button) through
its matching `)}`, immediately after the "Walk-in Bill" `<Button>` and
before the closing `</div>` of the left-side actions group:

```jsx
                                    {linkedVisit && !walkInMode && (
                                        <div className="flex items-center gap-2 shrink-0">
                                            <div className="flex items-center space-x-2">
                                                <input
                                                    type="checkbox"
                                                    id="billing-refund-check"
                                                    checked={refundChecked}
                                                    onChange={(e) => {
                                                        setRefundChecked(e.target.checked)
                                                        if (!e.target.checked) {
                                                            setRefundValue("")
                                                            setRefundMode("")
                                                        }
                                                    }}
                                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                                />
                                                <label htmlFor="billing-refund-check" className="text-sm font-medium cursor-pointer select-none">
                                                    Refund
                                                </label>
                                            </div>
                                            <Input
                                                type="number"
                                                placeholder="Value"
                                                className="w-24 h-10"
                                                value={refundValue}
                                                onChange={(e) => setRefundValue(e.target.value)}
                                                disabled={!refundChecked}
                                            />
                                            <Select value={refundMode} onValueChange={(v) => setRefundMode(v as RefundMode)} disabled={!refundChecked}>
                                                <SelectTrigger className="w-36 h-10">
                                                    <SelectValue placeholder="Settle via..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="visit_cash">Visit Cash</SelectItem>
                                                    <SelectItem value="visit_upi">Visit UPI</SelectItem>
                                                    <SelectItem value="billing_cash">Billing Cash</SelectItem>
                                                    <SelectItem value="billing_upi">Billing UPI</SelectItem>
                                                    <SelectItem value="apply_to_bill">Apply to Bill</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="h-10 shrink-0"
                                                disabled={!refundChecked || refundSubmitting}
                                                onClick={handleRefund}
                                            >
                                                {refundSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                Submit Refund
                                            </Button>
                                        </div>
                                    )}
```

Delete it — nothing replaces it here (the replacement control lives by the
Items table, added in Step 9).

- [ ] **Step 8: Append a refund row to the items table**

In the `<TableBody>`, replace:

```jsx
                                        {billItems.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                                    Search and add items to bill.
                                                </TableCell>
                                            </TableRow>
                                        )}
```

with:

```jsx
                                        {refundLine && (
                                            <TableRow>
                                                <TableCell>{billItems.length + 1}</TableCell>
                                                <TableCell className="font-medium text-destructive">
                                                    Refund ({refundLine.mode === 'billing_upi' ? 'Billing UPI' : 'Cash'})
                                                </TableCell>
                                                <TableCell />
                                                <TableCell />
                                                <TableCell />
                                                <TableCell className="text-destructive">−{refundLine.amount.toFixed(2)}</TableCell>
                                                <TableCell>
                                                    <Button variant="ghost" size="sm" onClick={removeRefundLine}>
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {billItems.length === 0 && !refundLine && (
                                            <TableRow>
                                                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                                    Search and add items to bill.
                                                </TableCell>
                                            </TableRow>
                                        )}
```

- [ ] **Step 9: Add the "Add Refund" control above the Items table, and fix the always-visible Total bug**

Replace:

```jsx
                            {/* Items */}
                            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                                <h3 className="font-semibold text-base mb-3 shrink-0">Items</h3>
```

with:

```jsx
                            {/* Items */}
                            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                                <div className="flex items-center justify-between mb-3 shrink-0 flex-wrap gap-2">
                                    <h3 className="font-semibold text-base">Items</h3>
                                    {canAddRefund && (
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                placeholder="Refund value"
                                                className="w-32 h-8"
                                                value={refundDraftAmount}
                                                onChange={(e) => setRefundDraftAmount(e.target.value)}
                                            />
                                            <Select value={refundDraftMode} onValueChange={(v) => setRefundDraftMode(v as RefundMode)}>
                                                <SelectTrigger className="w-32 h-8">
                                                    <SelectValue placeholder="Settle via..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="billing_upi">Billing UPI</SelectItem>
                                                    <SelectItem value="cash">Cash</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-8"
                                                disabled={!(parseFloat(refundDraftAmount || '0') > 0) || !refundDraftMode}
                                                onClick={addRefundLine}
                                            >
                                                Add Refund
                                            </Button>
                                        </div>
                                    )}
                                </div>
```

Then replace the totals card's outer gate and its Subtotal/Refund-Applied
rows:

```jsx
                            {billItems.length > 0 && (
                                <div className="flex justify-end mt-4 shrink-0">
                                    <div className="flex flex-col items-end gap-2 min-w-[260px]">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-muted-foreground">Discount</span>
                                            <div className="flex rounded-md border overflow-hidden">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant={discountType === "percent" ? "default" : "ghost"}
                                                    className="rounded-none h-8 px-2.5"
                                                    onClick={() => setDiscountType("percent")}
                                                >
                                                    %
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant={discountType === "flat" ? "default" : "ghost"}
                                                    className="rounded-none h-8 px-2.5"
                                                    onClick={() => setDiscountType("flat")}
                                                >
                                                    ₹
                                                </Button>
                                            </div>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={discountType === "percent" ? 100 : subtotal}
                                                value={discountValue}
                                                onChange={(e) => setDiscountValue(e.target.value)}
                                                placeholder="0"
                                                className="w-24 h-8"
                                            />
                                        </div>
                                        {!walkInMode && pendingBillRefund > 0 && (
                                            <div className="flex items-center gap-2 w-full">
                                                <input
                                                    type="checkbox"
                                                    id="apply-refund-check"
                                                    checked={applyRefundToBill}
                                                    onChange={(e) => setApplyRefundToBill(e.target.checked)}
                                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                                />
                                                <label htmlFor="apply-refund-check" className="text-sm text-muted-foreground cursor-pointer select-none">
                                                    Apply ₹{pendingBillRefund.toFixed(2)} pending refund to this bill
                                                </label>
                                            </div>
                                        )}
                                        {(discountAmount > 0 || refundToApply > 0) && (
                                            <>
                                                <div className="flex justify-between w-full text-sm text-muted-foreground">
                                                    <span>Subtotal</span>
                                                    <span>₹{subtotal.toFixed(2)}</span>
                                                </div>
                                                {discountAmount > 0 && (
                                                    <div className="flex justify-between w-full text-sm text-muted-foreground">
                                                        <span>Discount{discountType === "percent" ? ` (${parsedDiscountValue}%)` : ""}</span>
                                                        <span>−₹{discountAmount.toFixed(2)}</span>
                                                    </div>
                                                )}
                                                {refundToApply > 0 && (
                                                    <div className="flex justify-between w-full text-sm text-muted-foreground">
                                                        <span>Refund Applied</span>
                                                        <span>−₹{refundToApply.toFixed(2)}</span>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        <span className="text-lg font-bold">
                                            Total: ₹{finalTotal.toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            )}
```

with:

```jsx
                            <div className="flex justify-end mt-4 shrink-0">
                                <div className="flex flex-col items-end gap-2 min-w-[260px]">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-muted-foreground">Discount</span>
                                        <div className="flex rounded-md border overflow-hidden">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant={discountType === "percent" ? "default" : "ghost"}
                                                className="rounded-none h-8 px-2.5"
                                                onClick={() => setDiscountType("percent")}
                                            >
                                                %
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant={discountType === "flat" ? "default" : "ghost"}
                                                className="rounded-none h-8 px-2.5"
                                                onClick={() => setDiscountType("flat")}
                                            >
                                                ₹
                                            </Button>
                                        </div>
                                        <Input
                                            type="number"
                                            min={0}
                                            max={discountType === "percent" ? 100 : subtotal}
                                            value={discountValue}
                                            onChange={(e) => setDiscountValue(e.target.value)}
                                            placeholder="0"
                                            className="w-24 h-8"
                                        />
                                    </div>
                                    {discountAmount > 0 && (
                                        <div className="flex justify-between w-full text-sm text-muted-foreground">
                                            <span>Discount{discountType === "percent" ? ` (${parsedDiscountValue}%)` : ""}</span>
                                            <span>−₹{discountAmount.toFixed(2)}</span>
                                        </div>
                                    )}
                                    <span className="text-lg font-bold">
                                        Total: ₹{finalTotal.toFixed(2)}
                                    </span>
                                </div>
                            </div>
```

- [ ] **Step 10: Verify with `npx tsc --noEmit`**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors in `app/billing/page.tsx` or
`components/EditVisitDialog.tsx`. If anything else in the repo happens to
already fail typecheck independent of this change, confirm via `git stash`
that it was already failing before this plan's changes (don't let this
task be blamed for pre-existing unrelated errors).

- [ ] **Step 11: Manual browser verification**

Using Playwright MCP with the JWT-cookie auth-bypass:
1. Navigate to `/billing?patient_id=<id>&visit_id=<id>` for a visit with a
   `visiting_fee` and **no existing bill**.
2. Confirm the **Total is visible immediately**, before any item is added
   (fixes the always-visible bug — it should read "Total: ₹0.00" with an
   empty item list).
3. Confirm there's no "Refund" checkbox/input next to the "Walk-in Bill"
   button anymore.
4. Confirm an "Add Refund" control (value input + Settle-via select with
   only Billing UPI/Cash + "Add Refund" button) appears next to the
   "Items" heading.
5. Add an item, then add a refund smaller than the item's total. Confirm
   a red "Refund (Billing UPI)" (or "Cash") row appears in the items
   table with a trash icon, and the Total reflects the subtraction. Click
   its trash icon — confirm it disappears and the Total reverts.
6. Add the refund again, click "Create Bill". Confirm the bill is created
   successfully and the printed/preview invoice shows a bare `−amount`
   line with no label text (this part of `InvoicePrint.tsx` was already
   correct and untouched by this plan).
7. Navigate to `/billing?patient_id=<id>&visit_id=<id>` again for the
   **same visit** (which now has a bill). Confirm the "Add Refund" control
   no longer appears next to "Items" (since `has_bill` is now `true`).

- [ ] **Step 12: Commit**

```bash
git add frontend/app/billing/page.tsx
git commit -m "feat(refund): redesign Billing page refund UI as a deletable line item"
```

---

## Self-Review Notes

- **Spec coverage:** 3-mode shrink (Tasks 1-2-5-6-7), Visit-UPI-never-
  touches-a-bill / Billing-UPI+Cash-apply-to-first-bill rule (Task 3),
  Cash-always-debits-Billing-Cash (Tasks 3-4), no-retroactive-bill-mutation
  guarantee (Task 3's `is_first_bill` check), always-visible Total bug fix
  (Task 7 Step 9), removal of the "Apply pending refund" checkbox and
  Subtotal/Refund Applied text (Task 7 Steps 7 & 9), refund-as-deletable-
  line-item (Task 7 Steps 3/8/9), staged-client-side-until-submit (Task 7's
  `refundLine` state design), bare `−amount` on the printed invoice
  (already correct in `InvoicePrint.tsx`, verified not touched) — all
  covered. The spec's 4 "open decisions" were all resolved during
  brainstorming discussion before this plan was written (standalone
  Billing-page refund block removed, Visit UPI excluded from the bill
  line-item control, `apply_to_bill` migration mapping, incremental-only
  amounts) and are reflected directly in the tasks above.
- **Placeholder scan:** no TBD/TODO; every step has literal code or an
  exact curl/manual-check command with a stated expected result.
- **Type consistency:** `RefundMode` (Task 5) is `'visit_upi' |
  'billing_upi' | 'cash'` everywhere it's referenced (Tasks 6, 7).
  `Visit.has_bill` (Task 5) matches the `has_bill` key added to `GET
  /visits/<id>`'s response (Task 2). The `refund` payload shape
  (`{amount, mode}`) matches between the frontend's `handleCreateBill`
  payload (Task 7 Step 4) and the backend's `data.get('refund')` handling
  (Task 3 Step 2). `refund_applied`/`payout`/`applied` variable names in
  Task 3 stay internally consistent within that one function.
