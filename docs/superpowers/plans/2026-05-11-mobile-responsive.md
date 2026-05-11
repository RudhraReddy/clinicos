# Mobile Responsive Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all ClinicOS pages usable on phones (≥390px) while leaving the desktop layout unchanged above the `md` breakpoint (768px).

**Architecture:** Two render paths per data-heavy page — desktop table wrapped in `hidden md:block`, mobile card list wrapped in `md:hidden`. Doctor dashboard gets a `mobileDetailOpen` state toggle between a queue view and a full-screen detail view. No new files created. No backend changes.

**Tech Stack:** Next.js 15 App Router, React, Tailwind CSS 4, shadcn/ui (Button, Badge, Card), lucide-react icons.

---

## Task 1: AppShell — reduce main padding on mobile

**Files:**
- Modify: `frontend/components/layout/AppShell.tsx:49`

- [ ] **Step 1: Change main padding**

  In `AppShell.tsx` line 49, change:
  ```tsx
  <main className="flex-1 min-w-0 overflow-x-hidden p-8 bg-gray-50/50 dark:bg-background min-h-screen">
  ```
  to:
  ```tsx
  <main className="flex-1 min-w-0 overflow-x-hidden p-4 md:p-8 bg-gray-50/50 dark:bg-background min-h-screen">
  ```

