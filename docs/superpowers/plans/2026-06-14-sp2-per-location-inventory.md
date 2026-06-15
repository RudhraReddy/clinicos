# SP2 — Per-Location Inventory + Export/Import Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track inventory stock per clinic (each `InventoryBatch` tagged with a `location_id`), add a location switcher to the inventory page, and replace the single export button with a two-option popup. The "Edit Inventory" export produces a one-row-per-product CSV with dynamic per-clinic qty columns. The import dialog gains a column-mapping step for unrecognised headers.

**Architecture:** New backend routes `GET /api/inventory/export/edit` and `POST /api/inventory/import/parse-headers`. Updated `POST /api/inventory/import` accepts an optional `field_mapping` and `clinic_mapping` JSON. Frontend inventory page gets a location pill-switcher, a two-option export dialog, and an updated `ImportInventoryDialog` with a mapping step.

**Prerequisites:** SP1 must be complete. `InventoryBatch.location_id` FK column already exists from SP1.

**Tech Stack:** Flask/SQLAlchemy, Python csv module, Next.js 16, TypeScript, shadcn/ui, Tailwind CSS 4

> **No test suite** — verify with curl and browser. Start both dev servers before beginning.

---

### Task 1: Add the "Edit Inventory" export route

**Files:**
- Modify: `Backend_db/routes/inventory.py`

The Edit Inventory export produces one row per product. Qty columns are one per active Location. If `scope=<location_id>` is passed only that clinic's qty column is included.

- [ ] **Step 1: Add the route** — insert after the existing `export_inventory` function (around line 1169):

```python
@inventory.route('/inventory/export/edit', methods=['GET'])
@require_auth
def export_inventory_edit():
    from models import Location
    scope = request.args.get('scope', 'all')  # 'all' or a location_id integer string

    # Determine which locations to include as qty columns
    if scope == 'all':
        active_locs = Location.query.filter_by(is_active=True).order_by(Location.name).all()
    else:
        try:
            loc = db.session.get(Location, int(scope))
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid scope'}), 400
        if not loc:
            return jsonify({'error': 'Location not found'}), 404
        active_locs = [loc]

    output = io.StringIO()
    writer = csv.writer(output)

    # Header row: fixed fields + one qty column per location
    loc_headers = [l.name for l in active_locs]
    writer.writerow([
        'Product ID', 'Item Name', 'Pack Size', 'Formula',
        'Category', 'Manufacturer', 'MRP', 'Expiry Date',
    ] + loc_headers)

    products = ProductMaster.query.order_by(ProductMaster.item_name).all()

    for product in products:
        # Aggregate per-location qty
        loc_qtys = []
        overall_mrp = 0.0
        earliest_expiry = None

        for loc in active_locs:
            batches = InventoryBatch.query.filter_by(
                product_id=product.id,
                location_id=loc.id,
            ).filter(InventoryBatch.quantity > 0).all()

            loc_qty = sum(float(b.quantity or 0) for b in batches)
            loc_qtys.append(int(loc_qty))

            for b in batches:
                if b.mrp and float(b.mrp) > overall_mrp:
                    overall_mrp = float(b.mrp)
                if b.expiry_date:
                    if earliest_expiry is None or b.expiry_date < earliest_expiry:
                        earliest_expiry = b.expiry_date

        # Also aggregate across untagged batches (location_id IS NULL) for 'all' scope
        if scope == 'all':
            untagged = InventoryBatch.query.filter_by(
                product_id=product.id,
                location_id=None,
            ).filter(InventoryBatch.quantity > 0).all()
            if untagged and len(active_locs) > 0:
                # Distribute untagged qty to a synthetic "(Unassigned)" column — skip for now,
                # untagged stock appears as 0 in all per-location columns.
                for b in untagged:
                    if b.mrp and float(b.mrp) > overall_mrp:
                        overall_mrp = float(b.mrp)
                    if b.expiry_date:
                        if earliest_expiry is None or b.expiry_date < earliest_expiry:
                            earliest_expiry = b.expiry_date

        expiry_str = earliest_expiry.strftime('%m/%y') if earliest_expiry else ''
        mrp_str = f"{overall_mrp:.2f}" if overall_mrp else ''

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

    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'inventory_edit_{get_ist_now().strftime("%Y%m%d")}.csv'
    )
```

