# Responsive / Zoom Overflow Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop primary actions (Create Bill, Save to Inventory, All Visits tab/filter, duplicate-patient suggestions, admin tabs) from becoming unreachable when the browser is zoomed to ~150-200% or the app is opened on a narrow tablet/phone viewport.

**Architecture:** No new components or dependencies. Every fix is a targeted className change (mostly adding `flex-wrap`, swapping a breakpoint, or adding a `max-h/overflow-y-auto` cap) to an existing file, reusing patterns already proven correct elsewhere in this codebase. One fix (admin Tabs) additionally needs the existing uncontrolled `Tabs` converted to controlled state so a narrow-width `Select` fallback can drive the same tab value.

**Tech Stack:** Next.js 16 App Router, React, Tailwind CSS 4, shadcn/ui (Radix), TypeScript. No frontend test suite exists (per `CLAUDE.md`) — verification is `npm run lint`, `npm run build`, and a Playwright browser pass at narrow viewport widths.

## Global Constraints

- Frontend root: `/home/fia/Downloads/clinic_related/frontend`. Run all `npm` commands from there.
- Do not touch `components/layout/AppShell.tsx`'s `overflow-x-hidden` on `<main>` — it stays; the fix is making rows wrap instead of needing to scroll past it.
- Do not introduce a new shared "responsive toolbar" component — reuse the exact utility patterns already used correctly elsewhere (`flex-wrap`, `hidden lg:flex` + `block lg:hidden` Select fallback, `max-h-[Nvh] overflow-y-auto`, `max-w-[95vw] h-[95vh]`).
- No test suite exists for the frontend — do not invent one. Verification per task is `npm run lint` (must stay clean) plus a manual/Playwright viewport check where noted.
- Match existing code style in each file exactly (indentation, quote style, etc.) — these are surgical className edits, not rewrites.
- Spec: `docs/superpowers/specs/2026-08-11-responsive-ui-audit-design.md`.

---

### Task 1: Billing page — Patient & Actions Row wraps instead of clipping Create Bill

**Files:**
- Modify: `frontend/app/billing/page.tsx:498`

**Interfaces:** None — standalone className change, no new state or props.

- [ ] **Step 1: Confirm current broken state**

Read `frontend/app/billing/page.tsx` around line 498 and confirm the row is:
```tsx
<div className="flex flex-col md:flex-row gap-4 md:items-center justify-between shrink-0">
```
with no `flex-wrap` anywhere in that string.

- [ ] **Step 2: Add `flex-wrap`**

Change line 498 to:
```tsx
<div className="flex flex-col md:flex-row flex-wrap md:items-center justify-between gap-4 shrink-0">
```
(`gap-4` moved after `justify-between` only for readability — functionally the class list is the same set plus `flex-wrap`.)

- [ ] **Step 3: Verify with lint**

Run: `cd frontend && npm run lint`
Expected: no new errors/warnings introduced by this file.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/billing/page.tsx
git commit -m "fix: wrap Billing Patient & Actions row so Create Bill can't go off-screen"
```

---

### Task 2: Invoice Edit page — header action row wraps instead of clipping Save to Inventory

**Files:**
- Modify: `frontend/app/inventory/invoice_edit/page.tsx` (the `<div className="flex items-center justify-between">` header wrapper that contains the "Save to Inventory" button)

**Interfaces:** None — standalone className change.

- [ ] **Step 1: Confirm current broken state**

Read `frontend/app/inventory/invoice_edit/page.tsx` and find:
```tsx
<div className="flex items-center justify-between">
    <div className="flex items-center gap-4">
