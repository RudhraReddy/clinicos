# Visits Flow

**Route:** `/visits`  
**File:** `frontend/app/visits/page.tsx`

---

## Purpose

A legacy/secondary visits list page. Displays all recent visits in a simple table. Note: the primary visit management UI lives on the **Dashboard** (`/`) which has the calendar and today's list. This page is more of a raw data view.

---

## Layout

- Header with **Add Visit** button
- Card with "Recent Visits" table

---

## Features

### Visits Table

**Columns:** Visit Date, Visit Time, Patient, Patient ID, Visit ID, Status, Reason

- Sorted by date descending (client-side)
- Clicking a row navigates to `/visits/<visit_id>` (individual visit detail page)

### Add Visit Dialog

A basic inline `Dialog` (not the reusable `AddVisitDialog` component):
- Fields: Patient (dropdown from full patient list), Visit Date, Reason, Prescription, Notes
- On submit: `POST /api/visits`

---

## Data

On mount, fetches in parallel:
- `api.getVisits()` → `GET /api/visits` — all visits (last 50)
- `api.getPatients()` → `GET /api/patients` — for the patient dropdown in Add Visit

---

## Relationship to Dashboard

The Dashboard (`/`) is the main operational view with the calendar and today's list. This `/visits` page is a fallback table view and is accessible via the "All Visits" tab on the Dashboard as well (via `VisitsTab` component).

---

## Components Used

| Component | Purpose |
|---|---|
| Dialog (inline) | Simple add visit form |