- [ ] **Step 2: Verify the route**

```bash
# First create at least one location (SP1 Task 2) and restart backend, then:
curl -s "http://localhost:5000/api/inventory/export/edit?scope=all" \
  -b "auth_token=<YOUR_TOKEN>" -o /tmp/edit_export.csv
cat /tmp/edit_export.csv
# Expected: CSV with Product ID, Item Name, Pack Size, Formula, Category, Manufacturer, MRP, Expiry Date, [Location Name]...
# Each product is ONE row (not one row per batch)
# Zero-stock products included with 0 in qty columns

# Scope to one location (use actual location id)
curl -s "http://localhost:5000/api/inventory/export/edit?scope=1" \
  -b "auth_token=<YOUR_TOKEN>" -o /tmp/edit_loc1.csv
cat /tmp/edit_loc1.csv
# Expected: same format but only one clinic qty column
```

- [ ] **Step 3: Commit**

```bash
git add Backend_db/routes/inventory.py
git commit -m "feat: add Edit Inventory export route with per-location qty columns"
```

---

### Task 2: Add the parse-headers route

**Files:**
- Modify: `Backend_db/routes/inventory.py`

This route inspects a CSV file's headers and classifies each one as a known field, a known clinic (matching a Location name), or unknown. It does not import any data.

- [ ] **Step 1: Add the route** — insert after the edit export route:

```python
KNOWN_IMPORT_FIELDS = {
    'product id', 'item name', 'pack size', 'formula', 'category',
    'manufacturer', 'mrp', 'expiry date', 'manufacture date',
    'quantity', 'batch number', 'purchase rate', 'batch gst rate',
    'product gst rate', 'hsn code', 'min stock', 'generic tags',
    'initial quantity', 'free quantity', 'gst amount',
}

@inventory.route('/inventory/import/parse-headers', methods=['POST'])
@require_auth
def parse_import_headers():
    from models import Location
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    file = request.files['file']
    try:
        stream = io.StringIO(file.stream.read().decode('UTF8'), newline=None)
        reader = csv.DictReader(stream)
        headers = list(reader.fieldnames or [])
    except Exception as e:
        return jsonify({'error': f'Could not read file: {e}'}), 400

    if not headers:
        return jsonify({'error': 'Empty or unreadable CSV'}), 400

    location_names = {l.name.lower(): l.name for l in Location.query.filter_by(is_active=True).all()}

    known_fields = []
    known_clinics = []   # headers that exactly match an active Location name
    unknown = []         # headers that match neither

    for h in headers:
        h_lower = h.strip().lower()
        if h_lower in KNOWN_IMPORT_FIELDS:
            known_fields.append(h)
        elif h_lower in location_names:
            known_clinics.append({'header': h, 'location_name': location_names[h_lower]})
        else:
            unknown.append(h)

    return jsonify({
        'headers': headers,
        'known_fields': known_fields,
        'known_clinics': known_clinics,
        'unknown': unknown,
        'needs_mapping': len(unknown) > 0,
    })
```

- [ ] **Step 2: Verify**

```bash
# Create a small test CSV
echo "Product ID,Item Name,Pack Size,MyClinic,SomeUnknown" > /tmp/test_import.csv
echo "A1B2C3,Paracetamol,10s,50,0" >> /tmp/test_import.csv

curl -s -X POST http://localhost:5000/api/inventory/import/parse-headers \
  -b "auth_token=<YOUR_TOKEN>" \
  -F "file=@/tmp/test_import.csv" | python3 -m json.tool

# Expected:
# {
#   "headers": ["Product ID", "Item Name", "Pack Size", "MyClinic", "SomeUnknown"],
#   "known_fields": ["Product ID", "Item Name", "Pack Size"],
#   "known_clinics": [{"header": "MyClinic", "location_name": "MyClinic"}],  (if location exists)
#   "unknown": ["SomeUnknown"],
#   "needs_mapping": true
# }
```

- [ ] **Step 3: Commit**

```bash
git add Backend_db/routes/inventory.py
git commit -m "feat: add parse-headers route for import column mapping"
```

---

### Task 3: Update import route to handle location_id and mapping JSON

**Files:**
- Modify: `Backend_db/routes/inventory.py`

