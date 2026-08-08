# Remove OCR Invoice-Scanning Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely remove the OCR invoice-scanning feature (Google Cloud Vision-based photo-to-line-items extraction) from ClinicOS, leaving the already-working manual invoice entry flow (`/inventory/invoice_edit?manual=true`) as the sole way to add purchase invoices. Also delete the dead legacy OCR code that predates the Vision API integration and was never wired into the live app.

**Architecture:** The active OCR flow lives entirely in `Backend_db/routes/inventory.py` (`_run_ocr`, `_parse_vision_response`, `_transform_ocr_result`) and is called from two places: the desktop upload route (`upload_inventory_report`) and the QR mobile-upload finalize route (`Backend_db/routes/upload.py`). Both call sites are being repurposed to a plain "save the image, return its path" behavior rather than deleted outright, because `invoice_edit/page.tsx`'s "Attach Image" and "Upload via QR" buttons already only consume the `path`/success signal — they never read `ocr_data`. The one frontend surface that exists *purely* for OCR — `UploadInventoryReportDialog.tsx` and its "Upload" trigger button on the inventory page — is deleted outright since it has no purpose once extraction is gone. Legacy dead code (`ocr_cloud/`, `models/invoice_ocr.py`, `Backend_db/ocr_service.py`) that CLAUDE.md already documents as "no longer deployed" and which no active route imports is deleted as part of the same cleanup. Docs (`CLAUDE.md`, `CONTEXT.md`, `docs/api_endpoints.md`, `docs/flows/inventory.md`) are updated to match.

**Tech Stack:** Flask + SQLAlchemy 2.0 (backend), Next.js 16 App Router + React + Tailwind + shadcn/ui (frontend). No test suites — verification is curl against the running dev server (`http://localhost:5000`) plus browser interaction (`http://localhost:3000`).

## Global Constraints

