# Default Min Stock with Override Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable global "Default Min Stock" to Admin Settings, track per-product whether its min stock level is custom or on the default, and auto-update all "on-default" products when the default changes.

**Architecture:** Add `min_stock_override: bool` column to `ProductMaster` (False = on default, True = custom). Default value lives in frontend localStorage and is sent to the backend as a parameter on bulk-update and CSV import calls. A new admin-only `PATCH /api/inventory/products/apply_default_min_stock` endpoint updates all non-overridden products atomically.

**Tech Stack:** Flask + SQLAlchemy 2.0 (backend), Next.js 16 App Router + React + shadcn/ui + Tailwind (frontend). No test suites — verify with `curl` against the running dev server and browser inspection.

---

## File Map

| File | Change |
|---|---|
| `Backend_db/models.py` | Add `min_stock_override` column to `ProductMaster` |
| `Backend_db/app.py` | Add migration for `min_stock_override` column |
| `Backend_db/routes/inventory.py` | New bulk-update endpoint; update get/update/add/import/save_invoice/export-edit |
| `frontend/lib/settings_context.tsx` | Add `defaultMinStock` setting (localStorage) |
| `frontend/lib/api.ts` | Add `applyDefaultMinStock`, update `InventoryItem` type and `importInventory` signature |
| `frontend/app/admin/page.tsx` | New "Default Min Stock" settings card |
| `frontend/components/EditInventoryDialog.tsx` | Default/custom indicator + "Use default" reset link |
| `frontend/components/ImportInventoryDialog.tsx` | Pass `defaultMinStock` to `api.importInventory` |

---

## Task 1: Backend model column + migration

**Files:**
- Modify: `Backend_db/models.py:68`
- Modify: `Backend_db/app.py:50` (end of `stmts` list)

- [ ] **Step 1: Add `min_stock_override` to `ProductMaster`**

In `Backend_db/models.py`, after line 68 (`min_stock_level = db.Column(db.Integer, default=10)`), add:

```python
    min_stock_override = db.Column(db.Boolean, default=False)
```

So lines 68–69 read:
```python
    min_stock_level = db.Column(db.Integer, default=10)
    min_stock_override = db.Column(db.Boolean, default=False)
```

- [ ] **Step 2: Add migration statements**

In `Backend_db/app.py`, add three new entries at the end of the `stmts` list (after the last `inventory_batches` location_id line, before the closing `]`):

```python
        # 2026-06-15: min_stock_override flag for default vs custom min stock tracking
        "ALTER TABLE product_master ADD COLUMN IF NOT EXISTS min_stock_override BOOLEAN DEFAULT FALSE",
        "UPDATE product_master SET min_stock_override = TRUE WHERE min_stock_level != 10",
        "UPDATE product_master SET min_stock_override = FALSE WHERE min_stock_level = 10",
```

- [ ] **Step 3: Restart the backend and confirm migration ran**

```bash
cd Backend_db && source venv/bin/activate && python app.py
```

Then verify:
```bash
curl -s http://localhost:5000/api/inventory | python3 -c "import sys,json; d=json.load(sys.stdin); print(list(d[0].keys()) if d else 'empty')" 2>/dev/null || echo "check server"
```

(The column won't appear in the API yet — we're just confirming the server starts without errors.)

- [ ] **Step 4: Commit**

```bash
git add Backend_db/models.py Backend_db/app.py
git commit -m "feat: add min_stock_override column to product_master with migration"
```

---

## Task 2: New bulk-update endpoint + update get/add/update routes

**Files:**
- Modify: `Backend_db/routes/inventory.py`

### 2a — Add `min_stock_override` to the `get_inventory` response

- [ ] **Step 1: Add field to results dict**

In `inventory.py`, at line ~559 (the `results.append({...})` block that starts around line 541), add `'min_stock_override'` after `'formula'`:

```python
            'formula': item.formula,
            'min_stock_override': item.min_stock_override if item.min_stock_override is not None else False,
```

### 2b — New bulk-update endpoint

- [ ] **Step 2: Add the endpoint**

Insert this block immediately before the `delete_inventory_item` route (line 1004):

