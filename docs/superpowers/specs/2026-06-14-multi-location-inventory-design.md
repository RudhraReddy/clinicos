# Multi-Location Inventory & Analytics — Design Spec

**Date:** 2026-06-14
**Status:** Approved

---

## Overview

Three sequential sub-projects that together give ClinicOS proper multi-clinic support:
tracked stock per location, a redesigned export/import flow, and location-scoped analytics.
Each sub-project depends on the previous.

---

## Sub-project 1 — Location Management Foundation

### Goal

Replace the free-text `location_label` string on users (and other models) with a managed
`Location` entity that has a stable integer ID and a changeable display name. All location
references across the system use the ID internally; the display name is what users see.

### Backend

**New model — `Location`** (`locations` table):

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | Auto-increment, stable forever |
| `name` | String(100), unique | Display name, admin can rename freely |
| `is_active` | Boolean | Default true. Inactive locations cannot be assigned but historical data is preserved |
| `created_at` | DateTime | IST |

**New FK columns** — added as nullable columns alongside existing string fields (no existing data touched, no destructive migration):

| Model / Table | New column | Replaces (keep old col) |
|---|---|---|
| `User` | `location_id` (FK → Location) | `location_label` string kept |
| `Visit` | `location_id` (FK → Location) | `location` string kept |
| `Bill` | `location_id` (FK → Location) | `location` string kept |
| `PurchaseInvoice` | `location_id` (FK → Location) | `location` string kept |
| `ExpenseLedger` | `location_id` (FK → Location) | `location` string kept |
| `InventoryBatch` | `location_id` (FK → Location) | new — no prior string field |

All FK columns are nullable (`db.ForeignKey('locations.id'), nullable=True`). `db.create_all()` on deploy adds them automatically.

**New API routes** — all under `/api/admin/locations`, all require `@require_admin`:

| Method | Path | Action |
|---|---|---|
| `GET` | `/api/admin/locations` | Return all locations ordered by name |
| `POST` | `/api/admin/locations` | Create a location (`name` required, must be unique) |
| `PATCH` | `/api/admin/locations/<id>` | Rename or toggle `is_active` |
| `DELETE` | `/api/admin/locations/<id>` | Hard delete only if zero FK references exist; otherwise return 409 with a hint to deactivate instead |

**Updated routes:**
- `GET /api/admin/users` — include `location_id` and resolved `location_name` in each user record.
- `PATCH /api/admin/users/<id>` — accept `location_id` (integer); set `user.location_id`. Continue writing `location_label` from the resolved name for backward compat.
- `GET /api/auth/me` — include `location_id` in the session response.

### Frontend

**Admin Settings tab — new "Locations" card** (below existing "Inventory Settings" card):

- Lists all Location records: name, Active/Inactive badge, Edit button, Delete/Deactivate button.
- "Add Location" button opens an inline input row at the bottom of the list.
- Edit: click pencil → inline name field, Save / Cancel.
- Delete: only succeeds if no references exist (backend enforces); otherwise button label changes to "Deactivate" and toggles `is_active`.
- Inactive locations shown dimmed; can be reactivated.

**Admin Users dialog — Location field:**

