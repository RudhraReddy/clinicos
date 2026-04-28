# Doctor Dashboard Flow

**Route:** `/doctor`  
**File:** `frontend/app/doctor/page.tsx`  
**Access:** Role `doctor` is automatically redirected here from `/`

---

## Purpose

A clinical workspace for the doctor. Shows today's appointment queue on the right and a detailed patient view on the left when a patient is selected.

---

## Layout

Two-pane layout:

- **Left (main, ~70%)** — patient detail workspace
- **Right sidebar (~30%)** — today's queue + summary stats

---

## Right Sidebar

### Summary Card
- Total appointments today
- Completed (status = `done`)
- Pending (not done or cancelled)

### Today's Appointments
- Filtered to today's date via `getTodayIST()`
- Sorted by `visit_time` ascending
- Each appointment shows: time, patient name, reason, status badge
- Clicking an appointment loads the patient detail in the left pane

---

## Left Pane — Patient Detail

When a patient is selected via the sidebar:

### Header
- Patient name and visit reason
- Details banner: Patient ID, Phone, Date of Birth, Age (calculated from DOB)

### Two-column content grid

#### Left Card: Latest Prescription
- `PrescriptionCarousel` component
- Looks for images tagged `Prescription - Front` and `Prescription - Back` first
- Falls back to any image tagged `Prescription` or containing "prescription" in notes
- Supports front/back navigation with arrows
- Click to open full-screen lightbox via `ImagePreviewDialog`

#### Right Card: Patient Pictures + Timeline

**Timeline Sidebar (left 1/3 of the card):**
- Lists all unique dates from visits + image timestamps
- Sorted newest first
- "Show All History" option at the top
- Clicking a date filters the image grid to that date
- Dot indicators show which dates have images

**Image Grid (right 2/3 of the card):**
- Groups images by date with a sticky date header
- Each date header shows the visit reason (or "Direct Uploads" if no visit that day)
- Images shown in a 2–3 column grid
- Hover → gradient overlay, tag label, notes preview
- Click → opens `ImagePreviewDialog` lightbox with navigation through all images in that date group

**Add Image:**
- "+ Add Image" button triggers a hidden file input
- Selecting a file shows a preview dialog with optional notes input
- Confirm → `POST /api/patients/<patient_id>/images` (linked to the current visit)

**Image Lightbox (`ImagePreviewDialog`):**
- Full-screen capable
- Navigation arrows (prev/next within the date context)
- Editable notes and tag → saved via `PUT /api/patients/images/<id>`

---

## Data Loading

On patient selection:
1. `GET /api/visits/patient/<patient_id>` — loads visit history for the timeline
2. `GET /api/patients/<patient_id>/images` — loads all images

Refreshes on:
- After image upload
- After image edit (via `refreshTrigger` state increment)

---

## Components Used

| Component | Purpose |
|---|---|
| `PrescriptionCarousel` | Shows latest prescription image(s) with navigation |
| `ImagePreviewDialog` | Full-screen image lightbox with edit support |
