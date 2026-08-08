# Inventory Rack Location Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-product "Rack Location" free-text field (e.g. `"C2"`, `"H1"`) that frontdesk/pharmacy staff can set on the Edit Item dialog and per-row during invoice creation, and that's shown read-only in the billing search dropdown — without touching CSV export/import, bill printing, or invoice history.

**Architecture:** One new nullable `VARCHAR(50)` column (`rack_location`) on `ProductMaster`, threaded through four existing endpoints (list, search, update, save_invoice) and four existing frontend surfaces (Edit dialog, billing search dropdown, invoice-edit table rows). No new files, no new endpoints — every change is an addition to code that already exists and already does the equivalent thing for a sibling field (`formula`, `category`, `hsn_code`).

**Tech Stack:** Flask + SQLAlchemy 2.0 (backend), Next.js 16 App Router + TypeScript + shadcn/ui (frontend). No test suite exists for this project — verification is manual via a throwaway backend/frontend pair, curl, and Playwright, per `CLAUDE.md`.

## Global Constraints

- Field name is **`rack_location`** everywhere (DB column, JSON keys, TS interface fields) — never `location`, to avoid colliding with the existing clinic-branch `Location` feature (per the approved spec's naming note).
- UI label is **"Rack Location"** (or "Rack" where column width is tight).
- Must NOT appear in: `export_inventory`, `export_inventory_edit`, `parse_import_headers`, `import_inventory`, `export_invoice`, `InvoicePrint.tsx`, `PrintInvoiceDialog.tsx`, or `/inventory/history/[id]`.
- Must NOT be added as a column in the main Inventory table's visible-columns toggle list.
- On `save_invoice`, a blank/omitted `rack_location` on a row must never clear an existing value on a matched product (only a non-empty value overwrites).

Spec: `docs/superpowers/specs/2026-08-08-inventory-rack-location-design.md`

---

### Task 1: Data model + migration

**Files:**
- Modify: `Backend_db/models.py` (`ProductMaster` class, ~line 78)
- Modify: `Backend_db/app.py` (`_apply_migrations`, ~line 65)

**Interfaces:**
- Produces: `ProductMaster.rack_location` — `db.Column(db.String(50), nullable=True)`, accessed as a plain string attribute (`None` or `str`) by every later task.

- [ ] **Step 1: Add the column to the model**

In `Backend_db/models.py`, inside the `ProductMaster` class, right after the `formula` column (line 78):

```python
    # NOTE: New column — run ALTER TABLE product_master ADD COLUMN formula TEXT; in production
    formula = db.Column(db.Text, nullable=True)
    # Physical rack/shelf position (e.g. "C2", "H1") — NOT the clinic-branch Location.
    rack_location = db.Column(db.String(50), nullable=True)
    created_by_user_id = db.Column(db.String(36), nullable=True)
```

- [ ] **Step 2: Add the migration statement**

In `Backend_db/app.py`, append to the `stmts` list in `_apply_migrations` (right after the walk-in bills entry, line 64):

```python
        "ALTER TABLE bills ADD COLUMN IF NOT EXISTS walk_in_name VARCHAR(100)",
        # 2026-08-08: rack/shelf location string on product_master (distinct from clinic Location)
        "ALTER TABLE product_master ADD COLUMN IF NOT EXISTS rack_location VARCHAR(50)",
    ]
```

- [ ] **Step 3: Verify the backend still imports cleanly**

Run: `cd Backend_db && python3 -c "import ast; ast.parse(open('models.py').read()); ast.parse(open('app.py').read())"`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add Backend_db/models.py Backend_db/app.py
git commit -m "feat: add rack_location column to ProductMaster"
```

---

### Task 2: Backend endpoint changes

**Files:**
- Modify: `Backend_db/routes/inventory.py` — `get_inventory` (~line 152), `search_inventory` (~line 812), `update_inventory_item` (~line 544), `save_invoice` (~line 1719)

**Interfaces:**
- Consumes: `ProductMaster.rack_location` from Task 1.
- Produces: `rack_location` key present in the JSON of `GET /api/inventory` and `GET /api/inventory/search` responses; `PUT /api/inventory/<id>` accepts and persists `rack_location`; `POST /api/inventory/save_invoice` accepts `rack_location` per row in `product_details` and persists it on the matched/created `ProductMaster`.

- [ ] **Step 1: Include `rack_location` in `GET /api/inventory`**

In `Backend_db/routes/inventory.py`, in `get_inventory`'s result-building loop (~line 152-171), add the field to the appended dict, right after `formula`:

```python
            'formula': item.formula,
            'rack_location': item.rack_location,
            'min_stock_override': item.min_stock_override if item.min_stock_override is not None else False,
```

- [ ] **Step 2: Include `rack_location` in `GET /api/inventory/search`**

In the same file, in the `search_inventory` result-building loop (~line 812-823), add it to the appended dict, right after `formula`:

```python
        results.append({
            'id': item.id,
            'item_name': item.item_name,
            'manufacturer': item.manufacturer,
            'gst_rate': float(item.gst_rate) if item.gst_rate else 0,
            'vendors': vendors_map.get(item.id, []),
            'formula': item.formula,
            'rack_location': item.rack_location,
            'total_qty': total_qty,
            'price': float(max_mrp),
            'pack_size': item.pack_size,
            'substitutes': []
        })
```

- [ ] **Step 3: Accept `rack_location` on `PUT /api/inventory/<id>`**

In `update_inventory_item` (~line 544), right after the existing `manufacturer` block and before the `gst_rate` block (~line 592-600):

```python
    if 'manufacturer' in data:
        if item.manufacturer != data['manufacturer']:
            changed_fields.append('manufacturer')
        item.manufacturer = data['manufacturer']
    if 'rack_location' in data:
        new_rack = data['rack_location']
        if item.rack_location != new_rack:
            changed_fields.append('rack_location')
        item.rack_location = new_rack
    if 'gst_rate' in data:
```

- [ ] **Step 4: Accept and persist `rack_location` on `POST /api/inventory/save_invoice`**

In `save_invoice`'s row loop (~line 1719-1770), extract the value alongside `p_formula`:

```python
            p_hsn    = p.get('hsn') or p.get('hsn_code') or ''
            p_formula = (p.get('formula') or '').strip()
            p_rack   = (p.get('rack_location') or '').strip()
```

Then, in the "new item" branch, pass it through to the constructor (right after `formula`):

```python
            if not item:
                item = ProductMaster(
                    id=ProductMaster.generate_item_id(),
                    item_name=p_name,
                    category='',
                    manufacturer=p_mfg,
                    pack_size=str(p_pack),
                    hsn_code=str(p_hsn),
                    formula=p_formula if p_formula else None,
                    rack_location=p_rack if p_rack else None,
                    min_stock_override=False,
                )
                db.session.add(item)
                db.session.flush()
            else:
                if p_mfg and not item.manufacturer:
                    item.manufacturer = p_mfg
                if p_hsn and not item.hsn_code:
                    item.hsn_code = p_hsn
                if p_formula:
                    item.formula = p_formula
                if p_rack:
                    item.rack_location = p_rack
```

- [ ] **Step 5: Verify the file parses**

Run: `cd Backend_db && python3 -c "import ast; ast.parse(open('routes/inventory.py').read())"`
Expected: no output, exit code 0.

- [ ] **Step 6: Manual verification with a throwaway backend**

```bash
cd Backend_db
PORT=5050 python app.py &
sleep 3
curl -s -X GET http://localhost:5050/api/inventory -H "Cookie: auth_token=<test-jwt>" | python3 -c "import json,sys; d=json.load(sys.stdin); print('rack_location' in d[0] if d else 'no items')"
```
Expected: `True` (or `no items` on an empty DB — acceptable, means the key would still be present per-row once rows exist; re-run against a known product if the DB is empty). Kill the throwaway server afterward (`kill %1`).

- [ ] **Step 7: Commit**

```bash
git add Backend_db/routes/inventory.py
git commit -m "feat: expose and persist rack_location in inventory list/search/update/save_invoice endpoints"
```

---

### Task 3: Frontend API client types

**Files:**
- Modify: `frontend/lib/api.ts` — `InventoryItem` interface (~line 52), `InventorySearchResult` interface (~line 86)

**Interfaces:**
- Consumes: nothing new (mirrors backend JSON shape from Task 2).
- Produces: `InventoryItem.rack_location?: string` and `InventorySearchResult.rack_location?: string`, consumed by Tasks 4, 5, 6.

- [ ] **Step 1: Add `rack_location` to `InventoryItem`**

In `frontend/lib/api.ts`, in the `InventoryItem` interface (~line 52-72), add after `formula`:

```ts
export interface InventoryItem {
    id: string;
    item_name: string;
    category: string;
    quantity: number;
    price: number;
    min_price?: number;
    max_price?: number;
    min_stock_level: number;
    min_stock_override: boolean;
    total_value: number;
    manufacturer?: string;
    vendors?: string[];
    expiry_date?: string;
    status: string[];
    pack_size?: string;
    hsn_code?: string;
    gst_rate?: number;
    formula?: string;
    rack_location?: string;
}
```

- [ ] **Step 2: Add `rack_location` to `InventorySearchResult`**

In the same file, in the `InventorySearchResult` interface (~line 86-98):

```ts
export interface InventorySearchResult {
    id: string;
    item_name: string;
    manufacturer?: string;
    dosage: string;
    gst_rate: number;
    vendors?: string[];
    formula?: string | null;
    rack_location?: string | null;
    total_qty: number;
    price: number;
    pack_size?: string;
    substitutes: any[];
}
```

(`updateInventoryItem`'s signature is already `Partial<InventoryItem>`, and `saveInvoice`'s payload type is already `any` — both automatically accept `rack_location` once it's on `InventoryItem`/passed by the caller, so no further signature changes are needed here.)

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors (pre-existing errors, if any, are unrelated — confirm none mention `rack_location`, `InventoryItem`, or `InventorySearchResult`).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add rack_location to InventoryItem and InventorySearchResult types"
```

---

### Task 4: Edit Item dialog

**Files:**
- Modify: `frontend/components/EditInventoryDialog.tsx`

**Interfaces:**
- Consumes: `InventoryItem.rack_location` (Task 3), `api.updateInventoryItem` (existing, `Partial<InventoryItem>`).
- Produces: nothing consumed by later tasks — this is a leaf UI surface.

- [ ] **Step 1: Add `rack_location` to `formData` state initialization**

In `frontend/components/EditInventoryDialog.tsx`, the initial `useState` (~line 71-81):

```ts
    const [formData, setFormData] = useState({
        item_name: item.item_name,
        manufacturer: item.manufacturer || '',
        category: item.category,
        min_stock_level: item.min_stock_level,
        hsn_code: item.hsn_code || '',
        gst_rate: item.gst_rate || 5,
        vendors: (item.vendors || []).join(', '),
        pack_size: item.pack_size || '',
        formula: item.formula || '',
        rack_location: item.rack_location || ''
    })
```

- [ ] **Step 2: Reset `rack_location` when the dialog reopens**

In the `useEffect` that resyncs `formData` on open (~line 83-98), mirror the same addition:

```ts
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
                formula: item.formula || '',
                rack_location: item.rack_location || ''
            })
            setIsCustomMinStock(item.min_stock_override ?? true)
        }
    }, [open, item])
```

- [ ] **Step 3: Add the input field to the form**

Right after the "Formula" field block (~line 249-258), add:

```tsx
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="formula" className="text-right">Formula</Label>
                                <Input
                                    id="formula"
                                    value={formData.formula}
                                    onChange={(e) => setFormData({ ...formData, formula: e.target.value })}
                                    className="col-span-3"
                                    placeholder="Active chemical formula"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="rack_location" className="text-right">Rack Location</Label>
                                <Input
                                    id="rack_location"
                                    value={formData.rack_location}
                                    onChange={(e) => setFormData({ ...formData, rack_location: e.target.value })}
                                    className="col-span-3"
                                    placeholder="e.g. C2, H1"
                                />
                            </div>
```

(`handleSubmit` already spreads `...formData` into the payload sent to `api.updateInventoryItem`, so `rack_location` flows through automatically — no change needed there.)

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/EditInventoryDialog.tsx
git commit -m "feat: add Rack Location field to Edit Item dialog"
```

---

### Task 5: Billing search dropdown display

**Files:**
- Modify: `frontend/app/billing/page.tsx`

**Interfaces:**
- Consumes: `InventorySearchResult.rack_location` (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add a rack-location badge to the search result row**

In `frontend/app/billing/page.tsx`, in the `searchResults.map(...)` block (~line 446-478), add a badge under the vendor/formula line:

```tsx
                                                    <div className="text-xs text-muted-foreground">
                                                        {item.vendors && item.vendors.length > 0 ? item.vendors.join(', ') : 'No vendor'} | {item.formula || 'No formula'}
                                                    </div>
                                                    {item.rack_location && (
                                                        <div className="mt-1">
                                                            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 rounded px-1.5 py-0.5">
                                                                📍 {item.rack_location}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {item.substitutes && item.substitutes.length > 0 && (
```

(This is display-only — `addToBill(item)` on the row's `onClick` is unchanged, and `BillItem` never gains a `rack_location` field, so it can never reach `PrintInvoiceDialog`/`InvoicePrint`.)

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/billing/page.tsx
git commit -m "feat: show rack location badge in billing item search dropdown"
```

---

### Task 6: Invoice creation rows

**Files:**
- Modify: `frontend/app/inventory/invoice_edit/page.tsx`

**Interfaces:**
- Consumes: `InventoryItem.rack_location` (Task 3).
- Produces: `ProductRow.rack_location: string`, sent as `rack_location` inside each `product_details` row to `POST /api/inventory/save_invoice` (consumed by Task 2 Step 4).

- [ ] **Step 1: Add `rack_location` to the `ProductRow` interface**

In `frontend/app/inventory/invoice_edit/page.tsx` (~line 21-40):

```ts
interface ProductRow {
    matched_id?: string
    product_name: string
    batch: string
    expiry: string
    mrp: string
    rate: string
    qty: string
    free: string
    mfg: string
    pack: string
    company?: string
    hsn: string
    gst: string
    category: string
    formula: string
    rack_location: string
    match_type?: 'exact' | 'partial'
}
```

- [ ] **Step 2: Initialize `rack_location` on the manual-entry default row**

In the `isManual` branch of the load effect (~line 92):

```ts
                setRows([{ product_name: "", batch: "", expiry: "", mrp: "", rate: "", qty: "", free: "0", mfg: "", pack: "", hsn: "", gst: "", category: "Medicine", formula: "", rack_location: "" }])
```

- [ ] **Step 3: Map `rack_location` when restoring a saved session**

In the `sessionStorage` restore block (~line 107-123):

```ts
                    const products = (data.product_details || []).map((p: any) => ({
                        product_name: p.product_name || "",
                        batch: p.batch || "",
                        expiry: p.expiry || "",
                        mrp: p.mrp || "",
                        rate: p.rate || "",
                        qty: p.qty || "",
                        free: p.free || "0",
                        mfg: p.mfg || "",
                        pack: p.pack || "",
                        hsn: p.hsn || "",
                        gst: p.gst || "",
                        category: p.category || "Medicine",
                        formula: p.formula || "",
                        rack_location: p.rack_location || ""
                    }))
```

- [ ] **Step 4: Prefill `rack_location` in the auto-match effect**

In the auto-match `useEffect` (~line 160-187), add to the matched-row spread:

```ts
                if (match) {
                    return {
                        ...row,
                        matched_id: match.item.id,
                        match_type: match.type,
                        product_name: match.type === 'exact' ? match.item.item_name : row.product_name,
                        category: match.item.category || row.category,
                        mfg: match.item.manufacturer || row.mfg,
                        pack: match.item.pack_size || row.pack,
                        hsn: match.item.hsn_code || row.hsn,
                        formula: match.item.formula || row.formula,
                        rack_location: match.item.rack_location || row.rack_location,
                        gst: match.item.gst_rate != null ? match.item.gst_rate.toString() : row.gst
                    }
                }
```

- [ ] **Step 5: Prefill `rack_location` in `selectProduct`**

In `selectProduct` (~line 237-256):

```ts
    const selectProduct = (index: number, item: InventoryItem) => {
        setRows(prev => {
            const newRows = [...prev]
            newRows[index] = {
                ...newRows[index],
                product_name: item.item_name,
                mfg: item.manufacturer || "",
                category: item.category || "Medicine",
                pack: item.pack_size || "",
                hsn: item.hsn_code || "",
                formula: item.formula || "",
                rack_location: item.rack_location || "",
                gst: item.gst_rate != null ? item.gst_rate.toString() : "",
                mrp: item.price != null ? item.price.toString() : newRows[index].mrp,
                matched_id: item.id,
                match_type: 'exact'
            }
            return newRows
        })
```

- [ ] **Step 6: Initialize `rack_location` in `addRow`**

```ts
    const addRow = () => {
        setRows([...rows, { product_name: "", batch: "", expiry: "", mrp: "", rate: "", qty: "", free: "0", mfg: "", pack: "", hsn: "", gst: "", category: "Medicine", formula: "", rack_location: "" }])
    }
```

- [ ] **Step 7: Add a "Rack" column to the desktop table**

In the `TableHeader` (~line 412-429), add a header after "Formula":

```tsx
                                <TableHead className="px-2 py-1.5">Formula</TableHead>
                                <TableHead className="px-2 py-1.5">Rack</TableHead>
                                <TableHead className="w-[50px] px-2 py-1.5"></TableHead>
```

In the row rendering (~line 458), add the matching cell right after the Formula `TableCell`:

```tsx
                                    <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" placeholder="e.g. Tab 500mg" value={row.formula} onChange={e => updateRow(i, 'formula', e.target.value)} /></TableCell>
                                    <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" placeholder="e.g. C2, H1" value={row.rack_location} onChange={e => updateRow(i, 'rack_location', e.target.value)} /></TableCell>
                                    <TableCell className="text-center">
```

- [ ] **Step 8: Add a "Rack Location" field to the mobile card view**

In the mobile view's Qty/Formula grid (~line 533-542):

```tsx
                            <div className="grid grid-cols-2 gap-3 p-2 bg-muted/20 rounded">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-muted-foreground">Qty</label>
                                    <Input className="h-9 bg-background" value={row.qty} onChange={e => updateRow(i, 'qty', e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">Formula</label>
                                    <Input className="h-9" placeholder="e.g. Tab 500mg" value={row.formula} onChange={e => updateRow(i, 'formula', e.target.value)} />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">Rack Location</label>
                                    <Input className="h-9" placeholder="e.g. C2, H1" value={row.rack_location} onChange={e => updateRow(i, 'rack_location', e.target.value)} />
                                </div>
                            </div>
```

(The `handleSave` payload already does `product_details: rows`, so `rack_location` flows through to `saveInvoice` automatically — no change needed there.)

- [ ] **Step 9: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/app/inventory/invoice_edit/page.tsx
git commit -m "feat: add editable Rack Location column to invoice creation rows"
```

---

### Task 7: End-to-end verification and docs

**Files:**
- Modify: `CLAUDE.md` (Recent Changes / Notes section)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: nothing (terminal task).

- [ ] **Step 1: Start a throwaway backend and frontend**

```bash
cd Backend_db && PORT=5050 python app.py &
cd frontend && npm run dev -- -p 3001 &
sleep 5
```

- [ ] **Step 2: Verify the Edit Item dialog round-trips `rack_location`**

Using Playwright (with a JWT test cookie minted via `dev-jwt-secret-change-in-production` and injected via `page.context().addCookies(...)`, per project convention): navigate to `http://localhost:3001/inventory`, open the Edit dialog on any item, set Rack Location to `TEST-C2`, save, reopen the dialog, and confirm the field still shows `TEST-C2`.

- [ ] **Step 3: Verify the billing search dropdown shows the badge**

Navigate to `http://localhost:3001/billing`, search for the same item by name, and confirm the `📍 TEST-C2` badge renders in the dropdown row.

- [ ] **Step 4: Verify invoice creation prefill and overwrite behavior**

Navigate to `http://localhost:3001/inventory/invoice_edit?manual=true`, type the same item's name into the Product Name autocomplete and select it, and confirm the Rack column prefills `TEST-C2`. Change it to `TEST-H1`, fill the remaining required fields (batch, qty, mrp), attach any image, and save. Reload `/inventory`, reopen the Edit dialog on that item, and confirm Rack Location now reads `TEST-H1` (proving the always-overwrite rule from the spec).

- [ ] **Step 5: Verify exclusion from CSV, bill print, and invoice history**

```bash
curl -s "http://localhost:5050/api/inventory/export" -H "Cookie: auth_token=<test-jwt>" | head -1
curl -s "http://localhost:5050/api/inventory/export/edit?scope=all" -H "Cookie: auth_token=<test-jwt>" | head -1
```
Expected: neither header row contains `Rack Location` or `rack_location`. Then, from the Billing page, add the test item to a bill and open the print preview — confirm no rack location text appears anywhere in the invoice layout. Finally open `/inventory/history/<any-invoice-id>` and confirm no rack location column appears in the line-items table.

- [ ] **Step 6: Clean up**

Kill both throwaway servers (`kill %1 %2` or equivalent), delete any `.playwright-mcp/` screenshots taken during verification, and revert the test item's Rack Location back to blank (or delete the test row if one was created) so no test data is left in the dev DB.

- [ ] **Step 7: Update CLAUDE.md**

Add a new bullet at the top of "Recent Changes / Notes" in `CLAUDE.md`:

```markdown
- **Inventory Rack Location Field (2026-08-08):** Added `rack_location` (nullable `VARCHAR(50)`) to
  `ProductMaster` — a free-text physical rack/shelf position (e.g. "C2", "H1"), distinct from the
  clinic-branch `Location` model. Editable in the Edit Item dialog (`EditInventoryDialog.tsx`) and
  per-row during invoice creation (`/inventory/invoice_edit`, always overwrites the saved value when
  a non-empty value is provided, mirroring the existing `formula` field's behavior). Shown read-only
  as a badge in the billing page's item search dropdown so frontdesk can locate stock while building
  a bill. Deliberately excluded from CSV export/import, bill printing (`InvoicePrint.tsx`), invoice
  history (`/inventory/history/[id]`), and the main Inventory table's visible-columns list. Design
  doc: `docs/superpowers/specs/2026-08-08-inventory-rack-location-design.md`.
```

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the new inventory Rack Location field"
```

---

## Plan Self-Review

**Spec coverage:**
- Naming (`rack_location`, never `location`) — enforced in Global Constraints and every task's code. ✅
- DB column + migration — Task 1. ✅
- `GET /inventory`, `GET /inventory/search`, `PUT /inventory/<id>`, `POST /save_invoice` — Task 2. ✅
- `InventoryItem`/`InventorySearchResult` types — Task 3. ✅
- Edit Item dialog — Task 4. ✅
- Billing search display (read-only) — Task 5. ✅
- Invoice creation rows (prefill + editable + always-overwrite on save) — Task 6. ✅
- Exclusion from CSV, bill print, invoice history, main table columns — verified explicitly in Task 7 Step 5, and no task touches those files. ✅
- Manual verification approach (no test suite) — Task 7. ✅
- CLAUDE.md doc update — Task 7 Step 7. ✅

No gaps found. No placeholders. Field names (`rack_location`, `ProductRow.rack_location`, `InventoryItem.rack_location`) are consistent across all seven tasks.
