# Page Layout Rules

Applies to the four primary card-based pages only: **Dashboard** (`app/page.tsx`), **Patients** (`app/patients/page.tsx`), **Inventory** (`app/inventory/page.tsx`), **Billing** (`app/billing/page.tsx`). Dashboard is the reference implementation — when in doubt, match it exactly.

Out of scope, deliberately: Doctor (`app/doctor/page.tsx`), Admin, Status (`app/status/page.tsx`), Gallery, Inventory History, Invoice Edit. These are either different app patterns (split-pane, bespoke analytics dashboard) or drill-down/detail pages, not peers in the same nav-switching flow.

## 1. Chrome layer (`AppShell.tsx`, shared automatically)

`<main>`: `px-4 pb-4 md:px-8 md:pb-8`, plus `pt-8 md:pt-10` since all four pages render their own inline hamburger trigger via `useMenu()`. Don't add page-level padding on top of this — it's already accounted for.

## 2. Page-root wrapper

```tsx
<div className="flex flex-col gap-6 h-[calc(100vh-100px)]">
```
- Height pinned to `100vh - 100px`. The page itself never scrolls — only regions inside it do (the card's content area).
- `gap-6` (24px) between the header row and the card. Nothing else goes in this flex column — if a page needs an alerts banner or a filter row, it lives *inside* the card (in the `CardHeader` or as a `shrink-0` block inside `CardContent`), not as a third top-level flex child, so the header→card distance stays a single `gap-6`.

## 3. Header row

```tsx
<div className="flex items-center justify-between shrink-0 gap-3 flex-wrap">
    <div className="flex items-center gap-3 flex-wrap">
        {/* hamburger, title, 3 nav buttons, tab switcher */}
    </div>
    <div className="flex items-center gap-2 flex-wrap">
        {/* right-side option buttons, if any */}
    </div>
</div>
```
(Dashboard has no right-side group, so it skips the outer `justify-between` wrapper and `<Tabs>` owns the row directly — functionally equivalent.)

Left-to-right order: **Hamburger → Title → 3 nav buttons → Tab switcher (if the page has tabs)**. Right side: **option buttons**, if the page has any.

- **Hamburger:** `<button className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors">` wrapping `<Menu className="h-6 w-6" />`.
- **Title:** `<h1 className="text-3xl font-bold tracking-tight w-44 shrink-0">`. The `w-44` (176px) fixed width is what keeps the button row from shifting left/right when you switch between these four pages — it only works because all four titles ("Dashboard", "Patients", "Inventory", "Billing") are short. Don't reuse `w-44` on a page with a longer title; it'll clip.
- **3 nav buttons:** `<Button variant="outline" size="sm" asChild className="w-32">` — `size="sm"` gives **h-8** by default, don't override it. `w-32` (128px) fixed width, one per page, linking to the other three of the four.
- **Tab switcher** (`<TabsList>`): only on pages that have tabs (Dashboard: Overview/All Visits; Inventory: Inventory/All Changes). Comes right after the nav buttons, still inside the left group.
- **Right-side option buttons** (Patients: Export/Import/Columns/New Patient; Inventory: Export/Import/History/Columns/Add Invoice): `size="sm"` → **h-8**, same as the nav buttons. Size to content — don't fix their width, and don't add a stray `h-9` override. (This was the one real bug: Patients' right-side buttons had `h-9` hardcoded, 4px taller than its own nav buttons. Fixed by dropping the override.)

## 4. Card

One `<Card className="flex-1 flex flex-col overflow-hidden">` holds everything below the header and eats all remaining height.

- **If it has a `CardHeader`** (title + inline controls like search/filters/location switcher): trim its padding (`pb-4 shrink-0`, or the more compact `pb-2 pt-4 px-4` for a small sub-card like Dashboard's "Today's Visits"). Any page-level filter/switcher control (search box, location pills, column toggles) belongs here, in a `flex items-center gap-2 flex-wrap` group on the header's right side — not as a separate row above the card.
- **If it has no `CardHeader`** (Billing's "New Bill" card has no title bar): `CardContent` must restate `p-6` itself, since there's no header above it to own that top spacing.
- **`CardContent`**: `flex-1 overflow-hidden flex flex-col min-h-0` (or `overflow-auto` when the content itself is the scroll region, e.g. Billing's items table). The `min-h-0` is required on every nested flex-column ancestor for internal scrolling to actually clip instead of growing the whole card.

## Fixes already applied under this doc

- **Patients**: removed the stray `h-9` from Export Registry / Import List / Columns / New Patient buttons — now h-8, matching the nav buttons.
- **Inventory**: moved the per-clinic location pill switcher out of its own row between the header and the card, into the `CardHeader`, next to the Quick Search box — removes the extra row that was doubling the header→card gap.