```python
@inventory.route('/inventory/products/apply_default_min_stock', methods=['PATCH'])
@require_auth
@require_admin
def apply_default_min_stock():
    data = request.get_json() or {}
    try:
        default_val = int(data.get('default_min_stock', 10))
        if default_val < 1:
            return jsonify({'error': 'default_min_stock must be >= 1'}), 400
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid default_min_stock value'}), 400

    updated = ProductMaster.query.filter_by(min_stock_override=False).update(
        {'min_stock_level': default_val},
        synchronize_session=False,
    )
    db.session.commit()
    return jsonify({'updated': updated}), 200
```

### 2c — Update `update_inventory_item` to set override flag

- [ ] **Step 3: Mark product as custom when min_stock_level is changed**

In the `update_inventory_item` function (around line 947), replace the `if 'min_stock_level' in data:` block:

Old code:
```python
    if 'min_stock_level' in data:
        try:
            new_val = int(float(data['min_stock_level']))
        except (ValueError, TypeError):
            new_val = item.min_stock_level
        if item.min_stock_level != new_val:
            changed_fields.append('min_stock_level')
        item.min_stock_level = new_val
```

New code:
```python
    if 'min_stock_level' in data:
        try:
            new_val = int(float(data['min_stock_level']))
        except (ValueError, TypeError):
            new_val = item.min_stock_level
        if item.min_stock_level != new_val:
            changed_fields.append('min_stock_level')
        item.min_stock_level = new_val
        # If caller explicitly resets override to False, honour it; otherwise mark as custom
        if 'min_stock_override' in data and data['min_stock_override'] is False:
            item.min_stock_override = False
        else:
            item.min_stock_override = True
    elif 'min_stock_override' in data and data['min_stock_override'] is False:
        # Allow resetting to default without changing the value
        item.min_stock_override = False
        if 'min_stock_override' not in changed_fields:
            changed_fields.append('min_stock_override')
```

### 2d — Update `add_inventory_item` to set override=False for new items

- [ ] **Step 4: New items use default**

In `add_inventory_item` (line 906), in the `ProductMaster(...)` constructor, add `min_stock_override=False`:

```python
    new_item = ProductMaster(
        id=ProductMaster.generate_item_id(),
        item_name=data['item_name'],
        min_stock_level=data.get('min_stock_level', 10),
        min_stock_override=False,
        manufacturer=data.get('supplier', ''),
        category=data.get('category', ''),
        pack_size=data.get('pack_size', ''),
        hsn_code=data.get('hsn_code', ''),
        created_by_user_id=g.current_user.get('user_id'),
    )
```

### 2e — Update `save_invoice` new product creation

- [ ] **Step 5: OCR-created products use default**

In `save_invoice` around line 1988, in the `ProductMaster(...)` constructor, add `min_stock_override=False`:

```python
                item = ProductMaster(
                    id=ProductMaster.generate_item_id(),
                    item_name=p_name,
                    category='',
                    manufacturer=p_mfg,
                    pack_size=str(p_pack),
                    hsn_code=str(p_hsn),
                    formula=p_formula if p_formula else None,
                    min_stock_override=False,
                )
```

- [ ] **Step 6: Verify the endpoint responds correctly**

With the backend running and an admin session cookie, test:
```bash
curl -s -X PATCH http://localhost:5000/api/inventory/products/apply_default_min_stock \
  -H "Content-Type: application/json" \
  -b "session=<your-session-cookie>" \
  -d '{"default_min_stock": 10}' | python3 -m json.tool
```

Expected: `{"updated": <N>}` where N is the count of products with `min_stock_override = false`.

- [ ] **Step 7: Commit**

```bash
git add Backend_db/routes/inventory.py
git commit -m "feat: add apply_default_min_stock endpoint, propagate min_stock_override on create/update"
```

---

## Task 3: Backend — CSV export and import

**Files:**
- Modify: `Backend_db/routes/inventory.py`

### 3a — Add `Min Stock` column to Edit Inventory CSV export

- [ ] **Step 1: Update export headers and row**

In `export_inventory_edit` (around line 1226), the `writer.writerow` for headers currently is:

```python
    writer.writerow([
        'Product ID', 'Item Name', 'Pack Size', 'Formula',
        'Category', 'Manufacturer', 'MRP', 'Expiry Date',
    ] + loc_headers)
```

Change to:

```python
    writer.writerow([
        'Product ID', 'Item Name', 'Pack Size', 'Formula',
        'Category', 'Manufacturer', 'Min Stock', 'MRP', 'Expiry Date',
    ] + loc_headers)
```

Then find the `writer.writerow([...] + loc_qtys)` call (around line 1257) and add `product.min_stock_level` after `product.manufacturer or ''`:

