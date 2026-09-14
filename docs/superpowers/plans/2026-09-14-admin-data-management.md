# Admin Data Management (Danger Zone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "Wipe Inventory" button (Inventory page) with a
five-option "Danger Zone" in Admin → Settings — Clear Stock Counts, Clear
Entire Inventory, Clear Images (3 sub-options), Clear Patients (with correct
billing/visit cascade), and Clear All (nuclear, keeps only accounts) — each
gated by a live count preview and the existing TOTP admin auth code.

**Architecture:** One new pair of Flask routes
(`GET/DELETE /api/admin/data_management/{preview,execute}`) in
`Backend_db/routes/admin.py`, dispatching by a `scope` query/body param to
five private helper functions that each run one atomic delete transaction
then unlink files. One new frontend dialog component
(`DataManagementDialog.tsx`) drives both endpoints and replaces the old
Inventory-page wipe UI.

**Tech Stack:** Flask + SQLAlchemy 2.0 (backend), Next.js/React + shadcn/ui
`RadioGroup` (frontend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-14-admin-data-management-design.md`

## Global Constraints

- Every delete helper commits exactly once, after all row deletes for that
  scope, and rolls back on any exception before returning an error.
- File unlinks always happen *after* a successful commit, never before, and
  a failed unlink is logged (`print(f"Warning: ...")`) and never rolls back
  or blocks the response — mirrors `images.py`'s
  `permanent_delete_patient_image`.
- All FK delete ordering below was verified against the **live** Postgres
  schema's actual `ON DELETE` rules (checked via
  `information_schema.referential_constraints`), not just inferred from
  `models.py` — every FK in this schema is `NO ACTION` except
  `patients.reference_patient_id → patients` (`SET NULL`, handled
  automatically by Postgres). Two non-obvious "null the FK, don't delete
  the row" cases fall out of this and must be preserved exactly as written:
  `BillItem.product_id → NULL` before deleting a `ProductMaster` row (already
  the existing pattern in `delete_inventory_item`), and
  `InventoryHistory.bill_id → NULL` before deleting a `Bill` row (new in
  this plan — needed because `inventory_history.bill_id` is `NO ACTION`
  against `bills`, so deleting a Bill that a stock-movement history entry
  still references would fail; nulling it preserves the stock-movement
  audit trail instead of destroying it, matching the FK-null-not-cascade
  philosophy already established in `delete_inventory_item`).
- **This feature is inherently destructive by design — verification steps
  that call `execute` really delete rows in whatever database the backend
  is pointed at.** Before running any `execute` verification step against
  a table that is not already empty of real data, run its `preview` step
  first and inspect the counts. If they look like real seeded/production
  data rather than disposable rows you just inserted for the test, stop
  and ask the user before proceeding — do not wipe data you did not put
  there yourself for the purpose of this test.
- Response shape is the same for `preview` and `execute`: `{"counts": {...}}`
  for preview, `{"message": "...", "counts": {...}}` for execute. Frontend
  renders `counts` generically (`Object.entries(counts)`) — never hardcode
  a fixed key list per scope, since the key set legitimately differs by
  scope (see spec's per-scope tables).
- Every Execute click, on every scope (Task 7's `handleExecute`), triggers a
  backup CSV download via the pre-existing `api.exportInventory()` and
  `api.exportPatients()` before calling `api.executeDataManagement(...)` —
  unconditional, not scope-gated, images deliberately excluded. See the
  spec's "Pre-Wipe Backup Export" section.

---

### Task 1: Backend — routes, shared helpers, and the `stock_counts` scope

**Files:**
- Modify: `Backend_db/routes/admin.py`

**Interfaces:**
- Produces: `_unlink_files(paths: list[str]) -> None`; `_wipe_stock_counts() -> tuple[dict, list[str]]`; `_preview_counts(scope: str, image_scope: str | None) -> dict`; routes `GET /api/admin/data_management/preview`, `DELETE /api/admin/data_management/execute` (the latter only handles `scope='stock_counts'` after this task — other scopes 400 until later tasks add them).

- [ ] **Step 1: Add the new model imports**

In `Backend_db/routes/admin.py`, replace the existing models import line:

```python
from models import AuditLog, User, DoctorStaffAssignment, Visit, Bill, Patient, Location, InventoryBatch, InventoryHistory
```

with:

```python
from models import (
    AuditLog, User, DoctorStaffAssignment, Visit, Bill, BillItem, VisitRefund,
    Patient, Location, InventoryBatch, InventoryHistory, PatientImage,
    UploadSession, ExpenseLedger, ProductMaster, PurchaseInvoice,
)
```

- [ ] **Step 2: Add the shared helpers and `stock_counts` scope logic**

Add this block at the end of `Backend_db/routes/admin.py` (after the existing
`wipe_inventory` function — that function and its route are removed in
Task 5, once every scope has a replacement):

```python
# ─── Data Management (Danger Zone) ─────────────────────────────────────────

_VALID_SCOPES = ('stock_counts', 'inventory_all', 'images', 'patients', 'all')
_VALID_IMAGE_SCOPES = ('all', 'prescriptions', 'invoices')


def _unlink_files(paths):
    """Best-effort delete of files on disk. Never raises -- a missing or
    unremovable file is logged and skipped, not a reason to fail the
    (already-committed) DB wipe."""
    for p in paths:
        if not p:
            continue
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception as e:
            print(f"Warning: could not delete file {p}: {e}")


def _patient_cascade_counts(patient_ids):
    """Row counts for everything Clear Patients / Clear All would cascade-
    delete for the given patient ids. Read-only -- used by preview."""
    if not patient_ids:
        return {'patients': 0, 'visits': 0, 'bills': 0, 'bill_items': 0,
                'visit_refunds': 0, 'patient_images': 0}

    visit_ids = [v.visit_id for v in
                 Visit.query.with_entities(Visit.visit_id)
                 .filter(Visit.patient_id.in_(patient_ids)).all()]
    bill_ids = [b.invoice_id for b in
                Bill.query.with_entities(Bill.invoice_id)
                .filter(Bill.patient_id.in_(patient_ids)).all()]

    return {
        'patients': len(patient_ids),
        'visits': len(visit_ids),
        'bills': len(bill_ids),
        'bill_items': BillItem.query.filter(BillItem.bill_id.in_(bill_ids)).count() if bill_ids else 0,
        'visit_refunds': VisitRefund.query.filter(VisitRefund.visit_id.in_(visit_ids)).count() if visit_ids else 0,
        'patient_images': PatientImage.query.filter(PatientImage.patient_id.in_(patient_ids)).count(),
    }


def _preview_counts(scope, image_scope=None):
    """Read-only row counts for the given scope. Raises ValueError on an
    unknown scope/image_scope -- callers must validate against
    _VALID_SCOPES/_VALID_IMAGE_SCOPES first and turn that into a 400."""
    if scope == 'stock_counts':
        return {
            'inventory_batches': InventoryBatch.query.count(),
            'inventory_history': InventoryHistory.query.count(),
        }

    if scope == 'inventory_all':
        return {
            'inventory_batches': InventoryBatch.query.count(),
            'inventory_history': InventoryHistory.query.count(),
            'purchase_invoices': PurchaseInvoice.query.count(),
            'product_master': ProductMaster.query.count(),
        }

    if scope == 'images':
        if image_scope == 'prescriptions':
            return {'patient_images': PatientImage.query.filter_by(tag='Prescription').count()}
        if image_scope == 'invoices':
            return {'purchase_invoice_images': PurchaseInvoice.query.filter(PurchaseInvoice.image_path.isnot(None)).count()}
        return {
            'patient_images': PatientImage.query.count(),
            'purchase_invoice_images': PurchaseInvoice.query.filter(PurchaseInvoice.image_path.isnot(None)).count(),
        }

    if scope == 'patients':
        patient_ids = [p.patient_id for p in Patient.query.with_entities(Patient.patient_id).all()]
        return _patient_cascade_counts(patient_ids)

    if scope == 'all':
        patient_ids = [p.patient_id for p in Patient.query.with_entities(Patient.patient_id).all()]
        counts = _patient_cascade_counts(patient_ids)
        counts.update({
            'inventory_batches': InventoryBatch.query.count(),
            'inventory_history': InventoryHistory.query.count(),
            'purchase_invoices': PurchaseInvoice.query.count(),
            'product_master': ProductMaster.query.count(),
            'expense_ledger': ExpenseLedger.query.count(),
            'upload_sessions': UploadSession.query.count(),
        })
        return counts

    raise ValueError(f'Unknown scope: {scope}')


def _wipe_stock_counts():
    """= today's existing Wipe Inventory behavior: batches + history only."""
    history_count = InventoryHistory.query.count()
    batch_count = InventoryBatch.query.count()
    InventoryHistory.query.delete(synchronize_session=False)
    InventoryBatch.query.delete(synchronize_session=False)
    db.session.commit()
    return {'inventory_batches': batch_count, 'inventory_history': history_count}, []


@admin_bp.route('/admin/data_management/preview', methods=['GET'])
@require_auth
@require_admin
def data_management_preview():
    scope = request.args.get('scope')
    image_scope = request.args.get('image_scope')

    if scope not in _VALID_SCOPES:
        return jsonify({'error': 'Invalid scope'}), 400
    if scope == 'images' and image_scope not in _VALID_IMAGE_SCOPES:
        return jsonify({'error': 'Invalid image_scope'}), 400

    return jsonify({'counts': _preview_counts(scope, image_scope)}), 200


@admin_bp.route('/admin/data_management/execute', methods=['DELETE'])
@require_auth
@require_admin
def data_management_execute():
    data = request.get_json(silent=True) or {}
    scope = data.get('scope')
    image_scope = data.get('image_scope')
    totp_code = (data.get('totp_code') or '').strip()

    if scope not in _VALID_SCOPES:
        return jsonify({'error': 'Invalid scope'}), 400
    if scope == 'images' and image_scope not in _VALID_IMAGE_SCOPES:
        return jsonify({'error': 'Invalid image_scope'}), 400
    if not totp_code:
        return jsonify({'error': 'Auth code is required'}), 400
    if not _verify_totp(totp_code):
        return jsonify({'error': 'Invalid or expired auth code'}), 401

    try:
        if scope == 'stock_counts':
            counts, files = _wipe_stock_counts()
        else:
            return jsonify({'error': f'Scope not yet implemented: {scope}'}), 501
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

    _unlink_files(files)

    from routes.auth import log_activity
    log_activity(
        action='DELETE',
        resource_type='data_management',
        resource_id=scope if scope != 'images' else f'images:{image_scope}',
        resource_label=f'Data management wipe: {scope}',
        details=', '.join(f'{k}={v}' for k, v in counts.items()),
        user_id=g.current_user.get('user_id'),
        username=g.current_user.get('username'),
        ip_address=request.remote_addr,
    )

    return jsonify({'message': 'Wipe completed successfully.', 'counts': counts}), 200
```

Note the `else: return 501` branch in `data_management_execute` — this is
deliberately temporary scaffolding removed in Task 5 once every scope has a
real branch, not a permanent placeholder; every scope preview already works
fully after this task (via `_preview_counts`), only `execute` is partial.

- [ ] **Step 3: Start the backend and verify `stock_counts` preview + execute**

```bash
cd Backend_db && source venv/bin/activate && python app.py
```

In another terminal, mint a dev JWT for an admin user and curl (see
`CLAUDE.md`'s "Manual / Browser Testing" section for the mint snippet):

```bash
curl -s --cookie "auth_token=$JWT" \
  "http://127.0.0.1:5000/api/admin/data_management/preview?scope=stock_counts"
```

Expected: `200` with `{"counts": {"inventory_batches": N, "inventory_history": M}}`
where N/M match `InventoryBatch.query.count()` / `InventoryHistory.query.count()`
in the current dev DB (check via the same `python -c` pattern used earlier
in this session if unsure).

Per the Global Constraints safety rule: if N/M are non-trivial (looks like
real seeded inventory), stop here and confirm with the user before running
`execute` against it — otherwise insert one throwaway `InventoryBatch` row
first so you know exactly what should be gone afterward.

Then:

```bash
curl -s --cookie "auth_token=$JWT" -X DELETE \
  -H "Content-Type: application/json" \
  -d '{"scope":"stock_counts","totp_code":"<live 6-digit TOTP from TOTP_SECRET>"}' \
  "http://127.0.0.1:5000/api/admin/data_management/execute"
```

Expected: `200` with `{"message": "...", "counts": {...}}` matching the
preview's numbers, and a re-run of the preview curl now returns all zeros.

- [ ] **Step 4: Commit**

```bash
git add Backend_db/routes/admin.py
git commit -m "feat(admin): data_management preview/execute routes + stock_counts scope"
```

---

### Task 2: Backend — `inventory_all` scope

**Files:**
- Modify: `Backend_db/routes/admin.py`

**Interfaces:**
- Consumes: `_unlink_files` from Task 1.
- Produces: `_wipe_inventory_all() -> tuple[dict, list[str]]`.

- [ ] **Step 1: Add `_wipe_inventory_all()`**

Add directly below `_wipe_stock_counts()`:

```python
def _wipe_inventory_all():
    """Everything _wipe_stock_counts() does, plus the ProductMaster catalog
    and PurchaseInvoice rows (+ their image files). BillItem.product_id is
    nulled (not cascaded) first -- same reasoning as delete_inventory_item
    in routes/inventory.py: BillItem stores a sale-time snapshot, so losing
    the live FK link on a bulk catalog wipe must not touch historical
    billing rows."""
    history_count = InventoryHistory.query.count()
    batch_count = InventoryBatch.query.count()
    product_ids = [p.id for p in ProductMaster.query.with_entities(ProductMaster.id).all()]
    invoice_rows = PurchaseInvoice.query.with_entities(
        PurchaseInvoice.invoice_number, PurchaseInvoice.image_path
    ).all()

    files = [r.image_path for r in invoice_rows if r.image_path]

    if product_ids:
        BillItem.query.filter(BillItem.product_id.in_(product_ids)).update(
            {'product_id': None}, synchronize_session=False)
    InventoryHistory.query.delete(synchronize_session=False)
    InventoryBatch.query.delete(synchronize_session=False)
    PurchaseInvoice.query.delete(synchronize_session=False)
    ProductMaster.query.delete(synchronize_session=False)
    db.session.commit()

    return {
        'inventory_batches': batch_count,
        'inventory_history': history_count,
        'purchase_invoices': len(invoice_rows),
        'product_master': len(product_ids),
    }, files
```

- [ ] **Step 2: Wire it into `data_management_execute`**

In `data_management_execute`, change:

```python
        if scope == 'stock_counts':
            counts, files = _wipe_stock_counts()
        else:
            return jsonify({'error': f'Scope not yet implemented: {scope}'}), 501
```

to:

```python
        if scope == 'stock_counts':
            counts, files = _wipe_stock_counts()
        elif scope == 'inventory_all':
            counts, files = _wipe_inventory_all()
        else:
            return jsonify({'error': f'Scope not yet implemented: {scope}'}), 501
```

- [ ] **Step 3: Verify**

Restart the backend (Flask's debug reloader picks up the change
automatically if it's still running from Task 1). Insert one throwaway
`ProductMaster` + `InventoryBatch` + `PurchaseInvoice` (with a real
zero-byte file at some path under `UPLOAD_BASE_DIR/invoices/` so the unlink
step has something real to remove) via a `python -c` script against the app
context, then:

```bash
curl -s --cookie "auth_token=$JWT" \
  "http://127.0.0.1:5000/api/admin/data_management/preview?scope=inventory_all"
```

Expected: counts include your throwaway rows (plus whatever else exists —
apply the same non-trivial-data safety check as Task 1 before executing).

```bash
curl -s --cookie "auth_token=$JWT" -X DELETE \
  -H "Content-Type: application/json" \
  -d '{"scope":"inventory_all","totp_code":"<live TOTP>"}' \
  "http://127.0.0.1:5000/api/admin/data_management/execute"
```

Expected: `200`, counts match preview, `ProductMaster`/`PurchaseInvoice`
tables now empty, and the throwaway invoice image file is gone from disk.

- [ ] **Step 4: Commit**

```bash
git add Backend_db/routes/admin.py
git commit -m "feat(admin): data_management inventory_all scope"
```

---

### Task 3: Backend — `images` scope (all / prescriptions / invoices)

**Files:**
- Modify: `Backend_db/routes/admin.py`

**Interfaces:**
- Consumes: `_unlink_files` from Task 1.
- Produces: `_wipe_images(image_scope: str) -> tuple[dict, list[str]]`.

- [ ] **Step 1: Add `_wipe_images()`**

```python
def _wipe_images(image_scope):
    if image_scope == 'prescriptions':
        imgs = PatientImage.query.filter_by(tag='Prescription').all()
        files = [i.image_path for i in imgs if i.image_path]
        count = len(imgs)
        PatientImage.query.filter_by(tag='Prescription').delete(synchronize_session=False)
        db.session.commit()
        return {'patient_images': count}, files

    if image_scope == 'invoices':
        invs = PurchaseInvoice.query.filter(PurchaseInvoice.image_path.isnot(None)).all()
        files = [i.image_path for i in invs]
        count = len(invs)
        PurchaseInvoice.query.filter(PurchaseInvoice.image_path.isnot(None)).update(
            {'image_path': None}, synchronize_session=False)
        db.session.commit()
        return {'purchase_invoice_images': count}, files

    # 'all' -- every PatientImage row (any tag, including trashed) + every
    # PurchaseInvoice image file. PurchaseInvoice rows themselves are kept
    # (deleting the row is inventory_all's job, not this one).
    imgs = PatientImage.query.all()
    patient_image_files = [i.image_path for i in imgs if i.image_path]
    patient_image_count = len(imgs)

    invs = PurchaseInvoice.query.filter(PurchaseInvoice.image_path.isnot(None)).all()
    invoice_image_files = [i.image_path for i in invs]
    invoice_image_count = len(invs)

    PatientImage.query.delete(synchronize_session=False)
    PurchaseInvoice.query.filter(PurchaseInvoice.image_path.isnot(None)).update(
        {'image_path': None}, synchronize_session=False)
    db.session.commit()

    return {
        'patient_images': patient_image_count,
        'purchase_invoice_images': invoice_image_count,
    }, patient_image_files + invoice_image_files
```

- [ ] **Step 2: Wire it into `data_management_execute`**

```python
        elif scope == 'inventory_all':
            counts, files = _wipe_inventory_all()
        elif scope == 'images':
            counts, files = _wipe_images(image_scope)
        else:
```

- [ ] **Step 3: Verify all three sub-options**

Insert one throwaway `PatientImage` (`tag='Prescription'`) and one
throwaway `PatientImage` (`tag='Lab'`), each pointing at a real zero-byte
file, plus one throwaway `PurchaseInvoice` with an `image_path` pointing at
another real zero-byte file.

```bash
curl -s --cookie "auth_token=$JWT" \
  "http://127.0.0.1:5000/api/admin/data_management/preview?scope=images&image_scope=prescriptions"
# Expected: {"counts": {"patient_images": 1}}  (just the Prescription-tagged one)

curl -s --cookie "auth_token=$JWT" -X DELETE -H "Content-Type: application/json" \
  -d '{"scope":"images","image_scope":"prescriptions","totp_code":"<live TOTP>"}' \
  "http://127.0.0.1:5000/api/admin/data_management/execute"
# Expected: 200, counts.patient_images == 1, the Prescription file gone from disk,
# the Lab-tagged PatientImage row and file still present.
```

Repeat for `image_scope=invoices` (expect the throwaway `PurchaseInvoice`
row to survive with `image_path` now `NULL`, and its file gone), then for
`image_scope=all` against the remaining `Lab`-tagged image (expect it gone
too).

- [ ] **Step 4: Commit**

```bash
git add Backend_db/routes/admin.py
git commit -m "feat(admin): data_management images scope (all/prescriptions/invoices)"
```

---

### Task 4: Backend — `patients` scope

**Files:**
- Modify: `Backend_db/routes/admin.py`

**Interfaces:**
- Consumes: `_unlink_files` from Task 1.
- Produces: `_wipe_patients() -> tuple[dict, list[str]]`.

- [ ] **Step 1: Add `_wipe_patients()`**

```python
def _wipe_patients():
    """Deletes every Patient and cascades PatientImage (+ files),
    VisitRefund, BillItem, Bill (only bills with patient_id set -- walk-in
    bills stay), Visit, and any 'patient'-context UploadSession rows for
    the deleted ids. InventoryHistory.bill_id is nulled (not cascaded) on
    the bills about to be deleted -- same FK-null-not-cascade reasoning as
    _wipe_inventory_all()'s BillItem.product_id handling: the stock-
    movement audit trail should survive even though the bill it once
    pointed at is gone."""
    patient_ids = [p.patient_id for p in Patient.query.with_entities(Patient.patient_id).all()]
    if not patient_ids:
        return {'patients': 0, 'visits': 0, 'bills': 0, 'bill_items': 0,
                'visit_refunds': 0, 'patient_images': 0}, []

    visit_ids = [v.visit_id for v in
                 Visit.query.with_entities(Visit.visit_id)
                 .filter(Visit.patient_id.in_(patient_ids)).all()]
    bill_ids = [b.invoice_id for b in
                Bill.query.with_entities(Bill.invoice_id)
                .filter(Bill.patient_id.in_(patient_ids)).all()]

    images = PatientImage.query.filter(PatientImage.patient_id.in_(patient_ids)).all()
    files = [i.image_path for i in images if i.image_path]
    image_count = len(images)

    bill_item_count = BillItem.query.filter(BillItem.bill_id.in_(bill_ids)).count() if bill_ids else 0
    refund_count = VisitRefund.query.filter(VisitRefund.visit_id.in_(visit_ids)).count() if visit_ids else 0

    PatientImage.query.filter(PatientImage.patient_id.in_(patient_ids)).delete(synchronize_session=False)
    if visit_ids:
        VisitRefund.query.filter(VisitRefund.visit_id.in_(visit_ids)).delete(synchronize_session=False)
    if bill_ids:
        BillItem.query.filter(BillItem.bill_id.in_(bill_ids)).delete(synchronize_session=False)
        InventoryHistory.query.filter(InventoryHistory.bill_id.in_(bill_ids)).update(
            {'bill_id': None}, synchronize_session=False)
        Bill.query.filter(Bill.invoice_id.in_(bill_ids)).delete(synchronize_session=False)
    Visit.query.filter(Visit.patient_id.in_(patient_ids)).delete(synchronize_session=False)
    UploadSession.query.filter(
        UploadSession.context_type == 'patient',
        UploadSession.context_id.in_(patient_ids),
    ).delete(synchronize_session=False)
    Patient.query.filter(Patient.patient_id.in_(patient_ids)).delete(synchronize_session=False)
    db.session.commit()

    # Best-effort: remove each patient's now-empty upload folder.
    base_folder = os.path.join(os.environ.get('UPLOAD_BASE_DIR', '/tmp/clinic_uploads'), 'patients')
    for pid in patient_ids:
        shutil.rmtree(os.path.join(base_folder, pid), ignore_errors=True)

    return {
        'patients': len(patient_ids),
        'visits': len(visit_ids),
        'bills': len(bill_ids),
        'bill_items': bill_item_count,
        'visit_refunds': refund_count,
        'patient_images': image_count,
    }, files
```

- [ ] **Step 2: Wire it into `data_management_execute`**

```python
        elif scope == 'images':
            counts, files = _wipe_images(image_scope)
        elif scope == 'patients':
            counts, files = _wipe_patients()
        else:
```

- [ ] **Step 3: Verify, including the InventoryHistory.bill_id null case**

This is the one worth being careful with, since it's the case that would
previously have raised a Postgres FK violation. Create, via a `python -c`
script against the app context:
1. A throwaway `Patient`.
2. A `Visit` for that patient.
3. A `Bill` with `patient_id` set to that patient (and a `BillItem` on it).
4. An `InventoryHistory` row with `bill_id` set to that bill's `invoice_id`
   (any valid `product_id`/`action` value — check `InventoryHistory`'s
   column list in `models.py` for required fields).
5. A `PatientImage` for that patient pointing at a real zero-byte file.
6. A second, separate walk-in `Bill` with `patient_id=None` (to confirm it
   survives).

```bash
curl -s --cookie "auth_token=$JWT" \
  "http://127.0.0.1:5000/api/admin/data_management/preview?scope=patients"
```

Expected: counts reflect exactly the rows created above (plus any other
real patients already in the DB — apply the Global Constraints safety
check before executing if so).

```bash
curl -s --cookie "auth_token=$JWT" -X DELETE -H "Content-Type: application/json" \
  -d '{"scope":"patients","totp_code":"<live TOTP>"}' \
  "http://127.0.0.1:5000/api/admin/data_management/execute"
```

Expected: `200`, no 500/FK-violation error. Then verify directly against
the DB: the `InventoryHistory` row from step 4 still exists but now has
`bill_id IS NULL`; the walk-in bill from step 6 still exists; the
patient's image file and upload folder are gone from disk.

- [ ] **Step 4: Commit**

```bash
git add Backend_db/routes/admin.py
git commit -m "feat(admin): data_management patients scope"
```

---

### Task 5: Backend — `all` scope, remove deprecated `/admin/inventory/wipe`

**Files:**
- Modify: `Backend_db/routes/admin.py`

**Interfaces:**
- Consumes: `_wipe_patients()` (Task 4), `_wipe_inventory_all()` (Task 2).
- Produces: `_wipe_all() -> tuple[dict, list[str]]`.

- [ ] **Step 1: Add `_wipe_all()`**

Per the spec's corrected composition order (see spec doc's "Backend API"
section) -- `_wipe_patients()` already deletes every `PatientImage` row as
part of its own cascade (patient_id is non-nullable, so no image can
outlive its patient) and `_wipe_inventory_all()` already deletes every
`PurchaseInvoice` row, image and all. A separate `_wipe_images('all')` call
here would double-process `PatientImage` and corrupt the merged counts, so
it is deliberately **not** called:

```python
def _wipe_all():
    """Composition of _wipe_patients() + _wipe_inventory_all(), plus
    ExpenseLedger + any remaining UploadSession rows. Deliberately does NOT
    also call _wipe_images('all') -- see the comment in the spec doc's
    Backend API section for why that would double-count/double-delete
    PatientImage rows. Keeps: User, DoctorStaffAssignment, Location,
    AuditLog."""
    counts = {}
    files = []

    patient_counts, patient_files = _wipe_patients()
    counts.update(patient_counts)
    files.extend(patient_files)

    inv_counts, inv_files = _wipe_inventory_all()
    counts.update(inv_counts)
    files.extend(inv_files)

    expenses = ExpenseLedger.query.all()
    expense_files = [e.receipt_path for e in expenses if e.receipt_path]
    counts['expense_ledger'] = len(expenses)
    files.extend(expense_files)
    ExpenseLedger.query.delete(synchronize_session=False)

    counts['upload_sessions'] = UploadSession.query.count()
    UploadSession.query.delete(synchronize_session=False)

    db.session.commit()

    # Best-effort: sweep any leftover scratch files under temp/ (e.g. from
    # an abandoned/never-finalized QR session) not tracked by any DB row.
    temp_dir = os.path.join(os.environ.get('UPLOAD_BASE_DIR', '/tmp/clinic_uploads'), 'temp')
    if os.path.isdir(temp_dir):
        for entry in os.listdir(temp_dir):
            shutil.rmtree(os.path.join(temp_dir, entry), ignore_errors=True)

    return counts, files
```

- [ ] **Step 2: Wire it into `data_management_execute` and drop the 501 branch**

```python
        elif scope == 'patients':
            counts, files = _wipe_patients()
        else:  # 'all'
            counts, files = _wipe_all()
```

- [ ] **Step 3: Remove the deprecated route**

Delete the entire `wipe_inventory` function and its `@admin_bp.route(...)`
decorator (`Backend_db/routes/admin.py`, the block starting
`@admin_bp.route('/admin/inventory/wipe', methods=['DELETE'])` through its
closing `return jsonify(...), 500` / `except` block) — fully superseded by
`scope=stock_counts` on the new endpoint.

- [ ] **Step 4: Verify `all`, and that the old route is gone**

```bash
curl -s -o /dev/null -w "%{http_code}\n" --cookie "auth_token=$JWT" -X DELETE \
  -H "Content-Type: application/json" -d '{"totp_code":"000000"}' \
  "http://127.0.0.1:5000/api/admin/inventory/wipe"
# Expected: 404 (route no longer exists)
```

For the `all` scope itself: apply the Global Constraints safety check
first (`preview?scope=all` — if it reflects real data rather than
disposable test rows, confirm with the user before executing). With
disposable rows across patients/inventory/expense ledger/upload sessions
in place, run preview then execute, and confirm: all of `Patient`, `Visit`,
`Bill`, `BillItem`, `VisitRefund`, `PatientImage`, `InventoryBatch`,
`InventoryHistory`, `ProductMaster`, `PurchaseInvoice`, `ExpenseLedger`,
`UploadSession` are empty afterward, while `User`, `DoctorStaffAssignment`,
`Location`, and `AuditLog` (check the wipe's own `log_activity` row is
present!) are untouched.

- [ ] **Step 5: Commit**

```bash
git add Backend_db/routes/admin.py
git commit -m "feat(admin): data_management all scope; remove deprecated inventory/wipe route"
```

---

### Task 6: Frontend — `api.ts` client functions

**Files:**
- Modify: `frontend/lib/api.ts`

**Interfaces:**
- Produces: `DataManagementCounts` type; `getDataManagementPreview(scope, imageScope?)`; `executeDataManagement(scope, totpCode, imageScope?)`.

- [ ] **Step 1: Remove `wipeInventory` and add the two new functions**

In `frontend/lib/api.ts`, replace:

```ts
    async wipeInventory(totpCode: string): Promise<{ message: string }> {
        return fetchApi('/api/admin/inventory/wipe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ totp_code: totpCode }),
        });
    },
