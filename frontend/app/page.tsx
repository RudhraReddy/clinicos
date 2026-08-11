"use client"

import { Button } from "@/components/ui/button"
import { Check, Loader2, Pencil, Trash2, Package, CreditCard, Users, Menu } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getTodayIST, orderTodayVisits, getVisitAge, formatVisitFee } from "@/lib/utils"
import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth_context"
import { useMenu } from "@/components/layout/AppShell"
import { EditVisitDialog } from "@/components/EditVisitDialog"
import { WalkInForm } from "@/components/WalkInForm"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VisitsTab } from "@/components/VisitsTab"
import { api, type Visit } from "@/lib/api"
import { DatePickerWithRange } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"
import { format } from "date-fns"

function formatTime(timeStr: string | null | undefined, createdAt?: string | null) {
    if (!timeStr) {
        if (!createdAt) return "ASAP"
        try {
            const date = new Date(createdAt)
            const h = date.getHours()
            const m = date.getMinutes().toString().padStart(2, '0')
            const ampm = h >= 12 ? 'PM' : 'AM'
            return `${h % 12 || 12}:${m} ${ampm}`
        } catch { return "ASAP" }
    }
    try {
        const [hours, minutes] = timeStr.split(':')
        const h = parseInt(hours, 10)
        const ampm = h >= 12 ? 'PM' : 'AM'
        return `${h % 12 || 12}:${minutes} ${ampm}`
    } catch { return timeStr }
}

function formatUpdatedTime(updatedAtStr?: string, createdAtStr?: string) {
    if (!updatedAtStr) return null
    try {
        const created = createdAtStr ? new Date(createdAtStr).getTime() : 0
        const updated = new Date(updatedAtStr).getTime()
        if (Math.abs(updated - created) > 5000) {
            const date = new Date(updatedAtStr)
            const h = date.getHours()
            const m = date.getMinutes().toString().padStart(2, '0')
            const ampm = h >= 12 ? 'PM' : 'AM'
            return `${h % 12 || 12}:${m} ${ampm}`
        }
    } catch { /* ignore */ }
    return null
}


