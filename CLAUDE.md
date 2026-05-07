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

### Architecture

Three-service production stack, budget ~$24/month:

| Service | Platform | Plan | RAM | Cost |
|---|---|---|---|---|
| `clinicos-api` | Render Starter | Python web | 512MB | $7/mo |
| `clinicos-frontend` | Render Starter | Node web | 512MB | $7/mo |
| `clinicos-db` | Render Starter | PostgreSQL | — | $7/mo |
| `clinic-uploads` disk | Render | 10GB persistent | — | $1/mo |
| `clinicos-ocr` | GCP Cloud Run | pay-per-use | 2GB | ~$2/mo |

### Render

Configured via `render.yaml` (root of repo). Deployed automatically on push to `main`.

- Persistent disk mounted at `/var/data/clinic_uploads` (env `UPLOAD_BASE_DIR`)
- Gunicorn timeout 120s (OCR calls can take 30-60s)
- `OCR_SERVICE_URL` set as a **secret env var** in Render dashboard (not in render.yaml)
- `DATABASE_URL` injected from Render PostgreSQL; `app.py` normalises `postgres://` → `postgresql://` on startup
- `db.create_all()` runs inside `create_app()` — tables are created idempotently on every deploy

### OCR (GCP Cloud Run)

PaddleOCR runs as a separate microservice in `ocr_cloud/`. Models are baked into the Docker image at build time.

- Deployed to `asia-south1`, 2GB RAM, 2 vCPU, min-instances 0 (scales to zero when idle)
- Endpoint: `POST /ocr` (multipart `image` field) → returns parsed invoice rows as JSON
- `GET /health` → `{"status": "ok"}`
- Deploy command (from repo root, requires `gcloud` auth):
  ```bash
  gcloud builds submit ocr_cloud/ --tag gcr.io/YOUR_PROJECT/clinicos-ocr
  gcloud run deploy clinicos-ocr \
    --image gcr.io/YOUR_PROJECT/clinicos-ocr \
    --memory 2Gi --cpu 2 \
    --min-instances 0 --max-instances 3 \
    --allow-unauthenticated --region asia-south1
  ```
- After deploy, copy the service URL and set it as `OCR_SERVICE_URL` in the Render dashboard for `clinicos-api`.

### Environment Variables

**`clinicos-api` (set in render.yaml or Render dashboard):**

| Variable | Value |
|---|---|
| `DATABASE_URL` | injected from Render PostgreSQL |
| `UPLOAD_BASE_DIR` | `/var/data/clinic_uploads` |
| `FLASK_DEBUG` | `false` |
| `CORS_ORIGINS` | `https://clinicos-frontend.onrender.com` |
| `OCR_SERVICE_URL` | GCP Cloud Run URL (secret — set in dashboard) |
| `PYTHON_VERSION` | `3.11.2` |

**`clinicos-frontend`:**

| Variable | Value |
|---|---|
| `BACKEND_URL` | `https://clinicos-api.onrender.com` |
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

**Planned fix:** Add a `ClinicSettings` table (one row), `GET /api/settings` + `PATCH /api/settings` endpoints, a `ClinicSettingsContext` in the frontend that fetches once on mount, and update both call sites to read from context. The settings edit UI should be admin-only.
