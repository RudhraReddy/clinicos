# Inventory Flow

**Route:** `/inventory`  
**File:** `frontend/app/inventory/page.tsx`

---

## Purpose

Manage clinic drug and supply stock. Inventory is split into two layers:
1. **Product Master** — the catalog (name, category, HSN, GST, min stock)
2. **Batches** — actual physical stock with expiry, MRP, and quantities

---

## Layout

- Header with **Export CSV**, **Import CSV**, **View History**, **Manual Entry**, **Upload Report**, and **Columns toggle** controls
- Filter/search bar
- Data table with per-column filters

---

## Main Table

Default visible columns: Item Name, Pack, MFG, Vendor, Qty, Next Expiry, Status

Togglable columns (via Columns popover): ID, MRP, GST %, Total Value, Category, HSN, Min Stock

Each row shows:
- Aggregated quantity across all batches
- Total count = `quantity × pack_size_number` (shown in small text if pack size contains 's' or 'x')
- Price range if min ≠ max MRP across batches
- Earliest expiry among active batches
- Status tags: `OK`, `LOW STOCK`, `OUT OF STOCK`, `EXPIRES SOON`, `EXPIRED`
- **View Batches icon** → opens `ViewBatchesDialog` with per-batch breakdown
- **Edit icon** → opens `EditInventoryDialog` for product master fields

---

## Filtering

Every visible column has its own filter:
- **Categorical columns** (Name, MFG, Vendor, Category, Status, Pack, GST, HSN) — multi-select dropdown filter via `DataTableColumnFilter`
- **Numeric columns** (Qty, MRP, Total Value, Min Stock) — range slider via `DataTableRangeFilter`
- **Expiry** — month/year multi-select
- **Quick search** text box — client-side filter on name, category, manufacturer

A reset "×" button appears in the header when any filter is active.

---

## Adding Stock

### Manual Entry
- Click **Add Invoice** → `/inventory/invoice_edit?manual=true`
- User fills in invoice details and product rows manually
- Optionally attaches a photo of the physical invoice via "Attach Image" (`POST /api/inventory/upload` — stores the file, no extraction) or "Upload via QR" (same storage-only behavior via the QR mobile-upload session)
- `POST /api/inventory/save_invoice` commits everything

### Import CSV
- `ImportInventoryDialog` — upload a CSV with columns like Item Name, Pack Size, Quantity, MRP, Expiry, etc.
- Two modes:
  - **Update** — adds new batches for each row (fresh stock)
  - **Overwrite** — adjusts current total to match the CSV target quantity

---

## Export

- **Export CSV** button calls `GET /api/inventory/export` — triggers browser download of full inventory CSV

---

## Purchase Invoice History

- **View History** navigates to `/inventory/history`
- Shows all `purchase_invoices` with source, vendor, amount, and image indicator
- Each invoice is expandable to see individual batch items

---

## Components Used

| Component | Purpose |
|---|---|
| `ImportInventoryDialog` | Bulk CSV import |
| `EditInventoryDialog` | Edit product master fields |
| `ViewBatchesDialog` | Per-batch stock breakdown + batch edit |
| `DataTableColumnFilter` | Multi-select column filter |
| `DataTableRangeFilter` | Numeric range slider filter |
