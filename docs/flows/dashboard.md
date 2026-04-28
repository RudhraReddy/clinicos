# Dashboard Flow

**Route:** `/` (redirects to `/doctor` if role is `doctor`)  
**File:** `frontend/app/page.tsx`

---

## Purpose

The main landing page for frontdesk / admin staff. It gives an at-a-glance view of the day's appointments and lets staff quickly create new appointments or register patients.

---

## Layout

The page has two tabs:

### Tab 1: Overview (default)

Split into two columns:
- **Left (2/3 width):** Interactive calendar showing all visits
- **Right (1/3 width):**
  - Quick Actions card
  - Today's List card (today's appointments sorted by time)

### Tab 2: All Visits

Renders the `<VisitsTab>` component — a searchable, filterable table of all 50 most recent visits.

---

## Features

### Interactive Calendar
- Uses `react-dnd` + a custom `CalendarComponent`
- Events (appointments) can be **dragged and dropped** to reschedule them — calls `PUT /api/visits/<id>` with new date/time on drop
- Clicking an empty time slot opens `AddVisitDialog` pre-filled with the clicked date/time
- Clicking an existing event opens `EditVisitDialog`

### Quick Actions Card
- **Make Appointment** — opens `AddVisitDialog`
- **New Patient** — opens `AddPatientDialog`
- **Manage Patients** — navigates to `/patients`

### Today's List Card
- Filters all visits to just today's date (using `getTodayIST()`)
- Sorted strictly by `visit_time` ascending (undefined times pushed to end)
- Shows: patient name, visit reason, time, status badge
- Phone icon on each row triggers a lazy-loaded popover showing patient contact info
- **StatusActions component** handles inline status updates:
  - `in_progress` → clickable "In progress" button → marks as `done`
  - `done` → green pill, also shows a billing shortcut (CreditCard icon → `/billing?patient_id=...&visit_id=...`)
  - `cancelled` → red pill
  - Other statuses → three-button "Next / Now / ×" control

### Waiting Count
Header of Today's List shows the count of visits that are not yet `in_progress`, `done`, or `cancelled`.

---

## Data

- Fetched on mount via `api.getVisits()` → `GET /api/visits`
- Re-fetched after any status update, visit create, or calendar drag-drop
- Role check: if `role === 'doctor'`, redirects to `/doctor` immediately

---

## Components Used

| Component | Purpose |
|---|---|
| `CalendarComponent` | Drag-and-drop appointment calendar |
| `AddVisitDialog` | Create a new visit/appointment |
| `AddPatientDialog` | Register a new patient |
| `EditVisitDialog` | Edit an existing visit |
| `VisitsTab` | All-visits table for the second tab |
| `StatusActions` | Inline status update buttons per visit |
| `PatientContactPopover` | Hover popover showing patient phone/DOB |
