# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClinicOS is a full-stack clinic management system. The backend is a Flask REST API (`Backend_db/`) and the frontend is a Next.js 16 App Router app (`frontend/`). There is also an AI/OCR module in `models/` for invoice scanning (PaddleOCR). See `CONTEXT.md` for a quick-reference of all tables, endpoints, and key flows. See `docs/` for per-feature flow docs.

## Development Commands

### Backend (Flask)

```bash
cd Backend_db
source venv/bin/activate
python app.py          # Dev server on http://localhost:5000
```

For production (used by Render):
```bash
gunicorn --bind 0.0.0.0:$PORT "app:create_app()"
```

Utility scripts (not part of normal workflow):
```bash
python scripts/reset_db.py       # Drop and recreate tables
python scripts/seed_data.py      # Seed test data
```

### Frontend (Next.js)

```bash
cd frontend
npm run dev     # Dev server on http://localhost:3000
npm run build   # Production build
npm run lint    # ESLint check
```

### Running Both (VSCode)

The `.vscode/tasks.json` defines "Start Backend", "Start Frontend", and "Start All Servers" tasks.

### Environment Setup

**Backend** (`Backend_db/.env`):
```
DATABASE_URL=postgresql://Rize:vs%409699@localhost/clinic_db
UPLOAD_BASE_DIR=/media/fia/External/data/images
FLASK_DEBUG=True
CORS_ORIGINS=http://localhost:3000
```

**Frontend** (`frontend/.env.local`):
```
BACKEND_URL=http://127.0.0.1:5000
```

There are no test suites for either the backend or frontend.

## Architecture

### API Proxy

The frontend never calls the backend directly by hostname. `next.config.ts` rewrites `/api/*` → `$BACKEND_URL/api/*`. All API calls in `frontend/lib/api.ts` use relative paths (`/api/...`). This is intentional — it enables remote access via Twingate without CORS issues.

`lib/api.ts` also exports `API_BASE_URL` (the raw backend hostname) — use this only for direct file URLs (images), not for API calls.

### Flask Backend

- **App factory:** `Backend_db/app.py` → `create_app()` registers all blueprints with `/api` prefix.
- **Blueprints:** One file per domain in `routes/` (patients, visits, billing, inventory, images, upload, locations). All registered in `routes/__init__.py`.
- **ORM:** SQLAlchemy 2.0, all models in `models.py`. Extensions (db instance, `get_ist_now()`) in `extensions.py`.
- **Timestamps:** All use IST (UTC+5:30) via `get_ist_now()` — never use `datetime.utcnow()`.
- **ID generation:** `Backend_db/utils.py` — `generate_visit_id(patient_id)` → `{patient_id}-DDMMYY-XXX-XXX`, `generate_invoice_id()` → `DDMMYY-XXX-XXX`, `parse_expiry_date()` for flexible MM/YY input.

### Frontend

- **App Router:** All pages in `frontend/app/`. Role-based nav filtering done in `layout/Sidebar.tsx`.
- **Role system:** Roles (`frontdesk`, `doctor`, `admin`) are secured via multi-user server-side authentication and sessions. Authenticated context is managed via `lib/auth_context.tsx`.
- **UI stack:** Tailwind CSS 4 + shadcn/ui (Radix UI) + lucide-react icons. Toast notifications via `sonner`.
- **All API calls** go through `frontend/lib/api.ts`. This is the only place to add/modify API interaction.
- **IST date helper:** `frontend/lib/utils.ts` exports `getTodayIST()` — returns today's date as `YYYY-MM-DD` in IST. Use this wherever you need today's date on the frontend.

### Page Map

| Route | File | Roles |
|---|---|---|
| `/` | `app/page.tsx` | frontdesk |
| `/dashboard` | `app/dashboard/page.tsx` | frontdesk (identical to `/`) |
| `/doctor` | `app/doctor/page.tsx` | doctor (auto-redirected from `/`) |
| `/patients` | `app/patients/page.tsx` | all |
| `/visits` | `app/visits/page.tsx` | frontdesk |
| `/billing` | `app/billing/page.tsx` | frontdesk |
| `/inventory` | `app/inventory/page.tsx` | all |
| `/inventory/history` | `app/inventory/history/page.tsx` | frontdesk |
| `/inventory/history/[id]` | `app/inventory/history/[id]/page.tsx` | frontdesk |
| `/inventory/invoice_edit` | `app/inventory/invoice_edit/page.tsx` | frontdesk |
| `/gallery` | `app/gallery/page.tsx` | doctor |
| `/status` | `app/status/page.tsx` | doctor |
| `/connect/[sessionId]` | `app/connect/[sessionId]/page.tsx` | public (mobile upload) |