```
(the outer row directly under `return (<div className="space-y-6">`), and its sibling action group:
```tsx
    <div className="flex gap-2">
```
which contains the Attach Image / Upload via QR / remove-image / "Save to Inventory" buttons.

- [ ] **Step 2: Add `flex-wrap` to both rows**

Change the outer row to:
```tsx
<div className="flex items-center justify-between flex-wrap gap-y-3">
    <div className="flex items-center gap-4">
```
Change the action group to:
```tsx
    <div className="flex gap-2 flex-wrap">
```

- [ ] **Step 3: Verify with lint**

Run: `cd frontend && npm run lint`
Expected: no new errors/warnings.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/inventory/invoice_edit/page.tsx
git commit -m "fix: wrap Invoice Edit header row so Save to Inventory can't go off-screen"
```

---

### Task 3: Dashboard page — header wraps so All Visits tab and date filter stay reachable

**Files:**
- Modify: `frontend/app/page.tsx:269`

**Interfaces:** None — standalone className change.

- [ ] **Step 1: Confirm current broken state**

Read `frontend/app/page.tsx` around line 269 and confirm:
```tsx
<div className="flex items-center gap-3 flex-shrink-0">
```
has no `flex-wrap`, and that this row contains the hamburger button, the `w-44 shrink-0` "Dashboard" title, the `w-32` Inventory/Billing/Patients buttons, the `TabsList` (Overview/All Visits), and an `ml-auto` `DatePickerWithRange`.

- [ ] **Step 2: Add `flex-wrap`**

Change line 269 to:
```tsx
<div className="flex items-center gap-3 flex-wrap flex-shrink-0">
```

- [ ] **Step 3: Verify with lint**

Run: `cd frontend && npm run lint`
Expected: no new errors/warnings.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "fix: wrap Dashboard header row so All Visits tab and date filter stay reachable"
```

---

### Task 4: AddPatientDialog — duplicate-suggestions bubble repositions on narrow widths

**Files:**
- Modify: `frontend/components/AddPatientDialog.tsx` (the "Suggestions Bubble - Left Side" block, currently `absolute right-[102%] top-0 mr-2 w-64 ...`)

**Interfaces:** None — standalone className change, same conditional render logic (`showSuggestions && suggestions.length > 0`).

- [ ] **Step 1: Confirm current broken state**

Read `frontend/components/AddPatientDialog.tsx` and find:
```tsx
{showSuggestions && suggestions.length > 0 && (
    <div className="absolute right-[102%] top-0 mr-2 w-64 bg-popover text-popover-foreground rounded-md border shadow-md p-2 z-50 animate-in fade-in zoom-in-95 slide-in-from-right-2 block">
```
Confirm this places the bubble entirely to the left of the phone input with no responsive variant, so on a viewport narrower than roughly `input width + 256px + margins` it renders partially or fully outside the visible viewport.

- [ ] **Step 2: Make the position responsive — below the input by default, left-side at `sm:` and up**

Replace the className with:
```tsx
<div className="absolute z-50 w-64 top-full left-0 mt-2 sm:top-0 sm:left-auto sm:right-[102%] sm:mt-0 sm:mr-2 bg-popover text-popover-foreground rounded-md border shadow-md p-2 animate-in fade-in zoom-in-95 slide-in-from-top-2 sm:slide-in-from-right-2 block">
```
(Note: `slide-in-from-top-2` replaces `slide-in-from-right-2` as the default entrance animation since the bubble now enters from below by default; the `sm:` variant keeps the original right-side slide-in at wider widths.)

- [ ] **Step 3: Verify with lint**

Run: `cd frontend && npm run lint`
Expected: no new errors/warnings.

- [ ] **Step 4: Manually verify in-browser**

Open `/patients`, click "Add Patient", type a phone number that matches an existing patient (triggers `showSuggestions`). At a browser width **below 640px** (or zoomed so the dialog is that narrow), confirm the suggestions bubble appears **below** the phone input, fully visible, not clipped by the left edge of the viewport. At **640px and above**, confirm it still appears to the left of the input as before.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/AddPatientDialog.tsx
git commit -m "fix: reposition AddPatientDialog duplicate-suggestions bubble below input on narrow viewports"
```

---

### Task 5: Doctor page — desktop 3-pane layout no longer engages on cramped tablet widths

**Files:**
- Modify: `frontend/app/doctor/page.tsx:289` (mobile layout gate)
- Modify: `frontend/app/doctor/page.tsx:501` (desktop layout gate)
- Modify: `frontend/app/doctor/page.tsx:503` (desktop header row — add wrap safety net)

**Interfaces:** None — className/breakpoint changes only, no new state.

- [ ] **Step 1: Confirm current breakpoints**

Read `frontend/app/doctor/page.tsx` and confirm:
- Line 289: `<div className="md:hidden flex flex-col">` (mobile layout, hidden at `md`+ / 768px+)
- Line 501: `<div className="hidden md:flex md:flex-col gap-4 h-[calc(100vh-100px)] overflow-hidden relative">` (desktop 3-pane layout, shown at `md`+)
- Line 503: `<div className="flex items-center justify-between shrink-0">` (desktop header row with 4 nav buttons, no `flex-wrap`)

Confirm the desktop layout stacks a fixed `w-[380px]` sidebar (line 994) and a resizable `180-500px` timeline sidebar (line 581) next to the main content, which have no room to shrink — this is what gets crushed in the 768-1024px range.

- [ ] **Step 2: Move the mobile/desktop split from `md` to `lg`**

Change line 289 to:
```tsx
<div className="lg:hidden flex flex-col">
```
Change line 501 to:
```tsx
<div className="hidden lg:flex lg:flex-col gap-4 h-[calc(100vh-100px)] overflow-hidden relative">
```

- [ ] **Step 3: Add a wrap safety net to the desktop header row**

Change line 503 to:
```tsx
<div className="flex items-center justify-between flex-wrap gap-y-2 shrink-0">
```

- [ ] **Step 4: Verify with lint**

Run: `cd frontend && npm run lint`
Expected: no new errors/warnings.

- [ ] **Step 5: Manually verify in-browser**

Open `/doctor` as a doctor-role user (or a role that can view it) at a viewport width of ~900px (previously would have shown the cramped 3-pane desktop layout). Confirm it now shows the mobile/card layout instead. At ~1100px+, confirm the 3-pane desktop layout still renders normally.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/doctor/page.tsx
git commit -m "fix: move Doctor page desktop layout breakpoint from md to lg to fix tablet crushing"
```

---

### Task 6: Patients page — Patient List header row wraps

**Files:**
- Modify: `frontend/app/patients/page.tsx:255`

**Interfaces:** None — standalone className change.

- [ ] **Step 1: Confirm current broken state**

Read `frontend/app/patients/page.tsx` around line 255 and confirm:
```tsx
<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 shrink-0">
```
has no `flex-wrap`, sitting inside a `Card` with `overflow-hidden` (line 254), holding the `CardTitle` and a `w-72` search input.

- [ ] **Step 2: Add `flex-wrap`**

Change line 255 to:
```tsx
<CardHeader className="flex flex-row items-center justify-between flex-wrap gap-y-2 space-y-0 pb-4 shrink-0">
```

- [ ] **Step 3: Verify with lint**

Run: `cd frontend && npm run lint`
Expected: no new errors/warnings.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/patients/page.tsx
git commit -m "fix: wrap Patients page list header row on narrow widths"
```

---

### Task 7: Admin page — top-level TabsList gets a narrow-width Select fallback

**Files:**
- Modify: `frontend/app/admin/page.tsx` (component containing the `<Tabs defaultValue="overview">` block around line 1163, plus wherever its top-level state is declared)

**Interfaces:**
- Produces: a new `adminTab` (string) + `setAdminTab` state pair local to the component that renders this `Tabs` block, values matching the existing tab `value`s: `"overview" | "users" | "activity" | "settings"`.

- [ ] **Step 1: Confirm current uncontrolled Tabs**

Read `frontend/app/admin/page.tsx` around line 1163 and confirm:
```tsx
<Tabs defaultValue="overview">
    <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="activity">Activity Log</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
    </TabsList>

    <TabsContent value="overview" className="mt-4">
        <OverviewTab />
    </TabsContent>
    ...
```
is uncontrolled (`defaultValue`, no `value`/`onValueChange`). This block lives directly in `export default function AdminPage()` (line 1124) — not in one of the tab sub-components (`OverviewTab`, `UsersTab`, `ActivityLogTab`, `SettingsTab`, each defined earlier in the file) — so the new state goes in `AdminPage` itself, alongside its existing `useState` calls.

- [ ] **Step 2: Make Tabs controlled with local state**

In `AdminPage`, add near its other `useState` calls:
```tsx
const [adminTab, setAdminTab] = useState("overview")
```

Change the `Tabs` opening tag to:
```tsx
<Tabs value={adminTab} onValueChange={setAdminTab}>
```

- [ ] **Step 3: Hide TabsList on narrow widths, add a Select fallback**

Change:
```tsx
    <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="activity">Activity Log</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
    </TabsList>
```
to:
```tsx
    <TabsList className="hidden lg:inline-flex">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="activity">Activity Log</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
    </TabsList>

    <div className="block lg:hidden">
        <Select value={adminTab} onValueChange={setAdminTab}>
            <SelectTrigger className="w-full">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="overview">Overview</SelectItem>
                <SelectItem value="users">Users</SelectItem>
                <SelectItem value="activity">Activity Log</SelectItem>
                <SelectItem value="settings">Settings</SelectItem>
            </SelectContent>
        </Select>
    </div>
```
(`Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` are already imported in this file from `@/components/ui/select` — confirm the import exists before assuming it, it's used elsewhere in `app/admin/page.tsx`.)

- [ ] **Step 4: Verify with lint**

Run: `cd frontend && npm run lint`
Expected: no new errors/warnings, no "unused import" or "missing dependency" issues.

- [ ] **Step 5: Manually verify in-browser**

Open `/admin` as an admin user. At full desktop width, confirm the four-tab `TabsList` still works exactly as before (click each tab, confirm content switches). Shrink the browser below ~1024px (or zoom in), confirm the `TabsList` disappears and a `Select` dropdown appears in its place, and that choosing "Settings" in the dropdown shows the Settings tab content.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/admin/page.tsx
git commit -m "fix: add narrow-width Select fallback for Admin page's top-level Tabs"
```

---

### Task 8: AddVisitDialog and EditInventoryDialog — cap dialog height, allow scroll

**Files:**
- Modify: `frontend/components/AddVisitDialog.tsx:137`
- Modify: `frontend/components/EditInventoryDialog.tsx:130`

**Interfaces:** None — standalone className changes.

- [ ] **Step 1: Confirm current state — AddVisitDialog**

Read `frontend/components/AddVisitDialog.tsx` around line 137 and confirm:
```tsx
<DialogContent className="sm:max-w-[900px] gap-0 p-0 overflow-hidden">
    <div className="grid grid-cols-1 md:grid-cols-2 h-[600px]">
```
has no `max-h-[90vh]` cap on `DialogContent`, so a fixed `h-[600px]` inner grid can exceed a short/zoomed viewport with nothing to scroll.

- [ ] **Step 2: Cap AddVisitDialog's height**

Change the `DialogContent` className to:
```tsx
<DialogContent className="sm:max-w-[900px] max-h-[90vh] gap-0 p-0 overflow-y-auto overflow-x-hidden">
```
Change the inner grid's className to remove the fixed height so it can grow with its content instead of fighting the new scroll container:
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 min-h-[600px] md:h-full">
```
(`min-h-[600px]` preserves the original visual height on tall viewports; `md:h-full` lets it fill the now-scrollable `DialogContent` on desktop two-column layout without a hardcoded pixel height.)

- [ ] **Step 3: Confirm current state — EditInventoryDialog**

Read `frontend/components/EditInventoryDialog.tsx` around line 130 and confirm:
```tsx
<DialogContent className="sm:max-w-[600px]">
    <form onSubmit={handleSubmit}>
        <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
            <DialogDescription>
                Update master details for {item.item_name}.
            </DialogDescription>
        </DialogHeader>

        <div className="h-[400px] overflow-y-auto px-1">
```
has no `max-h-[90vh]` cap on `DialogContent` — the fixed `h-[400px]` inner region plus header/footer can exceed a short viewport.

- [ ] **Step 4: Cap EditInventoryDialog's height**

Change the `DialogContent` className to:
```tsx
<DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
```

- [ ] **Step 5: Verify with lint**

Run: `cd frontend && npm run lint`
Expected: no new errors/warnings.

- [ ] **Step 6: Manually verify in-browser**

Open `/patients`, use "Add Visit" to open `AddVisitDialog` at a short/zoomed viewport (e.g. browser window resized to ~500px tall) — confirm the dialog scrolls instead of clipping its footer/submit button. Open Inventory's Edit Item dialog (`EditInventoryDialog`) the same way and confirm the same.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/AddVisitDialog.tsx frontend/components/EditInventoryDialog.tsx
git commit -m "fix: cap AddVisitDialog/EditInventoryDialog height so they scroll instead of clipping on short viewports"
```

---

### Task 9: EditVisitDialog and EditPatientDialog — allow scroll on long content

**Files:**
- Modify: `frontend/components/EditVisitDialog.tsx:140`
- Modify: `frontend/components/EditPatientDialog.tsx:88`

**Interfaces:** None — standalone className changes.

- [ ] **Step 1: Confirm current state**

Read both files at the given lines and confirm both `DialogContent`s are:
```tsx
<DialogContent className="max-w-[95vw] h-[95vh] flex flex-col items-center justify-center">
```
with no `overflow-y-auto`, so content taller than `95vh` (e.g. `EditVisitDialog` with its refund sub-section expanded) has no scroll fallback.

- [ ] **Step 2: Add `overflow-y-auto`**

In `frontend/components/EditVisitDialog.tsx:140`, change to:
```tsx
<DialogContent className="max-w-[95vw] h-[95vh] flex flex-col items-center justify-center overflow-y-auto">
```
In `frontend/components/EditPatientDialog.tsx:88`, change to:
```tsx
<DialogContent className="max-w-[95vw] h-[95vh] flex flex-col items-center justify-center overflow-y-auto">
```

- [ ] **Step 3: Verify with lint**

Run: `cd frontend && npm run lint`
Expected: no new errors/warnings.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/EditVisitDialog.tsx frontend/components/EditPatientDialog.tsx
git commit -m "fix: allow EditVisitDialog/EditPatientDialog to scroll instead of clipping on tall content"
```

---

### Task 10: WalkInForm — Address/Age/Sex row loosens fixed pixel columns

**Files:**
- Modify: `frontend/components/WalkInForm.tsx:514`

**Interfaces:** None — standalone className change.

- [ ] **Step 1: Confirm current state**

Read `frontend/components/WalkInForm.tsx` around line 514 and confirm:
```tsx
<div className="grid grid-cols-[1fr_72px_96px] gap-2">
```
(Address / Age / Sex row) uses fixed pixel tracks for the Age and Sex columns, which get cramped once the already `md:w-2/5`-constrained form is squeezed further on narrow widths.

- [ ] **Step 2: Switch to `minmax()` tracks so columns can't be crushed below a usable width but can still grow**

Change line 514 to:
```tsx
<div className="grid grid-cols-[1fr_minmax(64px,72px)_minmax(84px,96px)] gap-2">
```

- [ ] **Step 3: Verify with lint**

Run: `cd frontend && npm run lint`
Expected: no new errors/warnings.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/WalkInForm.tsx
git commit -m "fix: loosen WalkInForm Address/Age/Sex row column widths on narrow viewports"
```

---

### Task 11: Full-sweep verification pass

**Files:** None modified — verification only.

**Interfaces:** None.

- [ ] **Step 1: Build check**

Run: `cd frontend && npm run build`
Expected: build succeeds with no new type or lint errors from any of Tasks 1-10.

- [ ] **Step 2: Start the app locally**

Ensure the backend and frontend dev servers are running per `CLAUDE.md` (`cd Backend_db && source venv/bin/activate && python app.py`, and separately `cd frontend && npm run dev`).

- [ ] **Step 3: Playwright pass — Billing (Task 1)**

Use the Playwright browser tools to navigate to `http://localhost:3000/billing`, resize the browser window to ~960px, then ~700px, then ~500px wide. At each width, take a screenshot and confirm the "Create Bill" button is visible and clickable (not clipped off the right edge), with the Patient & Actions Row content wrapped onto additional lines as needed.

- [ ] **Step 4: Playwright pass — Dashboard (Task 3)**

Navigate to `http://localhost:3000/`, resize to the same three widths, screenshot each, confirm the "All Visits" tab trigger is reachable and (when that tab is active) the date-range filter is visible, not clipped.

- [ ] **Step 5: Playwright pass — Invoice Edit (Task 2)**

Navigate to `http://localhost:3000/inventory/invoice_edit?manual=true` (or an existing invoice edit URL), resize to the same three widths, screenshot each, confirm "Save to Inventory" is visible and clickable.

- [ ] **Step 6: Playwright pass — Doctor page (Task 5)**

Log in as (or switch to) a doctor-role session, navigate to `http://localhost:3000/doctor`, resize to ~900px and confirm the mobile/card layout renders (not a crushed 3-pane layout); resize to ~1200px and confirm the full 3-pane desktop layout renders correctly.

- [ ] **Step 7: Report results**

Summarize pass/fail for each of the four pages at each width, including any screenshots taken, and note any remaining issue that needs a follow-up task before considering this plan complete.
