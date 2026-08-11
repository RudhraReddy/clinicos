# ClinicOS — Context File for AI Conversations

Paste this file at the start of a new conversation to restore full project context.

---

## What This Is

**ClinicOS** — a full-stack clinic management system.
- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui — in `frontend/`
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
│   │   ├── ImportInventoryDialog.tsx       # CSV import
│   │   ├── EditInventoryDialog.tsx
│   │   ├── ViewBatchesDialog.tsx
│   │   └── ImagePreviewDialog.tsx # Full-screen lightbox
│   └── lib/
│       ├── api.ts                # ALL API calls — single source of truth
│       ├── auth_context.tsx      # Server-side auth; AuthUser has user_id, role, location_id
│       └── settings_context.tsx  # expiryReminderMonths (localStorage)
│
├── Backend_db/
│   ├── app.py                    # Flask app factory + _apply_migrations() for new columns
│   ├── models.py                 # All SQLAlchemy models
│   ├── extensions.py             # db = SQLAlchemy(), get_ist_now()
│   ├── utils.py                  # generate_visit_id(), generate_invoice_id(), parse_expiry_date()
│   └── routes/
│       ├── patients.py           # /api/patients
│       ├── visits.py             # /api/visits
│       ├── billing.py            # /api/billing
│       ├── inventory.py          # /api/inventory  (+ analytics, export, import)
│       ├── locations.py          # /api/admin/locations (CRUD)
│       ├── admin.py              # /api/admin/* (users, stats, diagnostics, activity log)
│       ├── auth.py               # /api/auth/* (login, logout, me, users)
│       ├── ledger.py             # /api/ledger (expense tracking)
│       ├── images.py             # /api/patients/<id>/images
│       └── upload.py             # /api/upload (QR sessions)
│
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

Server-side auth via JWT cookies. `AuthUser` context (`lib/auth_context.tsx`) has `user_id`, `username`, `role`, `location_label`, `location_id`.

| Role | Pages visible | Notes |
|---|---|---|
| `frontdesk` (stored as `staff`) | Dashboard, Patients, Inventory, Billing | |
| `doctor` | Dashboard (`/doctor`), Patients, Inventory, Gallery, Status | |
| `admin` | All pages + `/admin` panel | |

Hardcoded admin accounts: `saivelapati`, `tejavelapati` (TOTP-gated, auto-provisioned on login).

---

## Database Tables (summary)

| Table | PK | Purpose |
|---|---|---|
| `locations` | `id` (int) | Clinic branches — name, is_active. Source of truth for location tracking. |
| `patients` | `patient_id` (8-char hex) | Patient demographics |
| `purchase_invoices` | `invoice_number` | Supplier invoices (source of stock). Has `location_id` FK. |
| `product_master` | `id` (6-char hex) | Drug/product catalog (no qty/price here) |
| `inventory_batches` | `id` (int) | Physical stock batches (qty, MRP, expiry). Has `location_id` FK — stock is tracked per clinic. |
| `inventory_history` | `id` (int) | Audit log for every stock change |
| `visits` | `visit_id` (PATIENTID-DDMMYY-XX-XX) | Appointments/encounters. Has `location_id` FK. |
| `bills` | `invoice_id` (DDMMYY-XX-XX) | Sales invoices. Has `location_id` FK. |
| `bill_items` | `id` (int) | Line items per bill (snapshot of product at sale time) |
| `patient_images` | `id` (int) | Images linked to patients/visits |
| `upload_sessions` | `session_id` (UUID) | Temp sessions for QR-code mobile uploads |
| `users` | `id` (UUID) | Staff accounts. Has `location_id` FK — determines which clinic a user belongs to. |
| `expense_ledger` | `id` (int) | Expense entries. Has `location_id` FK. |
| `audit_logs` | `id` (int) | All user actions |

