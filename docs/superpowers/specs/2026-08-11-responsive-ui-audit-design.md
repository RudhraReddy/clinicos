# Responsive / Zoom Overflow Audit — Design Spec

**Date:** 2026-08-11
**Status:** Approved

## Problem

At high browser zoom (reported: 200%) or on genuinely narrow devices
(tablet/phone), several pages lose access to primary actions instead of
degrading gracefully. Confirmed trigger case: on `/billing`, the "Create
Bill" button is pushed off-screen and unclickable once the "Patient &
Actions Row" can't fit its content.

Root cause, confirmed by full-codebase audit: `components/layout/AppShell.tsx`
puts `overflow-x-hidden` on the `<main>` wrapper every routed page renders
into, so any row that overflows horizontally is **silently clipped, not
scrollable**. Most toolbar/header rows in the app already guard against this
with `flex-wrap`; a handful don't, and those are exactly where content
becomes unreachable.

The base `Table` component (`components/ui/table.tsx`) already wraps every
table in `overflow-auto`, so wide tables reflow to horizontal scroll for
free — table-column overflow is not a live problem in this codebase, in
contrast to un-wrapped flex rows.

## Scope

**Devices:** Both desktop-browser zoom and genuine tablet/phone widths are
in scope (down to ~360px effective width).

