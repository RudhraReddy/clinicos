"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, TrendingUp, Users, IndianRupee, Calendar, Package, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, type Visit, type BillingHistoryEntry } from "@/lib/api"
import { getTodayIST } from "@/lib/utils"

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function StatCard({ title, value, sub, icon: Icon, color = "text-primary" }: {
    title: string; value: string; sub?: string; icon: React.ElementType; color?: string
}) {
    return (
        <Card>
            <CardContent className="pt-5 pb-4 px-5">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
                        <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
                        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
                    </div>
                    <div className="p-2 rounded-md bg-muted/50">
                        <Icon className={`h-5 w-5 ${color}`} />
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

function BarChart({ data, label, formatValue }: {
    data: { key: string; value: number; sub?: string }[]
    label: string
    formatValue?: (v: number) => string
}) {
    const max = Math.max(...data.map(d => d.value), 1)
    return (
        <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
            <div className="space-y-1.5">
                {data.map(d => (
                    <div key={d.key} className="flex items-center gap-2 group">
                        <span className="text-xs text-muted-foreground w-8 shrink-0 text-right">{d.key}</span>
                        <div className="flex-1 h-5 bg-muted/40 rounded-sm overflow-hidden">
                            <div
                                className="h-full bg-primary/70 group-hover:bg-primary transition-colors rounded-sm"
                                style={{ width: `${(d.value / max) * 100}%` }}
                            />
                        </div>
                        <span className="text-xs font-medium w-16 shrink-0">
                            {formatValue ? formatValue(d.value) : d.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}

function HorizontalBar({ label, value, max, color, sub }: {
    label: string; value: number; max: number; color: string; sub?: string
}) {
    return (
        <div className="space-y-1">
            <div className="flex justify-between text-xs">
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground">{sub ?? value}</span>
            </div>
            <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }}
                />
            </div>
        </div>
    )
}

export default function StatusPage() {
    const [visits, setVisits] = useState<Visit[]>([])
    const [bills, setBills] = useState<BillingHistoryEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const load = async () => {
        setLoading(true)
        setError(null)
        try {
            const [visitsData, billsRes] = await Promise.all([
                api.getVisits(),
                api.getBillingHistory({ limit: 500, page: 1 }),
            ])
            setVisits(visitsData.filter(v => v.status !== 'deleted'))
            setBills(billsRes.bills)
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load data")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [])

    const today = getTodayIST()
    const todayDate = new Date(today)

    const stats = useMemo(() => {
        if (!bills.length && !visits.length) return null

        // ── Revenue stats ──────────────────────────────────────────────
        const totalRevenue = bills.reduce((s, b) => s + b.total_amount, 0)

        const thisMonthBills = bills.filter(b => {
            const d = new Date(b.date)
            return d.getFullYear() === todayDate.getFullYear() && d.getMonth() === todayDate.getMonth()
        })
        const thisMonthRevenue = thisMonthBills.reduce((s, b) => s + b.total_amount, 0)

        const todayBills = bills.filter(b => b.date.startsWith(today))
        const todayRevenue = todayBills.reduce((s, b) => s + b.total_amount, 0)

        // ── Revenue last 30 days (daily) ───────────────────────────────
        const last30: Record<string, number> = {}
        for (let i = 29; i >= 0; i--) {
            const d = new Date(todayDate)
            d.setDate(d.getDate() - i)
            const key = d.toISOString().split('T')[0]
            last30[key] = 0
        }
        bills.forEach(b => {
            const key = b.date.split(' ')[0]
            if (key in last30) last30[key] += b.total_amount
        })

        // Group to weekly buckets for a cleaner bar chart (6 weeks ≈ 42 days → use last 8 weeks)
        const weeklyRevenue: Record<string, number> = {}
        Object.entries(last30).forEach(([date, amt]) => {
            const d = new Date(date)
            const weekStart = new Date(d)
            weekStart.setDate(d.getDate() - d.getDay())
            const wk = `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getDate()}`
            weeklyRevenue[wk] = (weeklyRevenue[wk] ?? 0) + amt
        })
        const weeklyData = Object.entries(weeklyRevenue).map(([key, value]) => ({ key, value }))

        // ── Visits per day of week ────────────────────────────────────
        const byDow: number[] = [0, 0, 0, 0, 0, 0, 0]
        visits.forEach(v => {
            if (!v.visit_date) return
            const dow = new Date(v.visit_date).getDay()
            byDow[dow]++
        })
        const dowData = DAY_NAMES.map((d, i) => ({ key: d, value: byDow[i] }))

        // ── Payment breakdown ─────────────────────────────────────────
        const paymentMap: Record<string, number> = { CASH: 0, CARD: 0, UPI: 0 }
        const todayPaymentMap: Record<string, number> = { CASH: 0, CARD: 0, UPI: 0 }
        const monthPaymentMap: Record<string, number> = { CASH: 0, CARD: 0, UPI: 0 }

        bills.forEach(b => {
            const type = b.payment_type || "unknown"
            paymentMap[type] = (paymentMap[type] ?? 0) + b.total_amount
        })
        const paymentData = Object.entries(paymentMap)
            .sort((a, b) => b[1] - a[1])
            .map(([key, value]) => ({ key, value }))

        todayBills.forEach(b => {
            const type = b.payment_type || "unknown"
            todayPaymentMap[type] = (todayPaymentMap[type] ?? 0) + b.total_amount
        })
        const todayPaymentData = Object.entries(todayPaymentMap)
            .sort((a, b) => b[1] - a[1])
            .map(([key, value]) => ({ key, value }))

        thisMonthBills.forEach(b => {
            const type = b.payment_type || "unknown"
            monthPaymentMap[type] = (monthPaymentMap[type] ?? 0) + b.total_amount
        })
        const monthPaymentData = Object.entries(monthPaymentMap)
            .sort((a, b) => b[1] - a[1])
            .map(([key, value]) => ({ key, value }))

        // ── Weekly Breakdown for This Month ───────────────────────────
        const thisMonthWeekly: Record<string, { CASH: number; CARD: number; UPI: number }> = {
            "Week 1": { CASH: 0, CARD: 0, UPI: 0 },
            "Week 2": { CASH: 0, CARD: 0, UPI: 0 },
            "Week 3": { CASH: 0, CARD: 0, UPI: 0 },
            "Week 4": { CASH: 0, CARD: 0, UPI: 0 },
            "Week 5": { CASH: 0, CARD: 0, UPI: 0 },
        }

        thisMonthBills.forEach(b => {
            const dateObj = new Date(b.date)
            const day = dateObj.getDate()
            const type = b.payment_type || "unknown"
            
            let week = "Week 5"
            if (day <= 7) week = "Week 1"
            else if (day <= 14) week = "Week 2"
            else if (day <= 21) week = "Week 3"
            else if (day <= 28) week = "Week 4"

            if (type === "CASH" || type === "CARD" || type === "UPI") {
                thisMonthWeekly[week][type as "CASH" | "CARD" | "UPI"] += b.total_amount
            }
        })
        const thisMonthWeeklyData = Object.entries(thisMonthWeekly).map(([week, data]) => ({ week, ...data }))
        const maxWeeklyRevenue = Math.max(...thisMonthWeeklyData.map(d => d.CASH + d.CARD + d.UPI))
        const maxWeeklySingleRevenue = Math.max(...thisMonthWeeklyData.map(d => Math.max(d.CASH, d.CARD, d.UPI)))

        // ── New vs returning patients ─────────────────────────────────
        const patientVisitCount: Record<string, number> = {}
        visits.forEach(v => {
            patientVisitCount[v.patient_id] = (patientVisitCount[v.patient_id] ?? 0) + 1
        })
        const newPatients = Object.values(patientVisitCount).filter(c => c === 1).length
        const returningPatients = Object.values(patientVisitCount).filter(c => c > 1).length
        const totalPatients = Object.keys(patientVisitCount).length

        // ── Busiest hours ─────────────────────────────────────────────
        const hourMap: Record<number, number> = {}
        visits.forEach(v => {
            if (!v.visit_time) return
            const hr = parseInt(v.visit_time.split(':')[0], 10)
            if (!isNaN(hr)) hourMap[hr] = (hourMap[hr] ?? 0) + 1
        })
        const hourData = Object.entries(hourMap)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([hr, count]) => {
                const h = Number(hr)
                const label = h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`
                return { key: label, value: count }
            })

        // ── Recent patients (last 10 distinct) ───────────────────────
        const seenIds = new Set<string>()
        const recentPatients: { name: string; date: string; visits: number }[] = []
        ;[...visits].sort((a, b) => (b.visit_date ?? "").localeCompare(a.visit_date ?? "")).forEach(v => {
            if (seenIds.has(v.patient_id)) return
            seenIds.add(v.patient_id)
            recentPatients.push({
                name: v.patient_name,
                date: v.visit_date,
                visits: patientVisitCount[v.patient_id] ?? 1,
            })
        })

        const avgRevenuePerVisit = bills.length > 0 ? totalRevenue / bills.length : 0

        return {
            totalRevenue, thisMonthRevenue, todayRevenue,
            weeklyData, dowData, paymentData, todayPaymentData, monthPaymentData, hourData,
            paymentMap, todayPaymentMap, monthPaymentMap,
            thisMonthWeeklyData, maxWeeklyRevenue, maxWeeklySingleRevenue,
            newPatients, returningPatients, totalPatients,
            recentPatients: recentPatients.slice(0, 8),
            totalVisits: visits.length,
            totalBills: bills.length,
            avgRevenuePerVisit,
        }
    }, [bills, visits, today]) // eslint-disable-line react-hooks/exhaustive-deps

    const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

    return (
        <div className="space-y-6 pb-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Clinic Status</h1>
                    <p className="text-sm text-muted-foreground">Insights and analytics across visits, revenue, and patients.</p>
                </div>
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-600 text-sm">{error}</div>
            )}

            {!loading && stats && (
                <div className="space-y-6">
                    {/* ── Top KPI Cards ─────────────────────────────── */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard title="Today's Revenue" value={fmt(stats.todayRevenue)} sub={`${todayBills(bills, today)} bills`} icon={IndianRupee} color="text-green-600" />
                        <StatCard title="This Month" value={fmt(stats.thisMonthRevenue)} icon={TrendingUp} color="text-blue-600" />
                        <StatCard title="Total Visits" value={stats.totalVisits.toString()} sub={`${stats.totalPatients} unique patients`} icon={Users} />
                        <StatCard title="Avg per Bill" value={fmt(stats.avgRevenuePerVisit)} sub={`${stats.totalBills} invoices total`} icon={Package} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* ── Revenue by Week ──────────────────────── */}
                        <Card>
                            <CardHeader className="pb-3 pt-5 px-5">
                                <CardTitle className="text-sm font-semibold">Revenue — Last 30 Days</CardTitle>
                            </CardHeader>
                            <CardContent className="px-5 pb-5">
                                {stats.weeklyData.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No billing data yet.</p>
                                ) : (
                                    <BarChart
                                        data={stats.weeklyData}
                                        label="Week of"
                                        formatValue={v => fmt(v)}
                                    />
                                )}
                            </CardContent>
                        </Card>

                        {/* ── Visits by Day of Week ───────────────── */}
                        <Card>
                            <CardHeader className="pb-3 pt-5 px-5">
                                <CardTitle className="text-sm font-semibold">Visits by Day of Week</CardTitle>
                            </CardHeader>
                            <CardContent className="px-5 pb-5">
                                <BarChart data={stats.dowData} label="Day" />
                                <p className="text-xs text-muted-foreground mt-3">
                                    Busiest: <span className="font-semibold text-foreground">
                                        {stats.dowData.reduce((a, b) => a.value > b.value ? a : b).key}
                                    </span>
                                </p>
                            </CardContent>
                        </Card>

                        {/* ── Busiest Hours ───────────────────────── */}
                        <Card>
                            <CardHeader className="pb-3 pt-5 px-5">
                                <CardTitle className="text-sm font-semibold">Busiest Hours</CardTitle>
                            </CardHeader>
                            <CardContent className="px-5 pb-5">
                                {stats.hourData.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No visit time data.</p>
                                ) : (
                                    <BarChart data={stats.hourData} label="Hour" />
                                )}
                            </CardContent>
                        </Card>

                        {/* ── Payment Breakdown ───────────────────── */}
                        <Card className="flex flex-col">
                            <CardHeader className="pb-3 pt-5 px-5">
                                <CardTitle className="text-sm font-semibold">Revenue by Payment Type</CardTitle>
                            </CardHeader>
                            <CardContent className="px-5 pb-5 flex-1 flex flex-col justify-between space-y-6">
                                <div>
                                    <div className="border rounded-md overflow-hidden">
                                        <Table>
                                            <TableHeader className="bg-muted/50">
                                                <TableRow>
                                                    <TableHead className="w-[100px] text-xs font-semibold uppercase tracking-wider text-muted-foreground">Period</TableHead>
                                                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cash</TableHead>
                                                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Card</TableHead>
                                                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">UPI</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                <TableRow className="bg-primary/5 hover:bg-primary/10 transition-colors">
                                                    <TableCell className="font-bold text-sm uppercase tracking-wider text-primary">Today</TableCell>
                                                    <TableCell className="text-right text-lg font-bold text-primary">{fmt(stats.todayPaymentMap.CASH)}</TableCell>
                                                    <TableCell className="text-right text-lg font-bold text-primary">{fmt(stats.todayPaymentMap.CARD)}</TableCell>
                                                    <TableCell className="text-right text-lg font-bold text-primary">{fmt(stats.todayPaymentMap.UPI)}</TableCell>
                                                </TableRow>
                                                <TableRow>
                                                    <TableCell className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">This Month</TableCell>
                                                    <TableCell className="text-right font-medium">{fmt(stats.monthPaymentMap.CASH)}</TableCell>
                                                    <TableCell className="text-right font-medium">{fmt(stats.monthPaymentMap.CARD)}</TableCell>
                                                    <TableCell className="text-right font-medium">{fmt(stats.monthPaymentMap.UPI)}</TableCell>
                                                </TableRow>
                                                <TableRow>
                                                    <TableCell className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">All Time</TableCell>
                                                    <TableCell className="text-right font-medium">{fmt(stats.paymentMap.CASH)}</TableCell>
                                                    <TableCell className="text-right font-medium">{fmt(stats.paymentMap.CARD)}</TableCell>
                                                    <TableCell className="text-right font-medium">{fmt(stats.paymentMap.UPI)}</TableCell>
                                                </TableRow>
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>

                                <div className="space-y-1 mt-auto pt-2">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">This Month's Trend</h4>
                                        <div className="flex gap-3 text-[10px] font-medium">
                                            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500"></div>Cash</div>
                                            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div>Card</div>
                                            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-purple-500"></div>UPI</div>
                                        </div>
                                    </div>
                                    {stats.thisMonthRevenue === 0 ? (
                                        <p className="text-sm text-muted-foreground">No billing data this month.</p>
                                    ) : (
                                        <div className="pt-2">
                                            <div className="flex h-36">
                                                {/* Y-axis */}
                                                <div className="flex flex-col justify-between items-end pr-2 pb-[24px] text-[10px] text-muted-foreground border-r border-muted w-10 shrink-0">
                                                    <span>{fmt(stats.maxWeeklySingleRevenue)}</span>
                                                    <span>0</span>
                                                </div>
                                                {/* Graph Area */}
                                                <div className="flex-1 relative border-b border-muted mb-[24px]">
                                                    {/* SVG Chart */}
                                                    <div className="absolute inset-0">
                                                        <svg className="w-full h-full overflow-visible pointer-events-none">
                                                            {(() => {
                                                                const max = stats.maxWeeklySingleRevenue || 1;
                                                                const getX = (i: number) => `${(i * 20) + 10}%`;
                                                                const getY = (val: number) => `${100 - (val / max) * 100}%`;
                                                                
                                                                return (
                                                                    <>
                                                                        <path d={stats.thisMonthWeeklyData.map((d, i) => `${i===0?'M':'L'} ${getX(i)} ${getY(d.CASH)}`).join(' ')} fill="none" className="stroke-green-500" strokeWidth="2" strokeLinejoin="round" />
                                                                        <path d={stats.thisMonthWeeklyData.map((d, i) => `${i===0?'M':'L'} ${getX(i)} ${getY(d.CARD)}`).join(' ')} fill="none" className="stroke-blue-500" strokeWidth="2" strokeLinejoin="round" />
                                                                        <path d={stats.thisMonthWeeklyData.map((d, i) => `${i===0?'M':'L'} ${getX(i)} ${getY(d.UPI)}`).join(' ')} fill="none" className="stroke-purple-500" strokeWidth="2" strokeLinejoin="round" />
                                                                        
                                                                        {stats.thisMonthWeeklyData.map((d, i) => (
                                                                            <g key={i}>
                                                                                <circle cx={getX(i)} cy={getY(d.CASH)} r="3" className="fill-background stroke-green-500" strokeWidth="2" />
                                                                                <circle cx={getX(i)} cy={getY(d.CARD)} r="3" className="fill-background stroke-blue-500" strokeWidth="2" />
                                                                                <circle cx={getX(i)} cy={getY(d.UPI)} r="3" className="fill-background stroke-purple-500" strokeWidth="2" />
                                                                            </g>
                                                                        ))}
                                                                    </>
                                                                );
                                                            })()}
                                                        </svg>
                                                    </div>

                                                    {/* Hover interaction columns & X-axis labels */}
                                                    <div className="absolute inset-0 flex">
                                                        {stats.thisMonthWeeklyData.map((d) => {
                                                            return (
                                                                <div key={d.week} className="flex-1 group relative h-full flex flex-col justify-end cursor-pointer">
                                                                    {/* Subtle hover background */}
                                                                    <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-8 bg-muted/0 group-hover:bg-muted/40 rounded transition-colors" />
                                                                    
                                                                    {/* Tooltip on hover */}
                                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border whitespace-nowrap">
                                                                        <div className="font-bold mb-1">{d.week}</div>
                                                                        <div className="flex justify-between gap-4"><span className="text-green-500">Cash:</span> <span>{fmt(d.CASH)}</span></div>
                                                                        <div className="flex justify-between gap-4"><span className="text-blue-500">Card:</span> <span>{fmt(d.CARD)}</span></div>
                                                                        <div className="flex justify-between gap-4"><span className="text-purple-500">UPI:</span> <span>{fmt(d.UPI)}</span></div>
                                                                    </div>

                                                                    {/* X-axis label */}
                                                                    <div className="absolute top-full mt-2 w-full text-center text-[10px] text-muted-foreground font-medium">
                                                                        {d.week.replace('Week ', 'W')}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* ── New vs Returning + Recent Patients ──────── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader className="pb-3 pt-5 px-5">
                                <CardTitle className="text-sm font-semibold">Patient Mix</CardTitle>
                            </CardHeader>
                            <CardContent className="px-5 pb-5 space-y-4">
                                <div className="flex gap-4">
                                    <div className="flex-1 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 p-4 text-center">
                                        <div className="text-3xl font-bold text-blue-600">{stats.newPatients}</div>
                                        <div className="text-xs text-blue-700 dark:text-blue-400 font-medium mt-1">New Patients</div>
                                        <div className="text-xs text-muted-foreground">(visited once)</div>
                                    </div>
                                    <div className="flex-1 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/40 p-4 text-center">
                                        <div className="text-3xl font-bold text-green-600">{stats.returningPatients}</div>
                                        <div className="text-xs text-green-700 dark:text-green-400 font-medium mt-1">Returning</div>
                                        <div className="text-xs text-muted-foreground">(2+ visits)</div>
                                    </div>
                                </div>
                                <HorizontalBar
                                    label="Retention rate"
                                    value={stats.returningPatients}
                                    max={stats.totalPatients}
                                    sub={stats.totalPatients > 0 ? `${Math.round((stats.returningPatients / stats.totalPatients) * 100)}%` : "0%"}
                                    color="bg-green-500"
                                />
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-3 pt-5 px-5">
                                <CardTitle className="text-sm font-semibold">Recent Patients</CardTitle>
                            </CardHeader>
                            <CardContent className="px-5 pb-5">
                                <div className="space-y-2">
                                    {stats.recentPatients.map((p, i) => (
                                        <div key={i} className="flex items-center justify-between py-1 border-b last:border-0">
                                            <div>
                                                <div className="text-sm font-medium">{p.name}</div>
                                                <div className="text-xs text-muted-foreground">{p.date}</div>
                                            </div>
                                            <Badge variant={p.visits > 1 ? "secondary" : "outline"} className="text-[10px]">
                                                {p.visits} {p.visits === 1 ? "visit" : "visits"}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}
        </div>
    )
}

function todayBills(bills: BillingHistoryEntry[], today: string) {
    return bills.filter(b => b.date.startsWith(today)).length
}
