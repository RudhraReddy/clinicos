# ClinicOS — Context File for AI Conversations

Paste this file at the start of a new conversation to restore full project context.

---

## What This Is

**ClinicOS** — a full-stack clinic management system.
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui — in `frontend/`
- **Backend:** Python Flask + SQLAlchemy — in `Backend_db/`
- **Database:** PostgreSQL, db name `clinic_db`, user `Rize`, pass `vs@9699`
- **Backend runs on:** `localhost:5000`
- **Frontend runs on:** `localhost:3000` (proxies `/api/*` to Flask)
- **All timestamps:** IST (UTC+5:30) via `get_ist_now()` in `Backend_db/extensions.py`

---

## Folder Structure (key files only)

```
clinic_related/
├── frontend/
│   ├── app/
│   │   ├── page.tsx              # Dashboard (frontdesk home)
│   │   ├── patients/page.tsx     # Patient registry
│   │   ├── visits/page.tsx       # Visits table (secondary view)
│   │   ├── billing/page.tsx      # Billing / invoicing
│   │   ├── inventory/page.tsx    # Stock management
│   │   ├── gallery/page.tsx      # Image gallery (3 tabs)
│   │   ├── prescriptions/page.tsx# Global prescription log
│   │   └── doctor/page.tsx       # Doctor-only dashboard
│   ├── components/
│   │   ├── layout/Sidebar.tsx    # Nav sidebar, role-filtered
│   │   ├── AddPatientDialog.tsx
│   │   ├── AddVisitDialog.tsx
│   │   ├── EditVisitDialog.tsx
│   │   ├── EditPatientDialog.tsx
│   │   ├── PatientDetailsView.tsx
│   │   ├── PatientSearch.tsx     # Autocomplete patient selector
│   │   ├── CalendarComponent.tsx # Drag-drop appointment calendar
│   │   ├── VisitsTab.tsx         # All-visits table
│   │   ├── InvoicePrint.tsx      # Printable invoice template
│   │   ├── QRCodeUpload.tsx      # QR code mobile upload widget
│   │   ├── UploadInventoryReportDialog.tsx # OCR invoice upload
│   │   ├── ImportInventoryDialog.tsx       # CSV import
│   │   ├── EditInventoryDialog.tsx
│   │   ├── ViewBatchesDialog.tsx
│   │   └── ImagePreviewDialog.tsx # Full-screen lightbox
│   └── lib/
│       ├── api.ts                # ALL API calls — single source of truth
│       └── auth_context.tsx      # Role stored in localStorage key "clinic_role"
│
├── Backend_db/
│   ├── app.py                    # Flask app factory, runs on port 5000
│   ├── models.py                 # All SQLAlchemy models
│   ├── extensions.py             # db = SQLAlchemy(), get_ist_now()
│   ├── utils.py                  # generate_visit_id(), generate_invoice_id(), parse_expiry_date()
│   └── routes/
│       ├── patients.py           # /api/patients
│       ├── visits.py             # /api/visits
│       ├── billing.py            # /api/billing
│       ├── inventory.py          # /api/inventory
│       ├── images.py             # /api/patients/<id>/images
│       └── upload.py             # /api/upload (QR sessions)
│
├── models/invoice_ocr.py         # AIInvoiceScanner (PaddleOCR/AI Studio)
├── README.md                     # Full project overview
├── docs/api_endpoints.md         # All API endpoints documented
├── docs/database_schema.md       # All DB tables documented
└── docs/flows/                   # Per-page flow docs
    ├── dashboard.md
    ├── patients.md
    ├── inventory.md
    ├── billing.md
    ├── doctor.md
    ├── gallery.md
    ├── prescriptions.md
    └── visits.md
```

---

## User Roles

Stored in `localStorage["clinic_role"]`. No server-side auth.

| Role | Pages visible | Notes |
|---|---|---|
| `frontdesk` | All pages | Default role |
| `doctor` | Dashboard (redirects to `/doctor`), Patients, Prescriptions | |
| `admin` | All pages | Same as frontdesk currently |

Role switched via `ProfileSwitcher` component in sidebar bottom.

---

## Database Tables (summary)

| Table | PK | Purpose |
|---|---|---|
| `patients` | `patient_id` (8-char hex) | Patient demographics |
| `purchase_invoices` | `invoice_number` | Supplier invoices (source of stock) |
| `product_master` | `id` (6-char hex) | Drug/product catalog (no qty/price here) |
| `inventory_batches` | `id` (int) | Physical stock batches (has qty, MRP, expiry) |
| `inventory_history` | `id` (int) | Audit log for every stock change |
| `visits` | `visit_id` (PATIENTID-DDMMYY-XX-XX) | Appointments/encounters |
| `bills` | `invoice_id` (DDMMYY-XX-XX) | Sales invoices |
| `bill_items` | `id` (int) | Line items per bill (snapshot of product at sale time) |
| `patient_images` | `id` (int) | Images linked to patients/visits |
| `upload_sessions` | `session_id` (UUID) | Temp sessions for QR-code mobile uploads |