Old:
```python
        writer.writerow([
            product.id,
            product.item_name,
            product.pack_size or '',
            product.formula or '',
            product.category or '',
            product.manufacturer or '',
            mrp_str,
            expiry_str,
        ] + loc_qtys)
```

New:
```python
        writer.writerow([
            product.id,
            product.item_name,
            product.pack_size or '',
            product.formula or '',
            product.category or '',
            product.manufacturer or '',
            product.min_stock_level,
            mrp_str,
            expiry_str,
        ] + loc_qtys)
```

### 3b — Update CSV import to use `default_min_stock` param

- [ ] **Step 2: Read `default_min_stock` query param**

In `import_inventory` (line 1358), add the query param read right after the `mode` line (line 1364):

Old:
```python
    mode = request.form.get('mode', 'update')
```

New:
```python
    mode = request.form.get('mode', 'update')
    try:
        default_min_stock = int(request.args.get('default_min_stock', 10))
        if default_min_stock < 1:
            default_min_stock = 10
    except (ValueError, TypeError):
        default_min_stock = 10
```

- [ ] **Step 3: Use `default_min_stock` and set `min_stock_override` on CSV import**

Find the min_stock block around line 1445:

Old:
```python
            try:
                min_stock_val = int(float(get_val(['Min Stock', 'min', 'Min Stock Level']) or 10))
            except (ValueError, TypeError):
                min_stock_val = 10
```

New:
```python
            raw_min_stock = get_val(['Min Stock', 'min', 'Min Stock Level'])
            if raw_min_stock is not None and str(raw_min_stock).strip() != '':
                try:
                    min_stock_val = int(float(raw_min_stock))
                    min_stock_is_custom = True
                except (ValueError, TypeError):
                    min_stock_val = default_min_stock
                    min_stock_is_custom = False
            else:
                min_stock_val = default_min_stock
                min_stock_is_custom = False
```

- [ ] **Step 4: Apply `min_stock_override` on new product creation in CSV import**

Find the new product `ProductMaster(...)` block around line 1452:

Old:
```python
                item = ProductMaster(
                    id=new_id,
                    item_name=name.strip(),
                    pack_size=pack_size.strip(),
                    category=get_val(['Category', 'cat']) or '',
                    min_stock_level=min_stock_val,
                    manufacturer=get_val(['Manufacturer', 'mfg', 'manufacturer']) or '',
                    hsn_code=get_val(['HSN Code', 'hsn']) or '',
                    generic_tags=get_val(['Generic Tags', 'tags']) or '',
                    formula=get_val(['Formula', 'formula']) or '',
                )
```

New:
```python
                item = ProductMaster(
                    id=new_id,
                    item_name=name.strip(),
                    pack_size=pack_size.strip(),
                    category=get_val(['Category', 'cat']) or '',
                    min_stock_level=min_stock_val,
                    min_stock_override=min_stock_is_custom,
                    manufacturer=get_val(['Manufacturer', 'mfg', 'manufacturer']) or '',
                    hsn_code=get_val(['HSN Code', 'hsn']) or '',
                    generic_tags=get_val(['Generic Tags', 'tags']) or '',
                    formula=get_val(['Formula', 'formula']) or '',
                )
```

- [ ] **Step 5: Apply `min_stock_override` on existing product update in CSV import**

Find the existing product update block around line 1473:

Old:
```python
                if min_stock_val: item.min_stock_level = min_stock_val
```

New:
```python
                if raw_min_stock is not None and str(raw_min_stock).strip() != '':
                    item.min_stock_level = min_stock_val
                    item.min_stock_override = min_stock_is_custom
```

- [ ] **Step 6: Verify Edit Inventory CSV now has Min Stock column**

With backend running:
```bash
curl -s -b "session=<cookie>" "http://localhost:5000/api/inventory/export/edit?scope=all" | head -1
```

Expected: first line contains `Min Stock` between `Manufacturer` and `MRP`.

- [ ] **Step 7: Commit**

```bash
git add Backend_db/routes/inventory.py
git commit -m "feat: add Min Stock to Edit Inventory CSV export; honour default_min_stock on import"
```

---

## Task 4: Frontend — settings context and api.ts

**Files:**
- Modify: `frontend/lib/settings_context.tsx`
- Modify: `frontend/lib/api.ts`

### 4a — Add `defaultMinStock` to settings context

- [ ] **Step 1: Add to `SettingsContextType` interface**