- [ ] **Step 2: Verify visually**

  ```bash
  cd frontend && npm run dev
  ```
  Open DevTools → toggle phone emulation (390px). All pages should now have `16px` side padding instead of `32px`. Desktop should be unchanged.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/components/layout/AppShell.tsx
  git commit -m "feat(mobile): reduce main padding to p-4 on mobile"
  ```

---

## Task 2: Doctor Dashboard — mobile queue + detail stack

**Files:**
- Modify: `frontend/app/doctor/page.tsx`

The current `return` (line 279) wraps everything in one `h-[calc(100vh-60px)] flex` container. We split it into a `md:hidden` mobile section and a `hidden md:flex` desktop section. The desktop section contains the existing split-pane code unchanged.

- [ ] **Step 1: Add `mobileDetailOpen` state and `allTimelineDates` memo**

  After line 20 (`const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null)`), add:
  ```tsx
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  ```

  After the `filteredImages` useMemo (after line 258), add:
  ```tsx
  const allTimelineDates = useMemo(() => {
      const s = new Set<string>()
      ;[selectedVisit, ...patientHistory].filter((v): v is Visit => !!v).forEach(v => {
          if (v.visit_date) s.add(v.visit_date)
      })
      patientImages.forEach(img => {
          if (img.timestamp) {
              try { s.add(new Date(img.timestamp).toISOString().split('T')[0]) } catch {}
          }
      })
      return Array.from(s).sort().reverse()
  }, [patientImages, selectedVisit, patientHistory])
  ```

- [ ] **Step 2: Update `setSelectedVisitId` calls to also set `mobileDetailOpen`**

  Find the single click handler in the desktop appointments list (line ~763):
  ```tsx
  onClick={() => setSelectedVisitId(visit.visit_id)}
  ```
  Change to:
  ```tsx
  onClick={() => { setSelectedVisitId(visit.visit_id); setMobileDetailOpen(true) }}
  ```

  Also in `handleDeleteVisit` (line ~201), after `setSelectedVisitId(null)`, add:
  ```tsx
  setMobileDetailOpen(false)
  ```

- [ ] **Step 3: Restructure the return JSX**

  Replace the opening line of the return (line 280):
  ```tsx
  <div className="h-[calc(100vh-60px)] flex bg-background overflow-hidden relative">
  ```
  with:
  ```tsx
  <div>
      {/* ── MOBILE LAYOUT (hidden md+) ── */}
      <div className="md:hidden flex flex-col">

          {/* Stat strip */}
          <div className="flex border-b bg-card">
              <div className="flex-1 text-center py-2.5 border-r">
                  <p className="text-2xl font-bold">{orderedTodayVisits.length}</p>
                  <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Today</p>
              </div>
              <div className="flex-1 text-center py-2.5 border-r">
                  <p className="text-2xl font-bold">{orderedTodayVisits.filter(v => v.status === 'done').length}</p>
                  <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Done</p>
              </div>
              <div className="flex-1 text-center py-2.5">
                  <p className="text-2xl font-bold">{orderedTodayVisits.filter(v => v.status !== 'done' && v.status !== 'cancelled').length}</p>
                  <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Waiting</p>
              </div>
          </div>

          {mobileDetailOpen && selectedVisit ? (
              /* ── MOBILE DETAIL PANEL ── */
              <div className="flex flex-col">
                  {/* Back + name header */}
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border-b border-primary/20">
                      <button
                          type="button"
                          className="text-sm font-semibold text-primary"
                          onClick={() => setMobileDetailOpen(false)}
                      >
                          ← Back
                      </button>
                      <span className="flex-1 font-bold text-sm truncate">{selectedVisit.patient_name}</span>
                      <Badge variant={selectedVisit.status === 'done' ? 'secondary' : 'outline'} className="text-[10px] uppercase">
                          {selectedVisit.status}
                      </Badge>
                  </div>

                  {/* Meta chips */}
                  <div className="flex flex-wrap gap-1.5 px-4 py-2 bg-card border-b">
                      {selectedVisit.dob && (
                          <span className="text-xs bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full">
                              {Math.floor((Date.now() - new Date(selectedVisit.dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25))} yrs
                              {selectedVisit.sex ? ` · ${selectedVisit.sex}` : ''}
                          </span>
                      )}
                      {selectedVisit.visit_time && (
                          <span className="text-xs bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full">
                              {selectedVisit.visit_time.substring(0, 5)}
                          </span>
                      )}
                      {selectedVisit.reason && (
                          <span className="text-xs bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full">
                              {selectedVisit.reason}
                          </span>
                      )}
                  </div>

                  {/* Patient Pictures card header */}
                  <div className="flex items-center justify-between px-4 py-2 bg-card border-b">
                      <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                          <ImageIcon className="h-3.5 w-3.5" /> Patient Pictures
                      </span>
                      <div className="flex items-center gap-1">
                          {!showTrash && (
                              <>
                                  <button
                                      type="button"
                                      onClick={() => document.getElementById('image-upload-input')?.click()}
                                      className="text-[10px] font-semibold px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                                  >
                                      + Add
                                  </button>
                                  <button
                                      type="button"
                                      onClick={() => setShowQR(true)}
                                      className="text-[10px] font-semibold px-2 py-1 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                                  >
                                      QR
                                  </button>
                              </>
                          )}
                          <button
                              type="button"
                              onClick={() => setShowTrash(prev => !prev)}
                              className={`text-[10px] font-semibold px-2 py-1 rounded transition-colors ${showTrash ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
                          >
                              {showTrash ? 'Back' : 'Trash'}
                          </button>
                      </div>
                  </div>

                  {/* Timeline chips — horizontal scroll */}
                  <div className="flex gap-1.5 px-4 py-2 overflow-x-auto border-b bg-muted/30" style={{WebkitOverflowScrolling:'touch'}}>
                      <button
                          type="button"
                          onClick={() => setSelectedDateFilter(null)}
                          className={`text-xs px-3 py-1 rounded-full border flex-shrink-0 transition-colors ${selectedDateFilter === null ? 'bg-primary/10 border-primary/20 text-primary font-semibold' : 'bg-card border-border text-muted-foreground'}`}
                      >
                          All History
                      </button>
                      {allTimelineDates.map(date => {
                          const hasImages = patientImages.some(img => {
                              try { return new Date(img.timestamp).toISOString().split('T')[0] === date } catch { return false }
                          })
                          return (
                              <button
                                  key={date}
                                  type="button"
                                  onClick={() => setSelectedDateFilter(date)}
                                  className={`text-xs px-3 py-1 rounded-full border flex-shrink-0 transition-colors ${selectedDateFilter === date ? 'bg-primary/10 border-primary/20 text-primary font-semibold' : 'bg-card border-border text-muted-foreground'}`}
                              >
                                  {new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                                  {hasImages && <span className="ml-1 opacity-50">·</span>}
                              </button>
                          )
                      })}
                  </div>

                  {/* 2-col image grid */}
                  <div className="grid grid-cols-2 gap-2 p-3 bg-card">
                      {filteredImages.length === 0 ? (
                          <div className="col-span-2 py-10 flex flex-col items-center text-muted-foreground opacity-50">
                              <ImageIcon className="h-8 w-8 mb-2" />
                              <span className="text-sm">No images</span>
                          </div>
                      ) : (
                          filteredImages.map(img => (
                              <div
                                  key={img.id}
                                  className="aspect-square rounded-md overflow-hidden border bg-muted cursor-pointer relative group"
                                  onClick={() => setLightboxState({ image: img, context: filteredImages })}
                              >
                                  <img
                                      src={`${API_BASE_URL}/api/patients/images/${img.id}/file`}
                                      alt={img.notes || ''}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                  />
                                  {img.notes && (
                                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] px-1.5 py-1 truncate">
                                          {img.notes}
                                      </div>
                                  )}
                              </div>
                          ))
                      )}
                  </div>
              </div>
          ) : (
              /* ── MOBILE QUEUE LIST ── */
              <div>
                  <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/30 border-b">
                      {today}
                  </p>
                  {loading ? (
                      <div className="flex justify-center py-12">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                  ) : orderedTodayVisits.length === 0 ? (
                      <p className="text-center py-12 text-sm text-muted-foreground">No appointments today.</p>
                  ) : (
                      orderedTodayVisits.map(visit => (
                          <div
                              key={visit.visit_id}
                              className={`flex items-center gap-2 px-4 py-3 border-b cursor-pointer transition-colors ${selectedVisitId === visit.visit_id ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-muted/40'} ${visit.status === 'done' ? 'opacity-50' : ''}`}
                              onClick={() => { setSelectedVisitId(visit.visit_id); setMobileDetailOpen(true) }}
                          >
                              <span className="font-bold text-sm min-w-[38px] flex-shrink-0">{visit.visit_time?.substring(0, 5) || 'ASAP'}</span>
                              <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-sm truncate">{visit.patient_name}</p>
                                  <p className="text-xs text-muted-foreground truncate">{visit.reason || '—'}</p>
                              </div>
                              <Badge variant={visit.status === 'done' ? 'secondary' : 'outline'} className="text-[10px] uppercase flex-shrink-0">
                                  {visit.status}
                              </Badge>
                              <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 flex-shrink-0"
                                  onClick={(e) => { e.stopPropagation(); handleDeleteVisit(visit.visit_id) }}
                              >
                                  <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                          </div>
                      ))
                  )}
              </div>
          )}
      </div>

      {/* ── DESKTOP LAYOUT (hidden on mobile) ── */}
      <div className="hidden md:flex h-[calc(100vh-60px)] bg-background overflow-hidden relative">
  ```

  Then at the very end of the return (line ~806), close the extra `</div>` for the desktop wrapper and outer wrapper:
  ```tsx
          </div> {/* end desktop right sidebar */}
      </div> {/* end desktop flex */}
  </div>  {/* end outer wrapper */}
  ```

- [ ] **Step 4: Verify visually**

  Run `npm run dev`. On a 390px phone emulation:
  - `/doctor` shows stat strip + appointment list
  - Tapping a row shows the detail panel with Back button, meta chips, timeline chips, and image grid
  - Tapping Back returns to queue
  - Desktop at 1024px is identical to before

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/app/doctor/page.tsx
  git commit -m "feat(mobile): doctor dashboard queue+detail stack on mobile"
  ```