```

with:

```ts
    async getDataManagementPreview(scope: string, imageScope?: string): Promise<{ counts: DataManagementCounts }> {
        const params = new URLSearchParams({ scope })
        if (imageScope) params.set('image_scope', imageScope)
        return fetchApi(`/api/admin/data_management/preview?${params.toString()}`);
    },

    async executeDataManagement(scope: string, totpCode: string, imageScope?: string): Promise<{ message: string; counts: DataManagementCounts }> {
        return fetchApi('/api/admin/data_management/execute', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope, image_scope: imageScope, totp_code: totpCode }),
        });
    },
```

Then add the `DataManagementCounts` type near the other exported types at
the top of the file (alongside `AdminUser`, `ActivityEntry`, etc.):

```ts
export interface DataManagementCounts {
    inventory_batches?: number
    inventory_history?: number
    purchase_invoices?: number
    product_master?: number
    patient_images?: number
    purchase_invoice_images?: number
    patients?: number
    visits?: number
    bills?: number
    bill_items?: number
    visit_refunds?: number
    expense_ledger?: number
    upload_sessions?: number
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no new type errors (any pre-existing ones in the codebase are
out of scope for this task — confirm the count of errors doesn't increase).

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(admin): api.ts data_management client + remove wipeInventory"
```

---

### Task 7: Frontend — `DataManagementDialog.tsx`

**Files:**
- Create: `frontend/components/DataManagementDialog.tsx`

**Interfaces:**
- Consumes: `api.getDataManagementPreview`, `api.executeDataManagement`, `DataManagementCounts` (Task 6); `api.exportInventory()` and `api.exportPatients()` — pre-existing functions already in `frontend/lib/api.ts` (not part of this plan, nothing to add), used unmodified by `handleExecute`.
- Produces: `<DataManagementDialog open, onOpenChange>` — a self-contained dialog; the only prop surface it needs from its mount site (Task 8) is open/close state, matching the existing `QRCodeUpload`/wipe-dialog convention already used elsewhere in this codebase.

- [ ] **Step 1: Write the component**

```tsx
"use client"

import { useEffect, useState } from "react"
import { api, DataManagementCounts } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { AlertCircle, Loader2, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

interface ScopeDef {
    key: string
    label: string
    description: string
}

const SCOPES: ScopeDef[] = [
    { key: 'stock_counts', label: 'Clear Stock Counts', description: 'Stock batches and movement history only. Product names and purchase invoices are kept.' },
    { key: 'inventory_all', label: 'Clear Entire Inventory', description: 'Everything in Stock Counts, plus the product catalog and purchase invoices. Patients/Visits/Bills are untouched.' },
    { key: 'images', label: 'Clear Images', description: 'Patient images and/or purchase invoice images -- pick a sub-option below.' },
    { key: 'patients', label: 'Clear Patients', description: 'Every patient, and their visits, bills, refunds, and images. Walk-in bills with no patient are kept.' },
    { key: 'all', label: 'Clear All (nuclear)', description: 'Everything above. Only user accounts, staff assignments, clinic locations, and the audit log survive.' },
]

const IMAGE_SCOPES: { key: string; label: string }[] = [
    { key: 'all', label: 'All images (patient images + invoice images)' },
    { key: 'prescriptions', label: 'Prescriptions only' },
    { key: 'invoices', label: 'Invoice images only' },
]

function labelize(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

interface DataManagementDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function DataManagementDialog({ open, onOpenChange }: DataManagementDialogProps) {
    const [scope, setScope] = useState<string>('stock_counts')
    const [imageScope, setImageScope] = useState<string>('all')
    const [counts, setCounts] = useState<DataManagementCounts | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const [totpCode, setTotpCode] = useState('')
    const [executing, setExecuting] = useState(false)
    const [executeError, setExecuteError] = useState<string | null>(null)

    const effectiveImageScope = scope === 'images' ? imageScope : undefined

    useEffect(() => {
        if (!open) return
        let cancelled = false
        setPreviewLoading(true)
        setPreviewError(null)
        setCounts(null)
        api.getDataManagementPreview(scope, effectiveImageScope)
            .then(res => { if (!cancelled) setCounts(res.counts) })
            .catch(err => { if (!cancelled) setPreviewError(err instanceof Error ? err.message : 'Failed to load preview') })
            .finally(() => { if (!cancelled) setPreviewLoading(false) })
        return () => { cancelled = true }
    }, [open, scope, effectiveImageScope])

    useEffect(() => {
        if (!open) {
            setTotpCode('')
            setExecuteError(null)
            setScope('stock_counts')
            setImageScope('all')
        }
    }, [open])

    const handleExecute = async () => {
        if (totpCode.length !== 6) return
        setExecuting(true)
        setExecuteError(null)
        try {
            // Pre-wipe backup export -- unconditional on every scope (even
            // Clear Images / Clear Stock Counts), not scope-conditional.
            // Both are pre-existing endpoints/client functions (already used
            // by the Inventory/Patients pages' own Download buttons) --
            // window.location.href navigations to a Content-Disposition:
            // attachment response, so these trigger a save without actually
            // navigating away. Images are deliberately not included; neither
            // endpoint has ever contained anything but tabular CSV data.
            api.exportInventory()
            api.exportPatients()
            const res = await api.executeDataManagement(scope, totpCode, effectiveImageScope)
            toast.success(res.message)
            onOpenChange(false)
        } catch (err: unknown) {
            setExecuteError(err instanceof Error ? err.message : 'Failed to execute wipe')
            setTotpCode('')
        } finally {
            setExecuting(false)
        }
    }

    const selectedScope = SCOPES.find(s => s.key === scope)!
    const totalRows = counts ? Object.values(counts).reduce((sum, v) => sum + (v ?? 0), 0) : null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-rose-600">
                        <ShieldAlert className="h-5 w-5" />
                        Data Management
                    </DialogTitle>
                    <DialogDescription>
                        These actions permanently delete data. None can be undone.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-2 space-y-4">
                    <RadioGroup value={scope} onValueChange={setScope} className="space-y-2">
                        {SCOPES.map(s => (
                            <label
                                key={s.key}
                                htmlFor={`scope-${s.key}`}
                                className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-accent/50"
                            >
                                <RadioGroupItem value={s.key} id={`scope-${s.key}`} className="mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium">{s.label}</p>
                                    <p className="text-xs text-muted-foreground">{s.description}</p>
                                </div>
                            </label>
                        ))}
                    </RadioGroup>

                    {scope === 'images' && (
                        <RadioGroup value={imageScope} onValueChange={setImageScope} className="space-y-1 pl-4">
                            {IMAGE_SCOPES.map(s => (
                                <label key={s.key} htmlFor={`imgscope-${s.key}`} className="flex items-center gap-2 cursor-pointer text-sm">
                                    <RadioGroupItem value={s.key} id={`imgscope-${s.key}`} />
                                    {s.label}
                                </label>
                            ))}
                        </RadioGroup>
                    )}

                    <div className="rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-700 dark:text-rose-400 space-y-1">
                        <p className="font-semibold">This will permanently delete:</p>
                        {previewLoading ? (
                            <p className="text-xs flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Loading counts…</p>
                        ) : previewError ? (
                            <p className="text-xs">Failed to load counts: {previewError}</p>
                        ) : counts && totalRows === 0 ? (
                            <p className="text-xs">Nothing to delete -- {selectedScope.label.toLowerCase()} is already empty.</p>
                        ) : counts ? (
                            <ul className="list-disc list-inside space-y-0.5 text-xs">
                                {Object.entries(counts).map(([k, v]) => (
                                    <li key={k}>{v} {labelize(k)}</li>
                                ))}
                            </ul>
                        ) : null}
                    </div>

                    {executeError && (
                        <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            {executeError}
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label className="text-sm font-medium">Enter your 6-digit admin auth code to confirm</Label>
                        <Input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="000000"
                            value={totpCode}
                            onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            onKeyDown={e => { if (e.key === 'Enter' && totpCode.length === 6) handleExecute() }}
                            className="text-center text-2xl tracking-widest font-mono h-12"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button
                        variant="destructive"
                        onClick={handleExecute}
                        disabled={totpCode.length !== 6 || executing || previewLoading || counts === null || totalRows === 0}
                    >
                        {executing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Execute
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no new type errors (component isn't mounted anywhere yet, so
this only checks the file's own internal type correctness).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/DataManagementDialog.tsx
git commit -m "feat(admin): DataManagementDialog component"
```

---

### Task 8: Frontend — wire the Danger Zone card into Admin Settings

**Files:**
- Modify: `frontend/app/admin/page.tsx`

**Interfaces:**
- Consumes: `<DataManagementDialog open, onOpenChange>` (Task 7).

- [ ] **Step 1: Import the dialog and `ShieldAlert`**

Add to the existing icon import line (`Loader2, Users, Activity, ...`):

```
, ShieldAlert
```

Add a new import below the other component imports:

```tsx
import { DataManagementDialog } from "@/components/DataManagementDialog"
```

- [ ] **Step 2: Add dialog-open state and the Danger Zone card**

Inside `SettingsTab()` (`frontend/app/admin/page.tsx`), add state near the
other `SettingsTab` state (e.g. next to `locations`/`locLoading`):

```tsx
    const [dataMgmtOpen, setDataMgmtOpen] = useState(false)
```

Then, immediately after the closing `</div>` of the Locations card
(`frontend/app/admin/page.tsx:1117`, right before the `</div>` that closes
`SettingsTab`'s top-level wrapper and the `return (` at `frontend/app/admin/page.tsx:1118-1119`),
insert:

```tsx
            {/* ── Danger Zone ── */}
            <div>
                <h2 className="text-lg font-semibold mb-1 text-rose-600">Danger Zone</h2>
                <p className="text-sm text-muted-foreground">
                    Permanently delete data. These actions cannot be undone.
                </p>
            </div>
            <div className="rounded-lg border border-rose-200 dark:border-rose-800 p-4">
                <Button
                    variant="outline"
                    className="text-rose-600 border-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    onClick={() => setDataMgmtOpen(true)}
                >
                    <ShieldAlert className="h-4 w-4 mr-2" />
                    Data Management
                </Button>
            </div>
            <DataManagementDialog open={dataMgmtOpen} onOpenChange={setDataMgmtOpen} />
```

- [ ] **Step 3: Verify visually**

Start both dev servers, log in as admin via the dev-JWT-cookie method
(`CLAUDE.md`'s Playwright testing section), navigate to
`/admin` → Settings tab, and confirm:
- A red-accented "Danger Zone" card with a "Data Management" button appears
  below Locations.
- Clicking it opens the dialog; the `stock_counts` scope is selected by
  default and its live counts load without error.
- Selecting "Clear Images" reveals the three image sub-radio options.
- Execute stays disabled until a 6-digit code is entered.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/admin/page.tsx
git commit -m "feat(admin): wire Danger Zone card into Admin Settings tab"
```

---

### Task 9: Frontend — remove the old Wipe Inventory button/dialog

**Files:**
- Modify: `frontend/app/inventory/page.tsx`

- [ ] **Step 1: Remove the wipe state and handler**

Delete these lines (`frontend/app/inventory/page.tsx:655-675`):

```tsx
    const [wipeDialogOpen, setWipeDialogOpen] = useState(false)
    const [wipeCode, setWipeCode] = useState('')
    const [wipeLoading, setWipeLoading] = useState(false)
    const [wipeError, setWipeError] = useState<string | null>(null)

    const handleWipeInventory = async () => {
        if (!wipeCode.trim()) return
        setWipeLoading(true)
        setWipeError(null)
        try {
            const res = await api.wipeInventory(wipeCode.trim())
            setWipeDialogOpen(false)
            setWipeCode('')
            toast.success(res.message)
            loadData()
        } catch (err: unknown) {
            setWipeError(err instanceof Error ? err.message : 'Failed to wipe inventory')
        } finally {
            setWipeLoading(false)
        }
    }
```

- [ ] **Step 2: Remove the button**

Delete the `role === 'admin'` wipe button block
(`frontend/app/inventory/page.tsx:943-953`):

```tsx
                        {role === 'admin' && (
                            <Button
                                variant="ghost"
                                size="icon"
                                title="Wipe Inventory"
                                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                onClick={() => { setWipeDialogOpen(true); setWipeCode(''); setWipeError(null) }}
                            >
                                <ShieldAlert className="h-4 w-4" />
                            </Button>
                        )}
```

- [ ] **Step 3: Remove the dialog**

Delete the entire "Wipe Inventory Dialog" block
(`frontend/app/inventory/page.tsx:1465-1525`, from the `{/* Wipe Inventory
Dialog */}` comment through its closing `</Dialog>`).

- [ ] **Step 4: Clean up now-unused imports**

Check whether `ShieldAlert` is still used elsewhere in
`frontend/app/inventory/page.tsx` after the above deletions (`grep -n
ShieldAlert frontend/app/inventory/page.tsx`); if not, remove it from the
`lucide-react` import line. Leave `AlertCircle`/`Loader2` alone — they're
near-certainly still used elsewhere in this large file.

- [ ] **Step 5: Verify**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no new type errors, and no "declared but never read" warnings
for the removed state/handler.

Then visually: navigate to `/inventory` as admin, confirm no Wipe Inventory
icon button appears anywhere in the header.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/inventory/page.tsx
git commit -m "refactor(inventory): remove Wipe Inventory button, superseded by Admin Danger Zone"
```

---

### Task 10: End-to-end verification pass

**Files:** none (verification only)

- [ ] **Step 1: Confirm the deprecated route and old UI are fully gone**

```bash
curl -s -o /dev/null -w "%{http_code}\n" --cookie "auth_token=$JWT" -X DELETE \
  "http://127.0.0.1:5000/api/admin/inventory/wipe"
```
Expected: `404`.

`grep -rn "wipeInventory\|admin/inventory/wipe" frontend/ Backend_db/routes/` —
expected: no matches anywhere in the codebase.

- [ ] **Step 2: Drive the full UI flow with Playwright for one full scope**

Using the dev-JWT-cookie method, log in as admin, open Admin → Settings →
Data Management, select "Clear Patients", confirm the live count preview
renders, enter a live TOTP code, click Execute, and confirm: the two
backup CSV downloads fire (check via
`mcp__plugin_playwright_playwright__browser_network_requests` or the
downloads list for requests to `/api/inventory/export` and
`/api/patients/export` immediately before the `execute` call), then the
success toast + dialog closes. Re-open the dialog on "Clear Patients"
again and confirm the preview now shows all zeros and Execute is disabled
("Nothing to delete").

- [ ] **Step 3: Spot-check the `images` sub-option UI interaction**

In the same session, open the dialog again, select "Clear Images", confirm
the three sub-radio options render and are switchable, and that changing
the sub-option re-fetches the preview (network tab or count text changes).
Do not necessarily execute this one if the dev DB's image data isn't
disposable — the interaction/preview behavior is what this step is
checking, not another full destructive run.

- [ ] **Step 4: Clean up test artifacts and stop dev servers**

Remove any throwaway files created under `UPLOAD_BASE_DIR` during this
plan's verification steps that execute didn't already clean up, delete any
leftover test DB rows, and stop both dev servers — mirroring the cleanup
already done for the QR upload bug fix earlier in this session.

- [ ] **Step 5: Final full-diff review**

```bash
git log --oneline -12
git diff origin/main --stat
```

Confirm the commit sequence matches Tasks 1-9 and nothing unintended is
in the diff.
