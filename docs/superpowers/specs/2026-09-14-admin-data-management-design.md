# Admin Data Management (Danger Zone) — Design

Date: 2026-09-14
Status: Approved, not yet implemented

## Problem

Admin currently has exactly one destructive data action: a "Wipe Inventory"
button on the Inventory page (`DELETE /api/admin/inventory/wipe`, TOTP-gated)
that clears `InventoryBatch` + `InventoryHistory` only. There's no way to:
reset the inventory catalog itself, bulk-clear images, bulk-clear patients
(with their billing/visit history correctly cascaded — nothing like this
exists today), or do a full "start from scratch" reset short of admin
manually touching the database. This design replaces the single wipe button
with a proper Admin-side "Danger Zone" covering five scoped, explicit wipe
actions.

## UI Placement

- New **Danger Zone** card in **Admin → Settings** tab (`SettingsTab` in
  `frontend/app/admin/page.tsx`), visually distinct (red border/heading) from
  the rest of Settings.
- The Inventory page's existing "Wipe Inventory" button/dialog
  (`app/inventory/page.tsx`: `wipeDialogOpen`/`wipeCode`/`handleWipeInventory`
  state, the button, and the dialog JSX) is **removed** — option 1 below
  supersedes it from the new single location.
- One dialog component, `components/DataManagementDialog.tsx`, handles all
  five actions (a scope selector + sub-option picker for Images + live
  preview + TOTP field + Execute/Cancel) rather than five near-duplicate
  dialogs.

## The Five Scopes

| Key | Label | Deletes |
|---|---|---|
| `stock_counts` | Clear Stock Counts | `InventoryBatch` + `InventoryHistory`. `ProductMaster` (catalog/names) and `PurchaseInvoice` untouched. *(= today's existing Wipe Inventory behavior.)* |
| `inventory_all` | Clear Entire Inventory | Everything in `stock_counts`, **plus** `ProductMaster` rows and `PurchaseInvoice` rows + their `image_path` files on disk. Patients/Visits/Bills/Users untouched. |
| `images` | Clear Images | Sub-option required — see below. |
| `patients` | Clear Patients | Every `Patient` row, cascading `Visit`, `Bill`+`BillItem` (only bills with `patient_id` set — walk-in bills with no patient are untouched), `VisitRefund`, `PatientImage` + files, and `UploadSession` rows where `context_type='patient'` and `context_id` is one of the deleted patient ids. |
| `all` | Clear All (nuclear) | Everything in `inventory_all` + `patients`, plus `ExpenseLedger` rows + their `receipt_path` files, and all remaining `UploadSession` rows (+ any leftover files under `UPLOAD_BASE_DIR/temp/`). **Kept:** `User`, `DoctorStaffAssignment`, `Location`, `AuditLog`. |

### Images sub-options (`image_scope`, required when `scope=images`)

| `image_scope` | Deletes |
|---|---|
| `all` | Every `PatientImage` row (all tags, including soft-deleted/trashed) + files, **and** every `PurchaseInvoice.image_path` file (column set to `NULL`; the `PurchaseInvoice` row itself is kept — deleting the row is `inventory_all`'s job, not this one). |
| `prescriptions` | `PatientImage` rows where `tag = 'Prescription'` (including soft-deleted/trashed, same as `all`) + their files. |
| `invoices` | Just `PurchaseInvoice.image_path` files (nulled); rows untouched. |

## Confirmation Flow

Two steps, same for all five actions:

1. **Pick scope (+ sub-option for Images)** → dialog calls
   `GET /api/admin/data_management/preview?scope=<key>&image_scope=<key>` which
   returns row counts per affected table, e.g.
   `{"patients": 214, "visits": 890, "bills": 650, "bill_items": 1400,
   "images": 320}`. The warning text renders these counts directly
   ("This will permanently delete **214 patients**, **890 visits**...")
   instead of a generic warning.
2. **Enter the 6-digit TOTP code** (`_verify_totp`, same helper the existing
   inventory wipe already uses) → Execute enabled only once the code is 6
   digits. The code is re-verified server-side on the actual delete call —
   the preview step is informational only and grants no authority.

On a failed execute (bad/expired code, or a server error), the dialog stays
open, the TOTP field is cleared, and the error is toasted — matching the
current `wipeError` behavior on the Inventory page today.

## Backend API

New section in `Backend_db/routes/admin.py` (reuses `_verify_totp`,
`require_admin`, `log_activity` — all already imported there):

- `GET /api/admin/data_management/preview?scope=...&image_scope=...`
- `DELETE /api/admin/data_management/execute` — body
  `{scope, image_scope?, totp_code}`

Each scope maps to one private helper (`_wipe_stock_counts()`,
`_wipe_inventory_all()`, `_wipe_images(image_scope)`, `_wipe_patients()`,
`_wipe_all()`). Each helper:

- Deletes rows inside a single DB transaction, child-before-parent in FK
  order, `db.session.commit()` once at the end; any exception →
  `db.session.rollback()` and the endpoint returns 500 with no partial
  state (mirrors the existing `wipe_inventory` / `delete_inventory_item`
  transactional pattern already in this codebase).
- Collects the list of file paths to remove *before* committing, then
  unlinks files *after* a successful commit — so a DB failure never leaves
  a file deleted without its row being deleted (or vice versa in a way
  that matters), and a file-unlink failure (logged, not fatal, matching the
  `except Exception as e: print(f"Warning: ...")` pattern already used in
  `images.py`'s `permanent_delete_patient_image`) never blocks or rolls
  back an otherwise-successful DB wipe.
- On success, calls `log_activity(action='DELETE',
  resource_type='data_management', resource_id=scope, resource_label=...,
  details=<the same counts the preview returned>, ...)`, which writes into
  `AuditLog` — a table every one of these five scopes explicitly excludes
  from deletion (`all` included), so the trail always survives.

`_wipe_all()` is a straight composition of the other four helpers, called in
dependency order (`images(all)` → `patients` → `inventory_all` →
`ExpenseLedger` + remaining `UploadSession` rows), not duplicated logic.

## Frontend

- `frontend/lib/api.ts`: remove `wipeInventory()`; add
  `getDataManagementPreview(scope, imageScope?)` and
  `executeDataManagement(scope, totpCode, imageScope?)`.
- New `components/DataManagementDialog.tsx` mounted from the new Danger Zone
  card in `SettingsTab`.
- `app/inventory/page.tsx`: remove `wipeDialogOpen`/`wipeCode`/`wipeLoading`/
  `wipeError` state, `handleWipeInventory`, the Wipe Inventory button, and
  its dialog JSX.

## Error Handling

- Preview request fails → toast error, Execute stays disabled (no stale
  counts shown).
- Execute fails → rollback (see above), toast the server's error message,
  TOTP field cleared, dialog stays open.
- Per-file unlink failures during cleanup are caught individually and
  logged; they never abort or roll back an otherwise-successful DB wipe.

## Out of Scope

- No selective/partial patient deletion (e.g. by date range or individual
  pick) — `patients` scope is all-or-nothing, matching the tone of the other
  four scopes.
- No undo/soft-delete for any of these five actions — all are hard,
  permanent deletes to file + DB, exactly like today's existing Wipe
  Inventory action.
- `ExpenseLedger` and `receipt_path` files are only touched by the `all`
  scope — no standalone "clear expenses" option was requested.