The import route now accepts two optional JSON fields in the multipart body:
- `field_mapping` — JSON object: `{"Unknown Col": "Item Name"}` — remaps column names
- `clinic_mapping` — JSON object: `{"OldClinicName": "1"}` — maps column names to location IDs

When a row has a clinic qty column, the batch is created with that `location_id` instead of null.

- [ ] **Step 1: Update the import route** — find `def import_inventory()` (around line 1207) and add mapping support at the start of the function, immediately after the `mode` extraction line:

```python
    mode = request.form.get('mode', 'update')

    # Optional column remapping passed as JSON strings in the form body
    import json as _json
    try:
        field_mapping = _json.loads(request.form.get('field_mapping', '{}') or '{}')
    except Exception:
        field_mapping = {}
    try:
        clinic_mapping = _json.loads(request.form.get('clinic_mapping', '{}') or '{}')
        # clinic_mapping: {"Column Header": location_id_int}
        clinic_mapping = {k: int(v) for k, v in clinic_mapping.items()}
    except Exception:
        clinic_mapping = {}
```

- [ ] **Step 2: Apply field_mapping before the existing DictReader processing** — after `csv_input = csv.DictReader(stream)`, add a step that renames headers according to `field_mapping`:

```python
        csv_input = csv.DictReader(stream)

        # Apply field remapping: rename columns before processing
        if field_mapping and csv_input.fieldnames:
            csv_input.fieldnames = [
                field_mapping.get(h, h) for h in csv_input.fieldnames
            ]
```

- [ ] **Step 3: Detect clinic columns and process per-location qty** — update the `for row in csv_input:` loop. After the existing `if qty <= 0 and mode == 'update': continue` check (around line 1316), add logic to also process clinic columns:

First, before the loop, build the set of clinic column names from the known_clinics plus clinic_mapping:

```python
        # Build clinic column → location_id map for this import session
        from models import Location as _Location
        loc_name_to_id = {l.name: l.id for l in _Location.query.filter_by(is_active=True).all()}
        # clinic_mapping overrides (for remapped columns)
        # clinic_cols: {column_header: location_id}
        clinic_cols = {}
        if csv_input.fieldnames:
            for h in csv_input.fieldnames:
                if h in clinic_mapping:
                    clinic_cols[h] = clinic_mapping[h]
                elif h in loc_name_to_id:
                    clinic_cols[h] = loc_name_to_id[h]
```

Then, in the row loop, after creating/updating the product master, iterate clinic columns and create batches per location. Add this block **after** the existing product creation/update logic and **before** the existing single-batch creation logic:

