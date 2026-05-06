# Patients

**Status:** Implemented

## Overview
Manages the clinic's patient registry. Each patient is assigned a randomly generated 8-character hex ID (e.g. `A1B2C3D4`) at registration time. The feature supports creating, viewing, editing, and searching patient records.

## Affected Layers
- DB models: `Patient`
- Backend routes: `Backend_db/routes/patients.py` (blueprint `patients`, prefix `/api`)
- Frontend pages/components:
  - `frontend/app/patients/page.tsx`
  - `frontend/components/AddPatientDialog.tsx`
  - `frontend/components/EditPatientDialog.tsx`
  - `frontend/components/PatientDetailsView.tsx`
  - `frontend/components/PatientSearch.tsx` (autocomplete selector used by Billing)

## Data Flow
1. User opens `/patients`. The page calls `GET /api/patients` (no filter) on mount and stores up to 50 results.
2. A client-side search filters the loaded list by name, patient_id, or phone number — no additional backend call is made after the initial load.
3. To add a patient, the user opens `AddPatientDialog` and submits the form. The page calls `POST /api/patients` with `name` and `phone_number` (required) plus optional `age`, `sex`, `address`, `reference`.
4. The backend generates a unique `patient_id` via `secrets.token_hex(4).upper()`, persists the record, and returns the new `patient_id`.
5. To edit, `EditPatientDialog` calls `PUT /api/patients/<patient_id>` with only the changed fields.
6. `PatientDetailsView` calls `GET /api/patients/<patient_id>` to display the full profile in a modal.

## Business Rules
- `phone_number` and `name` are required at creation; all other fields are optional.
- `dob` is stored in the model but is deprecated — the field is always set to `None` on creation and is omitted from UI interactions.
- `patient_id` is generated server-side using `secrets.token_hex(4).upper()` — it is never provided by the client.
- The list endpoint applies `func.replace` to normalize phone numbers before searching (strips hyphens and spaces).
- The list endpoint returns at most 50 records per call; there is no pagination beyond that limit.
- The `GET /api/patients` endpoint supports two distinct query modes: `?phone_number=` (exact normalized match) and `?q=` (fuzzy match on name, phone, or patient_id). They are mutually exclusive — `phone_number` takes priority if both are provided.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/patients` | Create a new patient |
| GET | `/api/patients` | List patients (optional `?q=` or `?phone_number=` filter, max 50) |
| GET | `/api/patients/<patient_id>` | Get a single patient's full details |
| PUT | `/api/patients/<patient_id>` | Update patient fields (partial update) |

## Known Constraints / Risks
- There is no DELETE endpoint for patients. Patient records cannot be removed via the API.
- No duplicate-prevention logic exists — two patients can share the same name and phone number.
- The client-side search on the patients page only searches within the 50 records already loaded. If more than 50 patients exist, records not in the initial batch are invisible to the client-side filter.
- `patient_id` uniqueness relies on `secrets.token_hex(4)` — collision probability increases as the patient count grows (birthday problem over a 4-byte hex space = ~65k unique values before collision risk is non-trivial).
