# Billing Flow

**Route:** `/billing`  
**File:** `frontend/app/billing/page.tsx`

---

## Purpose

Create sales invoices for patients, automatically deducting stock from inventory using FIFO batch logic. Also displays billing history and supports print.

---

## Layout

Two tabs:

### Tab 1: New Bill (default)

1. **Patient Details** card — select the patient
2. **Items** card — search and add medicines

### Tab 2: History

Table of all recent bills with a print button per row.

---

## New Bill Flow

### Step 1 — Select Patient

- Uses `PatientSearch` component (autocomplete search calling `GET /api/patients?q=...`)
- Can also be pre-loaded via URL params: `/billing?patient_id=...&visit_id=...` (used when clicking the billing shortcut from the Dashboard's Today's List)
- After selecting a patient, an **Upload via QR** button appears, opening `QRCodeUpload` to attach prescription images

### Step 2 — Add Items

- Type ≥ 3 characters in the search box → debounced call to `GET /api/inventory/search?q=...`
- Dropdown shows matching products with: name, manufacturer, GST %, and stock count
- If a product has substitutes, they are shown in a yellow highlight box
- Click any result → adds a row to the bill table with `qty=1` and estimated MRP

### Step 3 — Review & Submit

Bill table columns: #, Product Name, Batch (shows "Auto-FIFO"), Qty (editable), Price (Est), Total, Delete

- Qty is editable inline; total auto-recalculates
- **Create Bill** button calls `POST /api/billing` with:
  ```json
  {
    "patient_id": "...",
    "visit_id": "...",
    "payment_type": "CASH",
    "items_used": [ { "item_id": "...", "quantity": N } ]
  }
  ```
- Backend deducts stock FIFO (earliest expiry first) and creates `bill_items` + `inventory_history` records
- If a `visit_id` is provided, the visit's `status` is set to `done` and `invoice_id` is recorded
- On success: alert with invoice ID and total → switches to History tab

---

## Billing History Tab

- Loaded on tab switch via `GET /api/billing/history`
- Columns: Invoice ID, Date, Patient, Amount, Payment Type, Print button
- **Print** button calls `GET /api/billing/<invoice_id>` then renders `InvoicePrint` and triggers `window.print()`

---

## Invoice Printing (`InvoicePrint`)

A hidden `<div>` with `@media print` CSS that renders the formatted invoice:
- Clinic name, address, phone (hardcoded: "MediCare Clinic")
- Patient name, ID, phone
- Itemized table: product, batch, qty, MRP, total
- Grand total

---

## Components Used

| Component | Purpose |
|---|---|
| `PatientSearch` | Autocomplete patient selector |
| `InvoicePrint` | Printable invoice template (hidden until print) |
| `QRCodeUpload` | QR code for mobile prescription upload |