In `settings_context.tsx` (line 27), add `defaultMinStock: number` to the interface:

```typescript
interface SettingsContextType {
    clinicName: string
    clinicAddress: string
    clinicPhone: string
    referenceDoctor: string
    appFontSize: number
    expiryReminderMonths: number
    defaultMinStock: number
    defaultInventoryColumns: string[]
    setSettings: (settings: Partial<Omit<SettingsContextType, 'setSettings' | 'setPreviewFontSize'>>) => void
    setPreviewFontSize: (size: number | null) => void
}
```

- [ ] **Step 2: Add state and localStorage load**

After line 47 (`const [expiryReminderMonths, setExpiryReminderMonths] = useState(6)`), add:

```typescript
    const [defaultMinStock, setDefaultMinStock] = useState(10)
```

In the `useEffect` that reads from localStorage (around line 53), add a new `storedDefaultMinStock` read. After `const storedExpiry = localStorage.getItem("expiry_reminder_months")` add:

```typescript
        const storedDefaultMinStock = localStorage.getItem("inventory_default_min_stock")
```

And after the `if (storedExpiry)` block, add:

```typescript
        if (storedDefaultMinStock) {
            const parsed = parseInt(storedDefaultMinStock, 10)
            if (!isNaN(parsed) && parsed >= 1) setDefaultMinStock(parsed)
        }
```

- [ ] **Step 3: Add handler in `setSettings`**

In the `setSettings` function (around line 86), add after the `expiryReminderMonths` block:

```typescript
        if (settings.defaultMinStock !== undefined) {
            setDefaultMinStock(settings.defaultMinStock)
            localStorage.setItem("inventory_default_min_stock", settings.defaultMinStock.toString())
        }
```

- [ ] **Step 4: Expose in the context provider**

In the `SettingsContext.Provider value={{...}}` (around line 119), add `defaultMinStock` to the value object:

```typescript
        <SettingsContext.Provider value={{
            clinicName,
            clinicAddress,
            clinicPhone,
            referenceDoctor,
            appFontSize: currentFontSize,
            expiryReminderMonths,
            defaultMinStock,
            defaultInventoryColumns,
            setSettings,
            setPreviewFontSize
        }}>
```

### 4b — Update `api.ts`

- [ ] **Step 5: Add `min_stock_override` to `InventoryItem` type**

In `api.ts` around line 58, after `min_stock_level: number;`, add:

```typescript
    min_stock_override: boolean;
```

- [ ] **Step 6: Add `applyDefaultMinStock` function**

After `deleteInventoryItem` (around line 249), add:

```typescript
    async applyDefaultMinStock(value: number): Promise<{ updated: number }> {
        return fetchApi('/api/inventory/products/apply_default_min_stock', {
            method: 'PATCH',
            body: JSON.stringify({ default_min_stock: value }),
        });
    },
```

- [ ] **Step 7: Update `importInventory` signature to accept `defaultMinStock`**

Old (line 305):
```typescript
    async importInventory(
        file: File,
        mode: 'update' | 'overwrite',
        fieldMapping?: Record<string, string>,
        clinicMapping?: Record<string, number>,
    ) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('mode', mode)
        if (fieldMapping && Object.keys(fieldMapping).length > 0) {
            formData.append('field_mapping', JSON.stringify(fieldMapping))
        }
        if (clinicMapping && Object.keys(clinicMapping).length > 0) {
            formData.append('clinic_mapping', JSON.stringify(clinicMapping))
        }
        const res = await fetch(`${API_BASE_URL}/api/inventory/import`, {
            method: 'POST',
            body: formData,
            credentials: 'include',
        })
```

New:
```typescript
    async importInventory(
        file: File,
        mode: 'update' | 'overwrite',
        fieldMapping?: Record<string, string>,
        clinicMapping?: Record<string, number>,
        defaultMinStock?: number,
    ) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('mode', mode)
        if (fieldMapping && Object.keys(fieldMapping).length > 0) {
            formData.append('field_mapping', JSON.stringify(fieldMapping))
        }
        if (clinicMapping && Object.keys(clinicMapping).length > 0) {
            formData.append('clinic_mapping', JSON.stringify(clinicMapping))
        }
        const qs = defaultMinStock ? `?default_min_stock=${defaultMinStock}` : ''
        const res = await fetch(`${API_BASE_URL}/api/inventory/import${qs}`, {
            method: 'POST',
            body: formData,
            credentials: 'include',
        })
```

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/settings_context.tsx frontend/lib/api.ts
git commit -m "feat: add defaultMinStock to settings context and api.ts"
```

---

## Task 5: Frontend — Admin Settings card

**Files:**
- Modify: `frontend/app/admin/page.tsx`

- [ ] **Step 1: Add `defaultMinStock` and `localDefaultMinStock` state to `SettingsTab`**

In `SettingsTab` (line 758), destructure `defaultMinStock` from `useSettings`:

```typescript
    const { expiryReminderMonths, defaultInventoryColumns, defaultMinStock, setSettings } = useSettings()
