# Rack Location field for inventory items — Design Spec

**Date:** 2026-08-08
**Status:** Approved

## Problem

Frontdesk staff need to know where a physical item is stored on the shelf/rack
(e.g. `"C2"`, `"H1"`) when picking it up to build a bill, and pharmacy staff
need to record/update that location when a purchase invoice comes in and
stock is shelved. There is currently no field for this anywhere in the data
model.

## Naming note (important)

The codebase already has a `Location` model/concept meaning **clinic
branch** (`Location` table, `location_id` FKs on `User`/`Visit`/`Bill`/etc.,
the clinic-picker dropdown on `/inventory/invoice_edit`, `/status`,
`/daily-summary`). The field this spec adds is a **different concept** — a
free-text rack/shelf position on a single product — and must not be named
`location` anywhere in code or UI to avoid colliding with the existing
clinic-branch feature. It is called **"Rack Location"** throughout (DB
column `rack_location`, UI label "Rack Location" / "Rack").

## Scope

**In scope:**
- New `rack_location` field on `ProductMaster` (one per product, not per
  batch, not per clinic).
- Editable in the Inventory "Edit Item" dialog.
- Editable per-row during invoice creation (`/inventory/invoice_edit`),
  always overwriting the saved value on the matched product when a
  non-empty value is provided (same behavior as the existing `Formula`
  field on invoice rows).
- Displayed (read-only) in the billing page's item search dropdown, so
  frontdesk can locate the item while building a bill.

**Explicitly out of scope:**
- CSV export/import (`Total Inventory` / `Edit Inventory` sheets, and the
  import parser) — untouched.
- Bill printing (`InvoicePrint.tsx`) and `PrintInvoiceDialog` — untouched.
- Invoice history / invoice detail page (`/inventory/history/[id]`) and the
  per-invoice CSV export (`export_invoice`) — untouched.
- A visible column on the main Inventory table — not added; the field is
  only reachable via the Edit Item dialog and the two creation flows above.
- Validation beyond the DB column's length cap — informal free text field,
  consistent with `category`/`manufacturer`/etc.

## Data model

`Backend_db/models.py` — `ProductMaster` gets one new nullable column:

```python
rack_location = db.Column(db.String(50), nullable=True)
```

Migration, added to the existing additive-migration list in
`Backend_db/app.py`'s `_apply_migrations()`:

```python
"ALTER TABLE product_master ADD COLUMN IF NOT EXISTS rack_location VARCHAR(50)",
```

## Backend changes (`Backend_db/routes/inventory.py`)

- **`GET /api/inventory`** — include `rack_location` in each returned item
  (feeds the Edit Item dialog's initial form state).
- **`GET /api/inventory/search`** — include `rack_location` in each result
  (feeds the billing search dropdown; display-only there).
- **`PUT /api/inventory/<id>`** (`update_inventory_item`) — accept
  `rack_location` in the request body; if changed, update
  `item.rack_location` and append `'rack_location'` to `changed_fields` so
  it's captured in the `InventoryHistory` audit entry, matching how
  `category`/`hsn_code`/`formula` etc. are already handled in this
  function.
- **`POST /api/inventory/save_invoice`** — accept `rack_location` per row
  in `product_details`. On a newly-created `ProductMaster` row, set it
  directly from the row value (or `None` if blank). On an existing matched
  product, always overwrite `item.rack_location` when the row provides a
  non-empty value (mirrors the existing `formula` handling: `if
  p_formula: item.formula = p_formula`). A blank/omitted value on the row
  leaves the existing stored value untouched (no accidental clearing).
- **Untouched:** `export_inventory`, `export_inventory_edit`,
  `parse_import_headers`, `import_inventory`, `export_invoice` — none of
  these read or write `rack_location`.

## Frontend changes

### `frontend/lib/api.ts`
- `InventoryItem` interface: add `rack_location?: string`.
- `InventorySearchResult` interface: add `rack_location?: string`.
- `updateInventoryItem` payload type / call sites: include `rack_location`.
- Invoice save payload type (`product_details` row shape used by
  `saveInvoice`/equivalent): include `rack_location`.

### `frontend/components/EditInventoryDialog.tsx`
- Add `rack_location` to the `formData` state (initialized from
  `item.rack_location || ''`, reset on dialog open like the other fields).
- New text `Input` in the "Master Details" section, placed after Pack
  Size/Formula, labeled "Rack Location" with placeholder text like `e.g.
  C2, H1`.
- Included in the `handleSubmit` payload sent to `api.updateInventoryItem`.

### `frontend/app/billing/page.tsx`
- In the item search dropdown (`searchResults.map(...)`), add a small
  badge/tag showing `item.rack_location` when present (e.g. `📍 C2`),
  placed near the existing vendor/formula line. Purely informational —
  no click handler, no effect on `addToBill`, and never threaded into
  `BillItem`, `PrintInvoiceDialog`, or `InvoicePrint`.

### `frontend/app/inventory/invoice_edit/page.tsx`
- `ProductRow` interface: add `rack_location: string`.
- `selectProduct(i, item)` (the handler wired to `ProductSelector`'s
  `onSelect`): prefill `rack_location` from `item.rack_location || ''`,
  the same way `mfg`/`pack`/`category` are currently prefilled.
- `addRow()`'s initial row object and the OCR/manual-entry default row
  initializer: include `rack_location: ''`.
- Desktop table: new "Rack" column/input alongside the existing
  Category/Pack inputs.
- Mobile card view: new "Rack Location" input in the same grid as
  Category/Packs (around line ~514–531 today).
- Row-to-payload mapping sent to `save_invoice`: include
  `rack_location: row.rack_location`.
- Not shown on `/inventory/history/[id]` (invoice detail/history view) and
  not part of `export_invoice`'s CSV columns.

## Error handling / edge cases

- Empty/whitespace rack location on the Edit Item dialog is saved as-is
  (empty string), consistent with how this codebase already treats
  `category`/`hsn_code`/`manufacturer` — no special-casing to `NULL`.
- On invoice-row save, a blank `rack_location` cell means "no change" for
  an existing matched product (never clears a previously-set value); for a
  brand-new product it's simply stored as blank/`None`.
- No format/length validation beyond the `VARCHAR(50)` DB cap.

## Testing / verification approach

No test suite exists for this project (per `CLAUDE.md`). Verification will
be manual, following the project's established convention: throwaway
backend (`PORT=5050`) + frontend (`-p 3001`) + curl/Playwright checks
covering:
1. Setting a rack location via the Edit Item dialog persists and reloads
   correctly.
2. The billing search dropdown shows the rack location badge when set, and
   nothing when unset.
3. Creating/saving an invoice with a Rack input on a new product creates
   the product with that rack location.
4. Creating/saving an invoice row against an existing matched product with
   a non-empty Rack value overwrites the stored value; leaving it blank on
   the row does not clear the existing value.
5. `tsc --noEmit` (frontend) and `python3 -c "import ast; ast.parse(...)"`
   (backend) both pass.
6. Confirm bill print, invoice history detail page, and invoice CSV export
   show no trace of `rack_location`.