```python
            # ── Per-clinic qty columns ──────────────────────────────────────────
            has_clinic_cols = any(h in clinic_cols for h in (row.keys() if hasattr(row, 'keys') else []))

            if has_clinic_cols:
                for col_header, location_id in clinic_cols.items():
                    if col_header not in row:
                        continue
                    try:
                        col_qty = int(float(row[col_header] or 0))
                    except (ValueError, TypeError):
                        col_qty = 0

                    if col_qty <= 0 and mode == 'update':
                        continue

                    existing_batch = None
                    if batch_num and expiry_date:
                        existing_batch = InventoryBatch.query.filter_by(
                            product_id=item.id,
                            batch_number=batch_num,
                            expiry_date=expiry_date,
                            location_id=location_id,
                        ).first()
                    elif batch_num:
                        existing_batch = InventoryBatch.query.filter_by(
                            product_id=item.id,
                            batch_number=batch_num,
                            location_id=location_id,
                        ).first()

                    if existing_batch:
                        diff = col_qty - float(existing_batch.quantity)
                        if abs(diff) >= 0.01:
                            existing_batch.quantity = col_qty
                            db.session.add(InventoryHistory(
                                product_id=item.id,
                                batch_id=existing_batch.id,
                                change_amount=diff,
                                type='ADJUSTMENT',
                                notes=f'CSV Import {mode.capitalize()} — location batch update',
                                purchase_invoice_number=import_id,
                                user_id=g.current_user.get('user_id'),
                                username=g.current_user.get('username'),
                            ))
                            total_import_value += abs(diff) * mrp
                    elif mode == 'overwrite':
                        current_loc_qty = float(
                            db.session.query(func.sum(InventoryBatch.quantity))
                            .filter_by(product_id=item.id, location_id=location_id)
                            .scalar() or 0
                        )
                        diff = col_qty - current_loc_qty
                        if diff > 0:
                            batch = InventoryBatch(
                                product_id=item.id,
                                quantity=diff,
                                initial_quantity=diff,
                                mrp=mrp,
                                purchase_rate=rate,
                                gst_rate=gst_rate,
                                expiry_date=expiry_date,
                                purchase_invoice_number=import_id,
                                batch_number=batch_num or 'ADJUST',
                                location_id=location_id,
                            )
                            db.session.add(batch)
                            db.session.flush()
                            db.session.add(InventoryHistory(
                                product_id=item.id,
                                batch_id=batch.id,
                                change_amount=diff,
                                type='PURCHASE',
                                notes=f'CSV Import Overwrite — location {location_id}',
                                purchase_invoice_number=import_id,
                                user_id=g.current_user.get('user_id'),
                                username=g.current_user.get('username'),
                            ))
                            total_import_value += diff * mrp
                        elif diff < 0:
                            # FIFO reduction for overwrite
                            to_remove = abs(diff)
                            fifo_batches = InventoryBatch.query.filter_by(
                                product_id=item.id, location_id=location_id
                            ).filter(InventoryBatch.quantity > 0).order_by(
                                InventoryBatch.expiry_date.asc().nullslast()
                            ).all()
                            for fb in fifo_batches:
                                if to_remove <= 0:
                                    break
                                deduct = min(float(fb.quantity), to_remove)
                                fb.quantity = float(fb.quantity) - deduct
                                to_remove -= deduct
                    else:
                        # update mode — new batch for this location
                        batch = InventoryBatch(
                            product_id=item.id,
                            quantity=col_qty,
                            initial_quantity=col_qty,
                            mrp=mrp,
                            purchase_rate=rate,
                            gst_rate=gst_rate,
                            expiry_date=expiry_date,
                            purchase_invoice_number=import_id,
                            batch_number=batch_num or '',
                            location_id=location_id,
                        )
                        db.session.add(batch)
                        db.session.flush()
                        db.session.add(InventoryHistory(
                            product_id=item.id,
                            batch_id=batch.id,
                            change_amount=col_qty,
                            type='PURCHASE',
                            notes=f'CSV Import Update — location {location_id}',
                            purchase_invoice_number=import_id,
                            user_id=g.current_user.get('user_id'),
                            username=g.current_user.get('username'),
                        ))
                        total_import_value += col_qty * mrp
                    processed_count += 1
                continue  # Skip the generic single-batch logic below when clinic cols handled
```

- [ ] **Step 4: Verify end-to-end import flow**

Export the Edit Inventory CSV, change some qty values in a text editor, then import it back:

```bash
# Export
curl -s "http://localhost:5000/api/inventory/export/edit?scope=1" \
  -b "auth_token=<YOUR_TOKEN>" -o /tmp/edit.csv

# Parse headers (should return needs_mapping: false since location names match)
curl -s -X POST http://localhost:5000/api/inventory/import/parse-headers \
  -b "auth_token=<YOUR_TOKEN>" \
  -F "file=@/tmp/edit.csv" | python3 -m json.tool

# Import it back (update mode, no mapping needed)
curl -s -X POST http://localhost:5000/api/inventory/import \
  -b "auth_token=<YOUR_TOKEN>" \
  -F "file=@/tmp/edit.csv" \
  -F "mode=update" | python3 -m json.tool
# Expected: {"imported": N, "warnings": [], "message": "..."}
```

- [ ] **Step 5: Commit**

```bash
git add Backend_db/routes/inventory.py
git commit -m "feat: update import route to handle per-location qty columns and field/clinic mapping"
```

---

### Task 4: Add api.ts calls for new routes

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add export edit call** — inside the `api` object, replace the existing `exportInventory` function and add alongside it:

```typescript
    exportInventory() {
        window.location.href = `${API_BASE_URL}/api/inventory/export`
    },
    exportInventoryEdit(scope: 'all' | string) {
        window.location.href = `${API_BASE_URL}/api/inventory/export/edit?scope=${encodeURIComponent(scope)}`
    },
```

