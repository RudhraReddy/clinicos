# Dashboard Overhaul — Design Spec
**Date:** 2026-07-13

## Overview

Four coordinated changes:
1. **Dashboard layout overhaul** — remove calendar, replace with 3-panel layout (walk-in form + today's visits)
2. **Combined walk-in form** — phone-first patient search + visit booking in one inline flow
3. **Reference field migration** — `patients.reference` string → `reference_patient_id` FK to `patients.patient_id`
4. **Patient page column visibility** — admin-configurable default columns, per-session toggle

---

## 1. Dashboard Layout

**File:** `frontend/app/page.tsx`

Remove:
- `CalendarComponent` import and usage
- `DndProvider` / `HTML5Backend` / `react-dnd` imports
- `showCalendar` state and toggle button
- `handleEventDrop`, `handleSelectSlot`, `calendarAddOpen`, `selectedDate`, `selectedTime` state
- `AddVisitDialog` (replaced by inline form)
- `AddPatientDialog` (replaced by inline form)
- `renderQuickActions()` function

Replace overview tab content with a fixed 3-column grid:

```
┌───────────────────────────────────────────────────┬──────────────────┐
│         Walk-in / Booking Form  (col-span-2)       │  Today's List    │
│                                                   │  (col-span-1)    │
└───────────────────────────────────────────────────┴──────────────────┘
```

- Left 2/3: new `<WalkInForm onSuccess={fetchVisits} />` component
- Right 1/3: existing `renderTodaysList()` (unchanged)
- "All Visits" tab remains

---

## 2. Combined Walk-in Form

**New file:** `frontend/components/WalkInForm.tsx`

### Search flow

Phone number input is the single entry point. Debounced search fires after 300 ms when input length ≥ 4.

### States

| State | Condition | UI shown |
|---|---|---|
| **Idle** | < 4 digits | Placeholder: "Enter patient's phone number to begin" |
| **Searching** | Debouncing / fetching | Spinner next to input |
| **Found** | ≥ 1 match | Read-only patient card + visit fields + submit |
| **Not found** | 0 matches | Red inline banner + editable patient fields + visit fields + submit |
| **New patient mode** | "Create New Patient" clicked | Phone locked, editable patient fields pre-cleared, visit fields, reference set silently |

### Found state detail

- Shows first matched patient as a read-only card: name, age, sex
- If multiple patients share the phone number, show a subtle note: "N patients share this number"
- "Create New Patient" button always visible in this state
- `reference_patient_id` is set to the first matched patient's `patient_id` when entering new patient mode

### Not found state detail

- Red inline badge: "Patient not found"
- Editable fields appear: Name (required), Age, Sex, Address
- No `reference_patient_id` set (patient has no prior record at this number)

### New patient mode detail

- Triggered by clicking "Create New Patient" from found state
- Phone input becomes locked (read-only, keeps value)
- Personal fields (name, age, sex, address) are cleared and editable
- `reference_patient_id` captured silently from first matched patient; not displayed to staff
- Submit button label: "Create Patient & Book"

### Visit fields (shown in all non-idle states after patient determined)

- Reason (text input, optional)
- Date (date input, defaults to today IST)
- Time (time input, defaults to current time)
- Visiting Fee (number input, optional)
- Payment Status (select: unpaid / partial / full, defaults to unpaid)

### Submit behavior

| Mode | Action |
|---|---|
| Found (existing patient) | `POST /api/visits` with matched `patient_id` |
| Not found | `POST /api/patients` → then `POST /api/visits` with new patient's ID |
| New patient mode | `POST /api/patients` (with `reference_patient_id`) → then `POST /api/visits` |

After any successful submit: show toast, reset form to idle state, call `onSuccess()` to refresh today's list.

The form always shows the **first** patient returned by the phone search. If staff need to book for a different patient sharing the same number, they must search from the Patients page.

### Error handling

- Patient creation failure: toast error, stay on form (do not navigate away)
- Visit creation failure after patient was already created: toast error with the new patient's ID so staff can manually book from the dashboard or Patients page

---

## 3. Reference Field Migration

### Backend — `Backend_db/models.py`

Remove:
```python
reference = db.Column(db.String(100))
```

Add:
```python
reference_patient_id = db.Column(db.String(8), db.ForeignKey('patients.patient_id', ondelete='SET NULL'), nullable=True)
```

### Backend — `Backend_db/app.py` (`_apply_migrations`)

Add two migration steps in order:
1. `ALTER TABLE patients ADD COLUMN IF NOT EXISTS reference_patient_id VARCHAR(8) REFERENCES patients(patient_id) ON DELETE SET NULL`
2. `ALTER TABLE patients DROP COLUMN IF EXISTS reference`

Step 2 is a destructive migration — existing free-text reference data will be permanently lost. This is intentional per the design decision.

### Backend — `Backend_db/routes/patients.py`

**GET `/api/patients` and `GET /api/patients/<id>` responses:** include:
```json
{
  "reference_patient_id": "abc12345",
  "reference_patient_name": "Raju Kumar"
}
```
`reference_patient_name` is resolved via a join on `Patient.patient_id == reference_patient_id`. If null, both fields are `null`.

**`POST /api/patients`:** accept `reference_patient_id` from request body (string, nullable). Validate it exists in patients table if provided. Remove `reference` field handling.

**`PUT /api/patients/<id>`:** accept `reference_patient_id`. Remove `reference` field handling.

**Validation:** reject `reference_patient_id == patient_id` (a patient cannot reference themselves).

### Frontend — `frontend/lib/api.ts`

- `Patient` type: remove `reference?: string`, add `reference_patient_id?: string | null`, `reference_patient_name?: string | null`
- `createPatient` and `updatePatient` payloads: use `reference_patient_id` instead of `reference`

### Frontend — patient display

Anywhere `patient.reference` was rendered, replace with `patient.reference_patient_name ?? '—'`.

---

## 4. Patient Page Column Visibility

### `frontend/lib/settings_context.tsx`

Add alongside existing `ALL_INVENTORY_COLUMNS`:

```ts
export const ALL_PATIENT_COLUMNS = [
  { id: 'patient_id',    label: 'ID',          required: false },
  { id: 'name',          label: 'Name',         required: true  },
  { id: 'phone_number',  label: 'Phone',        required: false },
  { id: 'age',           label: 'Age',          required: false },
  { id: 'sex',           label: 'Sex',          required: false },
  { id: 'address',       label: 'Address',      required: false },
  { id: 'reference',     label: 'Referred By',  required: false },
  { id: 'created_at',    label: 'Joined',       required: false },
]

export const DEFAULT_PATIENT_COLUMNS = ['name', 'phone_number', 'age', 'sex']
```

Add to `SettingsContextType`:
```ts
defaultPatientColumns: string[]
```

Add state, `useEffect` loader (localStorage key: `patient_columns`), and `setSettings` handler — exact same pattern as `defaultInventoryColumns`.

### `frontend/app/patients/page.tsx`

- Import `ALL_PATIENT_COLUMNS` from settings context
- Read `defaultPatientColumns` from `useSettings()`
- Add local `visibleColumns: Set<string>` state (initialized from `defaultPatientColumns`)
- Add a "Columns" button in the page header (same popover pattern as inventory page)
- Replace all `appFontSize <= 16` conditionals with `visibleColumns.has(col_id)` checks
- `reference` column shows `patient.reference_patient_name ?? '—'`
- `name` column is always rendered (required: true, cannot be toggled off)

### `frontend/app/admin/page.tsx` — Settings tab

Add a "Patient Page Columns" card below the existing inventory column controls:
- Same checkbox-grid UI
- `required: true` columns shown as checked + disabled
- On change: calls `setSettings({ defaultPatientColumns: newArray })`

---

## Files Changed Summary

| File | Change |
|---|---|
| `Backend_db/models.py` | Replace `reference` String with `reference_patient_id` FK |
| `Backend_db/app.py` | Two migration steps: ADD reference_patient_id, DROP reference |
| `Backend_db/routes/patients.py` | Update all CRUD to use new field; add reference_patient_name to responses |
| `frontend/lib/api.ts` | Update Patient type and payloads |
| `frontend/lib/settings_context.tsx` | Add ALL_PATIENT_COLUMNS, DEFAULT_PATIENT_COLUMNS, defaultPatientColumns |
| `frontend/app/page.tsx` | Remove calendar/DnD; wire in WalkInForm + today's list |
| `frontend/components/WalkInForm.tsx` | New component (walk-in form) |
| `frontend/app/patients/page.tsx` | Column visibility toggle; reference display |
| `frontend/app/admin/page.tsx` | Patient columns card in Settings tab |

---

## Out of Scope

- Doctor dashboard (`/doctor`) — not touched
- `EditPatientDialog` reference field — will be updated to show/edit `reference_patient_id` as a patient name selector, but the exact UI is left to implementation judgment
- Mobile card view on patients page — updated to respect visible columns too
