"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, TrendingUp, Users, IndianRupee, Calendar, Package, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
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
        const paymentMap: Record<string, number> = {}
        bills.forEach(b => {
            const type = b.payment_type || "unknown"
            paymentMap[type] = (paymentMap[type] ?? 0) + b.total_amount
        })
        const paymentData = Object.entries(paymentMap)
            .sort((a, b) => b[1] - a[1])
            .map(([key, value]) => ({ key, value }))

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
            weeklyData, dowData, paymentData, hourData,
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
                        <Card>
                            <CardHeader className="pb-3 pt-5 px-5">
                                <CardTitle className="text-sm font-semibold">Revenue by Payment Type</CardTitle>
                            </CardHeader>
                            <CardContent className="px-5 pb-5 space-y-3">
                                {stats.paymentData.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No billing data yet.</p>
                                ) : (
                                    stats.paymentData.map((p, i) => (
                                        <HorizontalBar
                                            key={p.key}
                                            label={p.key.charAt(0).toUpperCase() + p.key.slice(1)}
                                            value={p.value}
                                            max={stats.paymentData[0].value}
                                            sub={fmt(p.value)}
                                            color={["bg-blue-500", "bg-green-500", "bg-amber-500", "bg-purple-500"][i % 4]}
                                        />
                                    ))
                                )}
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