- [ ] **Step 2: Add parse-headers call** — add after `importInventory`:

```typescript
    async parseImportHeaders(file: File): Promise<{
        headers: string[];
        known_fields: string[];
        known_clinics: { header: string; location_name: string }[];
        unknown: string[];
        needs_mapping: boolean;
    }> {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch(`${API_BASE_URL}/api/inventory/import/parse-headers`, {
            method: 'POST',
            body: formData,
            credentials: 'include',
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.error || 'Failed to parse headers')
        }
        return res.json()
    },
```

- [ ] **Step 3: Update `importInventory` to accept mapping** — update the existing signature and body:

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
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Failed to import')
        return data
    },
```

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add exportInventoryEdit, parseImportHeaders, and updated importInventory to api.ts"
```

---

### Task 5: Add location switcher + export popup to inventory page

**Files:**
- Modify: `frontend/app/inventory/page.tsx`

- [ ] **Step 1: Add location state + fetch** — at the top of the `InventoryPage` component, after the existing state declarations, add:

```typescript
    const [locations, setLocations] = useState<import('@/lib/api').Location[]>([])
    const [activeLocationId, setActiveLocationId] = useState<number | 'all'>('all')
    const [exportDialogOpen, setExportDialogOpen] = useState(false)
    const [exportScope, setExportScope] = useState<'all' | string>('all')

    useEffect(() => {
        api.getLocations().then(locs => setLocations(locs.filter(l => l.is_active))).catch(() => {})
    }, [])
```

- [ ] **Step 2: Pass `activeLocationId` to `loadData`** — update `loadData` to filter by location:

```typescript
    const loadData = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await api.getInventory(expiryReminderMonths, activeLocationId === 'all' ? undefined : activeLocationId)
            setInventory(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load inventory")
        } finally {
            setLoading(false)
        }
    }
```

Update the `useEffect` that calls `loadData` to also depend on `activeLocationId`:

```typescript
    useEffect(() => {
        loadData()
    }, [activeLocationId])
```

> **Note:** `api.getInventory` currently takes `expiryMonths?: number`. Update its signature in `api.ts` to also accept an optional `locationId?: number`:
> ```typescript
> async getInventory(expiryMonths?: number, locationId?: number): Promise<InventoryItem[]> {
>     const params = new URLSearchParams()
>     if (expiryMonths) params.set('expiry_months', expiryMonths.toString())
>     if (locationId) params.set('location_id', locationId.toString())
>     const qs = params.toString() ? `?${params}` : ''
>     return fetchApi(`/api/inventory${qs}`)
> },
> ```
> The backend inventory route already reads `location` as a query param; update it to also read `location_id` and filter `InventoryBatch.location_id` accordingly (see backend step below).

- [ ] **Step 3: Update backend `get_inventory` route to filter by `location_id`** — in `Backend_db/routes/inventory.py`, find `def get_inventory()` and add location_id filtering. After the existing `expiry_months` extraction, add:

```python
    location_id_param = request.args.get('location_id')
    filter_location_id = int(location_id_param) if location_id_param and location_id_param.isdigit() else None
```

Then in the batch aggregation query, if `filter_location_id` is set, add a filter:

```python
    # Existing batch query (find where it filters batches and add):
    if filter_location_id is not None:
        batch_q = batch_q.filter(InventoryBatch.location_id == filter_location_id)
```

The exact lines to modify depend on the current query structure inside `get_inventory`. Read the function carefully and apply `filter(InventoryBatch.location_id == filter_location_id)` to the batch subquery before it aggregates.

- [ ] **Step 4: Add the location switcher UI** — in the JSX, after the opening `<div className="space-y-6">` and the title section, and before the `<Tabs>`, add:

```tsx
            {locations.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                    <button
                        onClick={() => setActiveLocationId('all')}
                        className={cn(
                            "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                            activeLocationId === 'all'
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:bg-muted/80"
                        )}
                    >
                        All Locations
                    </button>
                    {locations.map(loc => (
                        <button
                            key={loc.id}
                            onClick={() => setActiveLocationId(loc.id)}
                            className={cn(
                                "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                                activeLocationId === loc.id
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                            )}
                        >
                            {loc.name}
                        </button>
                    ))}
                </div>
            )}
```

