# Daily Summary Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `/daily-summary` page, visible to all roles, showing one day's visits + walk-in
bills as a flat table with a cash/UPI income cross-tab summary at the top.

**Architecture:** One new Flask blueprint (`routes/daily_summary.py`) exposing
`GET /api/daily_summary?date=&location_id=`, which does all the aggregation server-side and
returns rows + a precomputed summary. One new Next.js page
(`app/daily-summary/page.tsx`) that fetches and renders it. A one-line fix to
`app/page.tsx` so `Bill.visit_id` actually gets populated going forward. Nav entries added to
all three role lists in `Sidebar.tsx`.

**Tech Stack:** Flask + SQLAlchemy 2.0 (backend), Next.js 16 App Router + React + Tailwind +
shadcn/ui + date-fns (frontend). No test suite exists in this repo (confirmed in `CLAUDE.md`) —
verification is via `ast.parse`/`tsc --noEmit` for correctness and a throwaway
backend (`PORT=5050`) + frontend (`-p 3001`) + Playwright with JWT test cookies for behavior,
per this project's established convention. Never touch the real dev servers (5000/3000).

## Global Constraints

- No `Co-Authored-By` line in any commit message.
- All frontend API calls go through `frontend/lib/api.ts` using relative `/api/...` paths.
- Timestamps use IST; dates from the frontend are always `YYYY-MM-DD` strings
  (`getTodayIST()` from `lib/utils.ts`).
- Follow `docs/page_layout_rules.md`'s card/scroll conventions (`flex-1 overflow-hidden`,
  `min-h-0`, sticky `TableHeader`) — same pattern just applied to `VisitsTab`.
- Visit Fee = `visit.amount_paid` (money actually collected), not `visiting_fee`.
- Billing Fee = the bill's `total_amount` (bills are always paid in full at creation, no partial
  concept).
- Payment mode values: visits use lowercase `'cash'`/`'upi'`; bills use uppercase
  `'CASH'`/`'UPI'`/`'CARD'` (CARD confirmed unused in practice, but the endpoint must not crash
  or silently drop money if it ever appears — fold into a neutral `'other'` bucket that still
  counts toward the row/grand total, just not toward the cash/UPI columns).
- Full design reference: `docs/superpowers/specs/2026-08-08-daily-summary-page-design.md`.

---

### Task 1: Fix Bill→Visit linkage on the Dashboard's "Go to Billing" action

**Files:**
- Modify: `frontend/app/page.tsx` (the `handleGoToBilling` function, ~line 147)

**Interfaces:**
- Consumes: nothing new — `Visit.visit_id` already exists on the `Visit` type in `lib/api.ts`.
- Produces: nothing new for later tasks — this just makes future bills created via this flow
  carry `visit_id`, so Task 2's backend query has real data to find in dev testing.

- [ ] **Step 1: Make the change**

In `frontend/app/page.tsx`, find:
```ts
    const handleGoToBilling = (visit: Visit) => {
        router.push(`/billing?patient_id=${visit.patient_id}`)
    }
```
Change to:
```ts
    const handleGoToBilling = (visit: Visit) => {
        router.push(`/billing?patient_id=${visit.patient_id}&visit_id=${visit.visit_id}`)
    }
```

- [ ] **Step 2: Verify no other call site needs the same fix**

Run: `grep -rn "router.push(\`/billing\|href=\"/billing\|href={\`/billing" frontend --include="*.tsx" | grep -v node_modules`
Expected: only the line just changed passes patient/visit context; every other match is a bare
`<Link href="/billing">` nav shortcut with no query string. If a new context-aware call site
shows up that isn't accounted for here, add the same `&visit_id=` fix to it too before
continuing.

