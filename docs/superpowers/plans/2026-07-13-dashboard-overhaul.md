# Dashboard Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the frontdesk dashboard with a 3-panel walk-in form, migrate the patient reference field from a free string to a patient FK, and add admin-configurable column visibility to the Patients page.

**Architecture:** Backend migration first (reference FK), then API types, then new WalkInForm component, then dashboard page wiring, then settings context extension, then Patients page column toggle, then admin settings card. Each task is independently testable.

**Tech Stack:** Flask + SQLAlchemy 2.0 (backend), Next.js 16 App Router + React + Tailwind + shadcn/ui + sonner toasts (frontend). No test suites — verification is curl + browser.

## Global Constraints

- No `Co-Authored-By` lines in any git commit message
- All timestamps use `get_ist_now()` (IST, UTC+5:30) — never `datetime.utcnow()`
- All frontend API calls use relative paths (`/api/...`) — never hardcode `localhost:5000`
- Patient `name` column is always visible (required: true) and cannot be toggled off
- The `reference` string column on `patients` is being permanently dropped — all existing text data in it will be lost (per design decision)
- Backend runs on `localhost:5000`, frontend on `localhost:3000`

---

## File Map

| File | Action | What changes |
|---|---|---|
| `Backend_db/models.py` | Modify | `reference` String → `reference_patient_id` FK |
| `Backend_db/app.py` | Modify | Two migration SQL statements |
| `Backend_db/routes/patients.py` | Modify | All CRUD + export/import updated |
| `frontend/lib/api.ts` | Modify | `Patient` type; `createPatient`/`updatePatient` payloads |
| `frontend/components/EditPatientDialog.tsx` | Modify | Reference field → PatientSearch widget |
| `frontend/components/AddPatientDialog.tsx` | Modify | Remove (replaced by WalkInForm) or keep for Patients page |
| `frontend/components/WalkInForm.tsx` | Create | New walk-in + booking inline form |
| `frontend/app/page.tsx` | Modify | Remove calendar/DnD; wire in WalkInForm |
| `frontend/lib/settings_context.tsx` | Modify | Add `ALL_PATIENT_COLUMNS`, `defaultPatientColumns` |
| `frontend/app/patients/page.tsx` | Modify | Column visibility toggle; reference display |
| `frontend/app/admin/page.tsx` | Modify | Patient Columns card in Settings tab |

---

## Task 1: Backend — reference field migration + CRUD update

**Files:**
- Modify: `Backend_db/models.py:15`
- Modify: `Backend_db/app.py:15-52` (`_apply_migrations`)
- Modify: `Backend_db/routes/patients.py` (all CRUD functions)

**Interfaces:**
- Produces: `GET /api/patients` returns `reference_patient_id: string|null` and `reference_patient_name: string|null` instead of `reference: string`
- Produces: `POST /api/patients` accepts `reference_patient_id: string|null`
- Produces: `PUT /api/patients/<id>` accepts `reference_patient_id: string|null`

- [ ] **Step 1: Update Patient model**

In `Backend_db/models.py`, find line 15:
```python
    reference = db.Column(db.String(100))
```
Replace with:
```python
    reference_patient_id = db.Column(db.String(8), db.ForeignKey('patients.patient_id', ondelete='SET NULL'), nullable=True)
```

- [ ] **Step 2: Add migration SQL to `_apply_migrations`**

In `Backend_db/app.py`, at the end of the migrations list (after the last existing entry, before the closing `]`):
```python
        "ALTER TABLE patients ADD COLUMN IF NOT EXISTS reference_patient_id VARCHAR(8) REFERENCES patients(patient_id) ON DELETE SET NULL",
        "ALTER TABLE patients DROP COLUMN IF EXISTS reference",
```

- [ ] **Step 3: Update `create_patient` route**

In `Backend_db/routes/patients.py`, the `create_patient` function currently starts around line 14. Replace the body up through `db.session.add(new_patient)`:

```python
@patients.route('/patients', methods=['POST'])
@require_auth
def create_patient():
    data = request.get_json()
    if not all(k in data for k in ('phone_number', 'name')):
        return jsonify({'error': 'Missing required fields: name, phone_number'}), 400

    patient_id = Patient.generate_patient_id()

    ref_id = data.get('reference_patient_id')
    if ref_id:
        if ref_id == patient_id:
            return jsonify({'error': 'Patient cannot reference themselves'}), 400
        if not Patient.query.filter_by(patient_id=ref_id).first():
            return jsonify({'error': 'Referenced patient not found'}), 400

    new_patient = Patient(
        patient_id=patient_id,
        phone_number=data['phone_number'],
        name=data['name'],
        age=int(data['age']) if data.get('age') else None,
        sex=data.get('sex'),
        address=data.get('address'),
        dob=data.get('dob'),
        reference_patient_id=ref_id,
        created_by_user_id=g.current_user.get('user_id')
    )
    db.session.add(new_patient)
    db.session.commit()
```

- [ ] **Step 4: Update `get_patients` list response**

Replace the entire loop and return in the `get_patients` function (currently lines ~70-84):

```python
    patients_list = q.offset((page - 1) * limit).limit(limit).all()

    # Batch-load reference names (one extra query at most)
    ref_ids = [p.reference_patient_id for p in patients_list if p.reference_patient_id]
    ref_map: dict = {}
    if ref_ids:
        refs = Patient.query.filter(Patient.patient_id.in_(ref_ids)).all()
        ref_map = {r.patient_id: r.name for r in refs}

    results = []
    for p in patients_list:
        results.append({
            'patient_id': p.patient_id,
            'name': p.name,
            'phone_number': p.phone_number,
            'age': p.age,
            'sex': p.sex,
            'address': p.address,
            'reference_patient_id': p.reference_patient_id,
            'reference_patient_name': ref_map.get(p.reference_patient_id) if p.reference_patient_id else None,
            'created_at': p.created_at.isoformat() if p.created_at else None,
        })
    return jsonify(results), 200
```

- [ ] **Step 5: Update `get_patient_detail` response**

Replace the return in `get_patient_detail` (currently lines ~88-99):

