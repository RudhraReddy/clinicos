# SP1 — Location Management Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text `location_label` on users with a managed `Location` entity (stable integer ID + editable display name), propagate `location_id` FK columns across all relevant models, expose CRUD admin API, and wire the Admin panel to create/manage locations and assign users via dropdown.

**Architecture:** New `Location` SQLAlchemy model → new `locations_bp` Flask blueprint → additive `location_id` FK columns on six existing models (no data loss) → frontend Locations card in Admin Settings tab + Users dialog dropdown. `db.create_all()` on deploy adds new columns automatically since all FK columns are nullable.

**Tech Stack:** Flask/SQLAlchemy 2.0, PostgreSQL, Next.js 16 App Router, TypeScript, shadcn/ui, Tailwind CSS 4

> **No test suite exists** — verification steps use curl commands against the running dev server. Start both servers before beginning: `cd Backend_db && source venv/bin/activate && python app.py` and `cd frontend && npm run dev`.

---

### Task 1: Add Location model + location_id FK columns to models.py

**Files:**
- Modify: `Backend_db/models.py`

- [ ] **Step 1: Add the Location class** — insert after the `PurchaseInvoice` class (around line 43) and before `ProductMaster`. The class must come before any model that references it as an FK.

```python
class Location(db.Model):
    __tablename__ = 'locations'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=get_ist_now)
```

- [ ] **Step 2: Add `location_id` to `InventoryBatch`** — add after the existing `created_by_user_id` line (around line 107):

```python
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=True)
```

- [ ] **Step 3: Add `location_id` to `Visit`** — add after the existing `location` string column (around line 151):

```python
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=True)
```

- [ ] **Step 4: Add `location_id` to `Bill`** — add after the existing `location` string column (around line 166):

```python
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=True)
```

- [ ] **Step 5: Add `location_id` to `PurchaseInvoice`** — add after the existing `location` string column (around line 41):

```python
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=True)
```

- [ ] **Step 6: Add `location_id` to `ExpenseLedger`** — add after the existing `location` string column (around line 224):

```python
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=True)
```

- [ ] **Step 7: Add `location_id` to `User`** — add after the existing `location_label` column (around line 241):

```python
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=True)
```

- [ ] **Step 8: Verify backend starts cleanly**

```bash
cd Backend_db && source venv/bin/activate && python app.py
```

Expected: server starts on port 5000 with no errors. `db.create_all()` inside `create_app()` will silently add all new columns to existing tables.

- [ ] **Step 9: Commit**

```bash
git add Backend_db/models.py
git commit -m "feat: add Location model and location_id FK columns to all relevant models"
```

---

### Task 2: Create the locations blueprint

**Files:**
- Create: `Backend_db/routes/locations.py`

- [ ] **Step 1: Create the file with full CRUD**

