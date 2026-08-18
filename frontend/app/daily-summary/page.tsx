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
import { ChevronLeft, ChevronRight, Loader2, Menu, Calendar as CalendarIcon, MapPin, Receipt, PieChart as PieChartIcon } from "lucide-react"
import { useMenu } from "@/components/layout/AppShell"
import { api, type DailySummaryResponse, type Location } from "@/lib/api"
import { getTodayIST } from "@/lib/utils"
import { format, addDays, subDays, parseISO } from "date-fns"
import { ResponsiveContainer, PieChart as RePie, Pie, Cell, Tooltip as ReTooltip } from "recharts"
import { useAuth } from "@/lib/auth_context"

// Rendered locally (never fetched) when a frontdesk user has no clinic assigned —
// keeps every summary section showing its normal "no data" appearance instead of
// spinning forever or accidentally showing another clinic's numbers.
const EMPTY_SUMMARY_BUCKET = { cash: 0, upi: 0, total: 0 }

// Refund settlement adds 3 more codes beyond plain cash/upi: billing_cash/
// billing_upi (a payout sourced from the billing till) and apply_to_bill
// (not a payout — folded into a bill's total instead).
function ModeBadge({ mode }: { mode: string | null }) {
    switch (mode) {
        case 'cash':
        case 'visit_cash':
            return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-[10px] h-5 hover:bg-green-100">{mode === 'visit_cash' ? 'Visit Cash' : 'Cash'}</Badge>
        case 'upi':
        case 'visit_upi':
            return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 text-[10px] h-5 hover:bg-blue-100">{mode === 'visit_upi' ? 'Visit UPI' : 'UPI'}</Badge>
        case 'billing_cash':
            return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] h-5 hover:bg-amber-100">Billing Cash</Badge>
        case 'billing_upi':
            return <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 text-[10px] h-5 hover:bg-purple-100">Billing UPI</Badge>
        case 'apply_to_bill':
            return <Badge variant="secondary" className="text-[10px] h-5">Applied to Bill</Badge>
        default:
            return null
    }
}

function FeeCell({ amount, mode, refund, refundMode }: { amount: number | null; mode: string | null; refund?: number | null; refundMode?: string | null }) {
    if (amount === null || amount === undefined) {
        return <span className="text-muted-foreground">-</span>
    }
    return (
        <div className="flex items-center gap-2">
            <span className="tabular-nums font-medium">
                ₹{amount}
                {!!refund && <span className="text-red-600 dark:text-red-400">/₹{refund}</span>}
            </span>
            <ModeBadge mode={mode} />
            {!!refund && <ModeBadge mode={refundMode ?? null} />}
        </div>
    )
}

// A visit can have several bills — shown slash-separated (e.g. 200/300/400)
// rather than only ever the single bill the old single-bill-per-visit model
// assumed. Each amount keeps its own cash/upi badge since separate bills can
// easily have been paid different ways.
function BillingFeesCell({ fees }: { fees: { amount: number; mode: string | null }[] }) {
    if (!fees || fees.length === 0) {
        return <span className="text-muted-foreground">-</span>
    }
    return (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {fees.map((f, i) => (
                <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground">/</span>}
                    <span className="tabular-nums font-medium">₹{f.amount}</span>
                    <ModeBadge mode={f.mode} />
                </span>
            ))}
        </div>
    )
}

