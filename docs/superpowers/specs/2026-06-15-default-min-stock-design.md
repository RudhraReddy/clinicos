# Default Min Stock with Override Tracking

**Date:** 2026-06-15
**Status:** Approved

## Goal

Add a configurable global "Default Min Stock" to Admin Settings. Products track whether their `min_stock_level` was set individually (custom) or is on the global default. When the admin changes the default, all products still on the default update automatically.

---

## Architecture

### Data model change

Add `min_stock_override: bool` column to `ProductMaster`.

| Value | Meaning |
|---|---|
| `False` | Product uses the global default — updates automatically when default changes |
| `True` | Product has a custom min stock level set by an admin |

**Migration heuristic for existing rows:**
- `min_stock_level = 10` (old hardcoded default) → `min_stock_override = False`
- `min_stock_level != 10` → `min_stock_override = True`

New products created without an explicit min stock → `min_stock_override = False`.

### Global default storage

Stored in frontend localStorage under key `inventory_default_min_stock` (integer, default 10). Consistent with all other Admin Settings (expiry reminder, default columns). The current default value is passed as a parameter whenever the backend needs it (bulk update body, CSV import query param).

---

## Backend Changes

### 1. `Backend_db/models.py`
Add to `ProductMaster`:
```python
min_stock_override = db.Column(db.Boolean, default=False)
```

### 2. `Backend_db/app.py` — `_apply_migrations()`
Add a migration block:
1. `ALTER TABLE product_master ADD COLUMN IF NOT EXISTS min_stock_override BOOLEAN DEFAULT FALSE`
2. `UPDATE product_master SET min_stock_override = TRUE WHERE min_stock_level != 10`
3. `UPDATE product_master SET min_stock_override = FALSE WHERE min_stock_level = 10`

### 3. `PATCH /api/inventory/products/apply_default_min_stock`
New endpoint (admin-only).

- **Body:** `{ "default_min_stock": N }` (integer ≥ 1)
- **Action:** `UPDATE product_master SET min_stock_level = N WHERE min_stock_override = FALSE`
- **Response:** `{ "updated": <count> }`
- **Auth:** `@require_admin`

### 4. `GET /api/inventory` — `get_inventory`
Add `min_stock_override` to each item in the response payload.

### 5. `PATCH /api/inventory/products/<id>` — `update_product`
- When `min_stock_level` is present in the request body → set `min_stock_override = True` (marking it custom).
- Accept explicit `min_stock_override: false` in body to reset a product back to default.

### 6. `GET /api/inventory/export/edit` — Edit Inventory CSV
Add `Min Stock` column to the export headers and rows (`product.min_stock_level`).

### 7. `POST /api/inventory/import` — CSV import
- Accept new query param `default_min_stock` (integer, default 10).
- When processing a row:
  - `Min Stock` cell is blank → `min_stock_level = default_min_stock`, `min_stock_override = False`
  - `Min Stock` cell has a value → `min_stock_level = value`, `min_stock_override = True`
- This applies to both the generic import path and the Edit Inventory import path.

### 8. `POST /api/inventory/save_invoice` — new products from OCR
New products created here get `min_stock_override = False` (no explicit min stock set during OCR flow).

---

## Frontend Changes

### 1. `frontend/lib/settings_context.tsx`
- Add `defaultMinStock: number` to `SettingsContextType` (default `10`).
- localStorage key: `inventory_default_min_stock`.
- Persist and load alongside existing settings.

### 2. `frontend/lib/api.ts`
Add:
```ts
applyDefaultMinStock(value: number): Promise<{ updated: number }>
```
`PATCH /api/inventory/products/apply_default_min_stock` with body `{ default_min_stock: value }`.

Also update the inventory item type to include `min_stock_override: boolean`.

### 3. `frontend/app/admin/page.tsx` — `SettingsTab`
Add a new card under "Inventory Settings" (between Expiry Reminder and Default Columns):

- **Title:** Default Min Stock Level
- **Description:** Products without a custom min stock will use this value. Changing it updates all such products automatically.
- **Input:** Number input, range 1–9999
- **Button:** "Save" — calls `setSettings({ defaultMinStock: val })` then `api.applyDefaultMinStock(val)`. Toast shows `"Default updated — X products synced"`.

### 4. `frontend/components/EditInventoryDialog.tsx`
Change the Min Stock field:

- If `item.min_stock_override === false`: show a `(default)` badge next to the value. The input is enabled but shows the default value.
- After the user edits the value: badge disappears, a small "↺ Use default" link appears.
- Clicking "↺ Use default": resets the input to `defaultMinStock` from context and marks it as not overridden.
- On save: include `min_stock_override` in the PATCH payload (`true` if custom, `false` if reset to default).

### 5. `frontend/app/inventory/invoice_edit/page.tsx` (or wherever `ImportInventoryDialog` calls the import endpoint)
Pass `default_min_stock` as a query param: `?default_min_stock=${defaultMinStock}`.

---

## Data Flow: Admin Changes the Default

1. Admin edits number input in Settings card, clicks Save.
2. Frontend: `setSettings({ defaultMinStock: 15 })` → localStorage updated.
3. Frontend: `api.applyDefaultMinStock(15)` → `PATCH /api/inventory/products/apply_default_min_stock { default_min_stock: 15 }`.
4. Backend: updates all `ProductMaster` rows where `min_stock_override = False`.
5. Frontend: toast `"Default updated — 42 products synced"`.
6. Next `loadData()` on inventory page reflects new min stock levels.

## Data Flow: Admin Manually Edits a Product's Min Stock

1. Admin opens Edit dialog for a product (shows `(default)` badge if `override = false`).
2. Admin changes value to 25, clicks Save.
3. Frontend sends `PATCH /api/inventory/products/<id>` with `{ min_stock_level: 25, min_stock_override: true }`.
4. Product is now custom — future default changes won't affect it.
5. Admin can click "↺ Use default" to reset, which sends `{ min_stock_override: false }`.

## Data Flow: CSV Bulk Edit

1. Admin downloads Edit Inventory CSV (now includes `Min Stock` column with current values).
2. Admin edits the sheet: fills in explicit values for items they want to customize, blanks out cells for items that should follow the default.
3. Admin imports the CSV. Frontend passes `?default_min_stock=15` query param.
4. Backend: blank `Min Stock` cell → `override = False`, `min_stock_level = 15`; filled cell → `override = True`, `min_stock_level = value`.

---

## Files Touched

| File | Change |
|---|---|
| `Backend_db/models.py` | Add `min_stock_override` to `ProductMaster` |
| `Backend_db/app.py` | Migration for new column |
| `Backend_db/routes/inventory.py` | New endpoint, update export/import/get/update logic |
| `frontend/lib/settings_context.tsx` | Add `defaultMinStock` |
| `frontend/lib/api.ts` | Add `applyDefaultMinStock`, update inventory item type |
| `frontend/app/admin/page.tsx` | New settings card |
| `frontend/components/EditInventoryDialog.tsx` | default/custom indicator + reset link |
| `frontend/app/inventory/page.tsx` (or `ImportInventoryDialog`) | Pass `default_min_stock` param on import |
