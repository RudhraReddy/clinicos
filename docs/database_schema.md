# Database Schema

Database: **PostgreSQL** — `clinic_db`  
ORM: **SQLAlchemy** (defined in `Backend_db/models.py`)  
All timestamps use **IST (UTC+5:30)** via `get_ist_now()` in `extensions.py`.

---

## Table: `patients`

Stores all registered patients.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `patient_id` | VARCHAR(10) | PK | Random 8-char hex, e.g. `A1B2C3D4` |
| `phone_number` | VARCHAR(20) | NOT NULL, INDEXED | Primary contact |
| `name` | VARCHAR(100) | NOT NULL | Full name |
| `dob` | DATE | nullable | Deprecated — not used in new flows |
| `age` | INTEGER | nullable | Stored directly |
| `sex` | VARCHAR(10) | nullable | e.g. `Male`, `Female` |
| `address` | TEXT | nullable | |
| `reference` | VARCHAR(100) | nullable | Referral source |
| `created_at` | DATETIME | default: IST now | Registration timestamp |

---

## Table: `purchase_invoices`

Tracks supplier purchase invoices (source of inventory stock).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `invoice_number` | VARCHAR(50) | PK | User-provided or OCR-extracted |
| `gst_number` | VARCHAR(50) | nullable | Vendor's GST registration |
| `total_amount` | NUMERIC(10,2) | nullable | Total invoice value |
| `vendor_name` | VARCHAR(100) | nullable | Supplier name |
| `invoice_date` | DATE | nullable | Date on the invoice |
| `upload_date` | DATETIME | default: IST now | When it was entered into the system |
| `image_path` | VARCHAR(255) | nullable | Absolute path to saved image file |
| `source` | VARCHAR(50) | nullable | `OCR`, `MANUAL`, `CSV_UPDATE`, `CSV_OVERWRITE` |

---

## Table: `product_master`

Master catalog of all products/medicines. Does **not** store quantity or price — those live in batches.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | VARCHAR(10) | PK | Random 6-char hex, e.g. `A1B2C3` |
| `item_name` | VARCHAR(100) | NOT NULL, INDEXED | Product name |
| `category` | VARCHAR(50) | nullable | e.g. `Tablet`, `Syrup`, `Injection` |
| `pack_size` | VARCHAR(50) | nullable | e.g. `1x10`, `100ml` |
| `hsn_code` | VARCHAR(20) | nullable | HSN code for GST |
| `min_stock_level` | INTEGER | default: 10 | Alert threshold |
| `manufacturer` | VARCHAR(100) | nullable | Manufacturer name |
| `gst_rate` | NUMERIC(5,2) | default: 0.0 | GST percentage (e.g. `5.00`, `12.00`) |
| `generic_tags` | TEXT | nullable | Comma-separated generic names for search |

**Relationships:**
- Has many `inventory_batches` (via `product_id`)

---

## Table: `inventory_batches`

Each row = one physical batch of stock. Differentiated by expiry date, MRP, and batch number.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PK, auto-increment | |
| `product_id` | VARCHAR(10) | FK → `product_master.id`, NOT NULL | |
| `purchase_invoice_number` | VARCHAR(50) | FK → `purchase_invoices.invoice_number`, nullable | Source invoice |
| `batch_number` | VARCHAR(50) | nullable | Vendor's batch identifier |
| `expiry_date` | DATE | nullable | |
| `mrp` | NUMERIC(10,2) | nullable | Maximum Retail Price |
| `purchase_rate` | NUMERIC(10,2) | nullable | Cost price per unit |
| `gst_rate` | NUMERIC(10,2) | default: 0.0 | GST % on this batch |
| `gst_amount` | NUMERIC(10,2) | default: 0.0 | Total tax on batch (informational) |
| `quantity` | INTEGER | default: 0 | **Current available stock** |
| `initial_quantity` | INTEGER | default: 0 | Quantity at time of purchase (paid + free) |
| `free_quantity` | INTEGER | default: 0 | Free units included in the purchase |

**Stock deduction** during billing is FIFO by `expiry_date` ascending.

---

## Table: `inventory_history`

Audit trail for every stock change.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PK, auto-increment | |
| `product_id` | VARCHAR(10) | FK → `product_master.id`, NOT NULL | |
| `batch_id` | INTEGER | FK → `inventory_batches.id`, nullable | |
| `bill_id` | VARCHAR(50) | FK → `bills.invoice_id`, nullable | Links to sale |
| `purchase_invoice_number` | VARCHAR(50) | FK → `purchase_invoices.invoice_number`, nullable | Links to purchase |
| `change_amount` | INTEGER | NOT NULL | Positive = stock in, Negative = stock out |
| `type` | VARCHAR(50) | NOT NULL | `PURCHASE`, `SALE`, `EXPIRED`, `RETURN`, `ADJUSTMENT` |
| `timestamp` | DATETIME | default: IST now | |
| `notes` | TEXT | nullable | Free-text description |