export default function DailySummaryPage() {
    const { openMenu } = useMenu()
    const { role, user } = useAuth()
    const [dateStr, setDateStr] = useState(getTodayIST())
    const [locationId, setLocationId] = useState<number | 'all'>('all')
    const [locations, setLocations] = useState<Location[]>([])
    const [data, setData] = useState<DailySummaryResponse | null>(null)
    const [loading, setLoading] = useState(true)

    // Clinic-view lock: frontdesk always sees only their own clinic, with no switcher.
    // Doctor and admin keep the full dropdown (including "All Locations") unchanged.
    const isFrontdesk = role === 'frontdesk'
    const frontdeskLocationId = user?.location_id ?? null
    const noClinicAssigned = isFrontdesk && !frontdeskLocationId
    const frontdeskLocationName = locations.find(l => l.id === frontdeskLocationId)?.name

    useEffect(() => {
        api.getLocations()
            .then(locs => setLocations(locs.filter(l => l.is_active)))
            .catch(() => {})
    }, [])

    const fetchData = useCallback(async () => {
        if (noClinicAssigned) {
            setData({
                date: dateStr,
                rows: [],
                summary: {
                    visit_fee: { ...EMPTY_SUMMARY_BUCKET },
                    billing_fee: { ...EMPTY_SUMMARY_BUCKET },
                    refund: { ...EMPTY_SUMMARY_BUCKET },
                    discount: { ...EMPTY_SUMMARY_BUCKET },
                    billing_refund: { ...EMPTY_SUMMARY_BUCKET },
                    total: { ...EMPTY_SUMMARY_BUCKET },
                },
            })
            setLoading(false)
            return
        }
        setLoading(true)
        try {
            const effectiveLocationId = isFrontdesk ? (frontdeskLocationId as number) : locationId
            const res = await api.getDailySummary(dateStr, effectiveLocationId)
            setData(res)
        } catch (err) {
            console.error("Failed to fetch daily summary", err)
            setData(null)
        } finally {
            setLoading(false)
        }
    }, [dateStr, locationId, isFrontdesk, frontdeskLocationId, noClinicAssigned])

    useEffect(() => { fetchData() }, [fetchData])

    const shiftDay = (delta: number) => {
        const d = delta > 0 ? addDays(parseISO(dateStr), delta) : subDays(parseISO(dateStr), -delta)
        setDateStr(format(d, 'yyyy-MM-dd'))
    }

    const summary = data?.summary
    const rows = data?.rows ?? []

    // Double pie: outer ring is the Cash/UPI payment-mode split across the whole
    // day (includes an "Other" slice for any amount in summary.total.total not
    // accounted for by cash/upi, e.g. a stray CARD-mode bill). Inner pie breaks
    // the same total down into the full 4-way cross-tab (Visit/Billing x
    // Cash/UPI) — each inner color is a shade of its matching outer color, so
    // the two rings visually reconcile (green shades sum to the Cash slice,
    // blue shades sum to the UPI slice).
    const CASH_COLOR = '#22c55e'
    const UPI_COLOR = '#2563eb'
    const VISIT_CASH_COLOR = '#86efac'
    const BILLING_CASH_COLOR = '#14532d'
    const VISIT_UPI_COLOR = '#38bdf8'
    const BILLING_UPI_COLOR = '#475569'

    const paymentSplitData = summary ? [
        { name: 'Cash', value: summary.total.cash, fill: CASH_COLOR },
        { name: 'UPI', value: summary.total.upi, fill: UPI_COLOR },
        { name: 'Other', value: Math.max(0, Math.round((summary.total.total - summary.total.cash - summary.total.upi) * 100) / 100), fill: '#94a3b8' },
    ].filter(d => d.value > 0) : []

    const crossTabData = summary ? [
        { name: 'Visit Fee (Cash)', value: summary.visit_fee.cash, fill: VISIT_CASH_COLOR },
        { name: 'Visit Fee (UPI)', value: summary.visit_fee.upi, fill: VISIT_UPI_COLOR },
        { name: 'Billing Fee (Cash)', value: summary.billing_fee.cash, fill: BILLING_CASH_COLOR },
        { name: 'Billing Fee (UPI)', value: summary.billing_fee.upi, fill: BILLING_UPI_COLOR },
    ].filter(d => d.value > 0) : []

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
                    {isFrontdesk ? (
                        <div className="h-8 px-3 flex items-center gap-1.5 text-sm rounded-md border border-input bg-muted/40 text-muted-foreground w-44">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{frontdeskLocationName || 'No clinic assigned'}</span>
                        </div>
                    ) : (
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
                    )}
                </div>
            </div>

            {noClinicAssigned && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-400 shrink-0">
                    No clinic is assigned to your account — contact an admin to get one assigned. Showing an empty summary until then.
                </div>
            )}

            {/* Summary card: donut chart + two cross-tab legend tables */}
            <Card className="shrink-0">
                <CardContent className="p-4">
                    {loading || !summary ? (
                        <div className="flex items-center justify-center py-10">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : summary.total.total === 0 ? (
                        <div className="text-center text-muted-foreground text-sm py-6">
                            <PieChartIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                            No income to chart for this day
                        </div>
                    ) : (
                        <div className="flex flex-col md:flex-row items-center gap-6">
                            {/* Donut: outer ring = Cash/UPI split, inner pie = the full
                                Visit/Billing x Cash/UPI cross-tab in matching shades. */}
                            <div className="w-40 h-40 shrink-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <RePie>
                                        <Pie
                                            data={paymentSplitData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={62}
                                            outerRadius={78}
                                            paddingAngle={2}
                                            dataKey="value"
                                            animationDuration={600}
                                        >
                                            {paymentSplitData.map((entry, index) => (
                                                <Cell key={`outer-cell-${index}`} fill={entry.fill} stroke="none" />
                                            ))}
                                        </Pie>
                                        <Pie
                                            data={crossTabData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={0}
                                            outerRadius={58}
                                            paddingAngle={2}
                                            dataKey="value"
                                            animationDuration={600}
                                        >
                                            {crossTabData.map((entry, index) => (
                                                <Cell key={`inner-cell-${index}`} fill={entry.fill} stroke="none" />
                                            ))}
                                        </Pie>
                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                        <ReTooltip formatter={(value: any, name: any) => [`₹${value}`, name]} />
                                    </RePie>
                                </ResponsiveContainer>
                            </div>

                            <div className="flex flex-col sm:flex-row items-stretch gap-6 w-full md:w-auto md:border-l md:pl-6">
                                {/* Cash/UPI totals, matching the outer ring */}
                                <table className="text-sm">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="text-left font-medium text-muted-foreground pr-6 pb-1.5">Fee Type</th>
                                            <th className="text-right font-medium pb-1.5">
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: CASH_COLOR }} />
                                                    Cash
                                                </span>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td className="text-muted-foreground pr-6 py-1">Cash</td>
                                            <td className="text-right tabular-nums font-semibold py-1">₹{summary.total.cash}</td>
                                        </tr>
                                        <tr>
                                            <td className="text-muted-foreground pr-6 py-1">
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: UPI_COLOR }} />
                                                    UPI
                                                </span>
                                            </td>
                                            <td className="text-right tabular-nums font-semibold py-1">₹{summary.total.upi}</td>
                                        </tr>
                                        <tr className="border-t">
                                            <td className="font-bold pr-6 pt-1.5">Total</td>
                                            <td className="text-right tabular-nums font-bold pt-1.5">₹{summary.total.total}</td>
                                        </tr>
                                    </tbody>
                                </table>

                                {/* Full Visit Fee / Billing Fee x Cash / UPI cross-tab */}
                                <table className="text-sm sm:border-l sm:pl-6">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="text-left font-medium text-muted-foreground pr-6 pb-1.5">Fee Type</th>
                                            <th className="text-right font-medium pr-6 pb-1.5">
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: CASH_COLOR }} />
                                                    Cash
                                                </span>
                                            </th>
                                            <th className="text-right font-medium pb-1.5">
                                                <span className="inline-flex items-center gap-1.5">
                                                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: UPI_COLOR }} />
                                                    UPI
                                                </span>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td className="text-muted-foreground pr-6 py-1">Visit Fee</td>
                                            <td className="text-right pr-6 py-1">
                                                <span className="inline-flex items-center gap-1.5 tabular-nums font-semibold">
                                                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: VISIT_CASH_COLOR }} />
                                                    ₹{summary.visit_fee.cash}
                                                </span>
                                            </td>
                                            <td className="text-right py-1">
                                                <span className="inline-flex items-center gap-1.5 tabular-nums font-semibold">
                                                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: VISIT_UPI_COLOR }} />
                                                    ₹{summary.visit_fee.upi}
                                                </span>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td className="text-muted-foreground pr-6 py-1">Billing Fee</td>
                                            <td className="text-right pr-6 py-1">
                                                <span className="inline-flex items-center gap-1.5 tabular-nums font-semibold">
                                                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: BILLING_CASH_COLOR }} />
                                                    ₹{summary.billing_fee.cash}
                                                </span>
                                            </td>
                                            <td className="text-right py-1">
                                                <span className="inline-flex items-center gap-1.5 tabular-nums font-semibold">
                                                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: BILLING_UPI_COLOR }} />
                                                    ₹{summary.billing_fee.upi}
                                                </span>
                                            </td>
                                        </tr>
                                        <tr className="border-t">
                                            <td className="font-bold pr-6 pt-1.5">Total</td>
                                            <td className="text-right tabular-nums font-bold pr-6 pt-1.5">₹{summary.total.cash}</td>
                                            <td className="text-right tabular-nums font-bold pt-1.5">₹{summary.total.upi}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
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
                                        <TableCell><FeeCell amount={row.visit_fee} mode={row.visit_fee_mode} refund={row.refund_amount} refundMode={row.refund_mode} /></TableCell>
                                        <TableCell><BillingFeesCell fees={row.billing_fees} /></TableCell>
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