```python
from flask import Blueprint, request, jsonify
from sqlalchemy import func
from extensions import db
from models import Location, User, Visit, Bill, PurchaseInvoice, ExpenseLedger, InventoryBatch
from routes.auth import require_auth, require_admin

locations_bp = Blueprint('locations', __name__)


@locations_bp.route('/admin/locations', methods=['GET'])
@require_auth
def list_locations():
    locs = Location.query.order_by(Location.name).all()
    return jsonify([{
        'id': l.id,
        'name': l.name,
        'is_active': l.is_active,
    } for l in locs])


@locations_bp.route('/admin/locations', methods=['POST'])
@require_auth
@require_admin
def create_location():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    if Location.query.filter(func.lower(Location.name) == name.lower()).first():
        return jsonify({'error': 'A location with this name already exists'}), 409
    loc = Location(name=name)
    db.session.add(loc)
    db.session.commit()
    return jsonify({'id': loc.id, 'name': loc.name, 'is_active': loc.is_active}), 201


@locations_bp.route('/admin/locations/<int:loc_id>', methods=['PATCH'])
@require_auth
@require_admin
def update_location(loc_id):
    loc = db.session.get(Location, loc_id)
    if not loc:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(silent=True) or {}
    if 'name' in data:
        name = (data['name'] or '').strip()
        if not name:
            return jsonify({'error': 'name cannot be empty'}), 400
        duplicate = Location.query.filter(
            func.lower(Location.name) == name.lower(),
            Location.id != loc_id
        ).first()
        if duplicate:
            return jsonify({'error': 'A location with this name already exists'}), 409
        loc.name = name
    if 'is_active' in data:
        loc.is_active = bool(data['is_active'])
    db.session.commit()
    return jsonify({'id': loc.id, 'name': loc.name, 'is_active': loc.is_active})


@locations_bp.route('/admin/locations/<int:loc_id>', methods=['DELETE'])
@require_auth
@require_admin
def delete_location(loc_id):
    loc = db.session.get(Location, loc_id)
    if not loc:
        return jsonify({'error': 'Not found'}), 404
    refs = (
        User.query.filter_by(location_id=loc_id).count() +
        Visit.query.filter_by(location_id=loc_id).count() +
        Bill.query.filter_by(location_id=loc_id).count() +
        PurchaseInvoice.query.filter_by(location_id=loc_id).count() +
        ExpenseLedger.query.filter_by(location_id=loc_id).count() +
        InventoryBatch.query.filter_by(location_id=loc_id).count()
    )
    if refs > 0:
        return jsonify({
            'error': f'Cannot delete: {refs} record(s) reference this location. Deactivate it instead.'
        }), 409
    db.session.delete(loc)
    db.session.commit()
    return jsonify({'ok': True})
```

- [ ] **Step 2: Register the blueprint in `routes/__init__.py`**

Add import at the top:
```python
from .locations import locations_bp
```

Add to the `blueprints` list:
```python
blueprints = [auth_bp, admin_bp, patients, inventory, visits, billing, images, upload_bp, ledger, locations_bp]
```

- [ ] **Step 3: Verify API endpoints work**

Restart the backend, then run these curl commands (replace cookie with a real admin session token from your browser dev tools):

```bash
# Create a location
curl -s -X POST http://localhost:5000/api/admin/locations \
  -H "Content-Type: application/json" \
  -b "auth_token=<YOUR_ADMIN_TOKEN>" \
  -d '{"name": "Rize Clinic"}' | python3 -m json.tool

# Expected: {"id": 1, "is_active": true, "name": "Rize Clinic"}

# List locations
curl -s http://localhost:5000/api/admin/locations \
  -b "auth_token=<YOUR_ADMIN_TOKEN>" | python3 -m json.tool

# Expected: [{"id": 1, "is_active": true, "name": "Rize Clinic"}]

# Rename it
curl -s -X PATCH http://localhost:5000/api/admin/locations/1 \
  -H "Content-Type: application/json" \
  -b "auth_token=<YOUR_ADMIN_TOKEN>" \
  -d '{"name": "Main Clinic"}' | python3 -m json.tool

# Expected: {"id": 1, "is_active": true, "name": "Main Clinic"}

# Deactivate it
curl -s -X PATCH http://localhost:5000/api/admin/locations/1 \
  -H "Content-Type: application/json" \
  -b "auth_token=<YOUR_ADMIN_TOKEN>" \
  -d '{"is_active": false}' | python3 -m json.tool

# Expected: {"id": 1, "is_active": false, "name": "Main Clinic"}

# Reactivate
curl -s -X PATCH http://localhost:5000/api/admin/locations/1 \
  -H "Content-Type: application/json" \
  -b "auth_token=<YOUR_ADMIN_TOKEN>" \
  -d '{"is_active": true}' | python3 -m json.tool
```

- [ ] **Step 4: Commit**

```bash
git add Backend_db/routes/locations.py Backend_db/routes/__init__.py
git commit -m "feat: add locations CRUD blueprint and register it"
```

---

### Task 3: Update admin.py and auth.py to include location_id

**Files:**
- Modify: `Backend_db/routes/admin.py`
- Modify: `Backend_db/routes/auth.py`

- [ ] **Step 1: Update `admin.py` imports** — add `Location` to the models import line at the top:

```python
from models import AuditLog, User, DoctorStaffAssignment, Visit, Bill, Patient, Location
```

- [ ] **Step 2: Update `list_all_users` response** — in the list comprehension inside `list_all_users`, add `location_id` and `location_name` fields:

```python
return jsonify([
    {
        'user_id': u.id,
        'username': u.username,
        'email': u.email,
        'role': u.role,
        'is_active': u.is_active,
        'location_label': u.location_label,
        'location_id': u.location_id,
        'location_name': (db.session.get(Location, u.location_id).name if u.location_id else None),
        'created_at': u.created_at.isoformat() if u.created_at else None,
        'assigned_staff_ids': [a.staff_id for a in DoctorStaffAssignment.query.filter_by(doctor_id=u.id).all()] if u.role == 'doctor' else [],
    }
    for u in users
]), 200
```

- [ ] **Step 3: Update `update_user` to handle `location_id`** — replace the existing `location_label` block:

```python
    if 'location_id' in data:
        loc_id = data['location_id']
        if loc_id is None:
            user.location_id = None
            user.location_label = None
        else:
            loc = db.session.get(Location, int(loc_id))
            if not loc:
                return jsonify({'error': 'Location not found'}), 404
            user.location_id = loc.id
            user.location_label = loc.name  # keep string in sync for backward compat

    # Keep the old location_label handler so existing callers still work
    if 'location_label' in data and 'location_id' not in data:
        user.location_label = (data['location_label'] or '').strip() or None
```

- [ ] **Step 4: Update `auth.py` `/auth/me` response** — add `location_id` to the returned dict:

```python
return jsonify({
    'user_id': user.id,
    'username': user.username,
    'role': user.role,
    'location_label': user.location_label,
    'location_id': user.location_id,
}), 200
```

- [ ] **Step 5: Update `auth.py` `/auth/users` list response** — add `location_id` to each user dict in the list comprehension:

```python
return jsonify([
    {
        'user_id': u.id,
        'username': u.username,
        'role': u.role,
        'location_label': u.location_label,
        'location_id': u.location_id,
    }
    for u in users
]), 200
```

- [ ] **Step 6: Verify via curl**

```bash
# Get current user (as admin)
curl -s http://localhost:5000/api/auth/me \
  -b "auth_token=<YOUR_ADMIN_TOKEN>" | python3 -m json.tool
# Expected: includes "location_id": null (or an int if already assigned)

# Assign location_id=1 to a user (replace USER_ID with a real user id)
curl -s -X PATCH http://localhost:5000/api/admin/users/USER_ID \
  -H "Content-Type: application/json" \
  -b "auth_token=<YOUR_ADMIN_TOKEN>" \
  -d '{"location_id": 1}' | python3 -m json.tool
# Expected: {"message": "User updated"}

# Confirm list shows location_name
curl -s http://localhost:5000/api/admin/users \
  -b "auth_token=<YOUR_ADMIN_TOKEN>" | python3 -m json.tool
# Expected: user has "location_id": 1, "location_name": "Main Clinic"
```

- [ ] **Step 7: Commit**

```bash
git add Backend_db/routes/admin.py Backend_db/routes/auth.py
git commit -m "feat: expose location_id in admin users and auth/me endpoints"
```

---

### Task 4: Update frontend api.ts

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add `Location` interface** — add after the existing interfaces near the top of api.ts:

```typescript
export interface Location {
    id: number;
    name: string;
    is_active: boolean;
}
```

- [ ] **Step 2: Add location CRUD calls** — add inside the `api` object, after `getInventoryAllChanges`:

```typescript
    async getLocations(): Promise<Location[]> {
        return fetchApi('/api/admin/locations');
    },
    async createLocation(name: string): Promise<Location> {
        return fetchApi('/api/admin/locations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
    },
    async updateLocation(id: number, data: { name?: string; is_active?: boolean }): Promise<Location> {
        return fetchApi(`/api/admin/locations/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    },
    async deleteLocation(id: number): Promise<{ ok?: boolean; error?: string }> {
        return fetchApi(`/api/admin/locations/${id}`, { method: 'DELETE' });
    },
