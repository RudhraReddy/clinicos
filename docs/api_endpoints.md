# API Endpoints Reference

All endpoints are prefixed with `/api`. The Flask server runs on port `5000`. The frontend proxies all `/api/*` requests through Next.js so clients always hit port `3000`.

---

## Patients

### `POST /api/patients`
Create a new patient. Generates a random 8-char hex `patient_id`.

**Request Body (JSON):**
```json
{
  "name": "John Doe",          // required
  "phone_number": "9876543210",// required
  "age": 35,                   // optional
  "sex": "Male",               // optional
  "address": "123 Main St",    // optional
  "reference": "Dr. Sharma"    // optional
}
```
**Response:** `201 { "message": "Patient created", "patient_id": "A1B2C3D4" }`

---

### `GET /api/patients`
List patients. Returns up to 50 results.

**Query Params:**
- `q` — fuzzy search on name, phone, or patient_id
- `phone_number` — exact phone search (strips dashes/spaces)

**Response:** `200 [ { patient_id, name, phone_number, age, sex, address, reference }, ... ]`

---

### `GET /api/patients/<patient_id>`
Get a single patient's full details.

**Response:** `200 { patient_id, name, phone_number, age, sex, address, reference, created_at }`

---

### `PUT /api/patients/<patient_id>`
Update patient fields (any subset).

**Request Body (JSON):** Any of `name`, `phone_number`, `age`, `sex`, `address`, `reference`

**Response:** `200 { "message": "Patient updated" }`

---

## Visits

### `POST /api/visits`
Create a new visit for a patient.

**Request Body (JSON):**
```json
{
  "patient_id": "A1B2C3D4",    // required
  "visit_date": "2024-04-28",  // optional, YYYY-MM-DD
  "visit_time": "10:30",       // optional, HH:MM
  "reason": "Fever",           // optional
  "status": "in_progress",     // optional, default: in_progress
  "visiting_fee": 300,         // optional, default: 0 (0 is a valid explicit "free appointment", not missing data)
  "amount_paid": 300,          // optional, default: 0
  "payment_status": "full",    // optional, default: unpaid
  "location_id": 14            // optional int — explicitly picks the clinic this visit belongs to;
                                // falls back to the creating user's own location_id when omitted
}
```
**Response:** `201 { "message": "Visit logged", "visit_id": "A1B2C3D4-280424-AB-CD" }`

---

### `GET /api/visits`
Get the 50 most recent visits (all patients), ordered by `created_at` descending.

**Response:** `200 [ { visit_id, patient_id, visit_date, visit_time, patient_name, phone_number, dob, reason, status, visiting_fee, amount_paid, payment_status, created_at }, ... ]`

---

### `GET /api/visits/patient/<patient_id>`
Get all visits for a specific patient, ordered by date descending.

**Response:** `200 [ { visit_id, visit_date, visit_time, reason, status, created_at }, ... ]`

---

### `GET /api/visits/<visit_id>`
Get full details of a single visit including patient info.

**Response:** `200 { visit_id, patient_id, patient_name, phone_number, dob, visit_date, visit_time, reason, status, visiting_fee, amount_paid, payment_status, created_at }`

---

### `PUT /api/visits/<visit_id>`
Update a visit. Any subset of fields.

**Request Body (JSON):** Any of `status`, `reason`, `visiting_fee`, `amount_paid`, `payment_status`, `visit_date`, `visit_time`

**Response:** `200 { "message": "Visit updated successfully" }`

---

### `DELETE /api/visits/<visit_id>`
Delete a visit record.

**Response:** `200 { "message": "Visit deleted successfully" }`

---

## Billing

### `POST /api/billing`
Create a bill. Deducts stock from inventory batches using **FIFO** (earliest expiry first).