**Overflow strategy:** Rows that don't fit wrap onto additional lines
(`flex-wrap`), matching the pattern already used correctly in most of the
app (`patients`, `inventory`, `status`, `daily-summary`, `admin`'s top row).
`AppShell`'s page-level `overflow-x-hidden` stays as-is — we are not adding
a page-level horizontal scrollbar, we're making sure nothing needs one.

**Rollout:** Full sweep in one pass, covering every issue found in the
audit below, ordered by severity.

**Explicitly out of scope:**
- `app/inventory/history/[id]/page.tsx`'s "Extracted Items Log" table — no
  mobile card-view fallback exists (unlike other data tables in the app),
  but it is already reachable via the base `Table` component's horizontal
  scroll. Left as a known inconsistency, not a broken state.
- Any change to `AppShell.tsx`'s `overflow-x-hidden` itself, or to the
  Sheet/hamburger nav (`Sidebar.tsx`/`AppShell.tsx`), which already works
  correctly at all widths.
- No new shared "responsive toolbar" component is introduced — fixes reuse
  existing Tailwind utility patterns already present elsewhere in the
  codebase (see "Patterns to reuse" below), applied per-file.

## Patterns to reuse (already correct elsewhere in the codebase)

- **`flex-wrap`** on header/toolbar rows — `app/patients/page.tsx:113-114`,
  `app/inventory/page.tsx:855-856,892,1003`, `app/status/page.tsx:205`,
  `app/daily-summary/page.tsx:167`, `app/admin/page.tsx:625`.
- **`hidden lg:flex` tab-row + `block lg:hidden` `Select` fallback** for a
  row of filter/tab buttons that can't fit — `app/status/page.tsx:628-676`
  ("Risk Matrix" card). Best existing answer to "TabsList doesn't fit";
  reused here for `admin/page.tsx`'s top-level `TabsList`.
- **`max-w-[95vw] h-[95vh]`** dialog sizing — `EditVisitDialog.tsx:140`,
  `EditPatientDialog.tsx:88`, `PatientDetailsView.tsx:127`.
- **`max-h-[Nvh] overflow-y-auto`** on `DialogContent` — `GlobalSettingsDialog.tsx:79`,
  `PrintInvoiceDialog.tsx:169`, `VisitDetailsDialog.tsx:99`,
  `ImportInventoryDialog.tsx:178`.
- **`hidden md:block` / `md:hidden` desktop-table vs. mobile-card split** —
  `app/patients/page.tsx:275,366`, `app/inventory/page.tsx:1054,1313`,
  `app/billing/page.tsx:950,1028`, `app/doctor/page.tsx:289,501`.

## Fix list

### Critical — primary action becomes unreachable

1. **`app/billing/page.tsx:498`** — "Patient & Actions Row"
   (`flex flex-col md:flex-row gap-4 md:items-center justify-between shrink-0`)
   has no `flex-wrap` at the `md:row` breakpoint. Add `flex-wrap` so the
   left group (patient/walk-in fields, clinic selector, refund sub-row) can
   spill onto its own line(s) instead of pushing the right group (Payment
   select + **Create Bill**) off-screen.

2. **`app/inventory/invoice_edit/page.tsx:292,307`** — header action row
   has no `flex-wrap`. Add it so **Save to Inventory** can't be pushed off
   by the Attach Image / Upload via QR / remove-image controls ahead of it.

3. **`app/page.tsx:269`** — Dashboard header
   (`flex items-center gap-3 flex-shrink-0`) has no responsive treatment at
   all, unlike every sibling page. Add `flex-wrap` so the "All Visits" tab
   trigger and the `ml-auto` `DatePickerWithRange` filter never become
   unreachable.

### High

4. **`components/AddPatientDialog.tsx:160`** — duplicate-phone suggestions
   bubble is positioned `absolute right-[102%] top-0 mr-2 w-64`, i.e.
   entirely to the left of its input. On a narrow/phone-width dialog this
   renders partially or fully outside the browser viewport with no way to
   reach it. Change to a responsive position: below the input
   (`top-full left-0 mt-1`) on narrow widths, keeping the existing
   left-side placement at wider widths (e.g. via a `sm:` variant pair, or
   a simple width-based conditional class).

5. **`app/doctor/page.tsx`** — the page's desktop/mobile split is gated at
   `md` (768px, lines ~501/503), but the desktop layout stacks a fixed
   `w-[380px]` right sidebar (line 994) plus a resizable `180-500px`
   timeline sidebar (line 581) next to the content, which get crushed
   together in the 768-1024px range. Move the split's breakpoint from `md`
   to `lg` (1024px) so tablets get the existing simpler stacked/mobile
   layout instead of the cramped 3-pane one. No change to the 3-pane
   layout's internals at `lg`+ beyond what's needed for the breakpoint
   rename.

### Medium / consistency

6. **`app/patients/page.tsx:255`** — Patient List card header row
   (`flex flex-row items-center justify-between space-y-0 pb-4 shrink-0`,
   parent `Card` is `overflow-hidden`) has no `flex-wrap`, inconsistent
   with the page's own top-level header. Add `flex-wrap`.

7. **`app/admin/page.tsx:1163`** — top-level `TabsList` (Overview / Users /
   Activity Log / Settings) never wraps and has no fallback at very narrow
   widths. Apply the `hidden lg:flex` tabs + `block lg:hidden` `Select`
   dropdown pattern from `status/page.tsx:628-676`.

8. **`components/AddVisitDialog.tsx:137`** and
   **`components/EditInventoryDialog.tsx:130`** — `DialogContent` has no
   `max-h-[90vh]`/`overflow-y-auto` cap, unlike `GlobalSettingsDialog` /
   `PrintInvoiceDialog` / `VisitDetailsDialog` / `ImportInventoryDialog`.
   Add the same cap so a short/zoomed viewport can still scroll the full
   dialog into view.

9. **`components/EditVisitDialog.tsx:140`** and
   **`components/EditPatientDialog.tsx:88`** — `max-w-[95vw] h-[95vh]` with
   no `overflow-y-auto` on the outer `DialogContent`. Add `overflow-y-auto`
   as a safety net for long content (e.g. Edit Visit with the refund
   sub-section expanded) on a short/zoomed viewport.

10. **`components/WalkInForm.tsx:514`** — Address/Age/Sex row
    (`grid grid-cols-[1fr_72px_96px] gap-2`) gets cramped once the
    already `md:w-2/5`-constrained form is squeezed further on narrow
    widths. Loosen the fixed pixel columns (e.g. `minmax()` tracks or a
    narrow-width stack) so Age/Sex stay usable instead of just tight.

## Verification

After implementing, use the Playwright browser tools to load `/billing`,
`/` (dashboard), `/doctor`, and `/inventory/invoice_edit` at a few narrow
effective widths (~960px, ~700px, ~500px — simulating 150-200% zoom on a
laptop and tablet/phone widths) and screenshot that the primary action in
each (Create Bill / All Visits tab+filter / Save to Inventory) stays
visible and clickable, not just review the CSS changes statically.

## Testing

No test suite exists for the frontend (per `CLAUDE.md`). Verification is
the Playwright pass above plus `npm run lint` and `npm run build` to catch
any regressions from the class/breakpoint changes.
