# SP3 — Location-Based Analytics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded location + staff filters on the Status/Analytics page with a dynamic location dropdown populated from the Locations API. Remove the staff filter entirely. When a location is selected, all KPI cards, charts, and inventory alerts scope to that clinic using `location_id` FK instead of the legacy string `location` field.

**Architecture:** The existing `GET /api/inventory_analytics` route already accepts a `?location=<string>` param and uses a helper `loc_f(query, model)` to apply string-based filtering. We update this to also accept `?location_id=<int>` and filter via `model.location_id == location_id`. The frontend status page replaces the hardcoded `<SelectItem value="Main">` with dynamically fetched location names, and removes the staff `<Select>`.

**Prerequisites:** SP1 must be complete (`location_id` columns exist on all models).

**Tech Stack:** Flask/SQLAlchemy, Next.js 16, TypeScript, shadcn/ui

> **No test suite** — verify with curl and browser. Start both dev servers before beginning.

---

### Task 1: Update the analytics backend to support location_id filtering

**Files:**
- Modify: `Backend_db/routes/inventory.py`

The analytics route is `GET /api/inventory_analytics` (note: the URL has an underscore, not a slash). It lives around line 548. It already has a `loc` variable from `request.args.get('location')` and a `loc_f` helper.

- [ ] **Step 1: Read the `get_analytics` function** — open `Backend_db/routes/inventory.py` around line 548 and read through the full function to understand its structure before editing. Key parts:
  - `loc = request.args.get('location')` at line ~554
  - `def loc_f(q, model):` helper at line ~560 applies `model.location == loc`
  - Used throughout for ledger, purchase invoices, bills, visits

- [ ] **Step 2: Add `location_id` param and update `loc_f`** — find the two lines:

```python
    loc = request.args.get('location')
```

and the `loc_f` helper:

```python
    def loc_f(q, model):
        if loc and loc != 'all':
            if hasattr(model, 'location'):
                return q.filter(model.location == loc)
        return q
```

Replace both with:

```python
    loc = request.args.get('location')

    location_id_param = request.args.get('location_id')
    filter_location_id = None
    if location_id_param and location_id_param.isdigit():
        filter_location_id = int(location_id_param)

    def loc_f(q, model):
        # Prefer location_id FK filter; fall back to legacy string filter
        if filter_location_id is not None:
            if hasattr(model, 'location_id'):
                return q.filter(model.location_id == filter_location_id)
        elif loc and loc != 'all':
            if hasattr(model, 'location'):
                return q.filter(model.location == loc)
        return q
```

This is a drop-in replacement — the rest of the function uses `loc_f` already, so no other changes needed.

- [ ] **Step 3: Update `InventoryBatch` aggregation** — the inventory analytics may query batches directly without going through `loc_f`. Search for `InventoryBatch.query` inside `get_analytics` and ensure any batch queries also filter by `location_id` when set. Specifically, find any `InventoryBatch.query.filter(...)` calls that don't use `loc_f` and add:

```python
            if filter_location_id is not None:
                batch_q = batch_q.filter(InventoryBatch.location_id == filter_location_id)
```

- [ ] **Step 4: Verify via curl**

```bash
# No location filter — should return all data (unchanged behaviour)
curl -s "http://localhost:5000/api/inventory_analytics" \
  -b "auth_token=<YOUR_TOKEN>" | python3 -m json.tool | head -30

# Filter by location_id=1
curl -s "http://localhost:5000/api/inventory_analytics?location_id=1" \
  -b "auth_token=<YOUR_TOKEN>" | python3 -m json.tool | head -30

# Expected: total_income, sitting_inventory_value etc. scoped to location 1's data
# If no bills/visits tagged with location_id=1 yet, revenue values will be 0 — that's correct
```

- [ ] **Step 5: Commit**

```bash
git add Backend_db/routes/inventory.py
git commit -m "feat: update analytics route to filter by location_id FK"
```

---

### Task 2: Update the frontend analytics API call

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Update `getInventoryAnalytics` signature** — find the existing function:

```typescript
    async getInventoryAnalytics(location?: string): Promise<{...}> {
        const qs = location && location !== 'all' ? `?location=${encodeURIComponent(location)}` : '';
        return fetchApi(`/api/inventory_analytics${qs}`);
    },
```

Replace it with a version that accepts either `locationId` (number) or falls back to the legacy string:

