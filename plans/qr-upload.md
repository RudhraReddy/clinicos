# QR Upload

**Status:** Implemented

## Overview
Allows a desktop user to generate a QR code that opens a mobile-optimized upload page on the patient's or staff's phone. The mobile device captures up to two images (front and back of a prescription) and uploads them to a temporary server-side session. The desktop user then "finalizes" the session, which moves the files to permanent patient storage and creates `PatientImage` records in the database.

## Affected Layers
- DB models: `UploadSession`, `PatientImage`
- Backend routes: `Backend_db/routes/upload.py` (blueprint `upload_bp`, prefix `/api`)
- Frontend pages/components:
  - `frontend/components/QRCodeUpload.tsx` (desktop widget — generates QR, polls session status)
  - `frontend/app/connect/[sessionId]/page.tsx` (mobile upload page, accessed via QR code)
  - `frontend/app/billing/page.tsx` (embeds `QRCodeUpload` when a patient is selected)

## Data Flow
1. Desktop user selects a patient on the billing page and clicks "Upload via QR". The `QRCodeUpload` component calls `POST /api/upload/session` with `context_type='patient'` and `context_id=<patient_id>`.
2. The backend creates an `UploadSession` record (UUID `session_id`, status `'WAITING'`, `files='[]'`) and returns the `session_id` and a `url_path` (`/connect/<session_id>`).
3. The `QRCodeUpload` component renders a QR code encoding the full URL to the mobile upload page. The desktop component begins polling `GET /api/upload/session/<session_id>` to detect when files are uploaded.
4. The patient scans the QR code with their phone. The mobile page (`/connect/[sessionId]`) loads and calls `GET /api/upload/session/<session_id>` to verify the session is valid (status not `'COMPLETED'`).
5. The mobile user selects a front image and/or a back image using the device camera (`capture="environment"`), optionally adds notes, and taps "Upload". The page calls `POST /api/upload/mobile/<session_id>` with the files as multipart form data. Tags are set as `"Prescription - Front"` and `"Prescription - Back"`.
6. The backend saves files to `$UPLOAD_BASE_DIR/temp/<session_id>/` with a timestamp-prefixed filename using `werkzeug.utils.secure_filename`. The session's `files` JSON array is updated and `status` is set to `'UPLOADED'`.
7. The desktop's polling detects `status='UPLOADED'`. The user (or the component) calls `POST /api/upload/session/<session_id>/finalize`.
8. The finalize endpoint:
   - Reads the session's `files` JSON.
   - For `context_type='patient'`: moves each file from `temp/<session_id>/` to `patients/<patient_id>/` using `os.rename()`.
   - Creates a `PatientImage` record for each moved file, defaulting `tag` to `'Prescription'` if the tag is unset or `'Uncategorized'`.
   - Sets `session.status = 'COMPLETED'`.
9. The desktop component receives the finalize response and calls its `onSuccess` callback (shows an alert: "Images uploaded! Check gallery.").

## Business Rules
- Session `context_type` supports `'patient'` and `'inventory'` in the model, but only `'patient'` is handled in the finalize endpoint's logic. An `'inventory'` session type will finalize with 0 images moved.
- Files in `temp/` are moved (not copied) on finalize — once finalized, the temp copy no longer exists.
- If a session has already been completed (`status='COMPLETED'`), the mobile upload page shows "Invalid or Expired Session" — it does not allow re-upload to a completed session.
- Default tag on finalize is `'Prescription'` — overrides `'Uncategorized'` but preserves any explicitly set tag (e.g. `"Prescription - Front"`, `"Prescription - Back"`).
- The `files` field on `UploadSession` is stored as a JSON string in a `Text` column, not a structured relation.
- Multiple `POST /api/upload/mobile/<session_id>` calls are allowed before finalize — each adds to the session's `files` array cumulatively.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload/session` | Create a new upload session; returns session_id and url_path |
| GET | `/api/upload/session/<session_id>` | Get session status and uploaded file list |
| POST | `/api/upload/mobile/<session_id>` | Upload files from mobile (multipart); updates session |
| POST | `/api/upload/session/<session_id>/finalize` | Move temp files to permanent storage, create PatientImage records |

## Known Constraints / Risks
- There is no expiry or cleanup mechanism for `UploadSession` records or temp files. Sessions remain in the database and temp files remain on disk until manually cleaned up or until the server restarts (on Render, `/tmp` is ephemeral).
- `os.rename()` is used to move files from temp to permanent storage. This will fail silently or raise an error if the source and destination are on different filesystems (e.g., different mounted volumes).
- There is no authentication on the mobile upload endpoint (`POST /api/upload/mobile/<session_id>`) — anyone with a valid session ID can upload files to that session.
- The finalize endpoint does not link created `PatientImage` records to a `visit_id`, even if a visit was in progress when the QR session was created.
- The `inventory` context type is defined in the model but has no finalize implementation — calling finalize on an inventory session produces a success response but creates no records.