**Request Body (JSON):**
```json
{
  "patient_id": "A1B2C3D4",     // required
  "visit_id": "...",             // optional — links bill to visit, marks visit as done
  "payment_type": "CASH",        // optional, default: CASH
  "items_used": [
    { "item_id": "XYZ123", "quantity": 2 }
  ]
}
```
**Response:** `201 { "message": "Bill created", "invoice_id": "280424-AB-CD", "total": 450.0 }`

---

### `GET /api/billing/history`
Get the 50 most recent bills.

**Response:** `200 [ { invoice_id, date, patient_name, patient_id, total_amount, payment_type }, ... ]`

---

### `GET /api/billing/patient/<patient_id>`
Get all bills for a specific patient.

**Response:** `200 [ { invoice_id, visit_id, date, total_amount, payment_type }, ... ]`

---

### `GET /api/billing/<invoice_id>`
Get full invoice details including itemized line items.

**Response:**
```json
{
  "invoice_id": "280424-AB-CD",
  "created_at": "2024-04-28 10:45",
  "patient": { "name": "...", "phone": "...", "id": "..." },
  "payment_type": "CASH",
  "total_amount": 450.0,
  "items": [
    {
      "item_name": "Paracetamol",
      "batch_number": "B001",
      "expiry_date": "2025-06-30",
      "quantity": 2,
      "mrp": 10.0,
      "gst_rate": 5.0,
      "total_value": 20.0
    }
  ]
}
```

---

## Inventory

### `GET /api/inventory`
Get all products with aggregated stock, price ranges, expiry, and status tags.

**Response:** `200 [ { id, item_name, quantity, min_stock_level, category, manufacturer, vendors[], price, min_price, max_price, total_value, expiry_date, status[], pack_size, hsn_code, gst_rate }, ... ]`

Status tags: `OK`, `LOW STOCK`, `OUT OF STOCK`, `EXPIRED`, `EXPIRES SOON`

---

### `GET /api/inventory/<id>/batches`
Get all active (quantity > 0) batches for a product.

**Response:** `200 [ { id, quantity, expiry_date, mrp, purchase_rate, vendor, invoice_number, batch_number }, ... ]`

---

### `POST /api/inventory`
Create a new product master entry (no stock — stock comes via invoices/imports).

**Request Body (JSON):** `item_name` (required), `min_stock_level`, `supplier`, `category`, `pack_size`, `hsn_code`

**Response:** `201 { "message": "Master Item added", "id": "A1B2C3" }`

---

### `PUT /api/inventory/<id>`
Update a product master record.

**Request Body (JSON):** Any of `item_name`, `category`, `min_stock_level`, `pack_size`, `hsn_code`

**Response:** `200 { "message": "Item updated successfully" }`

---

### `PUT /api/inventory/batch/<id>`
Update a specific batch (expiry, quantity, prices). Quantity changes are logged to `inventory_history`.

**Request Body (JSON):** Any of `expiry_date`, `quantity`, `mrp`, `purchase_rate`, `gst_rate`

**Response:** `200 { "message": "...", "changes": [...] }`

---

### `GET /api/inventory/search?q=<query>`
Search products by name, manufacturer, generic tags, or product ID. Returns up to 20 results with stock info.

**Response:** `200 [ { id, item_name, manufacturer, gst_rate, total_qty, price, substitutes[] }, ... ]`

---

### `GET /api/inventory/export`
Download all inventory as a CSV file attachment.

---

### `POST /api/inventory/import`
Import inventory from a CSV file.

**Form Data:**
- `file` — CSV file
- `mode` — `update` (add new batches) or `overwrite` (adjust to target quantity)

**Response:** `200 { "message": "Processed N items" }`

---

### `GET /api/inventory/invoices`
List all purchase invoices, ordered by upload date descending.

**Response:** `200 [ { invoice_number, gst_number, total_amount, vendor_name, source, upload_date, has_image }, ... ]`

---

### `GET /api/inventory/invoices/<invoice_number>`
Get full invoice details including all batch line items.