```typescript
    async getInventoryAnalytics(locationId?: number | 'all'): Promise<{
        today: { income: number; outcome: number; net: number; pharmRev: number; consultRev: number; visits: number; pBills: number; paid: number; marginPct: number };
        month: { income: number; outcome: number; net: number; pharmRev: number; consultRev: number; visits: number; pBills: number; paid: number; marginPct: number };
        year: { income: number; outcome: number; net: number; pharmRev: number; consultRev: number; visits: number; pBills: number; paid: number; marginPct: number };
        sitting_inventory_value: number;
        [key: string]: any;
    }> {
        const qs = (locationId && locationId !== 'all') ? `?location_id=${locationId}` : '';
        return fetchApi(`/api/inventory_analytics${qs}`);
    },
```

- [ ] **Step 2: Update `getLedger` to also accept `locationId`** — find the existing `getLedger` function:

```typescript
    async getLedger(location?: string, page = 1, limit = 20): Promise<any[]> {
        const params = new URLSearchParams()
        if (location && location !== 'all') params.set('location', location);
        ...
    },
```

Update to also support `location_id`:

```typescript
    async getLedger(locationId?: number | 'all', page = 1, limit = 20): Promise<any[]> {
        const params = new URLSearchParams()
        if (locationId && locationId !== 'all') params.set('location_id', locationId.toString())
        params.set('page', page.toString())
        params.set('limit', limit.toString())
        const res = await fetch(`${API_BASE_URL}/api/ledger?${params}`, { credentials: 'include' })
        if (!res.ok) throw new Error('Failed to fetch ledger')
        return res.json()
    },
```

> **Note:** The ledger route (`ledger.py`) currently filters by string `location`. Also update `ledger.py` to accept `location_id`:
>
> In `Backend_db/routes/ledger.py`, find the location filter:
> ```python
> loc = request.args.get('location')
> if loc:
>     q = q.filter(ExpenseLedger.location == loc)
> ```
> Add after it:
> ```python
> location_id_param = request.args.get('location_id')
> if location_id_param and location_id_param.isdigit():
>     q = q.filter(ExpenseLedger.location_id == int(location_id_param))
> ```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts Backend_db/routes/ledger.py
git commit -m "feat: update analytics and ledger API calls to use location_id"
```

---

### Task 3: Update the Status page — dynamic locations, remove staff filter

**Files:**
- Modify: `frontend/app/status/page.tsx`

- [ ] **Step 1: Add location state and fetch** — at the top of `StatusPage`, add:

```typescript
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([])

  useEffect(() => {
    api.getLocations()
      .then(locs => setLocations(locs.filter(l => l.is_active)))
      .catch(() => {})
  }, [])
```

- [ ] **Step 2: Change `loc` state type** — the current `loc` state is:

```typescript
  const [loc, setLoc] = useState("all")
```

Change it to use a numeric id or 'all':

```typescript
  const [loc, setLoc] = useState<number | 'all'>('all')
```

- [ ] **Step 3: Update `fetchData`** — the current call is:

```typescript
      const analytics = await api.getInventoryAnalytics(loc)
      const ledgerData = await api.getLedger(loc)
```

Both signatures now accept `number | 'all'`, so no change needed to the call itself. But if TypeScript complains, cast: `api.getInventoryAnalytics(loc as any)`.

- [ ] **Step 4: Remove the staff filter UI** — find the staff `<Select>` block (around line 243):

```tsx
          <Select value={staff} onValueChange={setStaff}>
            <SelectTrigger className="h-9 w-36 border-slate-200 font-bold text-xs rounded-lg "><UserCircle2 className="w-3.5 h-3.5 mr-2 text-slate-400"/><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Total Staff</SelectItem><SelectItem value="current">Current User</SelectItem></SelectContent>
          </Select>
```

Delete this entire block. Also remove the `const [staff, setStaff] = useState("all")` state declaration.

- [ ] **Step 5: Replace the hardcoded location `<Select>` with a dynamic one** — find:

```tsx
          <Select value={loc} onValueChange={setLoc}>
            <SelectTrigger className="h-9 w-36 border-slate-200 font-bold text-xs rounded-lg "><MapPin className="w-3.5 h-3.5 mr-2 text-slate-400"/><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Branches</SelectItem><SelectItem value="Main">Main Clinic</SelectItem></SelectContent>
          </Select>