```

After the `localMonths` state (line 760), add:

```typescript
    const [localDefaultMinStock, setLocalDefaultMinStock] = useState(defaultMinStock)

    useEffect(() => {
        setLocalDefaultMinStock(defaultMinStock)
    }, [defaultMinStock])
```

- [ ] **Step 2: Add `handleSaveDefaultMinStock` handler**

After `handleSave` (the expiry handler, around line 766), add:

```typescript
    const handleSaveDefaultMinStock = async () => {
        const val = Math.max(1, Math.min(9999, localDefaultMinStock))
        setSettings({ defaultMinStock: val })
        try {
            const result = await api.applyDefaultMinStock(val)
            toast.success(`Default updated — ${result.updated} product${result.updated !== 1 ? 's' : ''} synced`)
        } catch {
            toast.error('Failed to sync products')
        }
    }
```

- [ ] **Step 3: Add the new card in JSX**

In the JSX return, insert a new card block between the Expiry Reminder card and the Inventory Default Columns section. After the closing `</div>` of the Expiry Reminder card (the one ending with `<Button size="sm" onClick={handleSave}>Save Settings</Button>`) and before the `{/* ── Inventory Default Columns ── */}` comment, add:

```tsx
            {/* ── Default Min Stock ── */}
            <div className="rounded-lg border p-4 space-y-4">
                <div className="space-y-1">
                    <label className="text-sm font-medium">Default Min Stock Level</label>
                    <p className="text-xs text-muted-foreground">
                        Products without a custom min stock will use this value. Saving updates all such products automatically.
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                        <input
                            type="number"
                            min={1}
                            max={9999}
                            value={localDefaultMinStock}
                            onChange={e => {
                                const n = parseInt(e.target.value, 10)
                                if (!isNaN(n)) setLocalDefaultMinStock(n)
                            }}
                            className="w-24 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <span className="text-sm text-muted-foreground">units (1–9999)</span>
                    </div>
                </div>
                <Button size="sm" onClick={handleSaveDefaultMinStock}>Save</Button>
            </div>
```

- [ ] **Step 4: Also add `api` import if not already present**

Check if `api` is already imported in `admin/page.tsx`:
```bash
grep -n "from.*api" /home/fia/Downloads/clinic_related/frontend/app/admin/page.tsx | head -5
```

If not imported, add to the imports at the top:
```typescript
import { api } from "@/lib/api"
```

- [ ] **Step 5: Verify in browser**

Start the dev servers (`cd frontend && npm run dev`). Navigate to Admin → Settings. Confirm the new "Default Min Stock Level" card appears between Expiry Reminder and Default Columns. Change the value and click Save — confirm the toast shows `"Default updated — X products synced"`.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/admin/page.tsx
git commit -m "feat: add Default Min Stock settings card to Admin Settings"
```

---

## Task 6: Frontend — EditInventoryDialog default/custom indicator

**Files:**
- Modify: `frontend/components/EditInventoryDialog.tsx`

- [ ] **Step 1: Import `useSettings`**

At the top of `EditInventoryDialog.tsx`, add:

```typescript
import { useSettings } from "@/lib/settings_context"
```

- [ ] **Step 2: Access `defaultMinStock` inside the component**

Inside `EditInventoryDialog` function body (after the existing `useState`/`useEffect` calls), add:

```typescript
    const { defaultMinStock } = useSettings()
```

- [ ] **Step 3: Track whether the current edit is custom or default**

After the `formData` state, add:

```typescript
    const [isCustomMinStock, setIsCustomMinStock] = useState<boolean>(
        item.min_stock_override ?? true
    )
```

And in the `useEffect` that resets form on open (around line 75), reset this flag too:

```typescript
    useEffect(() => {
        if (open && item) {
            setFormData({
                item_name: item.item_name,
                manufacturer: item.manufacturer || '',
                category: item.category,
                min_stock_level: item.min_stock_level,
                hsn_code: item.hsn_code || '',
                gst_rate: item.gst_rate || 5,
                vendors: (item.vendors || []).join(', '),
                pack_size: item.pack_size || '',
                formula: item.formula || ''
            })
            setIsCustomMinStock(item.min_stock_override ?? true)
        }
    }, [open, item])
```

- [ ] **Step 4: Include `min_stock_override` in the save payload**

In `handleSubmit` (line 91), change the payload to include `min_stock_override`:

Old:
```typescript
            const payload = {
                ...formData,
                vendors: formData.vendors.split(',').map(v => v.trim()).filter(Boolean)
            }
```

New:
```typescript
            const payload = {
                ...formData,
                vendors: formData.vendors.split(',').map(v => v.trim()).filter(Boolean),
                min_stock_override: isCustomMinStock,
            }
```

- [ ] **Step 5: Update the Min Stock field JSX**

Find the Min Stock field section (around line 197):

Old:
```tsx
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="min_stock" className="text-right">Min Stock</Label>
                                <Input
                                    id="min_stock"
                                    type="number"
                                    value={formData.min_stock_level}
                                    onChange={(e) => setFormData({ ...formData, min_stock_level: parseInt(e.target.value) || 0 })}
                                    className="col-span-3"
                                />
                            </div>
```

New:
```tsx
                            <div className="grid grid-cols-4 items-start gap-4">
                                <Label htmlFor="min_stock" className="text-right pt-2">Min Stock</Label>
                                <div className="col-span-3 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Input
                                            id="min_stock"
                                            type="number"
                                            value={formData.min_stock_level}
                                            onChange={(e) => {
                                                setFormData({ ...formData, min_stock_level: parseInt(e.target.value) || 0 })
                                                setIsCustomMinStock(true)
                                            }}
                                            className="w-24"
                                        />
                                        {!isCustomMinStock && (
                                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">(default)</span>
                                        )}
                                        {isCustomMinStock && (
                                            <button
                                                type="button"
                                                className="text-xs text-primary underline underline-offset-2"
                                                onClick={() => {
                                                    setFormData({ ...formData, min_stock_level: defaultMinStock })
                                                    setIsCustomMinStock(false)
                                                }}
                                            >
                                                ↺ Use default
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
```

- [ ] **Step 6: Verify in browser**

Open the inventory page, click the edit (pencil) icon on a product. Confirm:
- Products with `min_stock_override = false` show `(default)` badge.
- Editing the value makes the badge disappear and shows `↺ Use default`.
- Clicking `↺ Use default` resets the value to `defaultMinStock` from settings and restores the `(default)` badge.
- Saving a custom value → on next open, the `↺ Use default` link appears.
- Saving with "Use default" → on next open, the `(default)` badge appears.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/EditInventoryDialog.tsx
git commit -m "feat: show default/custom badge in EditInventoryDialog min stock field"
```

---

## Task 7: Frontend — ImportInventoryDialog passes defaultMinStock

**Files:**
- Modify: `frontend/components/ImportInventoryDialog.tsx`

- [ ] **Step 1: Import `useSettings`**

Add to the imports at the top:

```typescript
import { useSettings } from "@/lib/settings_context"
```

- [ ] **Step 2: Read `defaultMinStock` inside the component**

Inside `ImportInventoryDialog` (after the existing state declarations), add:

```typescript
    const { defaultMinStock } = useSettings()
```

- [ ] **Step 3: Pass `defaultMinStock` to `api.importInventory`**

Find `handleImport` (around line 107). Change the `api.importInventory` call:

Old:
```typescript
            const data = await api.importInventory(file, mode, fieldMapping, clinicMapping)
```

New:
```typescript
            const data = await api.importInventory(file, mode, fieldMapping, clinicMapping, defaultMinStock)
```

- [ ] **Step 4: Verify in browser**

Open the inventory page, use Import to upload a CSV where some rows have a `Min Stock` value and some don't. Confirm:
- Rows with blank `Min Stock` → product gets `override = false` (shows `(default)` badge in Edit dialog).
- Rows with a numeric `Min Stock` → product gets `override = true` (shows `↺ Use default` link in Edit dialog).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ImportInventoryDialog.tsx
git commit -m "feat: pass defaultMinStock to import endpoint from ImportInventoryDialog"
```