```python
@patients.route('/patients/<patient_id>', methods=['GET'])
@require_auth
def get_patient_detail(patient_id):
    patient = Patient.query.filter_by(patient_id=patient_id).first_or_404()
    ref_name = None
    if patient.reference_patient_id:
        ref = Patient.query.filter_by(patient_id=patient.reference_patient_id).first()
        ref_name = ref.name if ref else None
    return jsonify({
        'patient_id': patient.patient_id,
        'name': patient.name,
        'phone_number': patient.phone_number,
        'age': patient.age,
        'sex': patient.sex,
        'address': patient.address,
        'reference_patient_id': patient.reference_patient_id,
        'reference_patient_name': ref_name,
        'created_at': patient.created_at
    }), 200
```

- [ ] **Step 6: Update `update_patient` route**

Replace the reference block (currently lines ~117-118) and validate:

```python
    if 'reference_patient_id' in data:
        ref_id = data['reference_patient_id']
        if ref_id is not None:
            if ref_id == patient_id:
                return jsonify({'error': 'Patient cannot reference themselves'}), 400
            if not Patient.query.filter_by(patient_id=ref_id).first():
                return jsonify({'error': 'Referenced patient not found'}), 400
        patient.reference_patient_id = ref_id
```

Remove the old block:
```python
    if 'reference' in data:
        patient.reference = data['reference']
```

- [ ] **Step 7: Update `export_patients`**

In `export_patients`, change the header row and data row:

```python
    writer.writerow(['Patient ID', 'Name', 'Phone Number', 'Age', 'Sex', 'Address', 'Referred By', 'Registration Date'])

    # Batch-load reference names
    all_ref_ids = [p.reference_patient_id for p in all_patients if p.reference_patient_id]
    all_ref_map: dict = {}
    if all_ref_ids:
        refs = Patient.query.filter(Patient.patient_id.in_(all_ref_ids)).all()
        all_ref_map = {r.patient_id: r.name for r in refs}

    for p in all_patients:
        writer.writerow([
            p.patient_id,
            p.name,
            p.phone_number,
            p.age if p.age is not None else '',
            p.sex or '',
            p.address or '',
            all_ref_map.get(p.reference_patient_id, '') if p.reference_patient_id else '',
            p.created_at.strftime('%Y-%m-%d %H:%M') if p.created_at else ''
        ])
```

- [ ] **Step 8: Update `import_patients` — remove reference handling**

In `import_patients`, remove these lines (currently ~248-252 and ~259 and ~270):
```python
# Remove these:
ref_val = safe_get(row, ['Reference', 'Referred By'])
clean_ref = str(ref_val).strip() if ref_val else None
if clean_ref and len(clean_ref) > 100:
    db.session.rollback()
    return jsonify({'error': f"Row {row_count + 1}: Reference field exceeds the maximum limit of 100 characters."}), 400

# In the existing block, remove:
if clean_ref: existing.reference = clean_ref

# In the new Patient(...) constructor, remove:
reference=clean_ref,
```

- [ ] **Step 9: Verify**

Start the backend:
```bash
cd Backend_db && source venv/bin/activate && python app.py
```

Expected in startup output: both migration SQL statements execute without error.

Then verify the column exists and old column is gone:
```bash
psql postgresql://Rize:vs%409699@localhost/clinic_db -c "\d patients"
```
Expected: `reference_patient_id` column present, `reference` column absent.

Test create with reference:
```bash
# First get an existing patient_id from the DB
curl -s -b "session=<cookie>" http://localhost:5000/api/patients?limit=1 | python3 -m json.tool
# Create patient referencing that ID
curl -s -b "session=<cookie>" -X POST http://localhost:5000/api/patients \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Ref","phone_number":"9999900001","reference_patient_id":"<existing_id>"}' \
  | python3 -m json.tool
# Expected: {"message":"Patient created","patient_id":"..."}
```

Test self-reference rejection:
```bash
curl -s -b "session=<cookie>" -X POST http://localhost:5000/api/patients \
  -H "Content-Type: application/json" \
  -d '{"name":"Self Ref","phone_number":"9999900002","reference_patient_id":"<the_new_id>"}' \
  | python3 -m json.tool
# Expected: {"error":"Patient cannot reference themselves"} 400
```

- [ ] **Step 10: Commit**

```bash
git add Backend_db/models.py Backend_db/app.py Backend_db/routes/patients.py
git commit -m "feat: replace patient reference string with reference_patient_id FK"
```

---

## Task 2: Frontend types + EditPatientDialog

**Files:**
- Modify: `frontend/lib/api.ts:6-16`
- Modify: `frontend/components/EditPatientDialog.tsx`

**Interfaces:**
- Consumes: Task 1's new API responses (`reference_patient_id`, `reference_patient_name`)
- Produces: `Patient` type exported with `reference_patient_id?: string | null` and `reference_patient_name?: string | null`

- [ ] **Step 1: Update `Patient` interface in `api.ts`**

Find lines 6-16 in `frontend/lib/api.ts`:
```typescript
export interface Patient {
    patient_id: string;
    name: string;
    phone_number: string;
    age?: number;
    sex?: string;
    dob?: string | null;
    address?: string;
    reference?: string;
    created_at?: string;
}
```

Replace with:
```typescript
export interface Patient {
    patient_id: string;
    name: string;
    phone_number: string;
    age?: number;
    sex?: string;
    dob?: string | null;
    address?: string;
    reference_patient_id?: string | null;
    reference_patient_name?: string | null;
    created_at?: string;
}
```

- [ ] **Step 2: Update `createPatient` payload type**

In `api.ts`, `createPatient` currently has:
```typescript
async createPatient(data: Omit<Patient, 'patient_id' | 'created_at'>): Promise<Patient> {
```
The type already covers the updated interface from Step 1 — no additional change needed here since we removed `reference` from the interface. Verify `reference` is no longer referenced in the call sites.

- [ ] **Step 3: Rewrite `EditPatientDialog` reference field**

In `frontend/components/EditPatientDialog.tsx`, add `PatientSearch` import at the top:
```typescript
import { PatientSearch } from "@/components/PatientSearch"
import { toast } from "sonner"
```