The sidebar (`Sidebar.tsx`) uses two separate nav lists keyed on role:
- **frontdesk**: Dashboard (`/`), Patients, Inventory, Billing — no Gallery
- **doctor**: Dashboard (`/doctor`), Patients, Inventory, Gallery, Status

The `/` root page redirects `doctor` role to `/doctor` on load.

### Patient History View (`PatientDetailsView`)

`components/PatientDetailsView.tsx` is a full-screen Dialog showing a chronological timeline of visits, images, and bills.
- **Images** open in `ImagePreviewDialog` with prev/next navigation and keyboard arrow key support.
- **Bills** are clickable cards that open `PrintInvoiceDialog` to preview and print the invoice.
- The **Eye (view history) button** on the patients list page is only rendered for `role === 'doctor'`; frontdesk sees only the Edit button.

### Status / Analytics Page

`app/status/page.tsx` is a doctor-only analytics dashboard. Calls `api.getInventoryAnalytics(locationId?)` and `api.getLedger(locationId?)` — both accept a numeric `location_id` or `'all'`. The page has a **dynamic location dropdown** populated from `GET /api/admin/locations` (no hardcoded options). When a location is selected all KPI cards, charts, and inventory alerts scope to that clinic via `?location_id=N` on the backend. **Staff filter has been removed** — filtering is location-only. Sections: revenue KPI cards, inventory stock value, expense ledger breakdown, expiry/stock alerts.

Placeholder empty directories exist for future auth: `app/login/`, `app/create-account/`.

### Database Models

