# Prescriptions Flow

**Route:** `/prescriptions`  
**File:** `frontend/app/prescriptions/page.tsx`

---

## Purpose

A global log of all prescriptions issued across all patients. Read-only view for auditing or quick lookup. Supports expanding individual records to see full medicine details.

---

## Layout

- Header with page title
- Search bar (patient name or visit ID)
- Expandable table

---

## Features

### Prescription Table

**Collapsed row columns:** Expand toggle, Date, Patient Name, Medicines Count (badge), Actions (View/Hide Details)

Clicking a row or the "View Details" button expands an inline sub-table:

**Expanded sub-table columns:** Medicine, Dosage, Duration, Quantity, Notes

### Search

Client-side filter on `patient_name` and `visit_id` within the already-loaded list.

---

## Data

- On mount: `api.getAllPrescriptions()` → `GET /api/prescriptions`
- Expected response shape:
  ```json
  [
    {
      "visit_id": "...",
      "visit_date": "2024-04-28",
      "patient_name": "John Doe",
      "items": [
        {
          "item_name": "Paracetamol",
          "dosage_instructions": "1-0-1",
          "duration": "5 days",
          "quantity": 10,
          "notes": "After meals"
        }
      ]
    }
  ]
  ```

> Note: The `/api/prescriptions` endpoint is called from `lib/api.ts` but its backend route is not yet implemented in the routes shown — it may be part of a `visits` extension or a separate routes file.

---

## Navigation

- Accessible from the sidebar for both `frontdesk`/`admin` and `doctor` roles
- No write operations on this page — prescriptions are created via the Doctor Dashboard
