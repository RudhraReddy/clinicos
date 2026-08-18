# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClinicOS is a full-stack clinic management system. The backend is a Flask REST API (`Backend_db/`) and the frontend is a Next.js 16 App Router app (`frontend/`). See `CONTEXT.md` for a quick-reference of all tables, endpoints, and key flows. See `docs/` for per-feature flow docs.

## Development Commands

### Backend (Flask)

```bash
cd Backend_db
source venv/bin/activate
python app.py          # Dev server on http://localhost:5000
```

For production (used by Render):
```bash
gunicorn --bind 0.0.0.0:$PORT "app:create_app()"
```

Utility scripts (not part of normal workflow):
```bash
python scripts/reset_db.py       # Drop and recreate tables
python scripts/seed_data.py      # Seed test data
```

### Frontend (Next.js)

```bash
cd frontend
npm run dev     # Dev server on http://localhost:3000
npm run build   # Production build
npm run lint    # ESLint check
```

### Running Both (VSCode)

The `.vscode/tasks.json` defines "Start Backend", "Start Frontend", and "Start All Servers" tasks.

### Environment Setup

**Backend** (`Backend_db/.env`):
```
DATABASE_URL=postgresql://Rize:vs%409699@localhost/clinic_db
UPLOAD_BASE_DIR=/media/fia/External/data/images
FLASK_DEBUG=True
CORS_ORIGINS=http://localhost:3000
```

**Frontend** (`frontend/.env.local`):
```
BACKEND_URL=http://127.0.0.1:5000
```

There are no test suites for either the backend or frontend.

### Manual / Browser Testing (Playwright, local dev only)

To drive the local app in a real browser (e.g. via the Playwright MCP tools) without going through the
TOTP login UI, mint a self-signed JWT and inject it as the `auth_token` cookie:

1. **Secret:** `JWT_SECRET_KEY` from `Backend_db/.env` — `dev-jwt-secret-change-in-production`.
2. **Payload:** `{"user_id": "<a real User.id>", "role": "<their role>", "username": "<their username>", "exp": <a few hours out>}`, signed HS256. `require_auth` (`Backend_db/routes/auth.py`) puts the decoded payload straight onto `g.current_user` — `role`/`username` must be present and correct for that user, not just `user_id`, or role-gated routes/UI will misbehave.
3. **Mint it** (from `Backend_db/`, with `venv` active):
   ```python
   import jwt, datetime
   token = jwt.encode(
       {"user_id": "<uuid>", "role": "<role>", "username": "<username>", "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=6)},
       "dev-jwt-secret-change-in-production", algorithm="HS256",
   )
   ```
4. **Inject it:**
   - Playwright MCP: navigate to the site once, then `browser_evaluate` with `() => { document.cookie = "auth_token=<token>; path=/"; }`, then navigate again.
   - `page.context().addCookies([{name: "auth_token", value: token, domain: "localhost", path: "/"}])` if driving Playwright directly.
   - curl: `curl --cookie "auth_token=$JWT" ...`

This only works against the local dev server, which uses the well-known dev secret above — it will not
work against Render, which uses a real, unknown `JWT_SECRET_KEY`. It's purely a shortcut to skip the
TOTP flow when poking the live local app or API during testing/verification.

### Git / GitHub

