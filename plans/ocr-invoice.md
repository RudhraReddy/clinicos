# OCR Invoice Import

**Status:** Implemented

## Overview
Allows clinic staff to photograph or upload a purchase invoice image. The image is processed by `AIInvoiceScanner` (PaddleOCR) to extract structured invoice data (invoice number, GST number, vendor, product rows). The staff reviews and corrects the extracted data, then confirms to persist the invoice and create the corresponding `InventoryBatch` records.

## Affected Layers
- DB models: `PurchaseInvoice`, `ProductMaster`, `InventoryBatch`, `InventoryHistory`
- Backend routes: `Backend_db/routes/inventory.py` — `POST /api/inventory/upload` and `POST /api/inventory/save_invoice`
- External module: `models/invoice_ocr.py` — `AIInvoiceScanner` (PaddleOCR + OpenCV)
- Frontend pages/components:
  - `frontend/components/UploadInventoryReportDialog.tsx` (upload modal on inventory page)
  - `frontend/app/inventory/page.tsx` (hosts the dialog)

## Data Flow
1. Staff opens the inventory page and clicks the upload/OCR button, opening `UploadInventoryReportDialog`.
2. Staff selects an invoice image file (JPEG, PNG, etc.). The dialog calls `POST /api/inventory/upload` with the image as multipart form data.
3. The backend:
   a. Saves the file to `$UPLOAD_BASE_DIR/invoices/<timestamp>_<filename>`.
   b. Instantiates `AIInvoiceScanner` and calls `scanner.scan(filepath)`.
   c. `AIInvoiceScanner.scan()` first runs a blur check using OpenCV's Variance of Laplacian. If the image is blurry (score < 100.0), it returns `{"error": "BLURRED", "message": "..."}` without proceeding.
   d. If not blurry, PaddleOCR processes the image. The scanner parses the OCR output and returns a structured dict: `{invoice_number, gst_number, total_amount, product_details: [{product_name, batch, qty, free, mrp, rate, expiry, gst, hsn, mfg, packs}, ...]}`.
   e. The response includes both `path` (saved file path) and `ocr_data` (parsed result or error).
4. The frontend displays the extracted `ocr_data` in an editable form. Staff can correct any field — invoice number, vendor name, GST, product details, quantities, expiry dates.
5. Staff clicks "Save Invoice". The frontend calls `POST /api/inventory/save_invoice` with the confirmed data.
6. The save endpoint:
   a. Checks if a `PurchaseInvoice` with the given `invoice_number` already exists. If not, creates one. `source` is set to `'OCR'` if `image_path` is present, otherwise `'MANUAL'`.
   b. For each product in `product_details`:
      - Looks up or creates a `ProductMaster` record (matched by normalized `item_name` and optionally `pack_size`; a `matched_id` field can be provided by the frontend to bypass the lookup).
      - If creating a new master, sets `manufacturer`, `pack_size`, and `hsn_code` from the OCR data.
      - Creates a new `InventoryBatch`: `quantity = qty + free_qty`, `initial_quantity = qty + free_qty`, `free_quantity = free_qty`.
      - Creates an `InventoryHistory` record with `type='PURCHASE'`.

## Business Rules
- `invoice_number` is required and serves as the primary key of `PurchaseInvoice`. If a save is attempted with a duplicate invoice number, the existing `PurchaseInvoice` record is reused (no update, no error — the `pass` branch).
- Free quantity (`free`) is added to `quantity` to compute the total stock added (`total_stock_qty = qty + free_qty`). The `InventoryBatch.free_quantity` field records the free portion separately.
- GST values ≥ 100 are treated as invalid and reset to `0.0` to handle OCR misreads.
- Product matching is case-insensitive on `item_name`. If `pack_size` is provided, it is also used as a matching criterion.
- If `matched_id` is provided in the frontend payload (i.e., staff manually linked the OCR product to an existing master), the backend uses that ID directly.
- The OCR module is imported with a `try/except` fallback: if `invoice_ocr` cannot be imported (missing PaddleOCR or OpenCV dependencies), a stub `AIInvoiceScanner` is used that returns `{'error': 'OCR module missing'}`.
- Blur detection uses a threshold of 100.0 (Variance of Laplacian). Images scoring below this are rejected before OCR processing.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/inventory/upload` | Upload invoice image; runs OCR and returns extracted data + saved file path |
| POST | `/api/inventory/save_invoice` | Persist confirmed invoice data: creates PurchaseInvoice + InventoryBatch records |

## Known Constraints / Risks
- PaddleOCR and OpenCV are heavyweight dependencies (`models/requirements.txt`). If these are not installed in the backend's virtual environment, the OCR feature silently falls back to a stub that always returns an error.
- On Render, the invoice image is saved to `/tmp/clinic_uploads/invoices/`, which is ephemeral — the image link stored in `PurchaseInvoice.image_path` will become invalid after an instance restart.
- The `POST /api/inventory/upload` endpoint processes OCR synchronously within the HTTP request. For large or complex invoices, this can cause the request to time out.
- The OCR parsing quality depends on PaddleOCR's ability to detect tabular data in the image. The `AIInvoiceScanner.scan()` implementation is heuristic-based and may produce incorrect product rows for unusual invoice formats.
- If a `PurchaseInvoice` with the same invoice number already exists, the save endpoint silently skips creating the invoice record (the `pass` branch) but still creates new `InventoryBatch` records linked to the existing invoice number — this can result in duplicate stock entries if the same invoice is submitted twice.