- [ ] **Step 3: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/fia/Downloads/clinic_related
git add frontend/app/page.tsx
git commit -m "fix: Dashboard's Go to Billing now links the created bill to its visit"
```

---

### Task 2: Backend — `GET /api/daily_summary` endpoint

**Files:**
- Create: `Backend_db/routes/daily_summary.py`
- Modify: `Backend_db/routes/__init__.py`

**Interfaces:**
- Consumes: `Visit`, `Patient`, `Bill` models from `models.py` (all already exist, no schema
  changes needed — `Bill.visit_id`, `Bill.walk_in_name`, `Bill.location_id`,
  `Visit.location_id`, `Visit.amount_paid`, `Visit.payment_mode`, `Bill.payment_type` all exist
  today). `require_auth` decorator from `.auth`.
- Produces: `GET /api/daily_summary?date=YYYY-MM-DD&location_id=N` (location_id optional) →
  JSON body:
  ```json
  {
    "date": "2026-08-08",
    "rows": [
      {
        "type": "visit", "visit_id": "...", "patient_id": "...", "patient_name": "...",
        "phone_number": "...", "reason": "...", "time": "09:20",
        "visit_fee": 400, "visit_fee_mode": "cash",
        "billing_fee": 250, "billing_fee_mode": "upi"
      },
      {
        "type": "walkin", "invoice_id": "...", "patient_id": null, "patient_name": "...",
        "phone_number": null, "reason": null, "time": "11:05",
        "visit_fee": null, "visit_fee_mode": null,
        "billing_fee": 800, "billing_fee_mode": "cash"
      }
    ],
    "summary": {
      "visit_fee":   {"cash": 0, "upi": 0, "total": 0},
      "billing_fee": {"cash": 0, "upi": 0, "total": 0},
      "total":       {"cash": 0, "upi": 0, "total": 0}
    }
  }
  ```
  `rows` sorted by `time` ascending. Task 3 (frontend) consumes this shape exactly — field names
  above are final, don't rename them.

- [ ] **Step 1: Write the blueprint**

Create `Backend_db/routes/daily_summary.py`:
```python
from flask import Blueprint, request, jsonify
from datetime import datetime
from sqlalchemy import func
from models import Visit, Patient, Bill
from .auth import require_auth

daily_summary = Blueprint('daily_summary', __name__)


def _norm_mode(raw):
    """Lowercase a payment mode/type down to 'cash'/'upi'/'other'. Bills use
    'CASH'/'UPI'/'CARD', visits use 'cash'/'upi' — this normalizes both."""
    if not raw:
        return None
    m = raw.strip().lower()
    return m if m in ('cash', 'upi') else 'other'


def _empty_bucket():
    return {'cash': 0, 'upi': 0, 'total': 0}


@daily_summary.route('/daily_summary', methods=['GET'])
@require_auth
def get_daily_summary():
    date_str = request.args.get('date')
    if not date_str:
        return jsonify({'error': 'date is required, expected YYYY-MM-DD'}), 400
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid date format, expected YYYY-MM-DD'}), 400

    location_id_param = request.args.get('location_id')
    filter_location_id = None
    if location_id_param and location_id_param.isdigit():
        filter_location_id = int(location_id_param)

    summary = {
        'visit_fee': _empty_bucket(),
        'billing_fee': _empty_bucket(),
        'total': _empty_bucket(),
    }

    def add(bucket, mode, amount):
        if not amount:
            return
        summary[bucket]['total'] += amount
        summary['total']['total'] += amount
        if mode in ('cash', 'upi'):
            summary[bucket][mode] += amount
            summary['total'][mode] += amount

    # ── Visits for the day ──────────────────────────────────────────────
    visit_q = Visit.query.filter(Visit.visit_date == date_obj, Visit.status != 'deleted')
    if filter_location_id is not None:
        visit_q = visit_q.filter(Visit.location_id == filter_location_id)
    visits_list = visit_q.all()

    visit_ids = [v.visit_id for v in visits_list]
    patient_ids = [v.patient_id for v in visits_list]

    bills_by_visit = {}
    if visit_ids:
        linked_bills = Bill.query.filter(Bill.visit_id.in_(visit_ids)).all()
        bills_by_visit = {b.visit_id: b for b in linked_bills}

    patients_map = {}
    if patient_ids:
        patients_list = Patient.query.filter(Patient.patient_id.in_(patient_ids)).all()
        patients_map = {p.patient_id: p for p in patients_list}

    rows = []
    for v in visits_list:
        patient = patients_map.get(v.patient_id)
        bill = bills_by_visit.get(v.visit_id)

        visit_fee = float(v.amount_paid) if v.amount_paid else 0
        visit_fee_mode = _norm_mode(v.payment_mode) if visit_fee else None
        billing_fee = float(bill.total_amount) if bill else None
        billing_fee_mode = _norm_mode(bill.payment_type) if bill else None

        rows.append({
            'type': 'visit',
            'visit_id': v.visit_id,
            'patient_id': v.patient_id,
            'patient_name': patient.name if patient else 'Unknown',
            'phone_number': patient.phone_number if patient else None,
            'reason': v.reason,
            'time': v.visit_time.strftime('%H:%M') if v.visit_time else '00:00',
            'visit_fee': visit_fee if visit_fee else None,
            'visit_fee_mode': visit_fee_mode,
            'billing_fee': billing_fee,
            'billing_fee_mode': billing_fee_mode,
        })

        add('visit_fee', visit_fee_mode, visit_fee)
        if bill:
            add('billing_fee', billing_fee_mode, billing_fee)

    # ── Walk-in bills for the day (no patient_id → not already covered above) ──
    walkin_q = Bill.query.filter(
        func.date(Bill.created_at) == date_str,
        Bill.patient_id.is_(None),
    )
    if filter_location_id is not None:
        walkin_q = walkin_q.filter(Bill.location_id == filter_location_id)
    walkin_bills = walkin_q.all()

    for b in walkin_bills:
        mode = _norm_mode(b.payment_type)
        amount = float(b.total_amount)
        rows.append({
            'type': 'walkin',
            'invoice_id': b.invoice_id,
            'patient_id': None,
            'patient_name': b.walk_in_name or 'Walk-in',
            'phone_number': None,
            'reason': None,
            'time': b.created_at.strftime('%H:%M') if b.created_at else '00:00',
            'visit_fee': None,
            'visit_fee_mode': None,
            'billing_fee': amount,
            'billing_fee_mode': mode,
        })
        add('billing_fee', mode, amount)

    rows.sort(key=lambda r: r['time'])

    return jsonify({'date': date_str, 'rows': rows, 'summary': summary}), 200
