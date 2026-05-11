# Mobile Responsive Design — ClinicOS

**Branch:** `feature/mobile-responsive`
**Date:** 2026-05-11
**Strategy:** Option B — Responsive-first with mobile card lists for data-heavy pages

---

## Goals

Make ClinicOS usable on phones. Primary users on mobile:
- **Doctor** — reviewing patient queues and image history on the go
- **Admin** — checking stats (via Status page) on a tablet/phone

Desktop layout is unchanged above the `md` breakpoint (768px).

> **Scope note:** Pages `admin`, `login`, `connect/[sessionId]`, `inventory/history`, and `inventory/invoice_edit` live on `feature/auth` and are not in scope here. They should be made mobile-friendly when that branch is merged.

---

## 1. Global Shell (`components/layout/AppShell.tsx`)

The mobile hamburger + Sheet sidebar already exists. One fix:

- Change `<main>` padding from `p-8` to `p-4 md:p-8`.

---

## 2. Doctor Dashboard (`app/doctor/page.tsx`)

The desktop layout is a fixed split-pane: right sidebar (Summary + Today's Appointments) + left main area (patient detail). On mobile this collapses into a two-screen stack.

### Mobile layout — Screen 1: Queue (default)

```
┌──────────────────────────────────────┐
│  Today │ Done │ Waiting              │  ← stat strip (3 equal cells, border dividers)
├──────────────────────────────────────┤
│  Mon, 11 May 2026                    │  ← date sep label
├──────────────────────────────────────┤
│ 09:00  Ramesh Kumar                  │
│        Fever & cold    [done]  [🗑]  │
├──────────────────────────────────────┤
│ 10:30  Priya Sharma   ← selected row (primary/10 bg + left border)
│        Routine checkup [active] [🗑] │
├──────────────────────────────────────┤
│ 11:00  Anusha Reddy                  │
│        Back pain      [waiting] [🗑] │
└──────────────────────────────────────┘
```

- **Stat strip:** flex row, 3 equal cells with `border-right` dividers. Numbers: `font-bold text-2xl text-foreground` (no coloured numbers — ClinicOS uses a single primary palette).
- **Visit rows:** `time (font-bold min-w-[38px])` + `name + reason` + `Badge variant="outline"/"secondary"` + ghost `Trash2` icon — identical structure to desktop rows, **no avatars**.
- **Selected row:** `bg-primary/10 border-l-2 border-primary`.
- **Done rows:** `opacity-50`.
- Tapping a row sets `selectedVisitId` and `mobileDetailOpen(true)`.

### Mobile layout — Screen 2: Patient Detail (overlays Screen 1)

New state: `const [mobileDetailOpen, setMobileDetailOpen] = useState(false)`. On mobile, when `mobileDetailOpen` is true, the detail panel renders full-width stacked below the stat strip, hiding the queue.

```
┌──────────────────────────────────────┐
│ ← Back   Priya Sharma     [active]   │  ← detail header (primary/10 bg)
├──────────────────────────────────────┤
│ [34 yrs · F]  [10:30]  [Routine…]   │  ← meta chips (muted bg, rounded-full)
├──────────────────────────────────────┤
│ 🖼 Patient Pictures  [+Add] [QR] [🗑]│  ← card header
├──────────────────────────────────────┤
│ [All History] [May 11 ··] [Apr 28 ·] │  ← horizontal scroll timeline chips
├──────────────────────────────────────┤
│  [img]   [img]                       │  ← 2-col image grid
│  [img]   [+ dashed add]              │
└──────────────────────────────────────┘
```

- **← Back:** calls `setMobileDetailOpen(false)`.
- **Visit Timeline** (desktop: left 1/3 sidebar) → horizontal scrollable chip row. Each chip is a date. Dots (`··`) = images exist for that date. Active chip: `bg-primary/10 border-primary/20 text-primary font-semibold`. Chips call the same `setSelectedDateFilter` state as desktop.
- **Image grid:** `grid grid-cols-2 gap-2`. Tapping an image opens the existing `ImagePreviewDialog` — no changes to that component.
- **Add Image / QR / Trash** buttons reuse existing button styles from the desktop card header.

### Desktop layout (`md` and above)

Fully preserved. The existing `flex h-[calc(100vh-60px)] overflow-hidden` split-pane is guarded with `hidden md:flex`. The mobile stack is guarded with `md:hidden`.

---

## 3. Patients Page (`app/patients/page.tsx`)

**Below `md`:** Table hidden (`hidden md:block`). Card list shown (`md:hidden`).

Each card:
```
Priya Sharma                      [👁] [✏️]
P-110524 · 34 yrs · F · 98765 43210
```

- **No avatars.**
- Action buttons: `Button variant="ghost" size="icon" className="h-8 w-8"` — lucide `Eye` (doctor) or `FileText` (frontdesk) + `Edit` — same icons as the desktop table.
- Patient ID: `font-mono text-xs text-muted-foreground`.
- Secondary line: age · sex · phone.
- Page header and search bar already use `flex-col md:flex-row` — no changes needed.

---

## 4. Billing Page (`app/billing/page.tsx`)

Two tabs: **New Bill** and **History**.

### History tab — below `md`

Table hidden, card list shown:
```
110524-001-234                    ₹ 850
Priya Sharma · 11 May   [full]   [🖨️]
```

- Invoice ID: `font-mono text-xs text-muted-foreground`.
- Amount: `font-bold` right-aligned.
- Status: `Badge variant="outline"`.
- Print: `Button variant="ghost" size="icon" h-8 w-8` with lucide `Printer`.
- Admin-only delete: ghost `Trash2 text-destructive` — only rendered for `role === 'admin'`.

### New Bill tab — below `md`

The existing layout already uses `flex-col md:flex-row` in several places. One additional fix:
- Wrap the bill-items line-item table in `overflow-x-auto`.

---

## 5. Inventory Page (`app/inventory/page.tsx`)

Multi-tab: **Stock**, **All Changes**.

### Stock tab — below `md`

Table hidden, card list shown:
```
Paracetamol 500mg                 [✏️] [📦]
Tablet · 48 units · Exp Jun '26
```

- Low-stock qty: `text-red-600 font-semibold ⚠` — same as desktop.
- Edit: lucide `Edit` ghost icon. View Batches: lucide `Package` ghost icon.

### All Changes tab — below `md`

The expand/collapse day rows are already vertical. Wrap the inner per-event table in `overflow-x-auto`.

---

## 6. Visits Page (`app/visits/page.tsx`)

**Below `md`:** Table hidden, card list shown.

The visits table columns are: Visit Date, Visit Time, Patient, Patient ID, Visit ID, Status. On mobile:

```
Priya Sharma                   [in_progress]
110524-001 · 11 May · 10:30
```

- Patient name: `font-semibold`.
- Second line: visit ID (mono) · date · time.
- Status: `Badge variant="outline"/"secondary"`.
- No action buttons shown (the visits page has no per-row actions in the desktop table beyond the row click).

---

## 7. Gallery Page (`app/gallery/page.tsx`)

The gallery shows a table of patient images with a thumbnail preview column. On mobile:
- Wrap the table in `overflow-x-auto` (images are thumbnails in a fixed-width column — horizontal scroll is acceptable here since images must be viewable).
- The page header already uses responsive layout.

---

## 8. Status / Analytics Page (`app/status/page.tsx`)

Doctor-only. All charts are custom CSS progress bars (not recharts) — already responsive. Two fixes:

- KPI stat cards at lines 271 and 294 use `grid-cols-2 lg:grid-cols-4`. Change `lg:` to `md:` so the 4-column layout kicks in earlier: `grid-cols-2 md:grid-cols-4`.
- The revenue bar chart section wraps bars in a flex column already — verify it doesn't overflow horizontally on 390px.

---

## Implementation Rules

1. **Breakpoint:** `md` (768px) is the single breakpoint throughout.
2. **No new files.** All changes in existing page and component files.
3. **Two render paths per data page:** `<div className="hidden md:block"><Table …/></div>` + `<div className="md:hidden"><CardList …/></div>`. Same state, same handlers.
4. **Action buttons:** Always `Button variant="ghost" size="icon" className="h-8 w-8"` with the same lucide icon as the desktop table. Never emoji, never custom icon buttons.
5. **No avatars** anywhere.
6. **AppShell `<main>` padding:** `p-4 md:p-8`.
7. **Doctor mobile state:** `const [mobileDetailOpen, setMobileDetailOpen] = useState(false)`. Setting `selectedVisitId` on mobile also calls `setMobileDetailOpen(true)`. Back button calls `setMobileDetailOpen(false)`.
8. **Timeline chips** reuse the same `selectedDateFilter` state — chips call `setSelectedDateFilter` same as the desktop sidebar.
9. **No backend changes required.**
