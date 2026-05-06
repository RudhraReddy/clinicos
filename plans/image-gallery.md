# Image Gallery

**Status:** Implemented

## Overview
Provides a unified view of all uploaded images across the system, organized into three tabs: Patient Images (non-prescription uploads), Prescriptions (images tagged with "Prescription"), and Invoice Images (purchase invoice scans with `has_image=true`). Images can be previewed full-screen and patient image metadata (notes, tag) can be edited in-place.

## Affected Layers
- DB models: `PatientImage`, `PurchaseInvoice`, `Patient`
- Backend routes: `Backend_db/routes/images.py` (blueprint `images`, prefix `/api`)
- Frontend pages/components:
  - `frontend/app/gallery/page.tsx`
  - `frontend/components/ImagePreviewDialog.tsx` (full-screen lightbox with prev/next navigation and edit form)

## Data Flow
1. On mount, the gallery page simultaneously calls:
   - `GET /api/patients/images` — returns all `PatientImage` records joined with `Patient`, ordered by `timestamp` descending.
   - `GET /api/inventory/invoices` — returns all `PurchaseInvoice` records; client filters to those where `has_image=true`.
2. The loaded patient images are split client-side into two lists:
   - **Prescriptions**: records where `tag` starts with `"Prescription"`.
   - **Patient Images**: all other records.
3. Each tab has its own search input with client-side filtering (by patient name, patient ID, notes for patient images/prescriptions; by invoice number or vendor name for invoice images).
4. Clicking a row opens `ImagePreviewDialog`, which renders the image by calling the file-serving endpoint directly in an `<img>` tag (`/api/patients/images/<id>/file` for patient images; `/api/inventory/invoices/<invoice_number>/image` for invoice images).
5. In `ImagePreviewDialog`, the user can edit `notes` and `tag` on patient images. Saving calls `PUT /api/patients/images/<id>` with the new values. The gallery page updates local state optimistically.
6. The dialog supports previous/next navigation within the currently filtered list.

## Business Rules
- The tab split between "Patient Images" and "Prescriptions" is purely client-side — both categories are stored as `PatientImage` records, differentiated only by the `tag` field prefix.
- Images uploaded via QR upload and finalized default to tag `"Prescription"` (set in `upload.py` finalize logic) unless a different tag was provided by the mobile uploader.
- Doctor-uploaded images default to tag `"Medical Record"` (set in `images.py` upload handler).
- Invoice images are read-only in the gallery — there is no save/edit capability for invoice metadata from this page.
- The gallery fetches all patient images in a single call — there is no pagination.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/patients/images` | List all patient images (all patients, joined with Patient) |
| GET | `/api/patients/<patient_id>/images` | List images for a specific patient |
| POST | `/api/patients/<patient_id>/images` | Upload a new image for a patient |
| GET | `/api/patients/images/<image_id>/file` | Serve the image file |
| PUT | `/api/patients/images/<image_id>` | Update image notes and/or tag |
| GET | `/api/inventory/invoices` | Used to find invoices with images |
| GET | `/api/inventory/invoices/<invoice_number>/image` | Serve invoice image file |

## Known Constraints / Risks
- The `GET /api/patients/images` endpoint returns all patient images with no limit — this will grow unbounded as the clinic accumulates records.
- Image files are served directly from the filesystem path stored in `PatientImage.image_path`. On Render, this path points to `/tmp/clinic_uploads`, which is ephemeral; images are lost on instance restart.
- The gallery page calls `loadImages()` twice on mount due to two separate `useEffect` hooks with `[]` dependencies — this results in a duplicate API call to `GET /api/patients/images` on every page load.
- The invoice images tab attempts to render each invoice image by loading the URL and setting `opacity: 0` with an `onLoad` handler to show it — images that fail to load (e.g., non-image files, missing files) remain invisible with a `FileText` icon showing instead; there is no explicit error state.
- There is no DELETE endpoint for patient images.
