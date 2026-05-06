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
- **Blueprints:** One file per domain in `routes/` (patients, visits, billing, inventory, images, upload). All registered in `routes/__init__.py`.
- **ORM:** SQLAlchemy 2.0, all models in `models.py`. Extensions (db instance, `get_ist_now()`) in `extensions.py`.
- **Timestamps:** All use IST (UTC+5:30) via `get_ist_now()` — never use `datetime.utcnow()`.
- **ID generation:** `Backend_db/utils.py` — `generate_visit_id(patient_id)` → `{patient_id}-DDMMYY-XXX-XXX`, `generate_invoice_id()` → `DDMMYY-XXX-XXX`, `parse_expiry_date()` for flexible MM/YY input.

### Frontend

- **App Router:** All pages in `frontend/app/`. Role-based nav filtering done in `layout/Sidebar.tsx`.
- **Role system:** Roles (`frontdesk`, `doctor`, `admin`) stored in `localStorage["clinic_role"]` — no server-side auth. Managed via `lib/auth_context.tsx` and `profile-switcher.tsx`.
- **UI stack:** Tailwind CSS 4 + shadcn/ui (Radix UI) + lucide-react icons. Toast notifications via `sonner`.
- **All API calls** go through `frontend/lib/api.ts`. This is the only place to add/modify API interaction.
- **IST date helper:** `frontend/lib/utils.ts` exports `getTodayIST()` — returns today's date as `YYYY-MM-DD` in IST. Use this wherever you need today's date on the frontend.

### Page Map

| Route | File | Roles |
|---|---|---|
| `/` | `app/page.tsx` | frontdesk, admin |
| `/dashboard` | `app/dashboard/page.tsx` | frontdesk, admin (identical to `/`) |
| `/doctor` | `app/doctor/page.tsx` | doctor (auto-redirected from `/`) |
| `/patients` | `app/patients/page.tsx` | all |
| `/visits` | `app/visits/page.tsx` | frontdesk, admin |
| `/billing` | `app/billing/page.tsx` | frontdesk, admin |
| `/inventory` | `app/inventory/page.tsx` | all |
| `/inventory/history` | `app/inventory/history/page.tsx` | frontdesk, admin |
| `/inventory/history/[id]` | `app/inventory/history/[id]/page.tsx` | frontdesk, admin |
| `/inventory/invoice_edit` | `app/inventory/invoice_edit/page.tsx` | frontdesk, admin |
| `/gallery` | `app/gallery/page.tsx` | doctor |
| `/status` | `app/status/page.tsx` | doctor |
| `/connect/[sessionId]` | `app/connect/[sessionId]/page.tsx` | public (mobile upload) |

The sidebar (`Sidebar.tsx`) uses two separate nav lists keyed on role:
- **frontdesk / admin**: Dashboard (`/`), Patients, Inventory, Billing — no Gallery
- **doctor**: Dashboard (`/doctor`), Patients, Inventory, Gallery, Status

The `/` root page redirects `doctor` role to `/doctor` on load.

### Patient History View (`PatientDetailsView`)

`components/PatientDetailsView.tsx` is a full-screen Dialog showing a chronological timeline of visits, images, and bills.
- **Images** open in `ImagePreviewDialog` with prev/next navigation and keyboard arrow key support.
- **Bills** are clickable cards that open `PrintInvoiceDialog` to preview and print the invoice.
- The **Eye (view history) button** on the patients list page is only rendered for `role === 'doctor'`; frontdesk/admin see only the Edit button.

### Status / Analytics Page

`app/status/page.tsx` is a doctor-only analytics dashboard. All metrics are computed client-side from `api.getVisits()` and `api.getBillingHistory()` — no dedicated backend endpoints. Sections: revenue KPI cards, weekly revenue bar chart, visits by day-of-week, busiest hours, payment type breakdown, new vs returning patients, recent patients list.

Placeholder empty directories exist for future auth: `app/admin/`, `app/login/`, `app/create-account/`, `app/admin-login/`.

### Database Models

Two-layer inventory model:
- `ProductMaster` — catalog only (name, category, GST rate, min stock level). No qty or price.
- `InventoryBatch` — physical stock (qty, expiry, MRP, batch#, purchase source).

Core relationship chain:
```
Patient → Visit → Bill → BillItem → ProductMaster
                                       ↓
                                 InventoryBatch → PurchaseInvoice
```

Other models: `InventoryHistory` (audit log), `PatientImage` (with tags), `PrescriptionItem` (linked to visits), `UploadSession` (QR mobile uploads).

### Key Business Logic

**FIFO Billing:** When creating a bill, batches are consumed oldest-expiry-first. `BillItem` stores a snapshot of product data at sale time (not a live FK to price).

**Visit lifecycle:** `in_progress` → `done` → bill optionally created (sets `visit.invoice_id`). Payment status (`full`/`partial`/`unpaid`) tracked on the visit.

**OCR Invoice Import:** Upload image → `AIInvoiceScanner.scan()` (PaddleOCR in `models/`) → returns parsed rows → user confirms → `POST /api/inventory/save_invoice` creates `PurchaseInvoice` + batches. OCR import is optional — the scanner is loaded with a fallback no-op class if PaddleOCR is unavailable.

**QR Mobile Upload:** Desktop creates session → mobile opens `/connect/[sessionId]` and uploads images → desktop polls and finalizes. Files move from temp dir to permanent storage on finalize.

### File Storage

- Patient images: `$UPLOAD_BASE_DIR/patients/<patient_id>/`
- Invoice images: `$UPLOAD_BASE_DIR/invoices/`
- QR upload temp: `$UPLOAD_BASE_DIR/temp/<session_id>/`
- On Render, `UPLOAD_BASE_DIR` is `/tmp/clinic_uploads` (ephemeral).

## Deployment

Deployed on **Render** via `render.yaml` (root of repo). Two services: `clinicos-api` (Flask/gunicorn) and `clinicos-frontend` (Next.js). PostgreSQL database is provisioned by Render and injected as `DATABASE_URL`.