- **Repo:** the project's actual GitHub repo is `RudhraReddy/clinicos` — `origin` should be
  `git@github.com:RudhraReddy/clinicos.git`. (The local folder/working-copy on this machine is named
  `clinic_related`, which is just the on-disk directory name and unrelated to the GitHub repo name —
  don't infer one from the other.)
- **Auth:** push/pull uses SSH, not HTTPS. An SSH key (`~/.ssh/id_ed25519`) is registered on the
  GitHub account for this — `ssh -T git@github.com` should greet `Hi RudhraReddy!`. The HTTPS
  credential helper in `~/.gitconfig` is stale (it shells out to a `gh` binary under `/tmp/...` that
  doesn't persist across environment resets, since `/tmp` is ephemeral here) — don't rely on HTTPS
  remotes or `gh` for auth in this environment; if `origin` is ever set to an `https://github.com/...`
  URL, switch it back to the `git@github.com:...` SSH form.

## Architecture

### API Proxy

The frontend never calls the backend directly by hostname. `next.config.ts` rewrites `/api/*` → `$BACKEND_URL/api/*`. All API calls in `frontend/lib/api.ts` use relative paths (`/api/...`). This is intentional — it enables remote access via Twingate without CORS issues.

`lib/api.ts` also exports `API_BASE_URL` (the raw backend hostname) — use this only for direct file URLs (images), not for API calls.

### Flask Backend

- **App factory:** `Backend_db/app.py` → `create_app()` registers all blueprints with `/api` prefix.
- **Blueprints:** One file per domain in `routes/` (patients, visits, billing, inventory, images, upload, locations). All registered in `routes/__init__.py`.
- **ORM:** SQLAlchemy 2.0, all models in `models.py`. Extensions (db instance, `get_ist_now()`) in `extensions.py`.
- **Timestamps:** All use IST (UTC+5:30) via `get_ist_now()` — never use `datetime.utcnow()`.
- **ID generation:** `Backend_db/utils.py` — `generate_visit_id(patient_id)` → `{patient_id}-DDMMYY-XXX-XXX`, `generate_invoice_id()` → `DDMMYY-XXX-XXX`, `parse_expiry_date()` for flexible MM/YY input.

### Frontend

- **App Router:** All pages in `frontend/app/`. Role-based nav filtering done in `layout/Sidebar.tsx`.
- **Role system:** Roles (`frontdesk`, `doctor`, `admin`) are secured via multi-user server-side authentication and sessions. Authenticated context is managed via `lib/auth_context.tsx`.
- **UI stack:** Tailwind CSS 4 + shadcn/ui (Radix UI) + lucide-react icons. Toast notifications via `sonner`.
- **All API calls** go through `frontend/lib/api.ts`. This is the only place to add/modify API interaction.
- **IST date helper:** `frontend/lib/utils.ts` exports `getTodayIST()` — returns today's date as `YYYY-MM-DD` in IST. Use this wherever you need today's date on the frontend.
- **Visit age helper:** `frontend/lib/utils.ts` exports `getVisitAge(visitDate)` — `"{days}d"` up to 90 days, then `"{months}mo"`. Use wherever a past visit's age is shown next to its date.
- **Visit fee display helper:** `frontend/lib/utils.ts` exports `formatVisitFee(fee)` — `null`/`undefined` → `—`, exactly `0` → `FREE` (a deliberate zero-fee visit, not missing data), any other number → `₹{amount}`. Always use this instead of a raw `₹{fee}` template so free appointments render consistently everywhere.

### Page Map

| Route | File | Roles |
|---|---|---|
| `/` | `app/page.tsx` | frontdesk |
| `/doctor` | `app/doctor/page.tsx` | doctor (auto-redirected from `/`) |
| `/patients` | `app/patients/page.tsx` | all |
| `/billing` | `app/billing/page.tsx` | frontdesk |
| `/inventory` | `app/inventory/page.tsx` | all |
| `/inventory/history/[id]` | `app/inventory/history/[id]/page.tsx` | frontdesk |
| `/inventory/invoice_edit` | `app/inventory/invoice_edit/page.tsx` | frontdesk |
| `/gallery` | `app/gallery/page.tsx` | doctor |
| `/status` | `app/status/page.tsx` | doctor |
| `/daily-summary` | `app/daily-summary/page.tsx` | all |
| `/connect/[sessionId]` | `app/connect/[sessionId]/page.tsx` | public (mobile upload) |

The sidebar (`Sidebar.tsx`) uses two separate nav lists keyed on role:
- **frontdesk**: Dashboard (`/`), Patients, Inventory, Billing, Daily Summary — no Gallery
- **doctor**: Dashboard (`/doctor`), Patients, Inventory, Billing, Daily Summary, Gallery, Status

The `/` root page redirects `doctor` role to `/doctor` on load.

### Patient History View (`PatientDetailsView`)

`components/PatientDetailsView.tsx` is a full-screen Dialog showing a chronological timeline of visits, images, and bills.
- **Images** open in `ImagePreviewDialog` with prev/next navigation and keyboard arrow key support.
- **Bills** are clickable cards that open `PrintInvoiceDialog` to preview and print the invoice.
- The **Eye (view history) button** on the patients list page is only rendered for `role === 'doctor'`; frontdesk sees only the Edit button.

### Status / Analytics Page

`app/status/page.tsx` is a doctor-only analytics dashboard. Calls `api.getInventoryAnalytics(locationId?)` and `api.getLedger(locationId?)` — both accept a numeric `location_id` or `'all'`. The page has a **dynamic location dropdown** populated from `GET /api/admin/locations` (no hardcoded options). When a location is selected all KPI cards, charts, and inventory alerts scope to that clinic via `?location_id=N` on the backend. **Staff filter has been removed** — filtering is location-only. Sections: revenue KPI cards, inventory stock value, expense ledger breakdown, expiry/stock alerts.

Placeholder empty directories exist for future auth: `app/login/`, `app/create-account/`.

### Database Models

Two-layer inventory model:
- `ProductMaster` — catalog only (name, category, GST rate, min stock level). No qty or price.
- `InventoryBatch` — physical stock (qty, expiry, MRP, batch#, purchase source, **location_id**).

Core relationship chain:
```
Patient → Visit → Bill → BillItem → ProductMaster
                                       ↓
                                 InventoryBatch → PurchaseInvoice
```

Other models: `InventoryHistory` (audit log), `PatientImage` (with tags), `PrescriptionItem` (linked to visits), `UploadSession` (QR mobile uploads), `Location` (clinic branches).

**Multi-location model:** `Location` (id int PK, name string unique, is_active bool) — managed in Admin → Settings. A nullable `location_id` FK to `Location` exists on `User`, `Visit`, `Bill`, `PurchaseInvoice`, `ExpenseLedger`, and `InventoryBatch`. New records are auto-tagged with the creating user's `location_id`. `Visit` creation additionally accepts an explicit `location_id` override — the dashboard's Appointment form (`WalkInForm.tsx`) has a Clinic dropdown (defaults to the user's own clinic, only rendered once clinics exist) that lets frontdesk pick the clinic per visit instead of always inheriting the logged-in user's clinic; booking is blocked until a clinic is selected. Old rows keep their legacy `location` string column for backward compat. `Patient` intentionally has no `location_id` — only money/stock-related records are clinic-scoped; a patient can be seen at any clinic.

### Key Business Logic

**FIFO Billing:** When creating a bill, batches are consumed oldest-expiry-first. `BillItem` stores a snapshot of product data at sale time (not a live FK to price).

**Split payment (Billing Cash + Billing UPI):** `Bill.cash_amount`/`Bill.upi_amount` (both `Numeric(10,2)`) hold the real cash/UPI breakdown of a bill's payment — a bill no longer has to be paid entirely in one mode. `Bill.payment_type` is now a **derived display label** (`'CASH'` if `upi_amount == 0`, `'UPI'` if `cash_amount == 0`, else `'SPLIT'`) rather than something the frontend picks; anything needing the real breakdown reads the two amount columns directly, not `payment_type`. `POST /api/billing` takes `cash_amount`/`upi_amount` in the payload (not `payment_type`) and validates their sum is within **±₹1** of the bill's final total (post-discount, post-refund) — a small tolerance for rounding, matching the same check the Billing page UI runs client-side to gate the Create Bill button. `GET /api/billing/history`'s `payment_type` filter matches on `cash_amount > 0` / `upi_amount > 0` (so a split bill shows under both `CASH` and `UPI` individually — correct behavior for "show me everything with cash in it," not a bug) plus a `SPLIT` option (`cash_amount > 0 AND upi_amount > 0`). Daily Summary attributes a bill's `billing_fee` bucket by calling `add('billing_fee', 'cash', ...)`/`add('billing_fee', 'upi', ...)` separately from `cash_amount`/`upi_amount`, rather than inferring one mode for the bill's whole amount — a split bill contributes up to two entries to a row's `billing_fees` list instead of one. `InvoicePrint.tsx` prints an extra `CASH : ₹X   UPI : ₹Y` line under `PAYMENT MODE : SPLIT` when applicable. Design doc: `docs/superpowers/specs/2026-08-18-split-payment-design.md`.

**Draft invoice preview:** a printer-icon button next to **Walk-in Bill** (`components/DraftInvoicePreviewDialog.tsx`) prints whatever is currently on-screen in the "New Bill" form — no bill is created, nothing is saved, no invoice ID is generated. `InvoicePrint` already falls back to `"INVOICE NO : DRAFT"` whenever no `invoiceId` is given, so this needs no special-casing there. The draft's item lines deliberately omit HSN/Batch/Expiry — the real batch (and its expiry) is only decided by FIFO consumption on the backend at actual creation time, so there's nothing real to show yet; manufacturer/GST/pack size print where known (captured into the local `BillItem.manufacturer` field when an item is added, alongside the pre-existing `gst`/`pack_size`). `InvoicePrint` also gained a `paid` prop: a bold, bordered `PAID` stamp between the pharmacy header and patient details, shown only when true. The draft preview always passes `paid={false}` (nothing has actually been paid yet); `PrintInvoiceDialog.tsx` (a real, saved bill) computes it from the fetched bill's own `cash_amount + upi_amount >= total_amount - 1` rather than hardcoding `true` — correct today (Create Bill already requires full payment) and still correct if that validation ever loosens.

**Visit lifecycle:** `in_progress` → `done` → bill optionally created (sets `visit.invoice_id`). Payment status (`full`/`partial`/`unpaid`) tracked on the visit.

**QR Mobile Upload:** Desktop creates session → mobile opens `/connect/[sessionId]` and uploads images → desktop polls and finalizes. Files move from temp dir to permanent storage on finalize.

### File Storage

- Patient images: `$UPLOAD_BASE_DIR/patients/<patient_id>/`
- Invoice images: `$UPLOAD_BASE_DIR/invoices/`
- QR upload temp: `$UPLOAD_BASE_DIR/temp/<session_id>/`
- On Render, `UPLOAD_BASE_DIR` is `/var/data/clinic_uploads` — the `clinic-uploads` **persistent** 10GB disk (not ephemeral).

## Deployment

### Architecture

Production stack, projected ~$15/month (Render Hobby workspace):

| Service | Platform | Plan | RAM | Cost |
|---|---|---|---|---|
| `clinicos-api` | Render | Starter Python web | 512MB | $7/mo |
| `clinicos-frontend` | Render | Starter Node web | 512MB | $7/mo |
| `clinicos-db` | Render | **Free** PostgreSQL (256MB, 1GB storage) | — | $0 → **must upgrade to $7/mo** |
| `clinic-uploads` disk | Render | 10GB persistent (attached to clinicos-api) | — | $1/mo |

> **URGENT — action needed:** `clinicos-db` was on the **Free plan** with an auto-deletion date of **2026-05-29**, which has now passed. Whether it was upgraded to Starter ($7/mo) before that date or the database (and all data) was actually deleted has **not been verified** — check the live Render dashboard before assuming either outcome, and upgrade immediately if it's still on Free.

### Render

Configured via `render.yaml` (root of repo). Deployed automatically on push to `main`.

**Live URLs:**
- Frontend: `https://clinicos-frontend.onrender.com`
- API: `https://clinicos-api-69mw.onrender.com`

Notes:
- Both web services (`clinicos-api`, `clinicos-frontend`) are on **Starter** plan — always-on, no spin-down
- Persistent disk `clinic-uploads` (10GB) mounted at `/var/data/clinic_uploads` on `clinicos-api` (env `UPLOAD_BASE_DIR`). Render takes daily snapshots with 7-day retention.
- **`clinicos-db` is on Free plan** — expiry 2026-05-29. Actual DB name has a Render suffix (`clinic_db_s5ra`) but this is transparent since `DATABASE_URL` is injected. PostgreSQL 18, 1GB storage, 256MB RAM.
- Gunicorn timeout 120s; `--max-requests-jitter 50` is active in the live start command (also in render.yaml)
- `DATABASE_URL` injected from Render PostgreSQL; `app.py` normalises `postgres://` → `postgresql://` on startup
- `db.create_all()` runs inside `create_app()` — tables are created idempotently on every deploy
- No health check paths configured on either service — Render cannot detect hung workers

### Environment Variables

**`clinicos-api` (set in render.yaml or Render dashboard):**

| Variable | Value |
|---|---|
| `DATABASE_URL` | injected from Render PostgreSQL |
| `UPLOAD_BASE_DIR` | `/var/data/clinic_uploads` |
| `FLASK_DEBUG` | `false` |
| `CORS_ORIGINS` | `https://clinicos-frontend.onrender.com` |

**`clinicos-frontend`:**

| Variable | Value |
|---|---|
| `BACKEND_URL` | `https://clinicos-api-69mw.onrender.com` |
| `NODE_VERSION` | `20` |

---

## Invoice Print System

### Overview

The invoice print flow uses a popup window (`window.open`) to render and print, targeting an **80mm
dot-matrix/thermal receipt printer** (not a full-page printer) — the sole invoice format, no A4/A5
alternative. Because the popup has no access to the app's Tailwind stylesheet, `InvoicePrint.tsx` uses
**100% inline CSS** — no Tailwind class names inside the invoice markup. Layout is monospace
(`"Courier New", Courier, monospace`), single-column, pure black on white, with literal repeated-`-`/`=`
characters as dividers (not CSS borders) for an authentic receipt look.

### Files

- `frontend/components/InvoicePrint.tsx` — the invoice layout component
- `frontend/components/PrintInvoiceDialog.tsx` — the dialog that fetches bill data and hosts the print trigger
- `frontend/app/globals.css` — contains the `@page` rule for print media (dead code in practice — the
  popup window injects its own `<style>`, so this only matters if the page itself is ever printed
  directly — kept in sync anyway)

### Page size

All three files are aligned to **80mm width, automatic (continuous) height, 2.5mm/3mm margin**:
- `InvoicePrint.tsx` injects `<style>{'@page { size: 80mm auto; margin: 2.5mm 3mm }'}</style>` inside `#invoice-print-region`
- `printElement()` in `PrintInvoiceDialog.tsx` writes `@page{size:80mm auto;margin:2.5mm 3mm}` into the popup's `<style>` block
- `globals.css` `@page` rule: `size: 80mm auto; margin: 2.5mm 3mm`
- Content itself is constrained to `width: 74mm` (usable width after margins)

### InvoicePrint props

```ts
interface InvoicePrintProps {
  clinicName: string
  clinicAddress: string
  clinicPhone: string
  clinicLicense?: string
  patient: {
    name: string
    phone_number: string
    age?: number | null
    sex?: string | null
    reference?: string | null  // fetched but not currently rendered
  }
  billItems: {
    item_name: string; qty: number; mrp: number
    hsn_code?: string | null; manufacturer?: string | null; batch_number?: string | null
    expiry_date?: string | null; gst_rate?: number | null; unit?: string | null; pack_size?: string | null
  }[]
  invoiceId?: string
  total: number
  subtotal?: number
  discountType?: "percent" | "flat" | null
  visitRefundApplied?: number | null
  paymentType?: string | null   // 'CASH' | 'UPI' | 'SPLIT', from Bill.payment_type
  cashAmount?: number | null    // from Bill.cash_amount, printed when paymentType is 'SPLIT'
  upiAmount?: number | null     // from Bill.upi_amount, printed when paymentType is 'SPLIT'
  paid?: boolean                // stamps "PAID" between header and patient details; false on a draft preview
  date?: Date
  referenceDoctor?: string      // clinic-wide setting from useSettings(), not per-bill
  className?: string            // applied to outer wrapper only, for dialog preview styling
}
```

### Typography

Base body text is 9.5pt/400 (`line-height: 1.2` throughout — tight spacing is a deliberate part of
the compact receipt look, not just small font sizes). A `Label` helper component renders field labels
(`NAME`, `PH`, `REF`, `AGE`, `INVOICE NO`, `PAYMENT MODE`, `DATE`, `TIME`) at `font-weight: 600` —
slightly stronger than the 400-weight value that follows, but not as heavy as a true bold — so labels
read distinctly without competing with the item name/NET TOTAL for attention. `Label` also takes an
optional `width` prop that right-pads the label text with spaces (`children.padEnd(width)`) — since
the font is monospace, this is a real fixed-width column, so a stack of labels of different lengths
(e.g. `NAME`/`PH`/`REF`, or `INVOICE NO`/`PAYMENT MODE`) still lands all its colons on the same
column. Only pass `width` within a group of labels that are actually stacked vertically in the same
column — `AGE`/`DATE`/`TIME` share a row with something else and don't need it. Full size/weight table.
Two rows are deliberately smaller than the rest — not for visual hierarchy, but because the pharmacy
name and the `PH`/`DL NO` line are the two lines most likely to overflow onto a second line at
real (long) clinic data lengths on a 74mm line; keep them at these sizes (or smaller) even if the
rest of the scale changes:

| Element | Size | Weight |
|---|---|---|
| Pharmacy name | 12.5pt | 700 |
| Address | 8.5pt | 400 |
| Phone / DL NO line | 7pt, `white-space: nowrap` | 400 |
| Body text (patient/invoice detail values, SUBTOTAL and the bare discount/refund lines) | 9.5pt | 400 |
| Field labels (via `Label`) | 9.5pt | 600 |
| `QTY × MRP` / `AMOUNT` header | 9.5pt | 700 |
| Item name | 10.5pt | 700 |
| Item detail lines (MFG/PACK/BATCH, HSN/GST/EXP) | 7.5pt | 400 |
| Item price line (`qty × mrp` / `amount`) | 9.5pt | 500 |
| NET TOTAL | 13pt | 700 |
| Footer legal text | 8pt | 400 |

### Layout sections (top to bottom)

1. **Pharmacy name** — centered, uppercase.
2. **Pharmacy details** — address line centered; `PH: {phone}` / `DL NO: {license}` on a flex
   `space-between` row (each pinned to its own edge, spanning the full width — not centered as one
   block, which is what caused it to wrap awkwardly next to the clinic name above).
3. Divider.
4. **Patient details** — `NAME : {NAME}` alone on its own line (hanging-indent wrap via
   `paddingLeft: "7ch", textIndent: "-7ch"` — a long name's continuation lines land under the value,
   not back at column 0), then `PH : {phone}` and `AGE : {age}` sharing one flex row, then
   `REF : {referenceDoctor}` alone (only if set). `sex` is fetched but not rendered here.
   `NAME`/`PH`/`REF` pass `width={4}` to `Label` (see Typography above) so they right-pad to the
   same column width and their colons all line up vertically.
5. Divider.
6. **Invoice details** — `INVOICE NO` and `PAYMENT MODE` each on their own line (a real invoice ID,
   `DDMMYY-XXX-XXX` ~15 chars, doesn't fit alongside a second field on one row), passing
   `width={12}` to `Label` (`PAYMENT MODE` is the longest) so their colons align with each other.
   When `paymentType === "SPLIT"`, one more row prints below: `CASH : ₹X   UPI : ₹Y`. `DATE`/`TIME`
   are short enough to safely share one flex row below.
7. **Price header**, once — `QTY × MRP` / `AMOUNT` — then a divider.
8. **Items**, one block per line item: `{n}. {ITEM NAME}` (hanging-indent wrap, never shrunk to fit);
   a flex row (`flexWrap: "wrap"`, `columnGap: 14px`, **not** `space-between`, **not** a fixed
   grid) with one `<span>` per *present* field among MFG (abbrev, ≤4 letters) / PACK / BATCH;
   likewise a second flex row for HSN / GST / EXP. A missing field (no manufacturer, no HSN, etc.)
   is filtered out entirely rather than rendered as an empty placeholder — an earlier fixed-grid
   version kept MFG/HSN, PACK/GST, BATCH/EXP column-aligned between the two rows, but that meant a
   missing field left a dead blank column; filtering was chosen over grid alignment once that
   trade-off was made explicit — present fields compact left with no reserved gap, at the cost of
   the two rows no longer always column-aligning with each other when their fields differ.
   `wordBreak: "keep-all"` + `overflowWrap: "normal"` are still set explicitly so a value is never
   split mid-token (e.g. `GD50506A` breaking into `GD5` / `0506A`) — it wraps at the `LABEL:`/value
   space instead, or overflows cleanly in the worst case. Then a `{qty} × {mrp}` / `{amount}` row;
   then a divider.
9. **Totals** — `SUBTOTAL` always shown. Discount and refund are each a bare right-aligned
   `-{amount}` line with **no label at all** (per clinic policy) and are omitted entirely — not
   shown as zero — when not applicable: discount only appears if `discountAmount > 0`, refund only
   if `visitRefundApplied` is set. Then a divider; `NET TOTAL` with `₹`; another divider (plain `-`,
   same weight as every other divider on the receipt — no heavier double-line style).
10. **Footer** — centered, three lines: "GOODS ONCE SOLD WILL NOT BE" / "TAKEN BACK OR
    EXCHANGED" / "SUBJECT TO HANAMKONDA JURISDICTION". No signature line.

### printElement function

```ts
function printElement(elementId: string) {
  const el = document.getElementById(elementId)
  if (!el) return
  const win = window.open('', '_blank', 'width=380,height=700')
  if (!win) return
  win.document.write(`<!DOCTYPE html><html><head><title>Invoice</title>
    <style>body{margin:0;padding:0}@page{size:80mm auto;margin:2.5mm 3mm}</style>
    </head><body>${el.innerHTML}</body></html>`)
  win.document.close()
  win.focus()
  win.print()
  win.close()
}
```

### Clinic name / address / phone / reference doctor

Sourced from `frontend/lib/settings_context.tsx`'s `useSettings()` (backed by `GET`/`PATCH
/api/settings`) — a single clinic-wide `ClinicSettings` row, fetched once and provided via context.
Both call sites (`app/billing/page.tsx`, `components/PatientDetailsView.tsx`) read
`clinicName`/`clinicAddress`/`clinicPhone`/`referenceDoctor` from this context rather than local state
or hardcoded strings.

**Planned fix:** Add a `ClinicSettings` table (one row), `GET /api/settings` + `PATCH /api/settings` endpoints, a `ClinicSettingsContext` in the frontend that fetches once on mount, and update both call sites to read from context.

## Recent Changes / Notes

- **Split Payment + Billing Page Layout (2026-08-18):** A bill can now be paid Cash + UPI split
  across a single transaction instead of always exactly one mode — see `Bill.cash_amount`/
  `upi_amount` under Key Business Logic above for the full data-model/API/Daily-Summary/invoice
  breakdown. The Billing page's "New Bill" tab was restructured to match: the top row's Payment
  Type (Cash/UPI) selector is gone and **Create Bill** moved out of the top row entirely — **Walk-in
  Bill** now sits top-right in its old spot. The bottom of the card is three columns: **Refund**
  (left, relocated from the Items-header area, same "Add Refund" control as before) | **Payment**
  (center, new — Cash ₹ / UPI ₹ rows, each with a "Full amount" quick-fill button covering the
  single-mode case, plus a live "Remaining: ₹X" / "✓ Matches total" hint) | **Discount + Total +
  Create Bill** (right, Create Bill moved here, disabled until Cash+UPI is within ±₹1 of the total).
  Design doc: `docs/superpowers/specs/2026-08-18-split-payment-design.md`.

- **Responsive / High-Zoom Overflow Fixes (2026-08-11):** Fixed a class of bugs where zooming the
  browser to ~150-200% (or opening the app on a narrow tablet/phone) pushed primary action buttons
  off-screen with no way to reach them — root cause is `AppShell.tsx`'s `overflow-x-hidden` on
  `<main>`, which clips instead of scrolling any row that doesn't fit. Fixed by adding `flex-wrap` to
  the toolbar/header rows that were missing it (most of the app already used this pattern correctly):
  `billing/page.tsx`'s Patient & Actions Row (previously could hide the **Create Bill** button — the
  originally reported bug — including its inner left group, which needed its own `flex-wrap` since
  outer wrapping alone only protects the boundary between the left and right groups, not the left
  group's own contents), `inventory/invoice_edit/page.tsx`'s header (protects **Save to Inventory**),
  `app/page.tsx`'s Dashboard header (protects the All Visits tab + date filter — this page previously
  had no responsive treatment at all, unlike every sibling page), and `patients/page.tsx`'s list
  header. `doctor/page.tsx`'s cramped 3-pane desktop layout (fixed `380px` sidebar + resizable
  `180-500px` timeline) now only engages at `lg` (1024px) instead of `md` (768px), so tablets get the
  page's existing simpler mobile/card layout instead of a crushed desktop one.
  `AddPatientDialog.tsx`'s duplicate-phone-suggestions bubble (previously positioned 102% to the left
  of its input, which had nowhere to go on a narrow dialog) now renders below the input by default and
  only reverts to the left-side placement at `sm:` (640px) and up. `admin/page.tsx`'s top-level `Tabs`
  was converted from uncontrolled to controlled state and gained a `Select` dropdown fallback below
  `lg`, reusing the `hidden lg:flex` / `block lg:hidden` pattern already used well in `status/page.tsx`'s
  Risk Matrix card. `AddVisitDialog.tsx`, `EditInventoryDialog.tsx`, `EditVisitDialog.tsx`, and
  `EditPatientDialog.tsx` gained `max-h-[90vh]`/`overflow-y-auto` (or just `overflow-y-auto` where a
  `max-w-[95vw] h-[95vh]` cap already existed) so tall dialog content scrolls instead of clipping on a
  short/zoomed viewport. `WalkInForm.tsx`'s Address/Age/Sex row switched from fixed `72px`/`96px` grid
  columns to `minmax()` tracks so they don't get crushed on narrow widths. Design/plan docs:
  `docs/superpowers/specs/2026-08-11-responsive-ui-audit-design.md` and
  `docs/superpowers/plans/2026-08-11-responsive-ui-audit.md`.

- **Appointment Clinic Selector (2026-08-11):** The dashboard's Appointment form (`WalkInForm.tsx`,
  under the Search box) gained a "Clinic" dropdown on the same row as the "Appointment" header,
  populated from `GET /api/admin/locations` (active locations only, only rendered once at least one
  exists). Defaults to the logged-in user's own `location_id` but is overridable per visit. Booking is
  blocked (Book button stays disabled) until a clinic is chosen, same as the existing fee requirement.
  Backend `POST /api/visits` now accepts an explicit `location_id` in the body and uses it when
  present, falling back to the creating user's own `location_id` when omitted (old auto-tag behavior
  preserved for any other caller). Rationale: every money/stock-related record (`Visit`, `Bill`,
  `PurchaseInvoice`, `ExpenseLedger`, `InventoryBatch`) must be linked to a clinic; `Patient` stays
  clinic-agnostic since the same patient can be seen at multiple clinics.

- **Free (Zero-Fee) Appointments (2026-08-11):** Walk-in visits can now be explicitly booked with a
  ₹0 fee. `WalkInForm.tsx`'s Fee field has a small "Free" checkbox next to it (same row, matching font
  size) — checking it disables/clears the fee input and forces `visiting_fee`/`amount_paid` to `0` on
  submit. Without it checked, a fee must be entered or the Book button stays disabled (an earlier
  iteration that changed the button's label/color to "Free Appointment" based on an empty fee field was
  tried and then reverted in favor of this explicit checkbox, since an empty field silently defaulting
  to free was too easy to trigger by accident). New `formatVisitFee(fee)` helper in
  `frontend/lib/utils.ts` renders `null`/`undefined` as `—`, exactly `0` as `FREE`, anything else as
  `₹{amount}` — rolled out to every fee display in the app: `WalkInForm.tsx` (Past Visits panel and
  Today's queue), `app/page.tsx`, `app/doctor/page.tsx` (queue row, visit timeline header, main visit
  card), `VisitsTab.tsx`, `PatientDetailsView.tsx`, `VisitDetailsDialog.tsx`.

- **Visit Age in Past Visits Panel (2026-08-11):** `WalkInForm.tsx`'s Past Visits panel (left side of
  the Appointment form) now shows each visit's age via the pre-existing `getVisitAge()` helper — it
  had been rolled out everywhere else but was missed in this one panel. Displayed as its own centered
  column (`grid grid-cols-[1fr_auto_1fr]`, not `flex justify-between`, which only wedges an element
  between unequal-width siblings instead of truly centering it) between the date/reason block and the
  fee/status block, non-bold.

- **Payment Mode Toggle Inversion (2026-08-11):** The Cash/UPI toggle in `WalkInForm.tsx`'s Appointment
  section now inverts colors on selection instead of only graying out the unselected option — the
  selected mode gets `bg-foreground text-background` (solid, high-contrast), the unselected one stays
  `text-muted-foreground`.

- **Inventory Rack Location Field (2026-08-08):** Added `rack_location` (nullable `VARCHAR(50)`) to
  `ProductMaster` — a free-text physical rack/shelf position (e.g. "C2", "H1"), distinct from the
  clinic-branch `Location` model. Editable in the Edit Item dialog (`EditInventoryDialog.tsx`) and
  per-row during invoice creation (`/inventory/invoice_edit`, always overwrites the saved value when
  a non-empty value is provided, mirroring the existing `formula` field's behavior). Shown read-only
  as a badge in the billing page's item search dropdown so frontdesk can locate stock while building
  a bill. Also a toggleable, filterable column ("Rack") in the main Inventory table's Columns picker
  (off by default, same as Category/HSN), and a "Rack Location" column on both CSV exports (Total
  Inventory and Edit Inventory) — recognized on re-import too, so it can be bulk-populated via
  spreadsheet instead of one row at a time. Still deliberately excluded from bill printing
  (`InvoicePrint.tsx`) and invoice history (`/inventory/history/[id]`). Design doc:
  `docs/superpowers/specs/2026-08-08-inventory-rack-location-design.md`.

- **New Daily Summary Page (2026-08-08):** Added `/daily-summary`, visible to all three roles
  (frontdesk, doctor, admin) — a read-only daily money ledger, distinct from the doctor-only
  `/status` analytics dashboard. Header has prev/next day arrows + a date input (defaults to
  today) and a location filter (same dropdown pattern as `/status`). A summary card at the top
  shows a Cash/UPI/Total cross-tab split by Visit Fee vs Billing Fee. Below it, one row per
  visit that day plus one row per walk-in bill (Patient name | Cell number | Visit fee |
  Billing fee | Reason), each fee amount tagged with a green (Cash) or blue (UPI) badge. Visit
  Fee is `visit.amount_paid` (money actually collected, not the billed `visiting_fee`); Billing
  Fee is the linked bill's `total_amount`. Backed by `GET /api/daily_summary?date=&location_id=`
  (`routes/daily_summary.py`), which does all the aggregation server-side. As part of this,
  `Bill.visit_id` — previously never populated by any frontend flow — now actually gets set:
  the Dashboard's "Go to Billing" visit-card action passes `visit_id` through to
  `/billing`, which was already wired to forward it to `createBill`. Bills created before this
  fix stay unlinked and show a blank Billing Fee on their visit's row. Design/plan docs:
  `docs/superpowers/specs/2026-08-08-daily-summary-page-design.md` and
  `docs/superpowers/plans/2026-08-08-daily-summary-page.md`.

- **`/visits` and `/inventory/history` Routes Removed, Dashboard Cleanup (2026-08-08):** Both list pages were fully superseded by earlier integrations (the "All Visits" tab in the Dashboard, and the "Invoices" tab in `/inventory`) and are now deleted: `app/visits/page.tsx`, `app/visits/[id]/page.tsx` (entire route), and `app/inventory/history/page.tsx` (list only — `app/inventory/history/[id]/page.tsx` is kept, still linked from Inventory's "Invoices" tab "View" button). Removed their `Sidebar.tsx` nav entries and `AppShell.tsx` inline-trigger route entries. Dashboard's "All Visits" tab (`VisitsTab.tsx`) had its redundant search box and "New Visit" button stripped (row click still opens `EditVisitDialog`). Dashboard header gained a right-aligned `DatePickerWithRange` date filter (single day or range) that scopes the "All Visits" tab only — the Overview tab's "Today's Visits" card always shows literally today, independent of the header filter. Backed by `GET /api/visits?date_from=&date_to=` (`get_all_visits` in `routes/visits.py`), which also raises its row cap from 50 → 1000 when a date filter is active.

- **OCR Feature Removed (2026-07-25):** The Google Cloud Vision invoice-scanning feature has been fully removed. `UploadInventoryReportDialog.tsx`, the OCR helper functions in `routes/inventory.py`, and the legacy dead `ocr_cloud/`/`models/invoice_ocr.py`/`Backend_db/ocr_service.py` scanners have all been deleted. Manual entry (`/inventory/invoice_edit?manual=true`) is now the only way to add a purchase invoice; users can still attach a photo of the physical invoice via "Attach Image" or "Upload via QR" — the image is just stored, not parsed. `GOOGLE_CLOUD_API_KEY` should be removed from the Render dashboard manually (not tracked in `render.yaml`).

- **Multi-Location Inventory System (2026-06-14):** Full per-clinic stock tracking across three sub-projects:
  - **SP1 — Location Foundation:** New `Location` model (`id`, `name`, `is_active`). Nullable `location_id` FK added to `User`, `Visit`, `Bill`, `PurchaseInvoice`, `ExpenseLedger`, `InventoryBatch` (additive — no data loss). CRUD API at `GET/POST/PATCH/DELETE /api/admin/locations` (GET is `@require_auth`; mutations are `@require_admin`). `_apply_migrations()` in `app.py` handles the 6 new FK columns on existing tables. Admin Settings tab has a **Locations card** (create, rename inline, activate/deactivate, delete). Admin Users dialog location field is now a **Select dropdown** (not free text) that saves `location_id` and syncs `location_label` for backward compat.
  - **SP2 — Per-Location Inventory:** `GET /api/inventory?location_id=N` filters stock to a single clinic. New `GET /api/inventory/export/edit?scope=all|<id>` exports one-row-per-product CSV with dynamic per-clinic qty columns. New `POST /api/inventory/import/parse-headers` classifies CSV headers as `known_fields`, `known_clinics`, or `unknown`. Import route accepts `field_mapping` and `clinic_mapping` JSON to handle renamed columns or renamed clinics. `ImportInventoryDialog` is now a 3-step flow: file pick → column mapping (if unknown headers) → mode select. Inventory page has a **location pill switcher** and the Download button opens a **two-option export dialog** (Total Inventory vs Edit Inventory with scope select).
  - **SP3 — Location Analytics:** `GET /api/inventory_analytics?location_id=N` filters all KPIs via `location_id` FK. `GET /api/ledger?location_id=N` likewise. New visits, bills, purchase invoices, and inventory batches are auto-tagged with the creating user's `location_id`. Status page has dynamic location dropdown and no staff filter.

- **Inventory System Overhaul (2026-05-23):** Comprehensive fixes across backend and frontend:
  - **OCR vendor name** — `_transform_ocr_result` now passes the extracted `vendor_name` through instead of hardcoding `''`.
  - **Expiry logic** — off-by-one fixed (`>` not `>=` month comparison); "Expires Soon" threshold changed from 3 → 6 months; configurable via `?expiry_months=N` query param on `GET /api/inventory` and `GET /api/inventory/analytics`. Frontend setting `expiryReminderMonths` (stored in localStorage, key `expiry_reminder_months`, default 6) is forwarded automatically.
  - **N+1 query fix** — `get_inventory` replaced with 4 aggregate queries (was 7× per product); `export_inventory` uses a single pre-loop GROUP BY instead of 3 scalar queries per item.
  - **Duplicate invoice detection** — `save_invoice` compares re-submitted invoices against existing batches: identical rows get an ADJUSTMENT history entry and a warning; qty-diff rows get an adjustment batch; new product rows are added normally. Always returns `warnings[]`. `invoice_date` is set to upload date on new invoices (never from form input).
  - **Negative batch prevention** — duplicate path and CSV overwrite mode both use FIFO stock reduction instead of creating negative-quantity batches.
  - **CSV export/import** — 8-column format: ID, Item Name, Pack Size, Category, Min Stock, Quantity, MRP, Expiry Date. No Dosage column; MRP = highest batch MRP; Expiry = earliest active-batch expiry. Import recognises both new and old header names.
  - **Currency** — `$` → `₹` throughout the inventory table.
  - **AllChanges tab** — visible to all roles (was doctor-only).
  - **`alert()` → `toast()`** — all `alert()` calls in `invoice_edit/page.tsx` replaced with `toast.success/warning/error`; duplicate warnings surfaced to the user.
  - **Admin Settings tab** — new Settings tab in `/admin` with an expiry reminder months control (1–24).

- **Date Filtering:** Replaced two-input date filters with `DatePickerWithRange` (`components/ui/date-range-picker.tsx`) using `react-day-picker`. This single calendar can be used to select both a single date or a range of dates. Used in Inventory "All Changes" and Invoice History tabs.
- **Invoice History:** Added client-side search (invoice number/vendor) and date range filtering to the `/inventory/history` tab. Additionally, implemented table-column dropdown filters for `Vendor` and `Source`, and a range filter for `Total Amount`. Updated the "Back to Inventory" button with an arrow icon.
- **Admin Accounts & TOTP Security Overhaul:** Integrated 10-minute JWT grant tokens (`grant_token`) after Step 1 TOTP verification to eliminate 30-second expiry failures. Created hardcoded admin accounts (`saivelapati`, `tejavelapati`) which dynamically authenticate using active 6-digit TOTP codes and auto-provision in the database on-the-fly. Completely removed `email` fields from login/signup forms, generating a mock internal email address under the hood to bypass database uniqueness constraints. Integrated `window.location.href` redirect on successful login for instant state refresh.
- **Bill Deletion Security:** Enforced `admin`-only role restrictions for deleting bills. The backend `DELETE /api/billing/<invoice_id>` endpoint and the frontend "Delete" action in `app/billing/page.tsx` are now restricted exclusively to administrators.
- **Staff Assignment Relocation & Users Overhaul:** Removed `<StaffAssignmentDialog />` from the Doctor Dashboard completely. Replaced it with a comprehensive, centralized administrative interface in `/admin` (Users tab). Overhauled the Users table to show static fields (Name, Role, Location, Status, and Edit) and added a modern Dialog modal to change Username, Role, Location, Status, and assign/unassign active staff members dynamically for Doctors (processed securely on the backend via the `PATCH /api/admin/users/<user_id>` route).
- **Unified Date Range Filters:** Standardized calendar filters across all history interfaces (Inventory, Billing History, and Admin Logs) utilizing the premium `DatePickerWithRange` component.
- **Admin Dashboard Overhaul & Real-time Metrics:** Modernized the Admin Dashboard into a dedicated split-pane analytical command center featuring glassmorphic KPI cards tracking daily active users, invoices, visits, and unified role-distribution visual capsules.
- **On-Demand Infrastructure Telemetry:** Engineered an asynchronous system probe via `/api/admin/diagnostics` allowing admins to execute disk checks, confirm OCR activation state, recursively scan user media volume consumption, and view live PostgreSQL footprint reports safely on-demand without login lag.
- **CSV Loader Persistence Fix:** Hotpatched iterative batch flushing logic to instantiate and Stage the parent Invoice entity prior to child record addition, preventing database constraint aborts on active inventory syncs.
- **Admin Master Deletion System:** Introduced secure `@require_admin` backends handling hard-cascading physical purges of Inventory products, written to intelligently safeguard historic `BillItem` integrity rather than corrupting accounts.
- **Patient Batch Pipelines:** Duplicated ultra-streamlined import/export engines to Patients module, complete with robust auto-deduplicating ingestion logics (collating on matching Name+Phone strings) and explicit browser triggers. Field-length validation added (name ≤100, phone ≤20, sex ≤10, reference ≤100) to prevent DB constraint crashes on bad CSV data.