Replace the `formData` state (line 36-43):
```typescript
    const [formData, setFormData] = useState({
        name: "",
        phone_number: "",
        age: "",
        sex: "",
        address: "",
        reference_patient_id: null as string | null,
        reference_patient_name: null as string | null,
    })
```

Replace the `useEffect` that initialises formData (lines 45-56):
```typescript
    useEffect(() => {
        if (open && patient) {
            setFormData({
                name: patient.name || "",
                phone_number: patient.phone_number || "",
                age: patient.age ? patient.age.toString() : "",
                sex: patient.sex || "",
                address: patient.address || "",
                reference_patient_id: patient.reference_patient_id ?? null,
                reference_patient_name: patient.reference_patient_name ?? null,
            })
        }
    }, [open, patient])
```

Replace the `handleSubmit` call to `api.updatePatient` (lines 63-70):
```typescript
            await api.updatePatient(patient.patient_id, {
                name: formData.name,
                phone_number: formData.phone_number,
                age: formData.age ? parseInt(formData.age) : undefined,
                sex: formData.sex,
                address: formData.address || undefined,
                reference_patient_id: formData.reference_patient_id,
            })
```

Also replace `alert(...)` in the catch block:
```typescript
        } catch (err) {
            toast.error(`Failed to update patient: ${err instanceof Error ? err.message : "Unknown error"}`)
        }
```

Replace the reference `<div className="space-y-2">` block (lines 167-177):
```tsx
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Referred By</label>
                            {formData.reference_patient_name ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-sm border rounded-md px-3 py-2 flex-1 bg-muted/30">
                                        {formData.reference_patient_name}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setFormData(f => ({ ...f, reference_patient_id: null, reference_patient_name: null }))}
                                    >
                                        Clear
                                    </Button>
                                </div>
                            ) : (
                                <PatientSearch
                                    key={open ? "open" : "closed"}
                                    onSelect={(p) => setFormData(f => ({
                                        ...f,
                                        reference_patient_id: p?.patient_id ?? null,
                                        reference_patient_name: p?.name ?? null,
                                    }))}
                                />
                            )}
                            <p className="text-xs text-muted-foreground">Patient who referred this person to the clinic.</p>
                        </div>
```

- [ ] **Step 4: Update `AddPatientDialog` — remove reference field**

`AddPatientDialog` (`frontend/components/AddPatientDialog.tsx`) is being superseded by `WalkInForm` for dashboard use, but still used from the Patients page "Add" button. Remove the reference field from it entirely since it was a free-text field that no longer exists.

In `AddPatientDialog.tsx`:
- Remove `reference: ""` from `formData` state
- Remove the `reference: patient.reference || prev.reference` line in `handlePreFill`
- Remove `reference: formData.reference || undefined` from `api.createPatient(...)` call
- Remove the `reference: ""` from the reset block
- Remove the reference `<div className="space-y-2">` JSX block (lines 259-269)

- [ ] **Step 5: Verify**

```bash
cd frontend && npm run lint 2>&1 | grep -E "error|Error" | head -20
```
Expected: no TypeScript errors on the `reference` property.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/api.ts frontend/components/EditPatientDialog.tsx frontend/components/AddPatientDialog.tsx
git commit -m "feat: update Patient type and dialogs for reference_patient_id FK"
```

---

## Task 3: WalkInForm component

**Files:**
- Create: `frontend/components/WalkInForm.tsx`

**Interfaces:**
- Consumes: `api.createPatient(data)` → `{ patient_id: string }`, `api.createVisit(data)` → void, `GET /api/patients?phone_number=` → `Patient[]`
- Consumes: `getTodayIST()` from `@/lib/utils`
- Produces: `<WalkInForm onSuccess={() => void} />` — calls `onSuccess` after every successful booking

- [ ] **Step 1: Create `WalkInForm.tsx`**

Create `frontend/components/WalkInForm.tsx` with the full implementation:

```tsx
"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, UserPlus, CheckCircle2, XCircle } from "lucide-react"
import { api, type Patient } from "@/lib/api"
import { getTodayIST } from "@/lib/utils"
import { toast } from "sonner"

type FormState = 'idle' | 'searching' | 'found' | 'not_found' | 'new_patient'

interface WalkInFormProps {
    onSuccess: () => void
}

function getCurrentTimeStr() {
    const now = new Date()
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
}

const emptyVisit = () => ({
    reason: '',
    visit_date: getTodayIST(),
    visit_time: getCurrentTimeStr(),
    visiting_fee: '',
    payment_status: 'unpaid',
})

const emptyNewPatient = () => ({
    name: '',
    age: '',
    sex: '',
    address: '',
})