**Response:** `200 { invoice: {...}, items: [ { product_name, batch_id, batch_number, quantity, free_quantity, mrp, purchase_rate, expiry_date, pack_size, gst_rate, hsn_code, manufacturer }, ... ] }`

---

### `GET /api/inventory/invoices/<invoice_number>/image`
Serve the original invoice image file.

---

### `GET /api/inventory/invoices/<invoice_number>/export`
Download the invoice's line items as a CSV file.

---

### `POST /api/inventory/upload`
Save an uploaded invoice image to disk and return its path, for attaching to a manually-entered invoice.

**Form Data:** `file` — image file (JPG, PNG, etc.)

**Response:** `200 { "message": "...", "path": "/media/.../filename.jpg" }`

---

### `POST /api/inventory/save_invoice`
Save a manually-entered invoice with all product details. Creates `PurchaseInvoice`, `ProductMaster` (if new), `InventoryBatch`, and `InventoryHistory` records.

**Request Body (JSON):**
```json
{
  "invoice_number": "INV-2024-001",  // required
  "gst_number": "27AABCU9603R1ZM",
  "total_amount": 5000.0,
  "vendor_name": "MediCorp",
  "image_path": "/media/.../file.jpg",
  "product_details": [
    {
      "product_name": "Paracetamol 500mg",
      "batch": "B001",
      "expiry": "06/26",
      "qty": 100,
      "free": 10,
      "mrp": 2.50,
      "rate": 1.80,
      "gst": 5,
      "packs": "1x10",
      "hsn": "3004",
      "mfg": "ABC Pharma",
      "matched_id": "A1B2C3"        // optional: existing product master ID
    }
  ]
}
```
**Response:** `200 { "message": "Invoice Saved", "invoice_number": "INV-2024-001" }`

---

## Patient Images

### `POST /api/patients/<patient_id>/images`
Upload an image for a patient.

**Form Data:**
- `file` — image file
- `visit_id` — optional visit to link to
- `notes` — optional text notes
- `tag` — optional tag (default: `Medical Record`)

**Response:** `201 { "message": "Image uploaded successfully", "id": 42 }`

---

### `GET /api/patients/<patient_id>/images`
Get all images for a patient, newest first.

**Response:** `200 [ { id, visit_id, timestamp, notes, tag, filename }, ... ]`

---

### `GET /api/patients/images/<image_id>/file`
Serve the actual image file binary.

---

### `GET /api/patients/images`
Get all patient images across all patients (joined with patient name).

**Response:** `200 [ { id, patient_id, patient_name, visit_id, timestamp, notes, tag, filename }, ... ]`

---

### `PUT /api/patients/images/<image_id>`
Update image metadata.

**Request Body (JSON):** Any of `notes`, `tag`

**Response:** `200 { "message": "Image updated successfully" }`

---

## QR Code Upload Sessions

### `POST /api/upload/session`
Create a temporary upload session (generates QR code link for mobile).

**Request Body (JSON):** `context_type` (`patient` or `inventory`), `context_id` (patient_id or invoice_id)

**Response:** `201 { "session_id": "uuid", "url_path": "/connect/<session_id>" }`

---

### `GET /api/upload/session/<session_id>`
Poll for session status and uploaded files.

**Response:** `200 { "status": "WAITING|UPLOADED|COMPLETED", "files": [...], "context_type": "...", "context_id": "..." }`

---

### `POST /api/upload/mobile/<session_id>`
Called by the mobile device to upload files to the session.

**Form Data:**
- `file` — one or more files
- `tags` — tag per file
- `notes` — shared notes

**Response:** `200 { "message": "Uploaded successfully", "files": [...] }`

---

### `POST /api/upload/session/<session_id>/finalize`
Called by the desktop to move files from temp storage to permanent patient image storage and create DB records.

**Response:** `200 { "message": "Files finalized", "count": N }`