```

- [ ] **Step 3: Update `getMe` return type** — find the `getMe` function near the bottom and update it:

```typescript
export async function getMe() {
  const res = await fetch('/api/auth/me', { credentials: 'include' })
  if (!res.ok) return null
  return res.json() as Promise<{ user_id: string; username: string; role: string; location_label?: string; location_id?: number | null }>
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add location CRUD API calls and Location type to api.ts"
```

---

### Task 5: Update auth_context.tsx

**Files:**
- Modify: `frontend/lib/auth_context.tsx`

- [ ] **Step 1: Add `location_id` to `AuthUser` interface**

Change the existing `AuthUser` interface:

```typescript
export interface AuthUser {
  user_id: string
  username: string
  role: 'staff' | 'doctor' | 'admin'
  location_label?: string | null
  location_id?: number | null
}
```

- [ ] **Step 2: Populate `location_id` in `fetchMe`**

In the `setUser` call inside `fetchMe`, add `location_id`:

```typescript
        setUser({
          user_id: data.user_id,
          username: data.username,
          role: data.role,
          location_label: data.location_label,
          location_id: data.location_id ?? null,
        })
```

- [ ] **Step 3: Verify in browser** — open the app as admin, open DevTools → Application → Cookies, confirm the auth cookie exists. Then open the Network tab and reload. Check the `/api/auth/me` response includes `location_id`.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/auth_context.tsx
git commit -m "feat: add location_id to AuthUser type and populate from /auth/me"
```

---

### Task 6: Add Locations card to Admin Settings tab

**Files:**
- Modify: `frontend/app/admin/page.tsx`

- [ ] **Step 1: Add necessary imports** — at the top of `admin/page.tsx`, ensure these are imported (add any missing ones):

```typescript
import { Plus, Pencil, Trash2, CheckCircle2, XCircle } from "lucide-react"
import { api, type Location } from "@/lib/api"
```

- [ ] **Step 2: Replace the `SettingsTab` function** — find the existing `SettingsTab` function (around line 738) and replace it entirely:

```typescript
function SettingsTab() {
    const { expiryReminderMonths, setSettings } = useSettings()
    const [localMonths, setLocalMonths] = useState(expiryReminderMonths)

    useEffect(() => {
        setLocalMonths(expiryReminderMonths)
    }, [expiryReminderMonths])

    const handleSave = () => {
        const val = Math.max(1, Math.min(24, localMonths))
        setSettings({ expiryReminderMonths: val })
        toast.success(`Expiry reminder set to ${val} months`)
    }

    // ── Locations state ──
    const [locations, setLocations] = useState<Location[]>([])
    const [locLoading, setLocLoading] = useState(true)
    const [newLocName, setNewLocName] = useState('')
    const [addingLoc, setAddingLoc] = useState(false)
    const [editingLocId, setEditingLocId] = useState<number | null>(null)
    const [editingLocName, setEditingLocName] = useState('')

    const loadLocations = async () => {
        setLocLoading(true)
        try {
            setLocations(await api.getLocations())
        } catch {
            toast.error('Failed to load locations')
        } finally {
            setLocLoading(false)
        }
    }

    useEffect(() => { loadLocations() }, [])

    const handleAddLocation = async () => {
        const name = newLocName.trim()
        if (!name) return
        try {
            await api.createLocation(name)
            setNewLocName('')
            setAddingLoc(false)
            await loadLocations()
            toast.success(`Location "${name}" created`)
        } catch (err: any) {
            toast.error(err?.message || 'Failed to create location')
        }
    }

    const handleRenameLocation = async (id: number) => {
        const name = editingLocName.trim()
        if (!name) return
        try {
            await api.updateLocation(id, { name })
            setEditingLocId(null)
            await loadLocations()
            toast.success('Location renamed')
        } catch (err: any) {
            toast.error(err?.message || 'Failed to rename')
        }
    }

    const handleToggleActive = async (loc: Location) => {
        try {
            await api.updateLocation(loc.id, { is_active: !loc.is_active })
            await loadLocations()
        } catch (err: any) {
            toast.error(err?.message || 'Failed to update')
        }
    }

    const handleDeleteLocation = async (loc: Location) => {
        if (!window.confirm(`Delete location "${loc.name}"? This cannot be undone.`)) return
        try {
            const res = await api.deleteLocation(loc.id)
            if (res.error) {
                toast.error(res.error)
            } else {
                await loadLocations()
                toast.success(`Deleted "${loc.name}"`)
            }
        } catch (err: any) {
            toast.error(err?.message || 'Failed to delete')
        }
    }

    return (
        <div className="space-y-6 max-w-lg">
            {/* ── Inventory Settings ── */}
            <div>
                <h2 className="text-lg font-semibold mb-1">Inventory Settings</h2>
                <p className="text-sm text-muted-foreground">
                    These settings apply across all inventory tables and dashboards.
                </p>
            </div>
            <div className="rounded-lg border p-4 space-y-4">
                <div className="space-y-1">
                    <label className="text-sm font-medium">Expiry Reminder (months)</label>
                    <p className="text-xs text-muted-foreground">
                        Items expiring within this many months will be flagged as &quot;Expires Soon&quot;.
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                        <input
                            type="number"
                            min={1}
                            max={24}
                            value={localMonths}
                            onChange={e => {
                                const n = parseInt(e.target.value, 10)
                                if (!isNaN(n)) setLocalMonths(n)
                            }}
                            className="w-24 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <span className="text-sm text-muted-foreground">months (1–24)</span>
                    </div>
                </div>
                <Button size="sm" onClick={handleSave}>Save Settings</Button>
            </div>

            {/* ── Locations ── */}
            <div>
                <h2 className="text-lg font-semibold mb-1">Locations</h2>
                <p className="text-sm text-muted-foreground">
                    Clinic branches or chambers. Used to track inventory and billing per location.
                </p>
            </div>
            <div className="rounded-lg border divide-y">
                {locLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                ) : locations.length === 0 && !addingLoc ? (
                    <div className="p-4 text-sm text-muted-foreground">No locations yet.</div>
                ) : (
                    locations.map(loc => (
                        <div key={loc.id} className="flex items-center gap-2 px-4 py-3">
                            {editingLocId === loc.id ? (
                                <>
                                    <Input
                                        autoFocus
                                        value={editingLocName}
                                        onChange={e => setEditingLocName(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') handleRenameLocation(loc.id)
                                            if (e.key === 'Escape') setEditingLocId(null)
                                        }}
                                        className="h-8 flex-1"
                                    />
                                    <Button size="sm" onClick={() => handleRenameLocation(loc.id)}>Save</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setEditingLocId(null)}>Cancel</Button>
                                </>
                            ) : (
                                <>
                                    <span className="flex-1 text-sm font-medium">{loc.name}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${loc.is_active ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                                        {loc.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        title="Rename"
                                        onClick={() => { setEditingLocId(loc.id); setEditingLocName(loc.name) }}
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        title={loc.is_active ? 'Deactivate' : 'Reactivate'}
                                        onClick={() => handleToggleActive(loc)}
                                    >
                                        {loc.is_active ? <XCircle className="h-3.5 w-3.5 text-muted-foreground" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 text-rose-600 hover:text-rose-700"
                                        title="Delete"
                                        onClick={() => handleDeleteLocation(loc)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </>
                            )}
                        </div>
                    ))
                )}

                {addingLoc && (
                    <div className="flex items-center gap-2 px-4 py-3">
                        <Input
                            autoFocus
                            placeholder="Location name…"
                            value={newLocName}
                            onChange={e => setNewLocName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleAddLocation()
                                if (e.key === 'Escape') { setAddingLoc(false); setNewLocName('') }
                            }}
                            className="h-8 flex-1"
                        />
                        <Button size="sm" onClick={handleAddLocation}>Add</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setAddingLoc(false); setNewLocName('') }}>Cancel</Button>
                    </div>
                )}

                <div className="px-4 py-3">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAddingLoc(true)}
                        disabled={addingLoc}
                    >
                        <Plus className="h-3.5 w-3.5 mr-1.5" />
                        Add Location
                    </Button>
                </div>
            </div>
        </div>
    )
}
```

- [ ] **Step 3: Verify in browser** — navigate to `/admin` → Settings tab. Confirm the Locations card appears below Inventory Settings. Create a location, rename it, deactivate it, reactivate it. Confirm toasts fire correctly.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/admin/page.tsx
git commit -m "feat: add Locations card to Admin Settings tab"
```

---

### Task 7: Update Users dialog to use location dropdown

**Files:**
- Modify: `frontend/app/admin/page.tsx`

The Users tab has a `UsersTab` function. The Edit dialog has an `editLocation` string state and a free-text `<Input>`. We need to change it to a `<Select>` populated from the Locations API.

- [ ] **Step 1: Add `Select` import** — confirm `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` are imported from `@/components/ui/select`. They likely already are (used elsewhere in the file).

- [ ] **Step 2: Find the `UsersTab` function** and locate these existing state declarations (around line 345):

```typescript
const [editLocation, setEditLocation] = useState("")
```

Add alongside it:
```typescript
const [locations, setLocations] = useState<Location[]>([])
const [editLocationId, setEditLocationId] = useState<number | null>(null)
```

- [ ] **Step 3: Load locations when the dialog opens** — find the function that populates edit state when clicking Edit on a user (it calls `setEditLocation(u.location_label || "")`). Update it to also set `editLocationId`:

```typescript
    setEditLocation(u.location_label || "")
    setEditLocationId(u.location_id ?? null)
```

Also load the locations list once when `UsersTab` mounts. Add a `useEffect` near the top of `UsersTab`:

```typescript
    useEffect(() => {
        api.getLocations().then(setLocations).catch(() => {})
    }, [])
```

- [ ] **Step 4: Update the PATCH call** — find where `update_user` is called (around line 375, where `location_label` is sent). Change it to send `location_id` instead:

```typescript
        await fetch(`/api/admin/users/${editUser.user_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                username: editUsername,
                role: editRole,
                is_active: editActive,
                location_id: editLocationId,
                assigned_staff_ids: editAssignedStaff,
            }),
        })
```

- [ ] **Step 5: Replace the location input with a Select** — find the `<Input id="edit-location" ...>` block (around line 484) and replace it:

```tsx
                <Label htmlFor="edit-location" className="text-sm font-semibold">Location</Label>
                <Select
                    value={editLocationId?.toString() ?? 'none'}
                    onValueChange={val => setEditLocationId(val === 'none' ? null : parseInt(val))}
                >
                    <SelectTrigger id="edit-location">
                        <SelectValue placeholder="No location assigned" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">No location</SelectItem>
                        {locations.filter(l => l.is_active).map(l => (
                            <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
```

- [ ] **Step 6: Update the Users table `location_label` display** — find the `<TableCell>` that shows `u.location_label` (around line 429) and update it to show `location_name` if available:

```tsx
<TableCell className="text-sm text-muted-foreground">
    {(u as any).location_name ?? u.location_label ?? '—'}
</TableCell>
```

- [ ] **Step 7: Update the `AdminUser` type** if it exists in the file — find any local interface for admin user data and add the fields:

```typescript
interface AdminUser {
    user_id: string
    username: string
    email: string
    role: string
    is_active: boolean
    location_label: string | null
    location_id: number | null
    location_name: string | null
    created_at: string | null
    assigned_staff_ids: string[]
}
```

- [ ] **Step 8: Verify in browser** — open `/admin` → Users tab, click Edit on a user. Confirm the Location field is now a dropdown showing your created locations. Select one, save, verify the table shows the location name.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/admin/page.tsx
git commit -m "feat: replace free-text location input with managed location dropdown in Users dialog"
```

---

**SP1 is complete.** The foundation is in place: Location records exist, FKs are on all relevant models, and the admin UI can create/manage locations and assign them to users. Proceed to SP2.