**Key relationships:**
- `patients` → `visits` → `bills` → `bill_items` → `product_master`
- `product_master` → `inventory_batches` → `inventory_history`
- `inventory_batches` → `purchase_invoices`
- `patients` → `patient_images` → `visits` (optional)
- `locations` → `users`, `visits`, `bills`, `purchase_invoices`, `expense_ledger`, `inventory_batches` (all via nullable `location_id` FK)

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
- `POST /api/visits` — create (optional `location_id` in body explicitly picks the clinic; falls back to the creating user's own `location_id` when omitted)
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
- `GET /api/inventory[?expiry_months=N&location_id=N]` — products with aggregated stock + status tags, filtered to a clinic when `location_id` provided
- `GET /api/inventory/<id>/batches` — batches for one product
- `POST /api/inventory` — create product master
- `PUT /api/inventory/<id>` — update product master
- `PUT /api/inventory/batch/<id>` — update a batch (qty/expiry/price)
- `GET /api/inventory/search?q=` — search (max 20, includes stock qty)
- `GET /api/inventory/export` — full batch-level CSV dump (Total Inventory)
- `GET /api/inventory/export/edit[?scope=all|<location_id>]` — one-row-per-product CSV with dynamic per-clinic qty columns (Edit Inventory)
- `POST /api/inventory/import/parse-headers` — classify CSV headers as known_fields / known_clinics / unknown (no data written)
- `POST /api/inventory/import` — upload CSV (mode: update|overwrite; optional field_mapping + clinic_mapping JSON for renamed columns/clinics)
- `GET /api/inventory/invoices` — list purchase invoices
- `GET /api/inventory/invoices/<num>` — invoice detail + items
- `GET /api/inventory/invoices/<num>/image` — serve invoice image
- `GET /api/inventory/invoices/<num>/export` — download invoice CSV
- `POST /api/inventory/upload` — save an invoice image, returns its path
- `POST /api/inventory/save_invoice` — commit a manually-entered invoice to DB (auto-tags batches with creator's location_id)
- `GET /api/inventory_analytics[?location_id=N]` — revenue/stock KPIs, scoped to location when provided

### Locations `/api/admin/locations`
- `GET /api/admin/locations` — list all locations (requires auth)
- `POST /api/admin/locations` — create location (admin only)
- `PATCH /api/admin/locations/<id>` — rename or toggle is_active (admin only)
- `DELETE /api/admin/locations/<id>` — hard delete if no FK refs; 409 otherwise (admin only)

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
- **Per-location stock:** `inventory_batches.location_id` tracks which clinic holds each batch. `GET /api/inventory?location_id=N` returns only that clinic's stock. The inventory page has a location pill-switcher.
- **FIFO billing:** `POST /api/billing` deducts from batches ordered by `expiry_date ASC`.
- **Visit status flow:** `in_progress` → `done` → (billing creates bill, sets `visit.invoice_id`) | `cancelled`
- **Auto-location tagging:** New `Visit`, `Bill`, `PurchaseInvoice`, and `InventoryBatch` records are automatically tagged with the creating user's `location_id`. `Visit` creation is the one exception with an explicit override: the dashboard's Appointment form (`WalkInForm.tsx`) has a Clinic dropdown (defaults to the user's own clinic, only shown once clinics exist) that sends `location_id` directly, and the booking button is disabled until a clinic is chosen. `Patient` deliberately carries no `location_id` — a patient can be seen across clinics; only money/stock-related records are clinic-scoped.
- **Zero-fee ("free") visits:** A visit's `visiting_fee`/`amount_paid` can be explicitly `0` — this is a deliberate free appointment, not missing data. In `WalkInForm.tsx`, checking the "Free" checkbox next to the Fee field disables/clears the fee input and forces `0` on submit; otherwise a fee must be entered or the Book button stays disabled. Anywhere a visit fee is displayed, use `formatVisitFee(fee)` (`frontend/lib/utils.ts`) — it renders `null`/`undefined` as `—`, exactly `0` as `FREE`, and any other number as `₹{amount}`. Rolled out to `WalkInForm.tsx`, `app/page.tsx`, `app/doctor/page.tsx`, `VisitsTab.tsx`, `PatientDetailsView.tsx`, `VisitDetailsDialog.tsx` — use it in any new fee display too instead of a raw `₹{fee}` template.
- **Visit age display:** `getVisitAge(visitDate)` (`frontend/lib/utils.ts`) returns `"{days}d"` up to 90 days old, then `"{months}mo"`. Used wherever a past visit's age needs to show next to its date (e.g. `WalkInForm.tsx`'s Past Visits panel, `VisitsTab.tsx`).
- **Location management:** Admin creates `Location` records in Admin → Settings → Locations card. Users are assigned to a location via dropdown (saves `location_id`; syncs `location_label` string for backward compat). Old string `location` columns are preserved on all tables but ignored by new code.
- **CSV export — two modes:** "Total Inventory" = full batch-level dump (19 columns). "Edit Inventory" = one-row-per-product with per-clinic qty columns, suitable for round-trip import to adjust stock.
- **CSV import — header mapping:** `parse-headers` classifies each column first. Unknown columns trigger a mapping step in the dialog where the user assigns them to a known field or a clinic. The import then applies `field_mapping` and `clinic_mapping` JSON.
- **Image tags:** `Prescription`, `Prescription - Front`, `Prescription - Back`, `Lab`, `X-Ray`, `Medical Record`
- **QR upload flow:** desktop generates session → mobile opens URL → uploads files → desktop polls/finalizes
- **Status tags on inventory:** `OK`, `LOW STOCK` (qty < min_stock_level), `OUT OF STOCK` (qty=0), `EXPIRES SOON` (configurable, default 6 months), `EXPIRED`
- **API base URL:** empty string `''` in `lib/api.ts` so all requests go through Next.js proxy (works for remote access via Twingate)
- **Schema migrations:** New columns on existing tables are handled by `_apply_migrations()` in `app.py` using `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. `db.create_all()` only creates new tables.

---

## Running Locally

```bash
# Backend
cd Backend_db && source venv/bin/activate && python app.py

# Frontend
cd frontend && npm run dev
```

VSCode tasks are defined in `.vscode/tasks.json` to start both services.