export function WalkInForm({ onSuccess }: WalkInFormProps) {
    const [phone, setPhone] = useState('')
    const [formState, setFormState] = useState<FormState>('idle')
    const [matchedPatient, setMatchedPatient] = useState<Patient | null>(null)
    const [matchCount, setMatchCount] = useState(0)
    const [referencePatientId, setReferencePatientId] = useState<string | null>(null)
    const [newPatient, setNewPatient] = useState(emptyNewPatient())
    const [visit, setVisit] = useState(emptyVisit())
    const [submitting, setSubmitting] = useState(false)

    // Phone search — debounced 300ms, fires when ≥ 4 digits
    useEffect(() => {
        if (phone.length < 4) {
            setFormState('idle')
            setMatchedPatient(null)
            setMatchCount(0)
            return
        }

        setFormState('searching')
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/patients?phone_number=${encodeURIComponent(phone)}`)
                if (!res.ok) throw new Error('Search failed')
                const data: Patient[] = await res.json()
                if (data.length > 0) {
                    setMatchedPatient(data[0])
                    setMatchCount(data.length)
                    setFormState('found')
                } else {
                    setMatchedPatient(null)
                    setMatchCount(0)
                    setFormState('not_found')
                }
            } catch {
                setMatchedPatient(null)
                setFormState('not_found')
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [phone])

    const handleCreateNewPatient = () => {
        setReferencePatientId(matchedPatient?.patient_id ?? null)
        setNewPatient(emptyNewPatient())
        setFormState('new_patient')
    }

    const resetForm = () => {
        setPhone('')
        setFormState('idle')
        setMatchedPatient(null)
        setMatchCount(0)
        setReferencePatientId(null)
        setNewPatient(emptyNewPatient())
        setVisit(emptyVisit())
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)

        try {
            let patientId: string

            if (formState === 'found' && matchedPatient) {
                patientId = matchedPatient.patient_id
            } else {
                // not_found or new_patient — create patient first
                const created = await api.createPatient({
                    name: newPatient.name,
                    phone_number: phone,
                    age: newPatient.age ? parseInt(newPatient.age) : undefined,
                    sex: newPatient.sex || undefined,
                    address: newPatient.address || undefined,
                    reference_patient_id: referencePatientId || undefined,
                    dob: null,
                }) as { patient_id: string }
                patientId = created.patient_id
            }

            await api.createVisit({
                patient_id: patientId,
                visit_date: visit.visit_date,
                visit_time: visit.visit_time || undefined,
                status: 'scheduled',
                reason: visit.reason || undefined,
                visiting_fee: visit.visiting_fee ? parseFloat(visit.visiting_fee) : 0,
                amount_paid: 0,
                payment_status: visit.payment_status,
            })

            toast.success(
                formState === 'found'
                    ? `Appointment booked for ${matchedPatient!.name}`
                    : 'Patient created and appointment booked'
            )
            resetForm()
            onSuccess()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save')
        } finally {
            setSubmitting(false)
        }
    }

    const showVisitFields = formState === 'found' || formState === 'not_found' || formState === 'new_patient'

    return (
        <Card className="flex flex-col h-full overflow-hidden">
            <CardHeader className="pb-3 pt-5 px-5 shrink-0">
                <CardTitle className="text-lg">Walk-in / Book Appointment</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto px-5 pb-5">
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Phone input */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Phone Number</label>
                        <div className="relative">
                            <Input
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                placeholder="Enter phone number to search..."
                                className="pr-8"
                                autoComplete="off"
                                readOnly={formState === 'new_patient'}
                            />
                            {formState === 'searching' && (
                                <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                        </div>
                    </div>

                    {/* Found state — patient card */}
                    {formState === 'found' && matchedPatient && (
                        <div className="space-y-2">
                            <div className="flex items-start gap-2 p-3 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
                                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm leading-none">{matchedPatient.name}</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {[matchedPatient.age ? `${matchedPatient.age}y` : null, matchedPatient.sex].filter(Boolean).join(' · ')}
                                    </p>
                                    {matchCount > 1 && (
                                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                            {matchCount} patients share this number
                                        </p>
                                    )}
                                </div>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={handleCreateNewPatient}
                            >
                                <UserPlus className="mr-2 h-3.5 w-3.5" />
                                Create New Patient with this number
                            </Button>
                        </div>
                    )}

                    {/* Not found — new patient fields */}
                    {formState === 'not_found' && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 p-2 rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30">
                                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                                <p className="text-xs text-red-700 dark:text-red-400 font-medium">Patient not found — enter details to register</p>
                            </div>
                            {renderNewPatientFields()}
                        </div>
                    )}

                    {/* New patient mode */}
                    {formState === 'new_patient' && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 p-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
                                <UserPlus className="h-4 w-4 text-blue-500 shrink-0" />
                                <p className="text-xs text-blue-700 dark:text-blue-400 font-medium">
                                    New patient — referred by {matchedPatient?.name}
                                </p>
                            </div>
                            {renderNewPatientFields()}
                        </div>
                    )}

                    {/* Visit fields */}
                    {showVisitFields && (
                        <div className="space-y-3 pt-2 border-t">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Appointment Details</p>
                            <div>
                                <label className="text-sm font-medium">Reason</label>
                                <Input
                                    value={visit.reason}
                                    onChange={e => setVisit(v => ({ ...v, reason: e.target.value }))}
                                    placeholder="Reason for visit (optional)"
                                    className="mt-1"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-sm font-medium">Date</label>
                                    <Input
                                        type="date"
                                        value={visit.visit_date}
                                        onChange={e => setVisit(v => ({ ...v, visit_date: e.target.value }))}
                                        className="mt-1"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Time</label>
                                    <Input
                                        type="time"
                                        value={visit.visit_time}
                                        onChange={e => setVisit(v => ({ ...v, visit_time: e.target.value }))}
                                        className="mt-1"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-sm font-medium">Fee (₹)</label>
                                    <Input
                                        type="number"
                                        min="0"
                                        value={visit.visiting_fee}
                                        onChange={e => setVisit(v => ({ ...v, visiting_fee: e.target.value }))}
                                        placeholder="0"
                                        className="mt-1"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Payment</label>
                                    <Select
                                        value={visit.payment_status}
                                        onValueChange={val => setVisit(v => ({ ...v, payment_status: val }))}
                                    >
                                        <SelectTrigger className="mt-1">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="unpaid">Unpaid</SelectItem>
                                            <SelectItem value="partial">Partial</SelectItem>
                                            <SelectItem value="full">Paid</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <Button type="submit" className="w-full" disabled={submitting}>
                                {submitting ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                                ) : formState === 'found' ? (
                                    'Book Appointment'
                                ) : (
                                    'Create Patient & Book'
                                )}
                            </Button>
                        </div>
                    )}

                    {/* Idle placeholder */}
                    {formState === 'idle' && (
                        <p className="text-sm text-muted-foreground text-center py-6">
                            Enter the patient&apos;s phone number above to begin
                        </p>
                    )}
                </form>
            </CardContent>
        </Card>
    )

    function renderNewPatientFields() {
        return (
            <>
                <div>
                    <label className="text-sm font-medium">Full Name <span className="text-destructive">*</span></label>
                    <Input
                        value={newPatient.name}
                        onChange={e => setNewPatient(p => ({ ...p, name: e.target.value }))}
                        placeholder="Patient name"
                        required
                        className="mt-1"
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-sm font-medium">Age</label>
                        <Input
                            type="number"
                            min="0"
                            max="120"
                            value={newPatient.age}
                            onChange={e => setNewPatient(p => ({ ...p, age: e.target.value }))}
                            placeholder="e.g. 30"
                            className="mt-1"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium">Sex</label>
                        <Select
                            value={newPatient.sex}
                            onValueChange={val => setNewPatient(p => ({ ...p, sex: val }))}
                        >
                            <SelectTrigger className="mt-1">
                                <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Male">Male</SelectItem>
                                <SelectItem value="Female">Female</SelectItem>
                                <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div>
                    <label className="text-sm font-medium">Address</label>
                    <Input
                        value={newPatient.address}
                        onChange={e => setNewPatient(p => ({ ...p, address: e.target.value }))}
                        placeholder="Address (optional)"
                        className="mt-1"
                    />
                </div>
            </>
        )
    }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npm run lint 2>&1 | grep -E "WalkInForm|error TS" | head -20
```
Expected: no errors on WalkInForm.tsx.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/WalkInForm.tsx
git commit -m "feat: add WalkInForm component with phone-first patient search and walk-in booking"
```

---

## Task 4: Dashboard page overhaul

**Files:**
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `<WalkInForm onSuccess={fetchVisits} />`
- Consumes: existing `renderTodaysList()` (kept as-is)

- [ ] **Step 1: Rewrite `frontend/app/page.tsx`**

Replace the entire file with:

```tsx
"use client"

import { Button } from "@/components/ui/button"
import { CreditCard, Loader2, Pencil, Phone, Trash2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn, getTodayIST } from "@/lib/utils"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth_context"
import { EditVisitDialog } from "@/components/EditVisitDialog"
import { WalkInForm } from "@/components/WalkInForm"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VisitsTab } from "@/components/VisitsTab"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, type Visit, type Patient } from "@/lib/api"

function formatTime(timeStr: string | null | undefined, createdAt?: string | null) {
    if (!timeStr) {
        if (!createdAt) return "ASAP"
        try {
            const date = new Date(createdAt)
            const h = date.getHours()
            const m = date.getMinutes().toString().padStart(2, '0')
            const ampm = h >= 12 ? 'PM' : 'AM'
            return `${h % 12 || 12}:${m} ${ampm}`
        } catch { return "ASAP" }
    }
    try {
        const [hours, minutes] = timeStr.split(':')
        const h = parseInt(hours, 10)
        const ampm = h >= 12 ? 'PM' : 'AM'
        return `${h % 12 || 12}:${minutes} ${ampm}`
    } catch { return timeStr }
}

function formatUpdatedTime(updatedAtStr?: string, createdAtStr?: string) {
    if (!updatedAtStr) return null
    try {
        const created = createdAtStr ? new Date(createdAtStr).getTime() : 0
        const updated = new Date(updatedAtStr).getTime()
        if (Math.abs(updated - created) > 5000) {
            const date = new Date(updatedAtStr)
            const h = date.getHours()
            const m = date.getMinutes().toString().padStart(2, '0')
            const ampm = h >= 12 ? 'PM' : 'AM'
            return `${h % 12 || 12}:${m} ${ampm}`
        }
    } catch { /* ignore */ }
    return null
}

const PatientContactPopover = ({ patientId }: { patientId: string }) => {
    const [patient, setPatient] = useState<Patient | null>(null)
    const [loading, setLoading] = useState(false)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        if (open && !patient) {
            setLoading(true)
            api.getPatient(patientId)
                .then(setPatient)
                .catch(console.error)
                .finally(() => setLoading(false))
        }
    }, [open, patient, patientId])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    className="inline-flex items-center justify-center p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                    onClick={e => e.stopPropagation()}
                >
                    <Phone className="h-3.5 w-3.5" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-4" onClick={e => e.stopPropagation()}>
                <h4 className="font-semibold leading-none mb-3">Contact</h4>
                {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : patient ? (
                    <div className="space-y-2 text-sm">
                        <div><span className="font-medium">Name: </span>{patient.name}</div>
                        <div><span className="font-medium">Phone: </span>{patient.phone_number}</div>
                    </div>
                ) : (
                    <p className="text-sm text-destructive">Failed to load</p>
                )}
            </PopoverContent>
        </Popover>
    )
}

