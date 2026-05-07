# Invoice Redesign — A5, Clean B&W

**Date:** 2026-05-07  
**Status:** Approved

## Summary

Redesign the patient bill invoice to A5 size (148×210 mm), black-and-white, with a clean hybrid layout (serif clinic header from style A, modern sans table from style B). Fix the broken print mechanism. Add `follow_up_date` to the Visit model so it can appear on printed invoices.

## Approved Layout

Visually approved in brainstorm session (v4 mockup).

### Header
- Clinic name: serif, bold, uppercase, large — left side
- Address + phone: small, muted — below clinic name
- "INVOICE" label: serif bold, right-aligned — right side
- Invoice number + date: small, right-aligned — below INVOICE
- Separator: 2px solid black rule below entire header

### Patient Row
Single line, `space-between` across full width:
```
Ravi Kumar          +91 99999 12345          Male          32 yrs
```
- Fields shown: Name (bold), Phone, Sex, Age
- Any field not on record is omitted silently (no placeholder)
- Separator: 1px light rule below

### Items Table
- Column headers: ALL CAPS, small, sans-serif — separated from body by 2px black rule
- Columns: `#` | `Item` | `Qty` | `MRP (₹)` | `Total (₹)`
- Rows: light 1px `#ddd` dividers
- **Batch number: not printed** — stored in DB / soft copy only
- Row number column: muted gray

### Totals
- Right-aligned, 46% width
- Subtotal: small, muted
- Total: bold, large, double top border (2px black)

### Follow-up Date
- Only rendered when `follow_up_date` is set on the linked Visit
- Bold black text with a 3px left border rule — no color, no background
- Placed just above the footer line

### Footer
- "Thank you for visiting {clinicName}."  — left
- "Authorised Signature ___________" — right
- Separated by 1px rule

## Page Size
`@page { size: A5 portrait; margin: 8mm }`

All styling uses **inline CSS** (no Tailwind) so it survives the print popup window without a stylesheet.

---

## Changes Required

### 1. Backend — `Visit` model: add `follow_up_date`

Add nullable `Date` column to `visits` table:
```python
follow_up_date = db.Column(db.Date, nullable=True)
```
Generate an Alembic migration for this column.

### 2. Backend — `GET /api/billing/<invoice_id>`

Extend the response to include:
- `patient.age` (from `Patient.age`)
- `patient.sex` (from `Patient.sex`)
- `follow_up_date` (from `Visit.follow_up_date` via `bill.visit_id` join — `null` if bill has no visit or visit has no follow-up)

### 3. Frontend — `InvoicePrint.tsx`

Full rewrite. New props interface:
```ts
interface InvoicePrintProps {
  clinicName: string
  clinicAddress: string
  clinicPhone: string
  patient: {
    name: string
    phone_number: string
    age?: number
    sex?: string
  }
  billItems: { item_name: string; qty: number; mrp: number }[]
  invoiceId?: string
  total: number
  date?: Date
  followUpDate?: string   // "YYYY-MM-DD" or null
  className?: string
}
```

Key implementation notes:
- Use 100% inline CSS — no Tailwind classes in the rendered invoice markup
- `@page` rule injected via a `<style>` tag inside `#invoice-print-region` (so it's captured by `printElement`)
- Batch number prop removed from `PrintableBillItem` — not rendered

### 4. Frontend — `PrintInvoiceDialog.tsx`

- Map `age`, `sex` from API response onto patient object passed to `InvoicePrint`
- Pass `followUpDate` from API response
- `printElement` already captures `innerHTML` of `#invoice-print-region` — since InvoicePrint now uses inline styles, this will work correctly
- Add `<style>@page { size: A5 portrait; margin: 8mm }</style>` to the printed window head

### 5. Frontend — `globals.css`

Update `@page` rule:
```css
@page {
  size: A5 portrait;
  margin: 8mm;
}
```

---

## Out of Scope

- Adding a follow-up date UI to the visit form (separate feature — the DB column is added now so the field is available; a UI to set it is a future task)
- GST line items on invoice
- PDF download (print dialog suffices)