function DashboardContent() {
    const searchParams = useSearchParams()

    // Explicitly filtered to today's date — feeds the Overview tab's "Today's Visits" card.
    // Must stay date-filtered: an unfiltered fetch is capped server-side to the 50 most
    // recently-*created* visits system-wide, so on a busy multi-clinic day today's own
    // visits can get pushed out of that window before this card ever sees them.
    const [visits, setVisits] = useState<Visit[]>([])
    const [loading, setLoading] = useState(true)

    // Date-filterable — feeds the "All Visits" tab only. Defaults to the same
    // unfiltered list until a date/range is picked in the header.
    const [dateRange, setDateRange] = useState<DateRange | undefined>()
    const [filteredVisits, setFilteredVisits] = useState<Visit[]>([])
    const [filteredLoading, setFilteredLoading] = useState(true)

    const [editVisitOpen, setEditVisitOpen] = useState(false)
    const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)

    // Controlled so the date-filter control (kept in the same header slot) can be
    // hidden on the Overview tab and shown only on All Visits, where it's meaningful.
    // Also lets external links (e.g. the doctor dashboard's "All Visits" button) land
    // directly on the All Visits tab via ?tab=visits.
    const [activeTab, setActiveTab] = useState(searchParams.get("tab") === "visits" ? "visits" : "overview")

    const { role, isLoading } = useAuth()
    const router = useRouter()
    const { openMenu } = useMenu()

    // Doctors are normally bounced to /doctor — except when they've explicitly
    // followed a link straight to All Visits (e.g. the doctor dashboard's own
    // "All Visits" button), which they're allowed to view directly.
    const cameForAllVisits = searchParams.get("tab") === "visits"

    useEffect(() => {
        if (!isLoading && role === 'doctor' && !cameForAllVisits) router.push('/doctor')
    }, [role, isLoading, router, cameForAllVisits])

    const filterDateFrom = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : ''
    const filterDateTo = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : ''

    const fetchVisits = async () => {
        try {
            setLoading(true)
            const todayStr = getTodayIST()
            const all = await api.getVisits(undefined, { date_from: todayStr, date_to: todayStr })
            setVisits(all.filter(v => v.status !== 'deleted'))
        } catch (err) {
            console.error("Failed to fetch visits:", err)
        } finally {
            setLoading(false)
        }
    }

    const fetchFilteredVisits = async () => {
        try {
            setFilteredLoading(true)
            const all = await api.getVisits(undefined, filterDateFrom || filterDateTo
                ? { date_from: filterDateFrom || undefined, date_to: filterDateTo || undefined }
                : undefined)
            setFilteredVisits(all.filter(v => v.status !== 'deleted'))
        } catch (err) {
            console.error("Failed to fetch visits:", err)
        } finally {
            setFilteredLoading(false)
        }
    }

    useEffect(() => { fetchVisits() }, [])
    useEffect(() => { fetchFilteredVisits() }, [filterDateFrom, filterDateTo])

    const refreshAll = () => {
        fetchVisits()
        fetchFilteredVisits()
    }

    if (isLoading || (role === 'doctor' && !cameForAllVisits)) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    const today = getTodayIST()
    const todayVisits = visits.filter(v => v.visit_date === today)
    const orderedTodayVisits = orderTodayVisits(todayVisits)
    const waitingCount = todayVisits.filter(v =>
        !['in_progress', 'done', 'cancelled'].includes(v.status.toLowerCase())
    ).length

    const handleDeleteVisit = async (visitId: string) => {
        if (!confirm("Delete this visit?")) return
        try {
            await api.updateVisit(visitId, { status: 'deleted' })
            refreshAll()
        } catch { /* silent */ }
    }

    const handleMarkDone = async (visitId: string) => {
        try {
            await api.updateVisit(visitId, { status: 'done' })
            refreshAll()
        } catch { /* silent */ }
    }

    const handleGoToBilling = (visit: Visit) => {
        router.push(`/billing?patient_id=${visit.patient_id}&visit_id=${visit.visit_id}`)
    }

    const renderVisitCard = (visit: Visit) => (
        <div
            key={visit.visit_id}
            className={`mx-3 mb-2 rounded-lg border px-3 py-2.5 transition-colors ${
                visit.status === 'done'
                    ? 'border-border bg-background dark:bg-muted/10'
                    : 'border-border bg-muted/60 hover:bg-muted/80 dark:bg-muted/30 dark:hover:bg-muted/50'
            }`}
        >
            {/* Name row */}
            <div className="flex items-center justify-between gap-2 mb-2">
                <p className="font-semibold text-base leading-none truncate">{visit.patient_name}</p>
                {visit.status === 'done' && (
                    <span className="text-[10px] font-medium text-green-600 dark:text-green-400 shrink-0">Done</span>
                )}
            </div>
            {/* Fee + time + actions */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                    <span className={`text-sm font-medium tabular-nums ${visit.payment_status === 'full' ? 'text-green-600 dark:text-green-400' : ''}`}>
                        {formatVisitFee(visit.visiting_fee)}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                        {formatTime(visit.visit_time, visit.created_at)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                        {getVisitAge(visit.visit_date)}
                    </span>
                </div>
                <div className="flex items-center gap-0.5">
                    {visit.status !== 'done' && (
                        <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 rounded-md hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-500/20"
                            onClick={() => handleMarkDone(visit.visit_id)}
                            title="Mark done"
                        >
                            <Check className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 rounded-md hover:bg-emerald-100 hover:text-emerald-600 dark:hover:bg-emerald-500/20"
                        onClick={() => handleGoToBilling(visit)}
                        title="Go to Billing"
                    >
                        <CreditCard className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 rounded-md hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-500/20"
                        onClick={() => { setSelectedVisit(visit); setEditVisitOpen(true) }}
                        title="Edit"
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 rounded-md hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-500/20"
                        onClick={() => handleDeleteVisit(visit.visit_id)}
                        title="Delete"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>
        </div>
    )

    const renderTodaysList = () => (
        <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader className="pb-2 pt-4 px-4 shrink-0">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Today&apos;s Visits</CardTitle>
                    <span className="text-xs font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-md">
                        {loading ? "..." : waitingCount} waiting
                    </span>
                </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto pt-2 pb-3 px-0 custom-scrollbar">
                <style jsx global>{`
                    .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                    .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 20px; }
                    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #94a3b8; }
                `}</style>
                {loading ? (
                    <div className="py-10 text-center text-muted-foreground text-sm">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Loading...
                    </div>
                ) : orderedTodayVisits.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">No appointments today</p>
                ) : (
                    orderedTodayVisits.map(v => renderVisitCard(v))
                )}
            </CardContent>
        </Card>
    )

    return (
        <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden gap-4">
                <div className="flex items-center gap-3 flex-shrink-0">
                    <button
                        type="button"
                        onClick={openMenu}
                        className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors"
                    >
                        <Menu className="h-6 w-6" />
                        <span className="sr-only">Toggle Menu</span>
                    </button>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground w-44 shrink-0">Dashboard</h1>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" asChild className="w-32">
                            <Link href="/inventory">
                                <Package className="mr-1.5 h-3.5 w-3.5" />
                                Inventory
                            </Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild className="w-32">
                            <Link href="/billing">
                                <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                                Billing
                            </Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild className="w-32">
                            <Link href="/patients">
                                <Users className="mr-1.5 h-3.5 w-3.5" />
                                Patients
                            </Link>
                        </Button>
                    </div>
                    <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="visits">All Visits</TabsTrigger>
                    </TabsList>
                    <div className="ml-auto">
                        {activeTab === "visits" && (
                            <DatePickerWithRange
                                date={dateRange}
                                setDate={setDateRange}
                                placeholder="Filter by date"
                                className="w-auto"
                            />
                        )}
                    </div>
                </div>

                <TabsContent value="overview" className="flex-1 overflow-hidden m-0">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
                        {/* Left 2/3: Walk-in form */}
                        <div className="lg:col-span-2 h-full overflow-hidden">
                            <WalkInForm onSuccess={refreshAll} />
                        </div>
                        {/* Right 1/3: Today's list */}
                        <div className="lg:col-span-1 h-full flex flex-col gap-6 pr-1 overflow-hidden">
                            {renderTodaysList()}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="visits" className="flex-1 overflow-hidden m-0">
                    <VisitsTab visits={filteredVisits} loading={filteredLoading} />
                </TabsContent>
            </Tabs>

            <EditVisitDialog
                open={editVisitOpen}
                onOpenChange={setEditVisitOpen}
                visit={selectedVisit}
                onSuccess={refreshAll}
            />
        </div>
    )
}

export default function Dashboard() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <DashboardContent />
        </Suspense>
    )
}