export default function Dashboard() {
    const [visits, setVisits] = useState<Visit[]>([])
    const [loading, setLoading] = useState(true)
    const [editVisitOpen, setEditVisitOpen] = useState(false)
    const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)

    const { role, isLoading } = useAuth()
    const router = useRouter()

    useEffect(() => {
        if (!isLoading && role === 'doctor') router.push('/doctor')
    }, [role, isLoading, router])

    const fetchVisits = async () => {
        try {
            setLoading(true)
            const all = await api.getVisits()
            setVisits(all.filter(v => v.status !== 'deleted'))
        } catch (err) {
            console.error("Failed to fetch visits:", err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchVisits() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    if (isLoading || role === 'doctor') {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    const today = getTodayIST()
    const todayVisits = visits.filter(v => v.visit_date === today)
    const orderedTodayVisits = [...todayVisits].sort((a, b) => {
        const timeA = a.visit_time || "23:59"
        const timeB = b.visit_time || "23:59"
        return timeA === timeB
            ? (a.created_at || "").localeCompare(b.created_at || "")
            : timeA.localeCompare(timeB)
    })
    const waitingCount = todayVisits.filter(v =>
        !['in_progress', 'done', 'cancelled'].includes(v.status.toLowerCase())
    ).length

    const handleDeleteVisit = async (visitId: string) => {
        if (!confirm("Delete this visit?")) return
        try {
            await api.updateVisit(visitId, { status: 'deleted' })
            fetchVisits()
        } catch { /* silent */ }
    }

    const handleDoneAndBill = async (visit: Visit) => {
        try {
            if (visit.status !== 'done') {
                await api.updateVisit(visit.visit_id, { status: 'done' })
            }
            router.push(`/billing?patient_id=${visit.patient_id}&visit_id=${visit.visit_id}`)
        } catch (err) {
            console.error("Failed to complete visit:", err)
        }
    }

    const renderTodaysList = () => (
        <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader className="pb-3 pt-5 px-5 shrink-0">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Today&apos;s List</CardTitle>
                    <span className="text-xs font-normal text-muted-foreground bg-secondary px-2 py-1 rounded-md">
                        {loading ? "..." : waitingCount} Waiting
                    </span>
                </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0 custom-scrollbar">
                <style jsx global>{`
                    .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                    .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 20px; }
                    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #94a3b8; }
                `}</style>
                {loading ? (
                    <div className="py-10 text-center text-muted-foreground text-sm">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Loading...
                    </div>
                ) : orderedTodayVisits.length === 0 ? (
                    <div className="py-4 mx-5 text-center text-muted-foreground text-sm border-2 border-dashed rounded-lg mt-2">
                        No appointments today.
                    </div>
                ) : (
                    <div className="space-y-0 text-sm">
                        {orderedTodayVisits.map(visit => (
                            <div
                                key={visit.visit_id}
                                className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 border-b last:border-0 border-border/50 hover:bg-muted/30 transition-all rounded-sm px-5"
                            >
                                <div className="space-y-0.5 text-left overflow-hidden">
                                    <div className="flex items-center gap-2">
                                        <p className="font-medium text-sm leading-none truncate">{visit.patient_name}</p>
                                        {visit.patient_id && <PatientContactPopover patientId={visit.patient_id} />}
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate">{visit.reason || "No reason"}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="flex flex-col items-end mr-1">
                                        <span className="text-xs font-mono text-muted-foreground tabular-nums">
                                            {formatTime(visit.visit_time, visit.created_at)}
                                        </span>
                                        {formatUpdatedTime(visit.updated_at, visit.created_at) && (
                                            <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 tabular-nums">
                                                Edited {formatUpdatedTime(visit.updated_at, visit.created_at)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost" size="icon"
                                            className="h-8 w-8 rounded-full hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-500/20"
                                            onClick={() => handleDoneAndBill(visit)}
                                            title="Done & Bill"
                                        >
                                            <CreditCard className="h-4 w-4 text-muted-foreground" />
                                        </Button>
                                        <Button
                                            variant="ghost" size="icon"
                                            className="h-8 w-8 rounded-full hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-500/20"
                                            onClick={() => { setSelectedVisit(visit); setEditVisitOpen(true) }}
                                            title="Edit"
                                        >
                                            <Pencil className="h-4 w-4 text-muted-foreground" />
                                        </Button>
                                        <Button
                                            variant="ghost" size="icon"
                                            className="h-8 w-8 rounded-full hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-500/20"
                                            onClick={() => handleDeleteVisit(visit.visit_id)}
                                            title="Delete"
                                        >
                                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )

    return (
        <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
            <div className="flex flex-col gap-1 flex-shrink-0">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
                <p className="text-muted-foreground text-sm">Walk-in registration and today&apos;s appointments.</p>
            </div>

            <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
                <div className="mb-4">
                    <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="visits">All Visits</TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="overview" className="flex-1 overflow-hidden m-0">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
                        {/* Left 2/3: Walk-in form */}
                        <div className="lg:col-span-2 h-full overflow-hidden">
                            <WalkInForm onSuccess={fetchVisits} />
                        </div>
                        {/* Right 1/3: Today's list */}
                        <div className="lg:col-span-1 h-full flex flex-col gap-6 pr-1 overflow-hidden">
                            {renderTodaysList()}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="visits" className="h-[calc(100%-40px)] m-0">
                    <VisitsTab visits={visits} loading={loading} onRefresh={fetchVisits} />
                </TabsContent>
            </Tabs>

            <EditVisitDialog
                open={editVisitOpen}
                onOpenChange={setEditVisitOpen}
                visit={selectedVisit}
                onSuccess={fetchVisits}
            />
        </div>
    )
}
```

- [ ] **Step 2: Verify no leftover imports**

```bash
cd frontend && npm run lint 2>&1 | grep "page.tsx" | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat: overhaul dashboard — remove calendar, add 3-panel layout with WalkInForm"
```

---

## Task 5: Settings context — patient column constants

**Files:**
- Modify: `frontend/lib/settings_context.tsx`

**Interfaces:**
- Produces: `ALL_PATIENT_COLUMNS` exported constant (array of `{id, label, required}`)
- Produces: `DEFAULT_PATIENT_COLUMNS` exported constant (string array)
- Produces: `defaultPatientColumns: string[]` in context value

- [ ] **Step 1: Add column constants after existing inventory constants**

In `frontend/lib/settings_context.tsx`, after line 25 (after `DEFAULT_INVENTORY_COLUMNS`), add:

```typescript
export const ALL_PATIENT_COLUMNS = [
    { id: 'patient_id',   label: 'ID',          required: false },
    { id: 'name',         label: 'Name',         required: true  },
    { id: 'phone_number', label: 'Phone',        required: false },
    { id: 'age',          label: 'Age',          required: false },
    { id: 'sex',          label: 'Sex',          required: false },
    { id: 'address',      label: 'Address',      required: false },
    { id: 'reference',    label: 'Referred By',  required: false },
    { id: 'created_at',   label: 'Joined',       required: false },
] as const

export const DEFAULT_PATIENT_COLUMNS = ['name', 'phone_number', 'age', 'sex']
```

- [ ] **Step 2: Add `defaultPatientColumns` to the interface**

In the `SettingsContextType` interface, add after `defaultInventoryColumns: string[]`:
```typescript
    defaultPatientColumns: string[]
```

- [ ] **Step 3: Add state and localStorage in `SettingsProvider`**

Add state after the existing `defaultInventoryColumns` state line (line 50):
```typescript
    const [defaultPatientColumns, setDefaultPatientColumns] = useState<string[]>(DEFAULT_PATIENT_COLUMNS)
```

In the `useEffect` that reads localStorage, add after the `storedCols` block:
```typescript
        const storedPatientCols = localStorage.getItem("patient_columns")
        // ... existing code ...
        if (storedPatientCols) {
            try {
                const parsed = JSON.parse(storedPatientCols)
                if (Array.isArray(parsed) && parsed.length > 0) setDefaultPatientColumns(parsed)
            } catch { /* ignore */ }
        }
```

- [ ] **Step 4: Add handler in `setSettings`**

After the `defaultInventoryColumns` block in `setSettings`:
```typescript
        if (settings.defaultPatientColumns !== undefined) {
            const cols = ['name', ...settings.defaultPatientColumns.filter(c => c !== 'name')]
            setDefaultPatientColumns(cols)
            localStorage.setItem("patient_columns", JSON.stringify(cols))
        }
```

- [ ] **Step 5: Add to provider value**

In the `<SettingsContext.Provider value={{...}}>`, add `defaultPatientColumns` to the value object.

- [ ] **Step 6: Verify**

```bash
cd frontend && npm run lint 2>&1 | grep "settings_context" | head -10
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/settings_context.tsx
git commit -m "feat: add ALL_PATIENT_COLUMNS and defaultPatientColumns to settings context"
```

---

## Task 6: Patients page — column visibility toggle

**Files:**
- Modify: `frontend/app/patients/page.tsx`

**Interfaces:**
- Consumes: `ALL_PATIENT_COLUMNS`, `defaultPatientColumns` from `useSettings()`
- Consumes: `Patient.reference_patient_name` from Task 2

- [ ] **Step 1: Add imports**

Add to imports at top of `frontend/app/patients/page.tsx`:
```typescript
import { Columns } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ALL_PATIENT_COLUMNS } from "@/lib/settings_context"
```

Change:
```typescript
import { useSettings } from "@/lib/settings_context"
```
to:
```typescript
import { useSettings, ALL_PATIENT_COLUMNS } from "@/lib/settings_context"
```

- [ ] **Step 2: Add `visibleColumns` state**

In the component body, after existing state declarations, add:
```typescript
    const { role, appFontSize, defaultPatientColumns } = useSettings()
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(defaultPatientColumns))

    useEffect(() => {
        setVisibleColumns(new Set(defaultPatientColumns))
    }, [defaultPatientColumns])

    const toggleColumn = (id: string) => {
        if (id === 'name') return // always required
        setVisibleColumns(prev => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }
```

Remove the old `const { appFontSize } = useSettings()` line if present (replaced above).

- [ ] **Step 3: Add Columns button to the page header**

In the header buttons row (near the Export/Import buttons), add a Columns toggle button:
```tsx
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="shadow-sm h-9">
                                <Columns className="mr-1.5 h-3.5 w-3.5" />
                                Columns
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2" align="end">
                            <h4 className="font-medium leading-none mb-2 px-2 text-sm">Toggle Columns</h4>
                            {ALL_PATIENT_COLUMNS.map(col => (
                                <label
                                    key={col.id}
                                    className={`flex items-center gap-2 text-sm rounded px-2 py-1 hover:bg-accent transition-colors ${col.required ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={visibleColumns.has(col.id)}
                                        onChange={() => toggleColumn(col.id)}
                                        disabled={col.required}
                                        className="h-4 w-4 rounded border-gray-300"
                                    />
                                    {col.label}
                                    {col.required && <span className="text-xs text-muted-foreground ml-auto">(always)</span>}
                                </label>
                            ))}
                        </PopoverContent>
                    </Popover>
```

- [ ] **Step 4: Replace `appFontSize <= 16` conditionals in table headers**

Find the `<TableHeader>` block (around line 201). Replace all conditional header cells:

```tsx
                                        <TableRow>
                                            {visibleColumns.has('patient_id') && <TableHead>Public ID</TableHead>}
                                            <TableHead>Name</TableHead>
                                            {visibleColumns.has('phone_number') && <TableHead>Phone</TableHead>}
                                            {visibleColumns.has('age') && <TableHead>Age</TableHead>}
                                            {visibleColumns.has('sex') && <TableHead>Sex</TableHead>}
                                            {visibleColumns.has('address') && <TableHead>Address</TableHead>}
                                            {visibleColumns.has('reference') && <TableHead>Referred By</TableHead>}
                                            {visibleColumns.has('created_at') && <TableHead>Joined</TableHead>}
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
```

- [ ] **Step 5: Replace `appFontSize <= 16` conditionals in table body rows**

In the `filteredPatients.map(...)` row, replace all conditional cells:

```tsx
                                                <TableRow key={`${patient.patient_id}-${index}`}>
                                                    {visibleColumns.has('patient_id') && (
                                                        <TableCell className="font-medium font-mono text-xs text-muted-foreground">
                                                            {patient.patient_id}
                                                        </TableCell>
                                                    )}
                                                    <TableCell className="font-semibold">{patient.name}</TableCell>
                                                    {visibleColumns.has('phone_number') && (
                                                        <TableCell>{patient.phone_number}</TableCell>
                                                    )}
                                                    {visibleColumns.has('age') && (
                                                        <TableCell>
                                                            {patient.age || (patient.dob ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)) : "N/A")}
                                                        </TableCell>
                                                    )}
                                                    {visibleColumns.has('sex') && (
                                                        <TableCell>{patient.sex || "N/A"}</TableCell>
                                                    )}
                                                    {visibleColumns.has('address') && (
                                                        <TableCell className="max-w-[150px] truncate" title={patient.address || ""}>{patient.address || "N/A"}</TableCell>
                                                    )}
                                                    {visibleColumns.has('reference') && (
                                                        <TableCell className="max-w-[150px] truncate" title={patient.reference_patient_name || ""}>
                                                            {patient.reference_patient_name || "—"}
                                                        </TableCell>
                                                    )}
                                                    {visibleColumns.has('created_at') && (
                                                        <TableCell>{patient.created_at ? new Date(patient.created_at).toLocaleDateString() : "N/A"}</TableCell>
                                                    )}
                                                    <TableCell className="text-right">
                                                        {/* existing action buttons unchanged */}
                                                    </TableCell>
                                                </TableRow>
```

- [ ] **Step 6: Verify**

```bash
cd frontend && npm run lint 2>&1 | grep "patients/page" | head -10
```
Expected: no TypeScript errors. Open `localhost:3000/patients` in browser — Columns button should appear and toggling should show/hide columns instantly.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/patients/page.tsx
git commit -m "feat: add column visibility toggle to Patients page"
```

---

## Task 7: Admin settings — Patient Columns card

**Files:**
- Modify: `frontend/app/admin/page.tsx`

**Interfaces:**
- Consumes: `ALL_PATIENT_COLUMNS`, `DEFAULT_PATIENT_COLUMNS`, `defaultPatientColumns`, `setSettings` from `useSettings()`

- [ ] **Step 1: Add imports to admin page**

At the top of `frontend/app/admin/page.tsx`, the existing import from settings_context should already have `ALL_INVENTORY_COLUMNS` and `DEFAULT_INVENTORY_COLUMNS`. Add the patient equivalents:

Find:
```typescript
import { useSettings, ALL_INVENTORY_COLUMNS, DEFAULT_INVENTORY_COLUMNS } from "@/lib/settings_context"
```
Replace with:
```typescript
import { useSettings, ALL_INVENTORY_COLUMNS, DEFAULT_INVENTORY_COLUMNS, ALL_PATIENT_COLUMNS, DEFAULT_PATIENT_COLUMNS } from "@/lib/settings_context"
```

- [ ] **Step 2: Extend `SettingsTab` — add patient columns state**

In `SettingsTab()` (starts around line 758), after the existing `localCols` block:

```typescript
    // ── Patient columns state ──
    const { defaultPatientColumns } = useSettings()
    const [localPatientCols, setLocalPatientCols] = useState<Set<string>>(new Set(defaultPatientColumns))
    useEffect(() => { setLocalPatientCols(new Set(defaultPatientColumns)) }, [defaultPatientColumns])

    const togglePatientCol = (id: string) => {
        if (id === 'name') return
        setLocalPatientCols(prev => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }

    const handleSavePatientCols = () => {
        setSettings({ defaultPatientColumns: Array.from(localPatientCols) })
        toast.success('Patient column defaults saved')
    }

    const handleResetPatientCols = () => {
        setLocalPatientCols(new Set(DEFAULT_PATIENT_COLUMNS))
        setSettings({ defaultPatientColumns: DEFAULT_PATIENT_COLUMNS })
        toast.success('Patient columns reset to defaults')
    }
```

Note: `SettingsTab` already destructures `setSettings` from `useSettings()` at line 759. The `defaultPatientColumns` destructure above will cause a duplicate — merge it into the existing destructure line:
```typescript
    const { expiryReminderMonths, defaultInventoryColumns, defaultMinStock, defaultPatientColumns, setSettings } = useSettings()
```
Then remove the separate `const { defaultPatientColumns } = useSettings()` line.

- [ ] **Step 3: Add Patient Columns card to the JSX**

In the `SettingsTab` return JSX, after the closing `</div>` of the Inventory Default Columns card (after line ~973 `</div>`), add:

```tsx
            {/* ── Patient Page Default Columns ── */}
            <div>
                <h2 className="text-lg font-semibold mb-1">Patient Page Default Columns</h2>
                <p className="text-sm text-muted-foreground">
                    Choose which columns are shown by default in the Patients table. Users can still toggle per-session.
                </p>
            </div>
            <div className="rounded-lg border p-4 space-y-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    {ALL_PATIENT_COLUMNS.map(col => (
                        <label
                            key={col.id}
                            className={`flex items-center gap-2 text-sm rounded px-2 py-1 hover:bg-accent transition-colors ${col.required ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                            <input
                                type="checkbox"
                                checked={localPatientCols.has(col.id)}
                                onChange={() => togglePatientCol(col.id)}
                                disabled={col.required}
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            />
                            <span className="font-medium leading-none">{col.label}</span>
                            {col.required && <span className="text-xs text-muted-foreground">(always on)</span>}
                        </label>
                    ))}
                </div>
                <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={handleSavePatientCols}>Save Defaults</Button>
                    <Button size="sm" variant="ghost" onClick={handleResetPatientCols}>Reset</Button>
                </div>
            </div>
```

- [ ] **Step 4: Verify**

```bash
cd frontend && npm run lint 2>&1 | grep "admin/page" | head -10
```
Expected: no errors. Open `localhost:3000/admin` → Settings tab → "Patient Page Default Columns" card should appear with 8 column checkboxes (Name checked and disabled).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/admin/page.tsx
git commit -m "feat: add Patient Page Default Columns card to Admin Settings"
```

---

## Self-Review

**Spec coverage:**
- ✅ Remove calendar/DnD (Task 4)
- ✅ 3-panel layout: walk-in form (2/3) + today's list (1/3) (Task 4)
- ✅ Phone-first search with debounce ≥ 4 digits (Task 3)
- ✅ Found state: read-only patient card + "N patients share this number" note (Task 3)
- ✅ "Create New Patient" button visible in found state (Task 3)
- ✅ Not found state: red banner + editable fields (Task 3)
- ✅ New patient mode: phone locked, reference captured silently (Task 3)
- ✅ Visit fields in all active states (Task 3)
- ✅ Submit: existing patient → visit only; new patient → create + visit (Task 3)
- ✅ Reset after success, toast (Task 3)
- ✅ reference string → reference_patient_id FK (Task 1)
- ✅ Migrations: ADD reference_patient_id, DROP reference (Task 1)
- ✅ CRUD endpoints updated (Task 1)
- ✅ reference_patient_name in list and detail responses (Task 1)
- ✅ Self-reference validation (Task 1)
- ✅ Export CSV updated (Task 1)
- ✅ Import CSV ignores reference column (Task 1)
- ✅ Patient type in api.ts updated (Task 2)
- ✅ EditPatientDialog uses PatientSearch for reference (Task 2)
- ✅ AddPatientDialog reference field removed (Task 2)
- ✅ ALL_PATIENT_COLUMNS + DEFAULT_PATIENT_COLUMNS (Task 5)
- ✅ defaultPatientColumns in context (Task 5)
- ✅ Patients page Columns toggle button (Task 6)
- ✅ appFontSize conditionals replaced with visibleColumns.has() (Task 6)
- ✅ reference column shows reference_patient_name (Task 6)
- ✅ Admin Settings: Patient Columns card (Task 7)

**Placeholder scan:** None found.

**Type consistency:** `ALL_PATIENT_COLUMNS` uses id `'reference'` (for the UI column key) which maps to data field `patient.reference_patient_name` — this is intentional and consistent across Task 5 (definition), Task 6 (usage), Task 7 (admin).