---

## Task 3: Patients Page — mobile card list

**Files:**
- Modify: `frontend/app/patients/page.tsx:147–261`

- [ ] **Step 1: Wrap existing table in `hidden md:block`**

  Find the `<Card>` containing the table (around line 174 — the `<CardContent>` that wraps `<Table>`). Change:
  ```tsx
  <CardContent className="p-0">
  ```
  to:
  ```tsx
  <CardContent className="p-0">
      {/* Desktop table */}
      <div className="hidden md:block">
  ```
  and close the new div just before `</CardContent>`:
  ```tsx
      </div> {/* end desktop table */}
  ```

- [ ] **Step 2: Add mobile card list inside `CardContent`, after the desktop table div**

  Insert this block just before `</CardContent>`:
  ```tsx
  {/* Mobile card list */}
  <div className="md:hidden divide-y">
      {loading ? (
          <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
      ) : filteredPatients.length === 0 ? (
          <p className="text-center py-8 text-sm text-muted-foreground">No patients found.</p>
      ) : (
          filteredPatients.map((patient, index) => (
              <div key={`m-${patient.patient_id}-${index}`} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{patient.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                          <span className="font-mono">{patient.patient_id}</span>
                          {patient.age || (patient.dob ? ` · ${Math.floor((Date.now() - new Date(patient.dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25))} yrs` : '')}
                          {patient.sex ? ` · ${patient.sex}` : ''}
                          {patient.phone_number ? ` · ${patient.phone_number}` : ''}
                      </p>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                      {role === 'doctor' ? (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedPatient(patient); setViewMode('full'); setViewDialogOpen(true) }}>
                              <Eye className="h-4 w-4" />
                          </Button>
                      ) : (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedPatient(patient); setViewMode('visits-only'); setViewDialogOpen(true) }}>
                              <FileText className="h-4 w-4" />
                          </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedPatient(patient); setEditDialogOpen(true) }}>
                          <Edit className="h-4 w-4" />
                      </Button>
                  </div>
              </div>
          ))
      )}
      {/* Pagination (mobile) */}
      <div className="flex items-center justify-between px-4 py-3 border-t">
          <p className="text-xs text-muted-foreground">Page {page} · {patients.length} records</p>
          <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={patients.length < PAGE_LIMIT}>
                  <ChevronRight className="h-4 w-4" />
              </Button>
          </div>
      </div>
  </div>
  ```

- [ ] **Step 3: Verify visually**

  On 390px emulation, `/patients` shows card rows (name, mono ID, age · sex · phone, ghost icon buttons). Desktop shows the original table.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/app/patients/page.tsx
  git commit -m "feat(mobile): patients page card list on mobile"
  ```

---

## Task 4: Billing Page — history cards + new bill overflow

**Files:**
- Modify: `frontend/app/billing/page.tsx`

### Part A — History tab mobile cards

- [ ] **Step 1: Wrap the existing history `<Table>` in `hidden md:block`**

  Around line 528, the `<Table>` is rendered directly inside a conditional. Wrap it:
  ```tsx
  ) : (
      <>
          {/* Desktop table */}
          <div className="hidden md:block">
              <Table>
                  ...existing table JSX...
              </Table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden divide-y border rounded-lg overflow-hidden">
              {history.length === 0 ? (
                  <p className="text-center py-8 text-sm text-muted-foreground">No bills found.</p>
              ) : (
                  history.map(bill => (
                      <div key={`m-${bill.invoice_id}`} className="px-4 py-3 bg-card">
                          <div className="flex items-baseline justify-between mb-1">
                              <span className="font-mono text-xs text-muted-foreground">{bill.invoice_id}</span>
                              <span className="font-bold text-sm">₹{bill.total_amount.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                              <span className="flex-1 text-xs text-muted-foreground">{bill.patient_name} · {bill.date}</span>
                              <Badge variant="outline" className="text-[10px]">{bill.payment_type}</Badge>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setPrintInvoiceId(bill.invoice_id); setPrintDialogOpen(true) }}>
                                  <Printer className="h-4 w-4" />
                              </Button>
                              {role === 'doctor' && (
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={async () => {
                                      if (window.confirm(`Delete invoice ${bill.invoice_id}? Stock will be restored.`)) {
                                          try {
                                              await api.deleteBill(bill.invoice_id)
                                              toast.success("Bill deleted and stock restored.")
                                              loadHistory(historyPage)
                                          } catch { toast.error("Failed to delete bill") }
                                      }
                                  }}>
                                      <Trash2 className="h-4 w-4" />
                                  </Button>
                              )}
                          </div>
                      </div>
                  ))
              )}
          </div>
      </>
  )}
  ```

### Part B — New Bill tab: wrap line-items table in overflow-x-auto

- [ ] **Step 2: Find the bill-items `<Table>` in the New Bill tab**

  Search for the table that renders bill items being added (has columns `#`, `Item`, `Qty`, `MRP`, `Total`, `Remove`). Wrap it:
  ```tsx
  <div className="overflow-x-auto">
      <Table>
          ...existing bill items table...
      </Table>
  </div>
  ```

