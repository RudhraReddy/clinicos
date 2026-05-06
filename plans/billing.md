# Billing

**Status:** Implemented

## Overview
Creates sales invoices for patients, consuming inventory stock via FIFO batch depletion. Each bill is linked to a patient (required) and optionally to an existing visit. The feature also provides a billing history view and a printable invoice template.

## Affected Layers
- DB models: `Bill`, `BillItem`, `Patient`, `Visit`, `ProductMaster`, `InventoryBatch`, `InventoryHistory`
- Backend routes: `Backend_db/routes/billing.py` (blueprint `billing`, prefix `/api`)
- Frontend pages/components:
  - `frontend/app/billing/page.tsx` (new bill form + history tab)
  - `frontend/components/PatientSearch.tsx` (patient autocomplete)
  - `frontend/components/InvoicePrint.tsx` (printable invoice template, rendered hidden, triggered via `window.print()`)
  - `frontend/components/QRCodeUpload.tsx` (QR upload widget, available on billing page to attach prescription images)

## Data Flow
1. User opens `/billing`. The page defaults to the "New Bill" tab.
2. User selects a patient via `PatientSearch` (autocomplete that calls `GET /api/patients?q=...`).
3. User searches for items in the inventory search box. After a 300ms debounce, `GET /api/inventory/search?q=...` is called and results are displayed in a dropdown. Stock count is shown next to each result.
4. User clicks a result to add it to the bill table. The item is stored client-side with an estimated MRP from the search result. Quantity can be adjusted inline.
5. User clicks "Create Bill". The frontend calls `POST /api/billing` with `patient_id`, optional `visit_id`, `payment_type` (hardcoded to `"CASH"`), and `items_used` (array of `{item_id, quantity}`).
6. On the backend:
   - A new `Bill` record is created and flushed to get the `invoice_id`.
   - If a `visit_id` is provided and the visit exists, `visit.invoice_id` is set and `visit.status` is set to `'done'`.
   - For each item in `items_used`, batches are fetched ordered by `expiry_date ASC` (FIFO). Stock is deducted batch-by-batch until the requested quantity is fulfilled.
   - A `BillItem` snapshot record is created for each batch deduction, capturing `item_name`, `batch_number`, `expiry_date`, `quantity`, `mrp`, `gst_rate`, and `total_value` at the time of sale.
   - An `InventoryHistory` record with `type='SALE'` and negative `change_amount` is created for each batch deduction.
   - The bill's `total_amount` is set to the sum of all line totals.
7. On success, the UI shows an alert with the invoice ID and total, clears the bill items, and switches to the "History" tab.
8. The "History" tab calls `GET /api/billing/history` (latest 50 bills). Each row has a "Print" button that fetches `GET /api/billing/<invoice_id>` and then triggers `window.print()` using the hidden `InvoicePrint` component.

## Business Rules
- `patient_id` and at least one item in `items_used` are required to create a bill.
- Batch consumption is strictly FIFO by `expiry_date ASC` — the earliest-expiring batch is consumed first.
- `BillItem` stores a snapshot of the product data at sale time (item name, batch number, expiry, MRP, GST rate). It does not maintain a live foreign key to the batch price — the snapshot is immutable after creation.
- If a product has no available stock (all batches at quantity 0), the billing loop silently skips that product — no error is returned for zero-stock items.
- `invoice_id` is generated server-side via `generate_invoice_id()` in `utils.py` (format `DDMMYY-XXX-XXX`).
- Payment type defaults to `"CASH"` on the frontend; the API field accepts any string but only `"CASH"`, `"CARD"`, `"INSURANCE"` are documented in the model comment.
- The history endpoint returns at most 50 bills ordered by `created_at` descending.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/billing` | Create a new bill (FIFO stock deduction + snapshot) |
| GET | `/api/billing/history` | List recent bills (max 50, newest first) |
| GET | `/api/billing/patient/<patient_id>` | List all bills for a specific patient |
| GET | `/api/billing/<invoice_id>` | Get full bill details including line items |

## Known Constraints / Risks
- Payment type on the billing page is hardcoded to `"CASH"` — there is no UI selector for `"CARD"` or `"INSURANCE"`.
- The MRP shown in the bill draft table is the estimated max MRP from the search endpoint. The actual MRP applied to `BillItem` is taken from the batch at bill-creation time and may differ if batch prices vary.
- If a product master ID does not exist, the billing backend silently skips it (`if not product_master: continue`). This can result in a bill with fewer items than requested, with no indication to the user.
- The `POST /api/billing` endpoint has a dead code block: `if 'total_amount' in data` and `else` branch both execute the same assignment (`new_bill.total_amount = total_calc_amount`), making the client-supplied total_amount effectively ignored.
- There is no UPDATE or DELETE endpoint for bills — bills are immutable once created.
- The invoice print template hardcodes clinic name, address, and phone (`"MediCare Clinic"`, `"123 Health St, Medical District, City"`, `"+91 98765 43210"`).