```

Replace with:

```tsx
          <Select
            value={loc === 'all' ? 'all' : loc.toString()}
            onValueChange={val => setLoc(val === 'all' ? 'all' : parseInt(val))}
          >
            <SelectTrigger className="h-9 w-44 border-slate-200 font-bold text-xs rounded-lg">
              <MapPin className="w-3.5 h-3.5 mr-2 text-slate-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {locations.map(l => (
                <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
```

- [ ] **Step 6: Fix the legacy `location` string passed in alerts** — find around line 173:

```typescript
        location: loc === 'all' ? 'Main' : loc
```

This is used somewhere in the page for a `createLedgerItem` call or similar. Update it to pass the location_id:

```typescript
        location_id: loc === 'all' ? undefined : loc
```

Check what object this line belongs to and update the whole object accordingly.

- [ ] **Step 7: Verify in browser**

1. Navigate to `/status`.
2. Confirm only the location dropdown appears (no staff dropdown).
3. "All Branches" should show combined totals (same as before).
4. Select a specific location — KPI cards should update. If no bills/visits are tagged with `location_id` yet (they will be as new records are created), values will show 0 for per-location revenue — this is expected.
5. Confirm inventory alert section respects the filter.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/status/page.tsx
git commit -m "feat: replace hardcoded location filter with dynamic locations on Status page, remove staff filter"
```

---

### Task 4: Tag new visits, bills, and purchase invoices with location_id

**Files:**
- Modify: `Backend_db/routes/visits.py`
- Modify: `Backend_db/routes/billing.py`
- Modify: `Backend_db/routes/inventory.py`

New records created going forward should automatically receive the `location_id` of the creating user. This ensures the per-location analytics fills in as staff use the system.

- [ ] **Step 1: Tag new Visit with `location_id`** — in `Backend_db/routes/visits.py`, find where a `Visit` is created (look for `Visit(` constructor call). After it's constructed, add:

```python
        # Tag with the creating user's location
        from models import User as _User
        creator = db.session.get(_User, g.current_user.get('user_id'))
        if creator and creator.location_id:
            new_visit.location_id = creator.location_id
```

- [ ] **Step 2: Tag new Bill with `location_id`** — in `Backend_db/routes/billing.py`, find where a `Bill` is created. After construction, add:

```python
        from models import User as _User
        creator = db.session.get(_User, g.current_user.get('user_id'))
        if creator and creator.location_id:
            new_bill.location_id = creator.location_id
```

- [ ] **Step 3: Tag new PurchaseInvoice with `location_id`** — in `Backend_db/routes/inventory.py`, find `save_invoice` (look for `PurchaseInvoice(`). After construction, add:

```python
        from models import User as _User
        creator = db.session.get(_User, g.current_user.get('user_id'))
        if creator and creator.location_id:
            invoice.location_id = creator.location_id
```

Also apply the same for InventoryBatch creation in `save_invoice`:

```python
        if creator and creator.location_id:
            batch.location_id = creator.location_id
```

- [ ] **Step 4: Verify** — create a test visit or bill while logged in as a user with a `location_id` assigned. Then query the DB or check the analytics endpoint with `?location_id=<id>` and confirm the revenue/visit count appears.

```bash
# Check that the analytics endpoint now shows data for the location
curl -s "http://localhost:5000/api/inventory_analytics?location_id=1" \
  -b "auth_token=<YOUR_TOKEN>" | python3 -m json.tool
# Expected: non-zero values for visits_today or bills if you just created some
```

- [ ] **Step 5: Commit**

```bash
git add Backend_db/routes/visits.py Backend_db/routes/billing.py Backend_db/routes/inventory.py
git commit -m "feat: auto-tag new visits, bills, and invoices with creating user's location_id"
```

---

**SP3 is complete.** The Status page now has a dynamic location dropdown, no staff filter, and all analytics scope correctly to the selected location via `location_id`. New records automatically pick up the creating user's location.

---

## Full Feature Summary

After all three sub-projects:
- Admins create and manage named Locations in Admin → Settings
- Users are assigned to a Location via dropdown (no more free-text)
- Inventory batches are tagged per-location; the inventory page has a location switcher
- Export gives two options: full dump (Total Inventory) or the editable per-clinic template (Edit Inventory)
- Import handles column remapping and clinic name mismatches via a guided mapping dialog
- The Status/Analytics page filters by location dynamically with no hardcoded options
- New visits, bills, and purchase invoices are automatically tagged with the creating user's location
