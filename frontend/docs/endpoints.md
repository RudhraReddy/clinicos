# Application Endpoints

## Frontend Routes (Pages)
These routes are accessible in the browser via the Next.js frontend application.

- `/` - **Dashboard**: Main overview page.
- `/patients` - **Patient List**: Manage patients.
- `/visits` - **Visits**: Clinical visit records.
- `/visits/[id]` - **Visit Details**: View visit info and manage prescriptions.
- `/inventory` - **Inventory**: Manage stock, batches, and imports.
- `/billing` - **Billing**: Create new bills and view history.

## Backend API Endpoints
All endpoints are prefixed with `/api`. Defined in `Backend_db/routes.py`.

### System
- `GET /api/health` - Health check.

### Patients
- `GET /api/patients` - List all patients.
- `POST /api/patients` - Create a new patient.
- `GET /api/patients/:id` - Get patient details.

### Visits
- `GET /api/visits` - List visits (Optional: `?patient_id=`).
- `POST /api/visits` - Create a new visit.
- `GET /api/visits/:id` - Get visit details.
- `PUT /api/visits/:id` - Update visit.
- `DELETE /api/visits/:id` - Delete visit.

### Prescription
- `GET /api/visits/:visit_id/prescription` - Get all items prescribed in a visit.
- `POST /api/visits/:visit_id/prescription` - Add items to a prescription.
- `DELETE /api/visits/:visit_id/prescription/:item_id` - Remove a specific item.

### Inventory
- `GET /api/inventory` - Get master inventory list (aggregated).
- `POST /api/inventory` - Create/Add inventory item.
- `GET /api/inventory/:id/batches` - Get specific batches for an item.
- `GET /api/inventory/search` - **Search Inventory** (Query: `?q=name`). Returns stock & price.
- `PUT /api/inventory/:id` - Update master item details.
- `PUT /api/inventory/batch/:id` - Update specific batch (qty, expiry).
- `POST /api/inventory/import` - Import CSV inventory data.
- `GET /api/inventory/export` - Export inventory to CSV.
- `POST /api/inventory/save_invoice` - Save OCR/Invoice data.
- `GET /api/inventory/invoices` - List purchase invoices.

### Billing
- `POST /api/billing` - Create a new bill (deducts stock via FIFO).
- `GET /api/billing/history` - Get billing history.
