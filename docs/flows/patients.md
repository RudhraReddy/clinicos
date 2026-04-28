# Patients Flow

**Route:** `/patients`  
**File:** `frontend/app/patients/page.tsx`

---

## Purpose

Central registry for all patients. Staff can search, register, view, and edit patient records.

---

## Layout

- Header with page title and **Add Patient** button
- Connection error banner (with Retry) when backend is unreachable
- Card containing a search bar + data table

---

## Features

### Patient Table

Columns: Public ID, Name, Phone, Date of Birth, Joined, Actions

- **Search** — client-side filter on name, patient_id, and phone number (searches the already-loaded 50-patient set)
- **Eye icon** → opens `PatientDetailsView` panel showing full patient profile, visit history, billing history, and linked images
- **Edit icon** → opens `EditPatientDialog` to update demographics

### Add Patient Dialog (`AddPatientDialog`)
Fields: Name (required), Phone (required), Age, Sex (dropdown), Address, Reference

On submit: `POST /api/patients` → auto-generates a patient_id → refreshes the table.

### Edit Patient Dialog (`EditPatientDialog`)
Pre-populated form with current values.  
On submit: `PUT /api/patients/<patient_id>` → refreshes the table.

### Patient Details View (`PatientDetailsView`)
A side sheet/dialog that shows:
- Full demographics
- Visit history (from `GET /api/visits/patient/<id>`)
- Billing history (from `GET /api/billing/patient/<id>`)
- Linked images (from `GET /api/patients/<id>/images`)

---

## Data

- On mount: `api.getPatients()` → `GET /api/patients` (returns up to 50)
- Search is client-side against the loaded list — for larger datasets, typing in the backend search uses the `q` query param via `GET /api/patients?q=...`

---

## Components Used

| Component | Purpose |
|---|---|
| `AddPatientDialog` | Create new patient |
| `EditPatientDialog` | Edit existing patient |
| `PatientDetailsView` | Full patient record panel |