- [ ] **Step 5: Replace the export button with a two-option popup** — find the existing export button (around line 507):

```tsx
                    <Button variant="ghost" size="icon" title="Export CSV" onClick={() => api.exportInventory()}>
                        <Download className="h-4 w-4" />
                    </Button>
```

Replace it with:

```tsx
                    <Button variant="ghost" size="icon" title="Export" onClick={() => setExportDialogOpen(true)}>
                        <Download className="h-4 w-4" />
                    </Button>
```

Then add the export dialog just before the closing `</div>` of the page return, after the existing history Sheet:

```tsx
            {/* Export Dialog */}
            <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Export Inventory</DialogTitle>
                        <DialogDescription>Choose what to export.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <button
                            className="w-full text-left rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                            onClick={() => { api.exportInventory(); setExportDialogOpen(false) }}
                        >
                            <p className="font-semibold text-sm">Total Inventory</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Full batch-level dump with all fields. Use for records or backup.
                            </p>
                        </button>
                        <div className="rounded-lg border p-4 space-y-3">
                            <div>
                                <p className="font-semibold text-sm">Edit Inventory</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    One row per product with per-clinic quantities. Use to adjust stock and re-import.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Select value={exportScope} onValueChange={setExportScope}>
                                    <SelectTrigger className="h-8 flex-1 text-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All clinics</SelectItem>
                                        {locations.map(l => (
                                            <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button size="sm" onClick={() => {
                                    api.exportInventoryEdit(exportScope)
                                    setExportDialogOpen(false)
                                }}>
                                    Download
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
```

Make sure `Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription` are imported from `@/components/ui/dialog`.

- [ ] **Step 6: Verify in browser**