---

## Table: `visits`

One row per patient visit / appointment.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `visit_id` | VARCHAR(50) | PK | Format: `PATIENTID-DDMMYY-XX-XX` |
| `patient_id` | VARCHAR(10) | FK → `patients.patient_id`, NOT NULL | |
| `invoice_id` | VARCHAR(50) | nullable | Set when billing is completed |
| `reason` | TEXT | nullable | Reason for visit |
| `visit_date` | DATE | nullable | |
| `visit_time` | TIME | nullable | |
| `status` | VARCHAR(20) | default: `in_progress` | `in_progress`, `done`, `cancelled` |
| `doctor_id` | VARCHAR(50) | nullable | User ID of attending doctor |
| `visiting_fee` | INTEGER | default: 0 | Consultation fee |
| `amount_paid` | INTEGER | default: 0 | Amount collected |
| `payment_status` | VARCHAR(20) | default: `unpaid` | `full`, `partial`, `unpaid` |
| `created_at` | DATETIME | default: IST now | |

---

## Table: `bills`

One invoice per billing event (linked to a visit).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `invoice_id` | VARCHAR(50) | PK | Format: `DDMMYY-XX-XX` |
| `patient_id` | VARCHAR(10) | FK → `patients.patient_id`, NOT NULL | |
| `visit_id` | VARCHAR(50) | FK → `visits.visit_id`, nullable | |
| `total_amount` | NUMERIC(10,2) | NOT NULL | Calculated from bill items |
| `payment_type` | VARCHAR(50) | nullable | `CASH`, `CARD`, `INSURANCE` |
| `created_at` | DATETIME | default: IST now | |
| `created_by_user_id` | VARCHAR(50) | nullable | Staff member who created it |

---

## Table: `bill_items`

Line items for each bill. Snapshot of product data at time of sale.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PK, auto-increment | |
| `bill_id` | VARCHAR(50) | FK → `bills.invoice_id`, NOT NULL | |
| `product_id` | VARCHAR(10) | FK → `product_master.id`, nullable | Reference to master |
| `batch_id` | INTEGER | nullable | Which batch was deducted |
| `item_name` | VARCHAR(100) | nullable | Snapshot of product name |
| `batch_number` | VARCHAR(50) | nullable | Snapshot of batch number |
| `expiry_date` | DATE | nullable | Snapshot of expiry |
| `quantity` | INTEGER | nullable | Units sold |
| `mrp` | NUMERIC(10,2) | nullable | Unit price at time of sale |
| `gst_rate` | NUMERIC(5,2) | nullable | GST % at time of sale |
| `total_value` | NUMERIC(10,2) | nullable | `quantity × mrp` |

---

## Table: `patient_images`

Patient-linked image files (prescriptions, X-rays, lab reports, etc.).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | INTEGER | PK, auto-increment | |
| `patient_id` | VARCHAR(10) | FK → `patients.patient_id`, NOT NULL | |
| `visit_id` | VARCHAR(50) | FK → `visits.visit_id`, nullable | Optional visit link |
| `invoice_id` | VARCHAR(50) | nullable | Optional bill link |
| `image_path` | VARCHAR(255) | NOT NULL | Absolute path on disk |
| `notes` | TEXT | nullable | Clinical notes |
| `tag` | VARCHAR(50) | nullable | `Prescription`, `Prescription - Front`, `Prescription - Back`, `Lab`, `X-Ray`, `Medical Record` |
| `timestamp` | DATETIME | default: IST now | |

Images are stored on disk at `/media/fia/External/data/images/patients/<patient_id>/`.

---

## Table: `upload_sessions`

Temporary sessions for QR-code-based mobile uploads.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `session_id` | VARCHAR(36) | PK | UUID v4 |
| `context_type` | VARCHAR(50) | nullable | `patient` or `inventory` |
| `context_id` | VARCHAR(50) | nullable | `patient_id` or invoice identifier |
| `status` | VARCHAR(20) | default: `WAITING` | `WAITING`, `UPLOADED`, `COMPLETED` |
| `created_at` | DATETIME | default: IST now | |
| `files` | TEXT | nullable | JSON string: `[{path, tag, notes, filename}]` |

Temp files land in `/media/fia/External/data/images/temp/<session_id>/` until finalized.

---

## Entity Relationship Summary

```
patients ──< visits >── bills ──< bill_items >── product_master
                │                                      │
                │                               inventory_batches ──< inventory_history
                │                                      │
                │                               purchase_invoices
                │
         patient_images
                │
        upload_sessions (temp)
```
