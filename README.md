# ClinicOS — Project Overview

A full-stack clinic management system built with a **Next.js** frontend and a **Flask/PostgreSQL** backend. The system handles patient registration, appointment scheduling, inventory management, billing, and image/prescription storage.

---

## Project Structure

```
clinic_related/
├── frontend/               # Next.js 14 (App Router) — UI
│   ├── app/                # Page routes
│   │   ├── page.tsx            # Dashboard (/)
│   │   ├── patients/           # Patient management
│   │   ├── visits/             # Visit records
│   │   ├── billing/            # Billing & invoicing
│   │   ├── inventory/          # Stock management
│   │   ├── gallery/            # Image gallery
│   │   ├── prescriptions/      # Prescription log
│   │   └── doctor/             # Doctor-specific dashboard
│   ├── components/         # Shared UI components
│   │   ├── layout/             # AppShell, Sidebar
│   │   └── ui/                 # shadcn/ui primitives
│   └── lib/
│       ├── api.ts              # All API calls (single source of truth)
│       └── auth_context.tsx    # Role-based auth (localStorage)
│
├── Backend_db/             # Flask REST API
│   ├── app.py              # App factory + Flask entrypoint
│   ├── models.py           # SQLAlchemy ORM models
│   ├── extensions.py       # db instance + IST timezone helper
│   ├── routes/
│   │   ├── patients.py         # Patient CRUD
│   │   ├── visits.py           # Visit CRUD
│   │   ├── billing.py          # Billing + FIFO stock deduction
│   │   ├── inventory.py        # Inventory + OCR invoice import
│   │   ├── images.py           # Patient image upload/retrieval
│   │   └── upload.py           # QR-code mobile upload sessions
│   ├── scripts/            # DB seed / reset / migration scripts
│   └── archive/            # Old migration scripts (not in use)
│
├── models/
│   └── invoice_ocr.py      # AI-powered invoice scanner (PaddleOCR / AI Studio)
│
└── .vscode/
    └── tasks.json          # VSCode task runner for starting services
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, shadcn/ui |
| State | React useState/useEffect, Context API |
| Backend | Python 3.11, Flask, Flask-SQLAlchemy, Flask-CORS |
| Database | PostgreSQL (`clinic_db`) |
| OCR | PaddleOCR / AI Studio via `invoice_ocr.py` |
| Drag & Drop | react-dnd (calendar appointments) |

---

## User Roles

The app has three roles stored in `localStorage` under the key `clinic_role`. No server-side auth — role switching is done via the Profile Switcher in the sidebar.

| Role | Access |
|---|---|
| `frontdesk` | Dashboard, Patients, Inventory, Gallery, Billing, Prescriptions |
| `doctor` | Doctor Dashboard, Patients, Prescriptions |
| `admin` | All pages (same as frontdesk currently) |

When the role is `doctor`, the app redirects `/` → `/doctor`.

---

## Running the Project

**Backend:**
```bash
cd Backend_db
source venv/bin/activate
python app.py
# Runs on http://localhost:5000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:3000
```

Next.js proxies `/api/*` requests to Flask on port 5000 (configured in `next.config.ts`).

**Database:**
```
Host: localhost
DB: clinic_db
User: Rize
Pass: vs@9699
```

---

## Key Features

- **Dashboard** — Interactive drag-and-drop calendar, today's appointment list, quick actions
- **Patients** — Register, search, view history, edit demographics
- **Visits** — Schedule appointments, update status (in_progress → done → cancelled)
- **Billing** — FIFO batch inventory deduction, printable invoices, billing history
- **Inventory** — Product master + batch-level stock, OCR invoice import, CSV import/export, status tags (LOW STOCK, EXPIRED, etc.)
- **Gallery** — Patient images separated into Prescriptions / Patient Images / Invoice Images
- **Doctor View** — Prescription carousel, patient image timeline grouped by visit date
- **QR Upload** — Generate a QR code on desktop; scan with phone to upload images directly

---

## Data Flow Summary

```
Patient → Visit → Billing (deducts inventory batches FIFO) → Invoice
                ↓
           Patient Images / Prescriptions (linked to visit)
```

All timestamps use **IST (Indian Standard Time)** via the `get_ist_now()` helper in `extensions.py`.