- Open `/inventory`. If locations exist, the pill switcher appears at the top.
- Click "All Locations" — shows combined inventory (or unfiltered).
- Click a specific location — table should refresh showing only that clinic's stock.
- Click Download icon — dialog with two cards appears.
- Click "Total Inventory" — downloads the existing full CSV.
- Select a clinic scope then "Download" under "Edit Inventory" — downloads the new format CSV.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/inventory/page.tsx frontend/lib/api.ts Backend_db/routes/inventory.py
git commit -m "feat: add location switcher and two-option export popup to inventory page"
```

---

### Task 6: Update ImportInventoryDialog with column mapping step

**Files:**
- Modify: `frontend/components/ImportInventoryDialog.tsx`

The dialog now has a 3-step flow: (1) file pick → (2) column mapping if needed → (3) mode select + import.

- [ ] **Step 1: Replace the full component** with the updated version:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Upload, AlertCircle, CheckCircle2 } from "lucide-react"
import { api } from "@/lib/api"

const KNOWN_FIELD_OPTIONS = [
    'Product ID', 'Item Name', 'Pack Size', 'Formula', 'Category',
    'Manufacturer', 'MRP', 'Expiry Date', 'Quantity', 'Batch Number',
    'Purchase Rate', 'Batch GST Rate', 'Product GST Rate', 'HSN Code',
    'Min Stock', 'Generic Tags', 'Initial Quantity', 'Free Quantity',
    'IGNORE',
]

interface ImportInventoryDialogProps {
    onSuccess?: () => void
    trigger?: React.ReactNode
}

type Step = 'pick' | 'mapping' | 'import' | 'done' | 'error'

export function ImportInventoryDialog({ onSuccess, trigger }: ImportInventoryDialogProps) {
    const [open, setOpen] = useState(false)
    const [step, setStep] = useState<Step>('pick')
    const [file, setFile] = useState<File | null>(null)
    const [parsing, setParsing] = useState(false)
    const [parseResult, setParseResult] = useState<{
        unknown: string[]
        known_clinics: { header: string; location_name: string }[]
    } | null>(null)
    const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({})
    const [clinicMapping, setClinicMapping] = useState<Record<string, string>>({})
    const [locations, setLocations] = useState<{ id: number; name: string }[]>([])
    const [mode, setMode] = useState<'update' | 'overwrite'>('update')
    const [submitting, setSubmitting] = useState(false)
    const [result, setResult] = useState<{ message: string } | null>(null)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    const reset = () => {
        setStep('pick')
        setFile(null)
        setParseResult(null)
        setFieldMapping({})
        setClinicMapping({})
        setMode('update')
        setResult(null)
        setErrorMsg(null)
    }

    const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        if (!f) return
        setFile(f)
        setParsing(true)
        setErrorMsg(null)
        try {
            const parsed = await api.parseImportHeaders(f)
            const locs = await api.getLocations()
            setLocations(locs.filter(l => l.is_active))
            if (parsed.needs_mapping || parsed.unknown.length > 0) {
                setParseResult({ unknown: parsed.unknown, known_clinics: parsed.known_clinics })
                // Pre-fill clinic mapping for already-matched clinics
                const cm: Record<string, string> = {}
                parsed.known_clinics.forEach(kc => { /* already matched, no action needed */ })
                setClinicMapping(cm)
                setStep('mapping')
            } else {
                setStep('import')
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'Failed to parse file')
        } finally {
            setParsing(false)
        }
    }

    const handleSubmitMapping = () => {
        // Validate all unknowns are resolved
        const missing = (parseResult?.unknown || []).filter(h => !fieldMapping[h])
        if (missing.length > 0) {
            setErrorMsg(`Please map all unknown columns before continuing. Missing: ${missing.join(', ')}`)
            return
        }
        setErrorMsg(null)
        setStep('import')
    }

    const handleImport = async () => {
        if (!file) return
        setSubmitting(true)
        setErrorMsg(null)
        try {
            // Build final mappings
            const fm: Record<string, string> = {}
            Object.entries(fieldMapping).forEach(([k, v]) => {
                if (v && v !== 'IGNORE') fm[k] = v
            })
            const cm: Record<string, number> = {}
            Object.entries(clinicMapping).forEach(([k, v]) => {
                if (v) cm[k] = parseInt(v)
            })
            const data = await api.importInventory(file, mode, fm, cm)
            setResult({ message: data.message || `Imported successfully.` })
            setStep('done')
            onSuccess?.()
        } catch (err: any) {
            setErrorMsg(err.message || 'Import failed')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={val => { setOpen(val); if (!val) setTimeout(reset, 300) }}>
            {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
            <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-[500px] rounded-lg">

                {step === 'done' && (
                    <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
                        <div className="rounded-full bg-green-100 p-3 dark:bg-green-900/20">
                            <CheckCircle2 className="h-6 w-6 text-green-600" />
                        </div>
                        <DialogTitle>Import Complete</DialogTitle>
                        <DialogDescription>{result?.message}</DialogDescription>
                        <Button onClick={() => setOpen(false)}>Close</Button>
                    </div>
                )}

                {step === 'pick' && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Import Inventory CSV</DialogTitle>
                            <DialogDescription>
                                Upload a CSV to update or overwrite inventory stock.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            {errorMsg && (
                                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 shrink-0" />
                                    {errorMsg}
                                </div>
                            )}
                            <div className="space-y-2">
                                <Label>CSV File</Label>
                                <Input type="file" accept=".csv" onChange={handleFilePick} />
                            </div>
                            {parsing && (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Analysing headers…
                                </div>
                            )}
                        </div>
                    </>
                )}

                {step === 'mapping' && parseResult && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Map Columns</DialogTitle>
                            <DialogDescription>
                                Some columns were not recognised. Tell us what each one is.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                            {errorMsg && (
                                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 shrink-0" />
                                    {errorMsg}
                                </div>
                            )}
                            {parseResult.unknown.length > 0 && (
                                <div className="space-y-3">
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unknown Columns</p>
                                    {parseResult.unknown.map(h => (
                                        <div key={h} className="flex items-center gap-2">
                                            <span className="text-sm font-mono flex-1 truncate" title={h}>{h}</span>
                                            <span className="text-muted-foreground text-xs">→</span>
                                            <Select
                                                value={fieldMapping[h] || ''}
                                                onValueChange={val => setFieldMapping(prev => ({ ...prev, [h]: val }))}
                                            >
                                                <SelectTrigger className="h-8 w-44 text-sm">
                                                    <SelectValue placeholder="Select…" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="IGNORE">Ignore this column</SelectItem>
                                                    <p className="px-2 py-1 text-xs text-muted-foreground font-semibold">Fields</p>
                                                    {KNOWN_FIELD_OPTIONS.filter(o => o !== 'IGNORE').map(o => (
                                                        <SelectItem key={o} value={o}>{o}</SelectItem>
                                                    ))}
                                                    {locations.length > 0 && (
                                                        <>
                                                            <p className="px-2 py-1 text-xs text-muted-foreground font-semibold">Clinics</p>
                                                            {locations.map(l => (
                                                                <SelectItem key={`loc-${l.id}`} value={`__clinic__${l.id}`}>
                                                                    📍 {l.name}
                                                                </SelectItem>
                                                            ))}
                                                        </>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setStep('pick')}>Back</Button>
                            <Button onClick={handleSubmitMapping}>Continue</Button>
                        </DialogFooter>
                    </>
                )}

                {step === 'import' && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Import Inventory CSV</DialogTitle>
                            <DialogDescription>Choose how stock quantities are applied.</DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            {errorMsg && (
                                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 shrink-0" />
                                    {errorMsg}
                                </div>
                            )}
                            <RadioGroup value={mode} onValueChange={(v: any) => setMode(v)}>
                                <div className="flex items-start space-x-2">
                                    <RadioGroupItem value="update" id="update" className="mt-1" />
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="update" className="font-medium">Update (Add to Stock)</Label>
                                        <p className="text-sm text-muted-foreground">Adds quantities to existing stock. Use for restocking.</p>
                                    </div>
                                </div>
                                <div className="flex items-start space-x-2">
                                    <RadioGroupItem value="overwrite" id="overwrite" className="mt-1" />
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="overwrite" className="font-medium">Overwrite (Set Stock)</Label>
                                        <p className="text-sm text-muted-foreground">Sets stock to exactly the CSV values. Adjusts automatically.</p>
                                    </div>
                                </div>
                            </RadioGroup>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setStep(parseResult ? 'mapping' : 'pick')}>Back</Button>
                            <Button onClick={handleImport} disabled={submitting}>
                                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Import
                            </Button>
                        </DialogFooter>
                    </>
                )}

            </DialogContent>
        </Dialog>
    )
}
```