**Key relationships:**
- `patients` → `visits` → `bills` → `bill_items` → `product_master`
- `product_master` → `inventory_batches` → `inventory_history`
- `inventory_batches` → `purchase_invoices`
- `patients` → `patient_images` → `visits` (optional)

**File storage paths (on disk):**
- Patient images: `/media/fia/External/data/images/patients/<patient_id>/`
- Invoice images: `/media/fia/External/data/images/invoices/`
- QR upload temp: `/media/fia/External/data/images/temp/<session_id>/`

---

## API Endpoints (condensed)

### Patients `/api/patients`
- `POST /api/patients` — create patient
- `GET /api/patients[?q=&phone_number=]` — list/search (max 50)
- `GET /api/patients/<id>` — get one
- `PUT /api/patients/<id>` — update

### Visits `/api/visits`
- `POST /api/visits` — create
- `GET /api/visits` — last 50
- `GET /api/visits/patient/<patient_id>` — patient's visits
- `GET /api/visits/<id>` — get one
- `PUT /api/visits/<id>` — update (status, reason, fee, date, time)
- `DELETE /api/visits/<id>` — delete

### Billing `/api/billing`
- `POST /api/billing` — create bill, FIFO deduct inventory
- `GET /api/billing/history` — last 50 bills
- `GET /api/billing/patient/<patient_id>` — patient's bills
- `GET /api/billing/<invoice_id>` — full bill with line items

### Inventory `/api/inventory`
- `GET /api/inventory` — all products with aggregated stock + status tags
- `GET /api/inventory/<id>/batches` — batches for one product
- `POST /api/inventory` — create product master
- `PUT /api/inventory/<id>` — update product master
- `PUT /api/inventory/batch/<id>` — update a batch (qty/expiry/price)
- `GET /api/inventory/search?q=` — search (max 20, includes stock qty)
- `GET /api/inventory/export` — download CSV
- `POST /api/inventory/import` — upload CSV (mode: update|overwrite)
- `GET /api/inventory/invoices` — list purchase invoices
- `GET /api/inventory/invoices/<num>` — invoice detail + items
- `GET /api/inventory/invoices/<num>/image` — serve invoice image
- `GET /api/inventory/invoices/<num>/export` — download invoice CSV
- `POST /api/inventory/upload` — upload image → OCR → returns parsed data
- `POST /api/inventory/save_invoice` — commit OCR/manual invoice to DB

### Patient Images `/api/patients`
- `POST /api/patients/<id>/images` — upload image (form: file, visit_id, notes, tag)
- `GET /api/patients/<id>/images` — list patient's images
- `GET /api/patients/images/<img_id>/file` — serve image binary
- `GET /api/patients/images` — all images all patients (joined with patient name)
- `PUT /api/patients/images/<img_id>` — update notes/tag

### QR Upload Sessions `/api/upload`
- `POST /api/upload/session` — create session → returns session_id + url_path
- `GET /api/upload/session/<id>` — poll status (WAITING→UPLOADED→COMPLETED)
- `POST /api/upload/mobile/<id>` — mobile uploads files to session
- `POST /api/upload/session/<id>/finalize` — desktop moves files to permanent storage

---

## Key Design Patterns

- **Inventory is two-layer:** `product_master` (catalog) + `inventory_batches` (physical stock). Qty/price never stored on master.
- **FIFO billing:** `POST /api/billing` deducts from batches ordered by `expiry_date ASC`.
- **Visit status flow:** `in_progress` → `done` → (billing creates bill, sets `visit.invoice_id`) | `cancelled`
- **Image tags:** `Prescription`, `Prescription - Front`, `Prescription - Back`, `Lab`, `X-Ray`, `Medical Record`
- **OCR flow:** upload image → `AIInvoiceScanner.scan()` → returns product rows → user reviews/edits → `save_invoice` commits
- **QR upload flow:** desktop generates session → mobile opens URL → uploads files → desktop polls/finalizes
- **Status tags on inventory:** `OK`, `LOW STOCK` (qty < min_stock_level), `OUT OF STOCK` (qty=0), `EXPIRES SOON` (≤3 months), `EXPIRED`
- **API base URL:** empty string `''` in `lib/api.ts` so all requests go through Next.js proxy (works for remote access via Twingate)

---

## Running Locally

```bash
# Backend
cd Backend_db && source venv/bin/activate && python app.py

# Frontend
cd frontend && npm run dev
```

VSCode tasks are defined in `.vscode/tasks.json` to start both services.