Two-layer inventory model:
- `ProductMaster` — catalog only (name, category, GST rate, min stock level). No qty or price.
- `InventoryBatch` — physical stock (qty, expiry, MRP, batch#, purchase source, **location_id**).

Core relationship chain:
```
Patient → Visit → Bill → BillItem → ProductMaster
                                       ↓
                                 InventoryBatch → PurchaseInvoice
```

Other models: `InventoryHistory` (audit log), `PatientImage` (with tags), `PrescriptionItem` (linked to visits), `UploadSession` (QR mobile uploads), `Location` (clinic branches).

**Multi-location model:** `Location` (id int PK, name string unique, is_active bool) — managed in Admin → Settings. A nullable `location_id` FK to `Location` exists on `User`, `Visit`, `Bill`, `PurchaseInvoice`, `ExpenseLedger`, and `InventoryBatch`. New records are auto-tagged with the creating user's `location_id`. Old rows keep their legacy `location` string column for backward compat.

### Key Business Logic

**FIFO Billing:** When creating a bill, batches are consumed oldest-expiry-first. `BillItem` stores a snapshot of product data at sale time (not a live FK to price).

**Visit lifecycle:** `in_progress` → `done` → bill optionally created (sets `visit.invoice_id`). Payment status (`full`/`partial`/`unpaid`) tracked on the visit.

**QR Mobile Upload:** Desktop creates session → mobile opens `/connect/[sessionId]` and uploads images → desktop polls and finalizes. Files move from temp dir to permanent storage on finalize.

### File Storage

- Patient images: `$UPLOAD_BASE_DIR/patients/<patient_id>/`
- Invoice images: `$UPLOAD_BASE_DIR/invoices/`
- QR upload temp: `$UPLOAD_BASE_DIR/temp/<session_id>/`
- On Render, `UPLOAD_BASE_DIR` is `/var/data/clinic_uploads` — the `clinic-uploads` **persistent** 10GB disk (not ephemeral).

## Deployment

### Architecture

Production stack, projected ~$15/month (Render Hobby workspace):

| Service | Platform | Plan | RAM | Cost |
|---|---|---|---|---|
| `clinicos-api` | Render | Starter Python web | 512MB | $7/mo |
| `clinicos-frontend` | Render | Starter Node web | 512MB | $7/mo |
| `clinicos-db` | Render | **Free** PostgreSQL (256MB, 1GB storage) | — | $0 → **must upgrade to $7/mo** |
| `clinic-uploads` disk | Render | 10GB persistent (attached to clinicos-api) | — | $1/mo |

> **URGENT:** `clinicos-db` is on the **Free plan** and will be **auto-deleted on 2026-05-29** (~22 days). Upgrade to Starter ($7/mo) at the Render dashboard before that date to preserve all data.

### Render

Configured via `render.yaml` (root of repo). Deployed automatically on push to `main`.

**Live URLs:**
- Frontend: `https://clinicos-frontend.onrender.com`
- API: `https://clinicos-api-69mw.onrender.com`

Notes:
- Both web services (`clinicos-api`, `clinicos-frontend`) are on **Starter** plan — always-on, no spin-down
- Persistent disk `clinic-uploads` (10GB) mounted at `/var/data/clinic_uploads` on `clinicos-api` (env `UPLOAD_BASE_DIR`). Render takes daily snapshots with 7-day retention.
- **`clinicos-db` is on Free plan** — expiry 2026-05-29. Actual DB name has a Render suffix (`clinic_db_s5ra`) but this is transparent since `DATABASE_URL` is injected. PostgreSQL 18, 1GB storage, 256MB RAM.
- Gunicorn timeout 120s (OCR calls can take 30-60s); `--max-requests-jitter 50` is active in the live start command (also in render.yaml)
- `OCR_SERVICE_URL` set as a **secret env var** in Render dashboard (not in render.yaml) — set to `https://clinicos-ocr.fly.dev`
- `DATABASE_URL` injected from Render PostgreSQL; `app.py` normalises `postgres://` → `postgresql://` on startup
- `db.create_all()` runs inside `create_app()` — tables are created idempotently on every deploy
- No health check paths configured on either service — Render cannot detect hung workers

### Environment Variables

**`clinicos-api` (set in render.yaml or Render dashboard):**

| Variable | Value |
|---|---|
| `DATABASE_URL` | injected from Render PostgreSQL |
| `UPLOAD_BASE_DIR` | `/var/data/clinic_uploads` |
| `FLASK_DEBUG` | `false` |
| `CORS_ORIGINS` | `https://clinicos-frontend.onrender.com` |

**`clinicos-frontend`:**

| Variable | Value |
|---|---|
| `BACKEND_URL` | `https://clinicos-api-69mw.onrender.com` |
| `NODE_VERSION` | `20` |

---

## Invoice Print System

### Overview

The invoice print flow uses a popup window (`window.open`) to render and print. Because the popup has no access to the app's Tailwind stylesheet, `InvoicePrint.tsx` uses **100% inline CSS** — no Tailwind class names inside the invoice markup.

### Files

- `frontend/components/InvoicePrint.tsx` — the invoice layout component
- `frontend/components/PrintInvoiceDialog.tsx` — the dialog that fetches bill data and hosts the print trigger
- `frontend/app/globals.css` — contains the `@page` rule for print media

### Page size

All three files are aligned to **A5 portrait, 8mm margin**:
- `InvoicePrint.tsx` injects `<style>{'@page { size: A5 portrait; margin: 8mm }'}</style>` inside `#invoice-print-region`
- `printElement()` in `PrintInvoiceDialog.tsx` writes `@page{size:A5 portrait;margin:8mm}` into the popup's `<style>` block
- `globals.css` `@page` rule: `size: A5 portrait; margin: 8mm`

### InvoicePrint props

```ts
interface InvoicePrintProps {
  clinicName: string
  clinicAddress: string
  clinicPhone: string
  patient: {
    name: string
    phone_number: string
    age?: number | null
    sex?: string | null
  }
  billItems: { item_name: string; qty: number; mrp: number }[]
  invoiceId?: string
  total: number
  date?: Date
  className?: string  // applied to outer wrapper only, for dialog preview styling
}
```

### Layout sections (top to bottom)

1. **Header** — serif font (`Georgia`). Clinic name large+bold+uppercase left. "INVOICE" right-aligned, invoice ID and formatted date below it. 2px solid black bottom border.
2. **Patient row** — single flex line, `justify-content: space-between`. Fields: name (bold 9.5pt), phone, sex, age — each only rendered if the value is present. 1px `#ccc` bottom border.
3. **Items table** — sans-serif. Headers ALL CAPS, 6.5pt, 0.6px letter-spacing, 2px black bottom border. Columns: `#` | `Item` | `Qty` | `MRP (₹)` | `Total (₹)`. Row dividers 1px `#ddd`. Row numbers in `#999`. **No batch number rendered.**
4. **Totals** — right-aligned, 46% width. Subtotal: 7pt, `#555`, 1px `#ddd` bottom. Total: 10pt, bold 800, 2px black top border.
5. **Follow-up strip** — commented out block labeled `{/* FOLLOW-UP: uncomment when follow_up_date is wired up */}` between totals and footer.
6. **Footer** — "Thank you for visiting {clinicName}." left + "Authorised Signature ___________" right. 1px `#bbb` top border, 6.5pt, `#888`.

### printElement function

```ts
function printElement(elementId: string) {
  const el = document.getElementById(elementId)
  if (!el) return
  const win = window.open('', '_blank', 'width=600,height=850')
  if (!win) return
  win.document.write(`<!DOCTYPE html><html><head><title>Invoice</title>
    <style>body{margin:0;padding:0}@page{size:A5 portrait;margin:8mm}</style>
    </head><body>${el.innerHTML}</body></html>`)
  win.document.close()
  win.focus()
  win.print()
  win.close()
}
```

### Clinic name / address / phone — current state (known gap)

These three strings are passed as props at two call sites and are currently hardcoded:
- `frontend/app/billing/page.tsx` lines ~85–86, ~603 — `clinicName` and `clinicAddress` have local state; phone is hardcoded
- `frontend/components/PatientDetailsView.tsx` lines ~388–390 — all three hardcoded

**Planned fix:** Add a `ClinicSettings` table (one row), `GET /api/settings` + `PATCH /api/settings` endpoints, a `ClinicSettingsContext` in the frontend that fetches once on mount, and update both call sites to read from context.

## Recent Changes / Notes

- **OCR Feature Removed (2026-07-25):** The Google Cloud Vision invoice-scanning feature has been fully removed. `UploadInventoryReportDialog.tsx`, the OCR helper functions in `routes/inventory.py`, and the legacy dead `ocr_cloud/`/`models/invoice_ocr.py`/`Backend_db/ocr_service.py` scanners have all been deleted. Manual entry (`/inventory/invoice_edit?manual=true`) is now the only way to add a purchase invoice; users can still attach a photo of the physical invoice via "Attach Image" or "Upload via QR" — the image is just stored, not parsed. `GOOGLE_CLOUD_API_KEY` should be removed from the Render dashboard manually (not tracked in `render.yaml`).

- **Multi-Location Inventory System (2026-06-14):** Full per-clinic stock tracking across three sub-projects:
  - **SP1 — Location Foundation:** New `Location` model (`id`, `name`, `is_active`). Nullable `location_id` FK added to `User`, `Visit`, `Bill`, `PurchaseInvoice`, `ExpenseLedger`, `InventoryBatch` (additive — no data loss). CRUD API at `GET/POST/PATCH/DELETE /api/admin/locations` (GET is `@require_auth`; mutations are `@require_admin`). `_apply_migrations()` in `app.py` handles the 6 new FK columns on existing tables. Admin Settings tab has a **Locations card** (create, rename inline, activate/deactivate, delete). Admin Users dialog location field is now a **Select dropdown** (not free text) that saves `location_id` and syncs `location_label` for backward compat.
  - **SP2 — Per-Location Inventory:** `GET /api/inventory?location_id=N` filters stock to a single clinic. New `GET /api/inventory/export/edit?scope=all|<id>` exports one-row-per-product CSV with dynamic per-clinic qty columns. New `POST /api/inventory/import/parse-headers` classifies CSV headers as `known_fields`, `known_clinics`, or `unknown`. Import route accepts `field_mapping` and `clinic_mapping` JSON to handle renamed columns or renamed clinics. `ImportInventoryDialog` is now a 3-step flow: file pick → column mapping (if unknown headers) → mode select. Inventory page has a **location pill switcher** and the Download button opens a **two-option export dialog** (Total Inventory vs Edit Inventory with scope select).
  - **SP3 — Location Analytics:** `GET /api/inventory_analytics?location_id=N` filters all KPIs via `location_id` FK. `GET /api/ledger?location_id=N` likewise. New visits, bills, purchase invoices, and inventory batches are auto-tagged with the creating user's `location_id`. Status page has dynamic location dropdown and no staff filter.

- **Inventory System Overhaul (2026-05-23):** Comprehensive fixes across backend and frontend:
  - **OCR vendor name** — `_transform_ocr_result` now passes the extracted `vendor_name` through instead of hardcoding `''`.
  - **Expiry logic** — off-by-one fixed (`>` not `>=` month comparison); "Expires Soon" threshold changed from 3 → 6 months; configurable via `?expiry_months=N` query param on `GET /api/inventory` and `GET /api/inventory/analytics`. Frontend setting `expiryReminderMonths` (stored in localStorage, key `expiry_reminder_months`, default 6) is forwarded automatically.
  - **N+1 query fix** — `get_inventory` replaced with 4 aggregate queries (was 7× per product); `export_inventory` uses a single pre-loop GROUP BY instead of 3 scalar queries per item.
  - **Duplicate invoice detection** — `save_invoice` compares re-submitted invoices against existing batches: identical rows get an ADJUSTMENT history entry and a warning; qty-diff rows get an adjustment batch; new product rows are added normally. Always returns `warnings[]`. `invoice_date` is set to upload date on new invoices (never from form input).
  - **Negative batch prevention** — duplicate path and CSV overwrite mode both use FIFO stock reduction instead of creating negative-quantity batches.
  - **CSV export/import** — 8-column format: ID, Item Name, Pack Size, Category, Min Stock, Quantity, MRP, Expiry Date. No Dosage column; MRP = highest batch MRP; Expiry = earliest active-batch expiry. Import recognises both new and old header names.
  - **Currency** — `$` → `₹` throughout the inventory table.
  - **AllChanges tab** — visible to all roles (was doctor-only).
  - **`alert()` → `toast()`** — all `alert()` calls in `invoice_edit/page.tsx` replaced with `toast.success/warning/error`; duplicate warnings surfaced to the user.
  - **Admin Settings tab** — new Settings tab in `/admin` with an expiry reminder months control (1–24).

- **Date Filtering:** Replaced two-input date filters with `DatePickerWithRange` (`components/ui/date-range-picker.tsx`) using `react-day-picker`. This single calendar can be used to select both a single date or a range of dates. Used in Inventory "All Changes" and Invoice History tabs.
- **Invoice History:** Added client-side search (invoice number/vendor) and date range filtering to the `/inventory/history` tab. Additionally, implemented table-column dropdown filters for `Vendor` and `Source`, and a range filter for `Total Amount`. Updated the "Back to Inventory" button with an arrow icon.
- **Admin Accounts & TOTP Security Overhaul:** Integrated 10-minute JWT grant tokens (`grant_token`) after Step 1 TOTP verification to eliminate 30-second expiry failures. Created hardcoded admin accounts (`saivelapati`, `tejavelapati`) which dynamically authenticate using active 6-digit TOTP codes and auto-provision in the database on-the-fly. Completely removed `email` fields from login/signup forms, generating a mock internal email address under the hood to bypass database uniqueness constraints. Integrated `window.location.href` redirect on successful login for instant state refresh.
- **Bill Deletion Security:** Enforced `admin`-only role restrictions for deleting bills. The backend `DELETE /api/billing/<invoice_id>` endpoint and the frontend "Delete" action in `app/billing/page.tsx` are now restricted exclusively to administrators.
- **Staff Assignment Relocation & Users Overhaul:** Removed `<StaffAssignmentDialog />` from the Doctor Dashboard completely. Replaced it with a comprehensive, centralized administrative interface in `/admin` (Users tab). Overhauled the Users table to show static fields (Name, Role, Location, Status, and Edit) and added a modern Dialog modal to change Username, Role, Location, Status, and assign/unassign active staff members dynamically for Doctors (processed securely on the backend via the `PATCH /api/admin/users/<user_id>` route).
- **Unified Date Range Filters:** Standardized calendar filters across all history interfaces (Inventory, Billing History, and Admin Logs) utilizing the premium `DatePickerWithRange` component.
- **Admin Dashboard Overhaul & Real-time Metrics:** Modernized the Admin Dashboard into a dedicated split-pane analytical command center featuring glassmorphic KPI cards tracking daily active users, invoices, visits, and unified role-distribution visual capsules.
- **On-Demand Infrastructure Telemetry:** Engineered an asynchronous system probe via `/api/admin/diagnostics` allowing admins to execute disk checks, confirm OCR activation state, recursively scan user media volume consumption, and view live PostgreSQL footprint reports safely on-demand without login lag.
- **CSV Loader Persistence Fix:** Hotpatched iterative batch flushing logic to instantiate and Stage the parent Invoice entity prior to child record addition, preventing database constraint aborts on active inventory syncs.
- **Admin Master Deletion System:** Introduced secure `@require_admin` backends handling hard-cascading physical purges of Inventory products, written to intelligently safeguard historic `BillItem` integrity rather than corrupting accounts.
- **Patient Batch Pipelines:** Duplicated ultra-streamlined import/export engines to Patients module, complete with robust auto-deduplicating ingestion logics (collating on matching Name+Phone strings) and explicit browser triggers. Field-length validation added (name ≤100, phone ≤20, sex ≤10, reference ≤100) to prevent DB constraint crashes on bad CSV data.
