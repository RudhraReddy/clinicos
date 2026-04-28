# Gallery Flow

**Route:** `/gallery`  
**File:** `frontend/app/gallery/page.tsx`

---

## Purpose

A global image browser across all patients. Separate tabs for different image types. Allows searching, previewing, and navigating images.

---

## Layout

Three tabs:

1. **Prescriptions** (default)
2. **Patient Images**
3. **Invoice Images**

---

## Tab 1: Prescriptions

Filters images where `tag` starts with `"Prescription"`.

**Table columns:** Image thumbnail, Date, Patient (name + ID), Side (Front/Back/Standard), Notes, Visit ID

- Clicking a row opens the full image in `ImagePreviewDialog`
- Search by patient name, patient ID, or notes

---

## Tab 2: Patient Images

Filters images where `tag` does **not** start with `"Prescription"` — i.e., lab reports, X-rays, general medical records.

**Table columns:** Preview thumbnail, Date, Patient (name + ID), Notes, Visit ID

- Clicking a row opens the full image in `ImagePreviewDialog`
- Search by patient name, patient ID, or notes

---

## Tab 3: Invoice Images

Shows only purchase invoices that have an attached image (`has_image: true`).

**Table columns:** Preview thumbnail, Date Uploaded, Invoice #, Vendor, Amount

- Image is fetched from `GET /api/inventory/invoices/<invoice_number>/image`
- Clicking a row opens `ImagePreviewDialog` in read-only mode (no save)
- Search by invoice number or vendor name

---

## Image Preview Dialog (`ImagePreviewDialog`)

Shared across all tabs:
- Shows the full image
- Navigation buttons (prev/next within current filtered list)
- For patient images: editable notes and tag fields
  - Save calls `PUT /api/patients/images/<id>` and updates local state
- For invoice images: read-only

---

## Data Sources

- Patient images: `GET /api/patients/images` (all patients, newest first)
- Invoice images: `GET /api/inventory/invoices` (filtered client-side to `has_image: true`)
- Image files served from: `GET /api/patients/images/<id>/file`
- Invoice image files served from: `GET /api/inventory/invoices/<invoice_number>/image`

---

## Components Used

| Component | Purpose |
|---|---|
| `ImagePreviewDialog` | Full-screen image viewer with navigation and edit |