- Change free-text input to a `<Select>` dropdown populated from `GET /api/admin/locations` (active locations only, plus the user's current location even if inactive).
- On save, sends `location_id` instead of `location_label`.

### Migration notes

- Existing users with `location_label` set will have `location_id = null` until an admin reassigns them via the updated dialog.
- No automated backfill — the admin creates Location records and reassigns users manually. This is intentional: prevents hardcoding and forces the admin to own the location names.
- Old string columns remain in the DB and are not read by any new logic.

---

## Sub-project 2 — Per-Location Inventory + Export/Import Redesign

### Goal

Inventory stock is tracked per clinic. The export button becomes a two-option popup.
The import dialog gains a header-mapping and clinic-mapping step for mismatched CSVs.

### Inventory Page Changes

**Location switcher** — a tab or pill group at the top of the Inventory tab:
- Pills: `All` | `[Location Name 1]` | `[Location Name 2]` | …
- Populated from `GET /api/admin/locations` (active locations only).
- "All" shows aggregate qty across all locations (current behaviour).
- Selecting a specific location filters the table to batches with `location_id` matching that location.
- The switcher is also used when adding stock: the active location is pre-filled on manual entry and invoice upload; admin can override.

**Inventory table** — no column changes. When a specific location is selected, qty shown is that location's stock only.

### Export — Two-Option Popup

Clicking the existing Download icon opens a dialog with two choices:

**Option 1 — Total Inventory**
Identical to the current export. All 19 columns, one row per batch. No change to backend logic.
Download name: `inventory_export_YYYYMMDD.csv`

**Option 2 — Edit Inventory**
A simplified template for human editing and re-import. One row per product (not per batch). Includes zero-stock products.

Columns (fixed order):
```
Product ID | Item Name | Pack Size | Formula | Category | Manufacturer | MRP | Expiry Date | [Location Name 1] | [Location Name 2] | …
```

- **Product ID** — existing hex ID, or blank for new products (import will auto-assign).
- **MRP** — highest MRP across active batches for that product at the selected scope.
- **Expiry Date** — earliest non-expired batch expiry across the selected scope (MM/YY format). Blank if no expiry set.
- **[Location Name]** columns — current qty at that location. One column per active location.
- Zero-stock products included with 0 in all clinic columns and blank MRP/Expiry.
- New products that don't exist yet can be added by leaving Product ID blank.

Before downloading the user picks scope: **All clinics** (all location columns included) or **one specific clinic** (only that clinic's column included). A `<Select>` in the dialog controls this.

Backend route: `GET /api/inventory/export/edit?scope=all` or `?scope=<location_id>`

### Import — Updated Dialog

Accepts the Edit Inventory format (and still accepts the old Total Inventory format).

**Flow:**

1. User picks a `.csv` file and clicks **Parse**.
2. Backend parses headers only (`POST /api/inventory/import/parse-headers`), returns:
   - `known_fields` — headers that matched a known field name exactly.
   - `known_clinics` — headers that matched an active Location name exactly.
   - `unknown` — headers that matched neither. These need user resolution.
3. **Column mapping step** (shown only if `unknown` is non-empty):
   - One row per unknown column: `Unknown column "[xyz]" is → <Select>` where the dropdown contains all known field names AND all Location names grouped under an "Assign to Clinic" section, plus "Ignore".
   - All rows resolved → Continue.
   - This single step handles both mistyped field names and mistyped/renamed clinic names.
5. User picks **Import Mode**: Update (add to stock) or Overwrite (set stock) — same as today.
6. Confirm → `POST /api/inventory/import` with file + mapping JSON + mode.
7. Result: success count, warnings, skipped rows.

**Backend parse-headers route:**
`POST /api/inventory/import/parse-headers` — accepts multipart file, returns JSON mapping analysis. Does not persist anything.

**Backend import route** — updated to accept an optional `field_mapping` and `clinic_mapping` JSON body alongside the file and mode.

### Known field names recognised on import

```
Product ID, Item Name, Pack Size, Formula, Category, Manufacturer,
MRP, Expiry Date, Manufacture Date (ignored), Quantity,
Batch Number, Purchase Rate, Batch GST Rate, Product GST Rate,
HSN Code, Min Stock, Generic Tags, Initial Quantity, Free Quantity
```

Any column not in this list and not matching a Location name triggers the unknown-field mapping step.

---

## Sub-project 3 — Location-Based Admin Analytics

### Goal

The Admin Status page filters by location only (staff filter removed for now). Selecting a
location scopes inventory totals, billing, and sales to that clinic.

### Admin Status Page Changes

**Location filter** — replace the existing staff+location filters with a single location selector:
- `<Select>`: "All Branches" | each active Location name.
- Default: All Branches.

**"All Branches" behaviour** — unchanged from today. Shows combined totals across the whole system.

**Per-location behaviour** — when a specific location is selected:

- **Inventory value / stock counts** — sum `InventoryBatch` rows where `location_id` = selected location.
- **Billing & revenue** — sum `Bill` rows where `Bill.location_id` = selected location. For historical bills without `location_id`, fall back to bills created by users whose `location_id` = selected location.
- **Visits** — same FK-first, user-fallback logic.
- **All KPI cards, charts, and tables** apply this scope consistently.

Staff filter is removed from the UI entirely. Can be added back as a separate filter later.

---

## Implementation Order

1. Sub-project 1 (foundation) — must be complete before 2 or 3
2. Sub-project 2 (inventory + export/import) — can start once Location model + API exist
3. Sub-project 3 (analytics) — can start once location_id is populated on Visits and Bills

---

## Out of Scope

- Manufacture Date field on InventoryBatch (not added — can be a follow-up)
- Staff-level filtering on the analytics page (deferred by user)
- Inter-location stock transfers
- Location-specific pricing