- No `Co-Authored-By` lines in any git commit message
- All frontend API calls use relative paths (`/api/...`) or `API_BASE_URL` for direct file/multipart calls — never hardcode `localhost:5000`
- Historical `purchase_invoices` rows with `source='OCR'` are left untouched in the database — this is a code change, not a data migration
- `GOOGLE_CLOUD_API_KEY` cannot be removed from the Render dashboard by this plan (it's a dashboard-only secret, not in `render.yaml`) — flagged as a manual step at the end
- Backend runs on `localhost:5000`, frontend on `localhost:3000`

---

## File Map

| File | Action | What changes |
|---|---|---|
| `Backend_db/routes/inventory.py` | Modify | Delete `_parse_vision_response`, `_run_ocr`, `_EMPTY_OCR`, `_transform_ocr_result`, the now-unused `requests` import; strip OCR call out of `upload_inventory_report`; fix `save_invoice` source-type bug |
| `Backend_db/routes/upload.py` | Modify | Drop the `_run_ocr`/`_transform_ocr_result` import and call in `finalize_session`'s inventory branch |
| `Backend_db/routes/admin.py` | Modify | Remove `ocr_configured` from `/admin/diagnostics` response |
| `Backend_db/ocr_service.py` | Delete | Unused duplicate of `models/invoice_ocr.py`'s `AIInvoiceScanner`, not imported anywhere |
| `models/invoice_ocr.py`, `models/README.md`, `models/requirements.txt`, `models/.venv/`, `models/__pycache__/` | Delete | Legacy AI Studio/PaddleOCR scanner, unused |
| `ocr_cloud/` (whole dir) | Delete | Legacy Fly.io/PaddleOCR microservice, already undeployed per CLAUDE.md |
| `Backend_db/requirements-ocr.txt` | Delete | Only served the deleted legacy scanner |
| `render.yaml` | Modify | Remove unused `OCR_SERVICE_URL` env var entry |
| `frontend/components/UploadInventoryReportDialog.tsx` | Delete | Entire component is OCR-response handling with no purpose left |
| `frontend/app/inventory/page.tsx` | Modify | Remove `UploadInventoryReportDialog` import + its "Upload" trigger button |
| `frontend/lib/api.ts` | Modify | Trim `UploadInventoryResponse` (drop `ocr_data`), trim `SystemDiagnostics` (drop `ocr_configured`) |
| `frontend/app/admin/page.tsx` | Modify | Remove the "OCR Service" diagnostics card |
| `CLAUDE.md` | Modify | Remove OCR business-logic section, deployment section, env var row |
| `CONTEXT.md` | Modify | Remove OCR references from folder tree, API list, key design patterns |
| `docs/api_endpoints.md` | Modify | Rewrite `POST /api/inventory/upload` doc to drop OCR mention |
| `docs/flows/inventory.md` | Modify | Rewrite "Upload Report (OCR Invoice)" section and component table row |

---

## Task 1: Backend — strip OCR out of `inventory.py`

**Files:**
- Modify: `Backend_db/routes/inventory.py:1-401` (delete OCR helpers + unused import)
- Modify: `Backend_db/routes/inventory.py` — `upload_inventory_report()` (currently lines ~1948-1975)
- Modify: `Backend_db/routes/inventory.py` — `save_invoice()` source-type block (currently lines ~1999-2002)

**Interfaces:**
- Produces: `POST /api/inventory/upload` now returns `{ "message": str, "path": str }` (no `ocr_data` key)
- Consumed by: `frontend/lib/api.ts`'s `uploadInventoryReport()` (Task 6), `frontend/app/inventory/invoice_edit/page.tsx`'s "Attach Image" handler (unchanged — already only reads `res.path`)

- [ ] **Step 1: Delete the OCR helper functions and the now-unused import**

In `Backend_db/routes/inventory.py`, delete the entire block from the top of the file through the end of `_transform_ocr_result` — that's everything from:

```python
def _parse_vision_response(vision_result: dict) -> dict:
```

down through:

```python
    return {
        'product_details': product_details,
        'invoice_number': metadata.get('invoice_no') or '',
        'gst_number': metadata.get('gst_no') or '',
        'total_amount': str(total_amount) if total_amount != '' else '',
        'vendor_name': metadata.get('vendor_name') or '',
    }
```

(This removes `_parse_vision_response`, `_run_ocr`, `_EMPTY_OCR`, and `_transform_ocr_result` — everything between the imports and the `inventory = Blueprint(...)` line.)

Also remove the now-unused import at the top of the file:

```python
import requests as http_requests
```

The imports block should read:

```python
from flask import Blueprint, request, jsonify, send_file, g
from extensions import db, get_ist_now
from models import ProductMaster, InventoryBatch, InventoryHistory, PurchaseInvoice, BillItem, User
from sqlalchemy import func, case
import io
import csv
import os

from utils import parse_expiry_date
from .auth import require_auth, require_admin, log_activity

inventory = Blueprint('inventory', __name__)
```

- [ ] **Step 2: Simplify `upload_inventory_report` to a plain file-save**

Find:

```python
@inventory.route('/inventory/upload', methods=['POST'])
@require_auth
def upload_inventory_report():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    upload_folder = os.path.join(os.environ.get('UPLOAD_BASE_DIR', '/tmp/clinic_uploads'), 'invoices')
    try:
        if not os.path.exists(upload_folder):
            os.makedirs(upload_folder)
        
        timestamp = int(get_ist_now().timestamp())
        filename = f"{timestamp}_{file.filename}"
        filepath = os.path.join(upload_folder, filename)
        file.save(filepath)
        
        ocr_result = _run_ocr(filepath)

        return jsonify({
            'message': 'File uploaded and processed successfully',
            'path': filepath,
            'ocr_data': _transform_ocr_result(ocr_result)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

Replace with:

```python
@inventory.route('/inventory/upload', methods=['POST'])
@require_auth
def upload_inventory_report():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    upload_folder = os.path.join(os.environ.get('UPLOAD_BASE_DIR', '/tmp/clinic_uploads'), 'invoices')
    try:
        if not os.path.exists(upload_folder):
            os.makedirs(upload_folder)

        timestamp = int(get_ist_now().timestamp())
        filename = f"{timestamp}_{file.filename}"
        filepath = os.path.join(upload_folder, filename)
        file.save(filepath)

        return jsonify({
            'message': 'File uploaded successfully',
            'path': filepath,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **Step 3: Fix `save_invoice`'s source-type bug**

This bug pre-dates this plan but must be fixed now: `save_invoice` currently tags a purchase invoice as `source='OCR'` merely because an image is attached, regardless of whether OCR ever ran on it. With OCR gone, every invoice would incorrectly show an "OCR" badge in invoice history just for having a photo attached.

Find (inside `save_invoice`, in the `if not existing:` block):

```python
        source_type = 'MANUAL'
        if image_path:
            source_type = 'OCR'

        new_inv = PurchaseInvoice(
```

Replace with:

```python
        new_inv = PurchaseInvoice(
```

And change the field below it from `source=source_type,` to `source='MANUAL',`.

- [ ] **Step 4: Verify**

Restart the backend:

```bash
cd Backend_db && source venv/bin/activate && python app.py
```

In another terminal, confirm the module imports cleanly and the route responds without OCR:

```bash
curl -s -X POST http://localhost:5000/api/inventory/upload \
  -H "Cookie: <paste a valid session cookie>" \
  -F "file=@/path/to/any/test/image.jpg"
```

Expected: `200` with `{"message": "File uploaded successfully", "path": "..."}` — no `ocr_data` key, no server error in the Flask console.

- [ ] **Step 5: Commit**

```bash
git add Backend_db/routes/inventory.py
git commit -m "refactor: remove OCR extraction from inventory upload route"
```

---

## Task 2: Backend — drop OCR from the QR mobile-upload finalize path

**Files:**
- Modify: `Backend_db/routes/upload.py:9` (import)
- Modify: `Backend_db/routes/upload.py` — `finalize_session()`, inventory branch (currently lines ~126-147)

**Interfaces:**
- Consumes: none (this task has no dependency on Task 1's new response shape — it builds its own return dict)
- Produces: `POST /api/upload/session/<session_id>/finalize` for `context_type == 'inventory'` now returns `{ "message": str, "path": str }` (no `ocr_data` key)

- [ ] **Step 1: Remove the OCR import**

Find:

```python
from routes.inventory import _run_ocr, _transform_ocr_result
```

Delete this line entirely.

- [ ] **Step 2: Simplify the inventory branch of `finalize_session`**

Find:

```python
    # ── Inventory path ──────────────────────────────────────────────────────
    if session.context_type == 'inventory':
        if not uploaded_files:
            return jsonify({'error': 'No files in session'}), 400

        # Use the first file only (invoice scans are one image)
        first_file = uploaded_files[0]
        filepath = first_file.get('path', '')

        if not filepath or not os.path.exists(filepath):
            return jsonify({'error': 'Uploaded file not found on disk'}), 500

        ocr_result = _run_ocr(filepath)

        session.status = 'COMPLETED'
        db.session.commit()

        return jsonify({
            'message': 'File processed successfully',
            'path': filepath,
            'ocr_data': _transform_ocr_result(ocr_result),
        }), 200
```

Replace with:

```python
    # ── Inventory path ──────────────────────────────────────────────────────
    if session.context_type == 'inventory':
        if not uploaded_files:
            return jsonify({'error': 'No files in session'}), 400

        # Use the first file only (invoice scans are one image)
        first_file = uploaded_files[0]
        filepath = first_file.get('path', '')

        if not filepath or not os.path.exists(filepath):
            return jsonify({'error': 'Uploaded file not found on disk'}), 500

        session.status = 'COMPLETED'
        db.session.commit()

        return jsonify({
            'message': 'File processed successfully',
            'path': filepath,
        }), 200
```

- [ ] **Step 3: Verify**

With the backend running, exercise the QR path from the browser: open `http://localhost:3000/inventory/invoice_edit?manual=true`, click "Upload via QR", scan with a phone (or manually `POST` to `/api/upload/mobile/<session_id>` with a test image using curl), then finalize:

```bash
curl -s -X POST http://localhost:5000/api/upload/session/<session_id>/finalize
```

Expected: `200` with `{"message": "File processed successfully", "path": "..."}`, no server error, no `ocr_data` key.

- [ ] **Step 4: Commit**

```bash
git add Backend_db/routes/upload.py
git commit -m "refactor: remove OCR call from QR mobile invoice-upload finalize path"
```

---

## Task 3: Backend — remove OCR diagnostics from admin panel

**Files:**
- Modify: `Backend_db/routes/admin.py` — `admin_diagnostics()` (currently lines ~244-290)

**Interfaces:**
- Produces: `GET /api/admin/diagnostics` response no longer includes `ocr_configured`
- Consumed by: `frontend/lib/api.ts`'s `SystemDiagnostics` type (Task 6), `frontend/app/admin/page.tsx`'s diagnostics card (Task 7)

- [ ] **Step 1: Remove the OCR status check and field**

Find:

```python
    # 1. OCR Status Detection
    ocr_active = bool(os.environ.get('GOOGLE_CLOUD_API_KEY', '').strip())

    # 2. File Storage Telemetry (Images/Invoices)
```

Replace with:

```python
    # 1. File Storage Telemetry (Images/Invoices)
```

Find:

```python
    return jsonify({
        'ocr_configured': ocr_active,
        'db_size_bytes': int(db_size_bytes),
```

Replace with:

```python
    return jsonify({
        'db_size_bytes': int(db_size_bytes),
```

- [ ] **Step 2: Verify**

```bash
curl -s http://localhost:5000/api/admin/diagnostics -H "Cookie: <paste an admin session cookie>"
```

Expected: `200` JSON response with no `ocr_configured` key; `db_size_bytes`, `media_size_bytes`, `system_disk` still present.

- [ ] **Step 3: Commit**

```bash
git add Backend_db/routes/admin.py
git commit -m "refactor: remove OCR status from admin diagnostics"
```

---

## Task 4: Delete dead legacy OCR code and unused env var

**Files:**
- Delete: `Backend_db/ocr_service.py`
- Delete: `models/invoice_ocr.py`, `models/README.md`, `models/requirements.txt`, `models/.venv/`, `models/__pycache__/`, and the now-empty `models/` directory
- Delete: `ocr_cloud/` (whole directory: `Dockerfile`, `fly.toml`, `main.py`, `ocr_service.py`, `requirements.txt`)
- Delete: `Backend_db/requirements-ocr.txt`
- Modify: `render.yaml`

None of this code is imported by any active route (verified: no references to `invoice_ocr`, `AIInvoiceScanner`, or `ocr_cloud` outside these files themselves and doc mentions handled in Task 8).

- [ ] **Step 1: Delete the legacy directories and files**

`models/.venv/` and `models/__pycache__/` are gitignored (untracked), so `git rm` won't touch them — remove them with a plain `rm -rf` after the tracked files are staged for deletion:

```bash
git rm -r Backend_db/ocr_service.py models/README.md models/invoice_ocr.py models/requirements.txt ocr_cloud/ Backend_db/requirements-ocr.txt
rm -rf models/
```

- [ ] **Step 2: Remove the unused `OCR_SERVICE_URL` env var from `render.yaml`**

Find (inside the `clinicos-api` service's `envVars:` list):

```yaml
      - key: OCR_SERVICE_URL
        sync: false
      - key: JWT_SECRET_KEY
        sync: false
```

Replace with:

```yaml
      - key: JWT_SECRET_KEY
        sync: false
```

- [ ] **Step 3: Verify**

```bash
git status
```

Expected: the deleted paths show as staged deletions; no other files affected. Confirm the backend still boots clean (no import errors) since none of these deleted modules were imported by live code:

```bash
cd Backend_db && source venv/bin/activate && python -c "from app import create_app; create_app()"
```

Expected: no traceback.

- [ ] **Step 4: Commit**

```bash
git add render.yaml
git commit -m "chore: delete dead legacy OCR code and unused OCR_SERVICE_URL env var"
```

---

## Task 5: Frontend — delete `UploadInventoryReportDialog` and its trigger

**Files:**
- Delete: `frontend/components/UploadInventoryReportDialog.tsx`
- Modify: `frontend/app/inventory/page.tsx:20` (import) and the "Upload" button block (currently around lines 593-600)

**Interfaces:**
- Consumes: none
- After this task, `/inventory` has a single "add invoice" entry point: the existing "Manual" button linking to `/inventory/invoice_edit?manual=true`

- [ ] **Step 1: Delete the component file**

```bash
git rm frontend/components/UploadInventoryReportDialog.tsx
```

- [ ] **Step 2: Remove the import from `inventory/page.tsx`**

Find:

```tsx
import { UploadInventoryReportDialog } from "@/components/UploadInventoryReportDialog"
```

Delete this line.

- [ ] **Step 3: Remove the "Upload" trigger button**

Find:

```tsx
                    <Link href="/inventory/invoice_edit?manual=true" className="shrink-0">
                        <Button size="sm">
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            Manual
                        </Button>
                    </Link>
                    <UploadInventoryReportDialog
                        trigger={
                            <Button size="sm" className="shrink-0">
                                <Package className="mr-1.5 h-3.5 w-3.5" />
                                Upload
                            </Button>
                        }
                    />
```

Replace with:

```tsx
                    <Link href="/inventory/invoice_edit?manual=true" className="shrink-0">
                        <Button size="sm">
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            Add Invoice
                        </Button>
                    </Link>
```

(Renamed "Manual" → "Add Invoice" since it's now the only entry point, not one of two options. If `Package` becomes an unused lucide-react import after this change, remove it from the import line too — check with a repo-wide grep for `Package` in this file before removing.)

- [ ] **Step 4: Verify**

```bash
cd frontend && npm run lint
```

Expected: no errors about unused imports or missing `UploadInventoryReportDialog`.

Start the dev server and check in browser:

```bash
npm run dev
```

Visit `http://localhost:3000/inventory`, confirm only one "Add Invoice" button appears (no separate "Upload" button), and clicking it navigates to the manual invoice-edit page correctly.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/UploadInventoryReportDialog.tsx frontend/app/inventory/page.tsx
git commit -m "feat: remove OCR upload dialog, manual entry is now the only invoice-add path"
```

---

## Task 6: Frontend — trim OCR fields out of `api.ts` types

**Files:**
- Modify: `frontend/lib/api.ts:136-140` (`UploadInventoryResponse`)
- Modify: `frontend/lib/api.ts:717-727` (`SystemDiagnostics`)

**Interfaces:**
- Produces: `UploadInventoryResponse { message: string; path: string }`, `SystemDiagnostics` without `ocr_configured`
- Consumed by: `frontend/app/inventory/invoice_edit/page.tsx` (uses `.path` only, already compatible), `frontend/app/admin/page.tsx` (Task 7)

- [ ] **Step 1: Trim `UploadInventoryResponse`**

Find:

```ts
export interface UploadInventoryResponse {
    message: string;
    path: string;
    ocr_data: string | Record<string, unknown> | { error: string };
}
```

Replace with:

```ts
export interface UploadInventoryResponse {
    message: string;
    path: string;
}
```

- [ ] **Step 2: Trim `SystemDiagnostics`**

Find:

```ts
export interface SystemDiagnostics {
  ocr_configured: boolean
  db_size_bytes: number
  media_size_bytes: number
  system_disk: {
    total: number
    used: number
    free: number
  }
  timestamp: string
}
```

Replace with:

```ts
export interface SystemDiagnostics {
  db_size_bytes: number
  media_size_bytes: number
  system_disk: {
    total: number
    used: number
    free: number
  }
  timestamp: string
}
```

- [ ] **Step 3: Verify**

```bash
cd frontend && npm run lint
```

Expected: no type errors. (Task 7 removes the last reader of `.ocr_configured`; if run out of order, `npm run lint` will flag `frontend/app/admin/page.tsx` referencing a removed field — that's expected until Task 7 lands.)

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "refactor: remove OCR fields from api.ts response types"
```

---

## Task 7: Frontend — remove OCR indicator from admin diagnostics UI

**Files:**
- Modify: `frontend/app/admin/page.tsx` (currently lines ~192-215)

**Interfaces:**
- Consumes: `SystemDiagnostics` from Task 6 (no `ocr_configured` field)

- [ ] **Step 1: Remove the OCR card and collapse the grid to one column**

Find:

```tsx
                {/* Quick Info Cards Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {/* OCR Indicator */}
                  <div className="flex items-center gap-3 p-2 bg-background/50 border rounded-xl">
                    {diag.ocr_configured ? (
                      <div className="h-7 w-7 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /></div>
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-600 dark:text-rose-400"><XCircle className="h-4 w-4" /></div>
                    )}
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider leading-none mb-0.5">OCR Service</p>
                      <p className="text-xs font-bold truncate">{diag.ocr_configured ? 'Google Vision Active' : 'Not Configured'}</p>
                    </div>
                  </div>

                  {/* DB Size */}
                  <div className="flex items-center gap-3 p-2 bg-background/50 border rounded-xl">
                    <div className="h-7 w-7 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400"><Database className="h-4 w-4" /></div>
                    <div>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider leading-none mb-0.5">DB Footprint</p>
                      <p className="text-xs font-bold">{fmtBytes(diag.db_size_bytes)}</p>
                    </div>
                  </div>
                </div>
```

Replace with:

```tsx
                {/* Quick Info Cards Grid */}
                <div className="grid grid-cols-1 gap-3">
                  {/* DB Size */}
                  <div className="flex items-center gap-3 p-2 bg-background/50 border rounded-xl">
                    <div className="h-7 w-7 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400"><Database className="h-4 w-4" /></div>
                    <div>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider leading-none mb-0.5">DB Footprint</p>
                      <p className="text-xs font-bold">{fmtBytes(diag.db_size_bytes)}</p>
                    </div>
                  </div>
                </div>
```

- [ ] **Step 2: Check whether `CheckCircle2` and `XCircle` are still used elsewhere in the file**

```bash
grep -n "CheckCircle2\|XCircle" frontend/app/admin/page.tsx
```

If either name no longer appears anywhere else in the file, remove it from the top-of-file lucide-react import list. If both are still used elsewhere (common in admin dashboards for status badges), leave the import line untouched.

- [ ] **Step 3: Verify**

```bash
cd frontend && npm run lint && npm run build
```

Expected: both succeed with no errors about `diag.ocr_configured` or unused imports.

In the browser, log in as an admin, go to `/admin` → Infrastructure Telemetry → Run Diagnostics, and confirm the panel shows only the DB Footprint card (plus the storage analysis section below it) with no OCR card and no layout gap.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/admin/page.tsx
git commit -m "feat: remove OCR service card from admin diagnostics panel"
```

---

## Task 8: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CONTEXT.md`
- Modify: `docs/api_endpoints.md:266-271`
- Modify: `docs/flows/inventory.md:55-60,92`

**Interfaces:** none — documentation only.

- [ ] **Step 1: `CLAUDE.md` — remove the OCR business-logic bullet**

Find (under "Key Business Logic"):

```markdown
**OCR Invoice Import:** Upload image → `_run_ocr()` in `routes/inventory.py` → calls **Google Cloud Vision API** (`DOCUMENT_TEXT_DETECTION`) → `_parse_vision_response()` extracts metadata + line items via bounding-box spatial analysis → `_transform_ocr_result()` maps to frontend schema → user confirms → `POST /api/inventory/save_invoice` creates `PurchaseInvoice` + batches. The `ocr_cloud/` directory (legacy Fly.io/PaddleOCR service) is no longer deployed.
```

Delete this line entirely.

- [ ] **Step 2: `CLAUDE.md` — remove the OCR deployment section**

Find and delete the entire `### OCR (Google Cloud Vision API)` subsection under "## Deployment", including its bullet list (the block starting `OCR runs directly inside clinicos-api...` through the `ocr_cloud/ directory kept in repo but no longer deployed` bullet). Since the feature and the `ocr_cloud/` directory are both gone as of this plan, the whole subsection is now inaccurate.

- [ ] **Step 3: `CLAUDE.md` — remove the `GOOGLE_CLOUD_API_KEY` row from the env var table**

Find (in the `clinicos-api` environment variables table under "### Environment Variables"):

```markdown
| `GOOGLE_CLOUD_API_KEY` | GCP Vision API key (secret — set in dashboard, restricted to Cloud Vision API) |
```

Delete this row.

- [ ] **Step 4: `CLAUDE.md` — remove OCR from the cost table**

Find (in the "### Architecture" cost table under "## Deployment"):

```markdown
| Google Cloud Vision API | GCP | pay-per-use (1000 free/mo) | — | $0/mo (budget alert set at $10) |
```

Delete this row.

- [ ] **Step 5: `CLAUDE.md` — add a note under "Recent Changes / Notes"**

At the top of the "## Recent Changes / Notes" section, add:

```markdown
- **OCR Feature Removed (2026-07-25):** The Google Cloud Vision invoice-scanning feature has been fully removed. `UploadInventoryReportDialog.tsx`, the OCR helper functions in `routes/inventory.py`, and the legacy dead `ocr_cloud/`/`models/invoice_ocr.py`/`Backend_db/ocr_service.py` scanners have all been deleted. Manual entry (`/inventory/invoice_edit?manual=true`) is now the only way to add a purchase invoice; users can still attach a photo of the physical invoice via "Attach Image" or "Upload via QR" — the image is just stored, not parsed. `GOOGLE_CLOUD_API_KEY` should be removed from the Render dashboard manually (not tracked in `render.yaml`).
```

- [ ] **Step 6: `CONTEXT.md` — remove the four OCR references**

In the folder-structure tree, find and delete this line:

```
│   │   ├── UploadInventoryReportDialog.tsx # OCR invoice upload
```

Find and edit:

```
│       ├── inventory.py          # /api/inventory  (+ analytics, export, import, OCR)
```

to:

```
│       ├── inventory.py          # /api/inventory  (+ analytics, export, import)
```

Find and delete this line entirely:

```
├── models/invoice_ocr.py         # AIInvoiceScanner (PaddleOCR/AI Studio)
```

In the API endpoints list, find:

```
- `POST /api/inventory/upload` — upload image → OCR → returns parsed data
- `POST /api/inventory/save_invoice` — commit OCR/manual invoice to DB (auto-tags batches with creator's location_id)
```

Replace with:

```
- `POST /api/inventory/upload` — save an invoice image, returns its path
- `POST /api/inventory/save_invoice` — commit a manually-entered invoice to DB (auto-tags batches with creator's location_id)
```

In "Key Design Patterns", find and delete this line entirely:

```
- **OCR flow:** upload image → Google Cloud Vision API → `_parse_vision_response()` → user reviews → `save_invoice` commits
```

- [ ] **Step 7: `docs/api_endpoints.md` — rewrite the upload endpoint doc**

Find:

```markdown
### `POST /api/inventory/upload`
Upload an invoice image and run OCR on it. Returns OCR-parsed product data.

**Form Data:** `file` — image file (JPG, PNG, etc.)

**Response:** `200 { "message": "...", "path": "/media/.../filename.jpg", "ocr_data": { ... } }`

---

### `POST /api/inventory/save_invoice`
Save a confirmed invoice (after OCR review or manual entry) with all product details. Creates `PurchaseInvoice`, `ProductMaster` (if new), `InventoryBatch`, and `InventoryHistory` records.
```

Replace with:

```markdown
### `POST /api/inventory/upload`
Save an uploaded invoice image to disk and return its path, for attaching to a manually-entered invoice.

**Form Data:** `file` — image file (JPG, PNG, etc.)

**Response:** `200 { "message": "...", "path": "/media/.../filename.jpg" }`

---

### `POST /api/inventory/save_invoice`
Save a manually-entered invoice with all product details. Creates `PurchaseInvoice`, `ProductMaster` (if new), `InventoryBatch`, and `InventoryHistory` records.
```

- [ ] **Step 8: `docs/flows/inventory.md` — rewrite the "Adding Stock" section**

Find:

```markdown
### Upload Report (OCR Invoice)
1. Click **Upload Report** → `UploadInventoryReportDialog`
2. Select an invoice image (JPG, PNG, PDF)
3. File is sent to `POST /api/inventory/upload` → saved to disk → passed through `AIInvoiceScanner`
4. OCR-parsed data is returned and shown for review on the invoice edit page
5. User confirms/edits → `POST /api/inventory/save_invoice` commits everything

### Manual Entry
- Link to `/inventory/invoice_edit?manual=true`
- User fills in invoice details and product rows manually
```

Replace with:

```markdown
### Manual Entry
- Click **Add Invoice** → `/inventory/invoice_edit?manual=true`
- User fills in invoice details and product rows manually
- Optionally attaches a photo of the physical invoice via "Attach Image" (`POST /api/inventory/upload` — stores the file, no extraction) or "Upload via QR" (same storage-only behavior via the QR mobile-upload session)
- `POST /api/inventory/save_invoice` commits everything
```

Find (in the "Components Used" table):

```markdown
| `UploadInventoryReportDialog` | Upload invoice image + trigger OCR |
```

Delete this row entirely.

- [ ] **Step 9: Verify**

```bash
grep -rn -i "ocr\|vision\|AIInvoiceScanner" CLAUDE.md CONTEXT.md docs/api_endpoints.md docs/flows/inventory.md
```

Expected: no output (aside from the one intentional historical note added in Step 5, which mentions OCR only to say it was removed).

- [ ] **Step 10: Commit**

```bash
git add CLAUDE.md CONTEXT.md docs/api_endpoints.md docs/flows/inventory.md
git commit -m "docs: remove OCR feature references, document its removal"
```

---

## Task 9: End-to-end verification

**Files:** none — manual verification only.

- [ ] **Step 1: Full manual invoice flow**

With both dev servers running (`Backend_db`: `python app.py`, `frontend`: `npm run dev`):

1. Log in as frontdesk or admin, go to `/inventory`.
2. Confirm there is exactly one "Add Invoice" button (no "Upload" button).
3. Click it → lands on `/inventory/invoice_edit?manual=true` with one empty row.
4. Fill in a product name, batch, expiry, qty, MRP → click "Attach Image" → pick a test photo → confirm it shows "View Attached Image" afterward (proves `POST /api/inventory/upload` still works without OCR).
5. Click "Save to Inventory" → confirm success toast and redirect to `/inventory`.
6. Go to `/inventory/history` → confirm the new invoice shows `source: MANUAL` (not `OCR`), even though it has an attached image — this confirms Task 1 Step 3's bug fix.

- [ ] **Step 2: Admin diagnostics sanity check**

Log in as admin, go to `/admin` → Infrastructure Telemetry → Run Diagnostics. Confirm no OCR card appears and no console errors.

- [ ] **Step 3: Grep sweep for stragglers**

```bash
grep -rn -i "ocr\|AIInvoiceScanner\|GOOGLE_CLOUD_API_KEY" --include="*.py" --include="*.ts" --include="*.tsx" --include="*.yaml" . | grep -v venv | grep -v node_modules | grep -v ".git/"
```

Expected: no output.

- [ ] **Step 4: Manual step — remove the Render dashboard secret**

This cannot be scripted: log into the Render dashboard, open `clinicos-api` → Environment, and delete the `GOOGLE_CLOUD_API_KEY` secret. Confirm with the user before doing this in production, since it's an irreversible-without-re-entry change to a live service's config.