```

- [ ] **Step 2: Register the blueprint**

In `Backend_db/routes/__init__.py`, change:
```python
from .locations import locations_bp

blueprints = [auth_bp, admin_bp, patients, inventory, visits, billing, images, upload_bp, ledger, locations_bp]
```
to:
```python
from .locations import locations_bp
from .daily_summary import daily_summary

blueprints = [auth_bp, admin_bp, patients, inventory, visits, billing, images, upload_bp, ledger, locations_bp, daily_summary]
```

- [ ] **Step 3: Syntax-check**

Run: `cd Backend_db && python3 -c "import ast; ast.parse(open('routes/daily_summary.py').read())" && python3 -c "import ast; ast.parse(open('routes/__init__.py').read())"`
Expected: no output (success).

- [ ] **Step 4: Start a throwaway backend and hit it live**

```bash
cd Backend_db && source venv/bin/activate
PORT=5050 nohup python app.py > /tmp/daily_summary_backend.log 2>&1 &
sleep 3
```
Mint a test cookie and call the endpoint for a date/location you know has data (adjust the date
to one you've verified has visits/bills in your dev DB, e.g. reuse a date from earlier session
testing):
```bash
python3 -c "
import jwt, datetime
secret = 'dev-jwt-secret-change-in-production'
payload = {'user_id': '3f2ff3cf-6d5e-46a2-9efa-ecaf9e11ced3', 'username': 'test_staff', 'role': 'frontdesk', 'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=2)}
print(jwt.encode(payload, secret, algorithm='HS256'))
"
```
```bash
TOKEN="<paste token>"
curl -s "http://127.0.0.1:5050/api/daily_summary?date=2026-02-20" --cookie "auth_token=$TOKEN" | python3 -m json.tool
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:5050/api/daily_summary" --cookie "auth_token=$TOKEN"
curl -s "http://127.0.0.1:5050/api/daily_summary?date=bad" --cookie "auth_token=$TOKEN"
```
Expected: first call returns rows + summary JSON with sane numbers (cross-check `summary.total.total == summary.visit_fee.total + summary.billing_fee.total`, and `summary.total.cash + summary.total.upi <= summary.total.total`). Second call (no `date`) returns 400. Third call (bad date) returns 400 JSON, not a 500 stack trace.

- [ ] **Step 5: Stop the throwaway backend**

```bash
ss -ltnp 2>/dev/null | grep :5050 | grep -oP 'pid=\K[0-9]+' | sort -u | xargs -r kill -9
```

- [ ] **Step 6: Commit**

```bash
cd /home/fia/Downloads/clinic_related
git add Backend_db/routes/daily_summary.py Backend_db/routes/__init__.py
git commit -m "feat: add GET /api/daily_summary endpoint"
```

---

### Task 3: Frontend — API client additions

**Files:**
- Modify: `frontend/lib/api.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DailySummaryRow`, `DailySummaryBucket`, `DailySummaryResponse` types, and
  `api.getDailySummary(date: string, locationId?: number | 'all'): Promise<DailySummaryResponse>`.
  Task 4 imports and calls this exactly.

- [ ] **Step 1: Add the types**

Add near the other billing-related interfaces in `frontend/lib/api.ts` (e.g. right after
`BillingHistoryFilters`):
```ts
export interface DailySummaryRow {
    type: 'visit' | 'walkin';
    visit_id?: string;
    invoice_id?: string;
    patient_id: string | null;
    patient_name: string;
    phone_number: string | null;
    reason: string | null;
    time: string;
    visit_fee: number | null;
    visit_fee_mode: 'cash' | 'upi' | 'other' | null;
    billing_fee: number | null;
    billing_fee_mode: 'cash' | 'upi' | 'other' | null;
}

export interface DailySummaryBucket {
    cash: number;
    upi: number;
    total: number;
}

export interface DailySummaryResponse {
    date: string;
    rows: DailySummaryRow[];
    summary: {
        visit_fee: DailySummaryBucket;
        billing_fee: DailySummaryBucket;
        total: DailySummaryBucket;
    };
}
```

- [ ] **Step 2: Add the API method**

Add near `getLedger`/`getInventoryAnalytics` in the `api` object:
```ts
    async getDailySummary(date: string, locationId?: number | 'all'): Promise<DailySummaryResponse> {
        const params = new URLSearchParams({ date })
        if (locationId && locationId !== 'all') params.set('location_id', locationId.toString())
        return fetchApi(`/api/daily_summary?${params.toString()}`)
    },
```

- [ ] **Step 3: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/fia/Downloads/clinic_related
git add frontend/lib/api.ts
git commit -m "feat: add getDailySummary API client method and types"
```

---

### Task 4: Frontend — the Daily Summary page

**Files:**
- Create: `frontend/app/daily-summary/page.tsx`

**Interfaces:**
- Consumes: `api.getDailySummary` and its types from Task 3; `api.getLocations()` (existing,
  returns `Location[]` with `{ id: number; name: string; is_active: boolean }`); `getTodayIST()`
  from `@/lib/utils`; `useMenu()` from `@/components/layout/AppShell`.
- Produces: default export page component mounted at `/daily-summary` by Next.js file-based
  routing — Task 5 just needs to link to that path, no exported symbols to reuse.

- [ ] **Step 1: Write the page**

Create `frontend/app/daily-summary/page.tsx`:
```tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChevronLeft, ChevronRight, Loader2, Menu, Calendar as CalendarIcon, MapPin, Receipt } from "lucide-react"
import { useMenu } from "@/components/layout/AppShell"
import { api, type DailySummaryResponse, type Location } from "@/lib/api"
import { getTodayIST } from "@/lib/utils"
import { format, addDays, subDays, parseISO } from "date-fns"

function FeeCell({ amount, mode }: { amount: number | null; mode: string | null }) {
    if (amount === null || amount === undefined) {
        return <span className="text-muted-foreground">-</span>
    }
    return (
        <div className="flex items-center gap-2">
            <span className="tabular-nums font-medium">₹{amount}</span>
            {mode === 'cash' && (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-[10px] h-5 hover:bg-green-100">Cash</Badge>
            )}
            {mode === 'upi' && (
                <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 text-[10px] h-5 hover:bg-blue-100">UPI</Badge>
            )}
        </div>
    )
}

export default function DailySummaryPage() {
    const { openMenu } = useMenu()
    const [dateStr, setDateStr] = useState(getTodayIST())
    const [locationId, setLocationId] = useState<number | 'all'>('all')
    const [locations, setLocations] = useState<Location[]>([])
    const [data, setData] = useState<DailySummaryResponse | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        api.getLocations()
            .then(locs => setLocations(locs.filter(l => l.is_active)))
            .catch(() => {})
    }, [])

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const res = await api.getDailySummary(dateStr, locationId)
            setData(res)
        } catch (err) {
            console.error("Failed to fetch daily summary", err)
            setData(null)
        } finally {
            setLoading(false)
        }
    }, [dateStr, locationId])

    useEffect(() => { fetchData() }, [fetchData])

    const shiftDay = (delta: number) => {
        const d = delta > 0 ? addDays(parseISO(dateStr), delta) : subDays(parseISO(dateStr), -delta)
        setDateStr(format(d, 'yyyy-MM-dd'))
    }

    const summary = data?.summary
    const rows = data?.rows ?? []

    return (
        <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
            <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
                <button
                    type="button"
                    onClick={openMenu}
                    className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors"
                >
                    <Menu className="h-6 w-6" />
                    <span className="sr-only">Toggle Menu</span>
                </button>
                <h1 className="text-3xl font-bold tracking-tight text-foreground shrink-0">Daily Summary</h1>

                <div className="flex items-center gap-1 ml-2">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftDay(-1)}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="relative flex items-center">
                        <CalendarIcon className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                            type="date"
                            value={dateStr}
                            onChange={e => e.target.value && setDateStr(e.target.value)}
                            className="h-8 pl-8 pr-2 text-sm rounded-md border border-input bg-background"
                        />
                    </div>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftDay(1)}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>

                <div className="ml-auto">
                    <Select
                        value={locationId === 'all' ? 'all' : locationId.toString()}
                        onValueChange={val => setLocationId(val === 'all' ? 'all' : parseInt(val))}
                    >
                        <SelectTrigger className="h-8 w-44">
                            <MapPin className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Locations</SelectItem>
                            {locations.map(l => (
                                <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Summary cross-tab */}
            <Card className="shrink-0">
                <CardContent className="p-4">
                    {loading || !summary ? (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead></TableHead>
                                    <TableHead className="text-right">Cash</TableHead>
                                    <TableHead className="text-right">UPI</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                <TableRow>
                                    <TableCell className="font-medium">Visit Fee</TableCell>
                                    <TableCell className="text-right tabular-nums">₹{summary.visit_fee.cash}</TableCell>
                                    <TableCell className="text-right tabular-nums">₹{summary.visit_fee.upi}</TableCell>
                                    <TableCell className="text-right tabular-nums font-semibold">₹{summary.visit_fee.total}</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell className="font-medium">Billing Fee</TableCell>
                                    <TableCell className="text-right tabular-nums">₹{summary.billing_fee.cash}</TableCell>
                                    <TableCell className="text-right tabular-nums">₹{summary.billing_fee.upi}</TableCell>
                                    <TableCell className="text-right tabular-nums font-semibold">₹{summary.billing_fee.total}</TableCell>
                                </TableRow>
                                <TableRow className="border-t-2">
                                    <TableCell className="font-bold">Total</TableCell>
                                    <TableCell className="text-right tabular-nums font-bold">₹{summary.total.cash}</TableCell>
                                    <TableCell className="text-right tabular-nums font-bold">₹{summary.total.upi}</TableCell>
                                    <TableCell className="text-right tabular-nums font-bold">₹{summary.total.total}</TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Row table */}
            <Card className="flex-1 flex flex-col overflow-hidden">
                <CardContent className="flex-1 overflow-y-auto min-h-0 p-0">
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No visits or bills for this day</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="sticky top-0 z-10 bg-card">
                                <TableRow>
                                    <TableHead>Patient name</TableHead>
                                    <TableHead>Cell number</TableHead>
                                    <TableHead>Visit fee</TableHead>
                                    <TableHead>Billing fee</TableHead>
                                    <TableHead>Reason</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((row, i) => (
                                    <TableRow key={`${row.type}-${row.visit_id ?? row.invoice_id ?? i}`}>
                                        <TableCell className="font-medium">{row.patient_name}</TableCell>
                                        <TableCell className="text-muted-foreground">{row.phone_number || '-'}</TableCell>
                                        <TableCell><FeeCell amount={row.visit_fee} mode={row.visit_fee_mode} /></TableCell>
                                        <TableCell><FeeCell amount={row.billing_fee} mode={row.billing_fee_mode} /></TableCell>
                                        <TableCell className="max-w-[240px] truncate text-muted-foreground">{row.reason || '-'}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
```

- [ ] **Step 2: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no errors. (If `Location` isn't already exported from `lib/api.ts`, check its exact
exported name via `grep -n "export interface Location" frontend/lib/api.ts` and adjust the
import — don't guess.)

- [ ] **Step 3: Commit**

```bash
cd /home/fia/Downloads/clinic_related
git add frontend/app/daily-summary/page.tsx
git commit -m "feat: add Daily Summary page"
```

---

### Task 5: Nav wiring — Sidebar and AppShell

**Files:**
- Modify: `frontend/components/layout/Sidebar.tsx`
- Modify: `frontend/components/layout/AppShell.tsx`

**Interfaces:**
- Consumes: the `/daily-summary` route created in Task 4.
- Produces: nothing consumed by later tasks — this is the last code task.

- [ ] **Step 1: Add nav entries**

In `frontend/components/layout/Sidebar.tsx`, add a `Receipt` icon import (already used
pattern-wise elsewhere — check the existing `lucide-react` import line and add `Receipt` to it),
then add one entry to each of the three nav arrays. For `staffNavItems`:
```ts
const staffNavItems = [
    { title: "Dashboard", href: "/", icon: LayoutDashboard },
    { title: "Patients", href: "/patients", icon: Users },
    { title: "Inventory", href: "/inventory", icon: Package },
    { title: "Billing", href: "/billing", icon: CreditCard },
    { title: "Daily Summary", href: "/daily-summary", icon: Receipt },
]
```
For `doctorNavItems`, insert the same `{ title: "Daily Summary", href: "/daily-summary", icon: Receipt },`
line (after "Billing", before "Gallery" — match staff's ordering relative to Billing).
For `adminNavItems`, insert it the same way (after "Billing", before "Gallery").

- [ ] **Step 2: Register the inline-trigger route**

In `frontend/components/layout/AppShell.tsx`, find:
```ts
    const INLINE_TRIGGER_ROUTES = [
        '/', '/patients', '/inventory', '/billing', '/doctor',
        '/inventory/invoice_edit', '/gallery', '/status', '/admin',
    ]
```
Add `'/daily-summary'` to the array.

- [ ] **Step 3: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/fia/Downloads/clinic_related
git add frontend/components/layout/Sidebar.tsx frontend/components/layout/AppShell.tsx
git commit -m "feat: add Daily Summary to sidebar nav for all roles"
```

---

### Task 6: End-to-end live verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Start throwaway backend + frontend**

```bash
cd Backend_db && source venv/bin/activate
PORT=5050 nohup python app.py > /tmp/daily_summary_backend.log 2>&1 &
sleep 3
cd ../frontend
rm -f .next/dev/lock
BACKEND_URL=http://127.0.0.1:5050 nohup npm run dev -- -p 3001 > /tmp/daily_summary_frontend.log 2>&1 &
sleep 6
```

- [ ] **Step 2: Playwright pass**

Using a JWT test cookie (frontdesk role, same minting approach as Task 2 Step 4), via Playwright:
1. Navigate to `http://localhost:3001/daily-summary`.
2. Confirm the page loads with today's date pre-filled, summary cross-tab visible, and either
   real rows or the "No visits or bills for this day" empty state (today's dev DB is likely
   empty — that's expected, not a bug).
3. Use the date input to jump to a date known to have both visits and bills (reuse a date from
   earlier session testing, e.g. `2026-02-16` or `2026-02-20`) and confirm rows populate with
   correct patient names/fees/badges, and the summary cross-tab numbers reconcile
   (`visit_fee.total + billing_fee.total === total.total` for all three columns).
4. Confirm the Cash badge renders green and UPI renders blue on at least one row each (if the
   test date has both).
5. Toggle the location dropdown and confirm the row count/summary changes (or stays the same if
   all data is in one location — check via a location filter that's known to exclude some rows).
6. Click prev/next day arrows and confirm the URL state/date input updates and data refetches.
7. Repeat step 1-2 logged in as `role: 'doctor'` and `role: 'admin'` test cookies (mint via the
   same script, swapping `user_id`/`username`/`role` — reuse `tejavelapati`'s admin UUID from
   earlier in this session) to confirm the page renders identically regardless of role (no
   role-gate redirect).
8. Confirm the sidebar shows "Daily Summary" for all three roles by checking the nav list
   rendered in each session's snapshot.

- [ ] **Step 3: Clean up**

```bash
rm -rf .playwright-mcp
ss -ltnp 2>/dev/null | grep -E ':5050|:3001' | grep -oP 'pid=\K[0-9]+' | sort -u | xargs -r kill -9
```

- [ ] **Step 4: Update CLAUDE.md**

Add a bullet to the "Recent Changes / Notes" section (top of the list) documenting the new page,
following the existing bullet style/format in that file. Also add a row to the "Page Map" table:
`| \`/daily-summary\` | \`app/daily-summary/page.tsx\` | all |`.

- [ ] **Step 5: Commit**

```bash
cd /home/fia/Downloads/clinic_related
git add CLAUDE.md
git commit -m "docs: document the new Daily Summary page"
```
