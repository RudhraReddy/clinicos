# Print Age/Sex on Invoices — Design Spec

**Date:** 2026-08-08
**Status:** Approved

## Problem

The printed invoice (`InvoicePrint.tsx`) should show the patient's age and
sex when known, and leave them blank when not — for both regular
patient-linked bills and walk-in bills.

## Findings

- `InvoicePrint.tsx`'s `patient` prop type already has `age`/`sex`, and the
  data already flows correctly end-to-end for patient-linked bills
  (`Patient` model → `get_bill_details` → `PrintInvoiceDialog` →
  `InvoicePrint`). The JSX itself simply never renders them — a pre-existing
  gap, not something this feature needs to build from scratch.
- Walk-in bills have no age/sex storage at all today — `Bill` only has
  `walk_in_name`. This needs new columns, new form inputs, and wiring
  through `create_bill` and `get_bill_details`.
- There is exactly one print code path in the app
  (`PrintInvoiceDialog` → `InvoicePrint`), used from both `billing/page.tsx`
  and `PatientDetailsView.tsx` — fixing `InvoicePrint.tsx` once covers both.

## Design

### Backend

- `Bill` model: add `walk_in_age` (`Integer`, nullable) and `walk_in_sex`
  (`String(10)`, nullable). Migration follows the existing additive-column
  pattern in `app.py`'s `_apply_migrations()`.
- `POST /api/billing` (`create_bill`): when creating a walk-in bill (no
  `patient_id`), read `walk_in_age`/`walk_in_sex` from the request body and
  store them on the new `Bill` row.
- `GET /api/billing/<invoice_id>` (`get_bill_details`): when the bill is a
  walk-in (`bill.patient_id is None`), return `age: bill.walk_in_age` and
  `sex: bill.walk_in_sex` instead of always `None`. Patient-linked bills are
  unchanged (already correct).

### Frontend

- `billing/page.tsx`: two new inputs shown only when `walkInMode` is true,
  next to the walk-in name field — Age (`number` input) and Sex (`Select`
  with `Male`/`Female`/`Other`, matching the exact convention used in
  `AddPatientDialog.tsx`/`EditPatientDialog.tsx`/`WalkInForm.tsx`). Both
  optional. Included in `handleCreateBill`'s payload only when
  `walkInMode` is true.
- `InvoicePrint.tsx`: render inline after the patient name —
  `Name: John Doe (32 / Male)`. If only age or only sex is present, show
  just that one (`(32)` or `(Male)`). If neither is present, render nothing
  extra — the line reads exactly as it does today.

## Out of scope

- No changes to the regular (non-walk-in) patient flow — `Patient.age`/
  `Patient.sex` already exist and already flow through correctly.
- No retroactive backfill for walk-in bills created before this change —
  they simply have no age/sex and will print without it, same as any other
  missing field.
- No changes to `PrintInvoiceDialog.tsx`'s data-fetching logic beyond what
  `get_bill_details` already returns — it already maps `age`/`sex` through
  unconditionally.