- [ ] **Step 2: Handle clinic mapping from field mapping** — after `handleSubmitMapping`, also build `clinicMapping` from any field mappings that resolved to `__clinic__<id>` values:

Find the `handleSubmitMapping` function in the component above and replace it:

```typescript
    const handleSubmitMapping = () => {
        const missing = (parseResult?.unknown || []).filter(h => !fieldMapping[h])
        if (missing.length > 0) {
            setErrorMsg(`Please map all unknown columns. Missing: ${missing.join(', ')}`)
            return
        }
        // Split out clinic mappings from field mappings
        const cm: Record<string, string> = {}
        const fm: Record<string, string> = {}
        Object.entries(fieldMapping).forEach(([header, val]) => {
            if (val.startsWith('__clinic__')) {
                cm[header] = val.replace('__clinic__', '')
            } else if (val !== 'IGNORE') {
                fm[header] = val
            }
        })
        setClinicMapping(cm)
        setFieldMapping(fm)
        setErrorMsg(null)
        setStep('import')
    }
```

- [ ] **Step 3: Update `handleImport`** — the clinicMapping now already holds `Record<string, string>` (location id as string). The `api.importInventory` call's `clinicMapping` arg expects `Record<string, number>`. Convert it:

```typescript
            const cm: Record<string, number> = {}
            Object.entries(clinicMapping).forEach(([k, v]) => {
                const n = parseInt(v)
                if (!isNaN(n)) cm[k] = n
            })
```

- [ ] **Step 4: Verify in browser**

1. Export an Edit Inventory CSV.
2. Open a copy and rename one location column to something like "Main Branch" (a name that doesn't match any Location).
3. Click Upload icon → pick the file → mapping step should appear with "Main Branch" as unknown.
4. Map it to the correct clinic from the dropdown → Continue → Import.
5. Confirm no errors and stock updates correctly.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ImportInventoryDialog.tsx
git commit -m "feat: add header mapping step to ImportInventoryDialog for unknown columns and clinics"
```

---

**SP2 is complete.** Inventory is now tracked per location, the export button shows two options, and the import dialog handles mismatched column names. Proceed to SP3.