- [ ] **Step 3: Verify visually**

  On 390px: History tab shows card rows. New Bill tab: items table scrolls horizontally when needed. Desktop unchanged.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/app/billing/page.tsx
  git commit -m "feat(mobile): billing history cards + new bill table scroll"
  ```

---

## Task 5: Inventory Page — stock cards + all-changes overflow

**Files:**
- Modify: `frontend/app/inventory/page.tsx`

### Part A — Stock tab mobile cards

The stock table (around line 624) is already inside `<div className="overflow-x-auto">`. Replace that wrapper with the two-path pattern:

- [ ] **Step 1: Replace the `overflow-x-auto` div wrapping the stock `<Table>`**

  Change:
  ```tsx
  <div className="overflow-x-auto">
      <Table>
          ...stock table...
      </Table>
  </div>
  ```
  to:
  ```tsx
  {/* Desktop table */}
  <div className="hidden md:block overflow-x-auto">
      <Table>
          ...stock table...
      </Table>
  </div>

  {/* Mobile card list */}
  <div className="md:hidden divide-y">
      {filteredItems.length === 0 ? (
          <p className="text-center py-8 text-sm text-muted-foreground">No items found.</p>
      ) : (
          filteredItems.map(item => (
              <div key={`m-${item.id}`} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{item.item_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                          {item.category || 'Uncategorised'}
                          {' · '}
                          <span className={item.quantity <= (item.min_stock_level ?? 0) && item.min_stock_level ? 'text-red-600 font-semibold' : ''}>
                              {item.quantity} units{item.quantity <= (item.min_stock_level ?? 0) && item.min_stock_level ? ' ⚠' : ''}
                          </span>
                          {item.expiry_date ? ` · Exp ${item.expiry_date}` : ''}
                      </p>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                      <EditInventoryDialog item={item} onSuccess={loadData} />
                      <ViewBatchesDialog item={item} />
                  </div>
              </div>
          ))
      )}
  </div>
  ```

  > **Note:** `filteredItems` is the filtered array already computed in the page. Check the exact variable name used in the existing `filteredItems.map(...)` call in the stock table body and use the same name.

### Part B — All Changes tab: inner event table overflow

- [ ] **Step 2: Find the inner table inside the All Changes day expand/collapse rows**

  Around line 903, there is a second `<div className="overflow-x-auto">`. Confirm it wraps the inner event table — if it already does, no change needed. If not, add:
  ```tsx
  <div className="overflow-x-auto">
      <Table>...inner events table...</Table>
  </div>
  ```

- [ ] **Step 3: Verify visually**

  On 390px: Inventory Stock tab shows card rows (name, category, qty with red warning if low, expiry). All Changes tab: inner event rows scroll horizontally if they overflow.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/app/inventory/page.tsx
  git commit -m "feat(mobile): inventory stock card list + all-changes table scroll"
  ```

---

## Task 6: Visits Page — mobile card list

**Files:**
- Modify: `frontend/app/visits/page.tsx:280–325`

- [ ] **Step 1: Wrap existing table**

  Around line 287, wrap the `<Table>` block:
  ```tsx
  {visits.length === 0 ? (
      <div className="text-center py-12 text-muted-foreground">
          ...existing empty state...
      </div>
  ) : (
      <>
          {/* Desktop table */}
          <div className="hidden md:block">
              <Table>
                  ...existing table...
              </Table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden divide-y">
              {visits.sort((a, b) => new Date(b.visit_date).getTime() - new Date(a.visit_date).getTime()).map(visit => (
                  <div
                      key={`m-${visit.visit_id}`}
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40"
                      onClick={() => window.location.href = `/visits/${visit.visit_id}`}
                  >
                      <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm">{visit.patient_name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                              {visit.visit_id} · {new Date(visit.visit_date).toLocaleDateString()} · {formatTime(visit.visit_time, visit.created_at)}
                          </p>
                      </div>
                      <Badge variant={visit.status === 'done' ? 'secondary' : 'outline'} className="text-[10px] uppercase flex-shrink-0">
                          {visit.status}
                      </Badge>
                  </div>
              ))}
          </div>
      </>
  )}
  ```

- [ ] **Step 2: Verify visually**

  On 390px: visits page shows card rows (patient name, mono visit ID · date · time, status badge). Tapping navigates to the visit detail. Desktop shows original table.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/app/visits/page.tsx
  git commit -m "feat(mobile): visits page card list on mobile"
  ```

---

## Task 7: Gallery Page — table horizontal scroll

**Files:**
- Modify: `frontend/app/gallery/page.tsx:~178`

- [ ] **Step 1: Wrap the gallery table in `overflow-x-auto`**

  Find the `<Table>` (around line 180). Wrap it:
  ```tsx
  <div className="overflow-x-auto">
      <Table>
          ...existing table...
      </Table>
  </div>
  ```

- [ ] **Step 2: Verify visually**

  On 390px: gallery table scrolls horizontally, thumbnails remain viewable. Desktop unchanged.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/app/gallery/page.tsx
  git commit -m "feat(mobile): gallery table horizontal scroll"
  ```

---

## Task 8: Status Page — fix KPI grid breakpoints

**Files:**
- Modify: `frontend/app/status/page.tsx:271,294`

- [ ] **Step 1: Change `lg:grid-cols-4` to `md:grid-cols-4` on two grid containers**

  Line 271:
  ```tsx
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-muted">
  ```
  change to:
  ```tsx
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-muted">
  ```

  Line 294:
  ```tsx
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
  ```
  change to:
  ```tsx
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
  ```

- [ ] **Step 2: Verify visually**

  On 390px: KPI cards display in 2 columns. On 768px tablet: cards spread to 4 columns. Desktop unchanged.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/app/status/page.tsx
  git commit -m "feat(mobile): status page KPI grid 2-col on mobile"
  ```

---

## Self-Review Notes

- All 8 spec sections have a corresponding task.
- No new files created in any task.
- `filteredItems` variable name in Task 5 must be verified against the actual variable used in the inventory table map — check the existing `filteredItems.map(...)` call and use the same name.
- Task 2 (doctor page) is the most complex; the new `</div>` tags for the desktop wrapper and outer wrapper must be carefully counted to avoid JSX nesting errors. Run `npm run build` after Task 2 to catch any JSX errors early.
- Billing delete check uses `role === 'doctor'` to match the existing code (not `role === 'admin'` — do not change the role guard).
