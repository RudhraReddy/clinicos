"use client"

import { Button } from "@/components/ui/button"
import { CreditCard, Loader2, Pencil, Phone, Trash2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getTodayIST } from "@/lib/utils"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth_context"
import { EditVisitDialog } from "@/components/EditVisitDialog"
import { WalkInForm } from "@/components/WalkInForm"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VisitsTab } from "@/components/VisitsTab"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, type Visit, type Patient } from "@/lib/api"

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

const PatientContactPopover = ({ patientId }: { patientId: string }) => {
    const [patient, setPatient] = useState<Patient | null>(null)
    const [loadFailed, setLoadFailed] = useState(false)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        if (!open || patient || loadFailed) return
        api.getPatient(patientId)
            .then(setPatient)
            .catch(err => { console.error(err); setLoadFailed(true) })
    }, [open, patient, patientId, loadFailed])

    const loading = open && !patient && !loadFailed

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    className="inline-flex items-center justify-center p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                    onClick={e => e.stopPropagation()}
                >
                    <Phone className="h-3.5 w-3.5" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-4" onClick={e => e.stopPropagation()}>
                <h4 className="font-semibold leading-none mb-3">Contact</h4>
                {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : patient ? (
                    <div className="space-y-2 text-sm">
                        <div><span className="font-medium">Name: </span>{patient.name}</div>
                        <div><span className="font-medium">Phone: </span>{patient.phone_number}</div>
                    </div>
                ) : (
                    <p className="text-sm text-destructive">Failed to load</p>
                )}
            </PopoverContent>
        </Popover>
    )
}

export default function Dashboard() {
    const [visits, setVisits] = useState<Visit[]>([])
    const [loading, setLoading] = useState(true)
    const [editVisitOpen, setEditVisitOpen] = useState(false)
    const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)

    const { role, isLoading } = useAuth()
    const router = useRouter()

    useEffect(() => {
        if (!isLoading && role === 'doctor') router.push('/doctor')
    }, [role, isLoading, router])

    const fetchVisits = async () => {
        try {
            setLoading(true)
            const all = await api.getVisits()
            setVisits(all.filter(v => v.status !== 'deleted'))
        } catch (err) {
            console.error("Failed to fetch visits:", err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchVisits() }, [])

    if (isLoading || role === 'doctor') {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    const today = getTodayIST()
    const todayVisits = visits.filter(v => v.visit_date === today)
    const orderedTodayVisits = [...todayVisits].sort((a, b) => {
        const timeA = a.visit_time || "23:59"
        const timeB = b.visit_time || "23:59"
        return timeA === timeB
            ? (a.created_at || "").localeCompare(b.created_at || "")
            : timeA.localeCompare(timeB)
    })
    const waitingCount = todayVisits.filter(v =>
        !['in_progress', 'done', 'cancelled'].includes(v.status.toLowerCase())
    ).length
    const recentVisits = visits
        .filter(v => v.visit_date < today)
        .sort((a, b) => b.visit_date.localeCompare(a.visit_date) || (b.visit_time || '').localeCompare(a.visit_time || ''))
        .slice(0, 20)

    const handleDeleteVisit = async (visitId: string) => {
        if (!confirm("Delete this visit?")) return
        try {
            await api.updateVisit(visitId, { status: 'deleted' })
            fetchVisits()
        } catch { /* silent */ }
    }

    const handleDoneAndBill = async (visit: Visit) => {
        try {
            if (visit.status !== 'done') {
                await api.updateVisit(visit.visit_id, { status: 'done' })
            }
            router.push(`/billing?patient_id=${visit.patient_id}&visit_id=${visit.visit_id}`)
        } catch (err) {
            console.error("Failed to complete visit:", err)
        }
    }

    const renderVisitRow = (visit: Visit, showDate = false) => (
        <div
            key={visit.visit_id}
            className="grid grid-cols-[1fr_auto] items-center gap-2 py-2.5 border-b last:border-0 border-border/50 hover:bg-muted/30 transition-all rounded-sm px-4"
        >
            <div className="space-y-0.5 text-left overflow-hidden">
                <div className="flex items-center gap-1.5">
                    <p className="font-medium text-sm leading-none truncate">{visit.patient_name}</p>
                    {visit.patient_id && <PatientContactPopover patientId={visit.patient_id} />}
                </div>
                <p className="text-xs text-muted-foreground truncate">{visit.reason || "No reason"}</p>
            </div>
            <div className="flex items-center gap-2">
                <div className="flex flex-col items-end">
                    <span className="text-xs font-mono text-muted-foreground tabular-nums">
                        {showDate ? visit.visit_date : formatTime(visit.visit_time, visit.created_at)}
                    </span>
                    {!showDate && formatUpdatedTime(visit.updated_at, visit.created_at) && (
                        <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 tabular-nums">
                            Edited {formatUpdatedTime(visit.updated_at, visit.created_at)}
                        </span>
                    )}
                </div>
                <div className="flex items-center">
                    <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 rounded-full hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-500/20"
                        onClick={() => handleDoneAndBill(visit)}
                        title="Done & Bill"
                    >
                        <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 rounded-full hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-500/20"
                        onClick={() => { setSelectedVisit(visit); setEditVisitOpen(true) }}
                        title="Edit"
                    >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 rounded-full hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-500/20"
                        onClick={() => handleDeleteVisit(visit.visit_id)}
                        title="Delete"
                    >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                </div>
            </div>
        </div>
    )

    const renderTodaysList = () => (
        <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader className="pb-2 pt-4 px-4 shrink-0">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Visits</CardTitle>
                    <span className="text-xs font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-md">
                        {loading ? "..." : waitingCount} waiting today
                    </span>
                </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0 custom-scrollbar">
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
                ) : (
                    <>
                        {/* Today */}
                        <div className="px-4 py-1.5 bg-muted/40 border-b">
                            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Today</span>
                        </div>
                        {orderedTodayVisits.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-3">No appointments today</p>
                        ) : (
                            <div className="text-sm">
                                {orderedTodayVisits.map(v => renderVisitRow(v, false))}
                            </div>
                        )}

                        {/* Recent */}
                        {recentVisits.length > 0 && (
                            <>
                                <div className="px-4 py-1.5 bg-muted/40 border-y mt-1">
                                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Recent</span>
                                </div>
                                <div className="text-sm">
                                    {recentVisits.map(v => renderVisitRow(v, true))}
                                </div>
                            </>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    )

    return (
        <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
            <div className="flex flex-col gap-1 flex-shrink-0">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
                <p className="text-muted-foreground text-sm">Walk-in registration and today&apos;s appointments.</p>
            </div>

            <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
                <div className="mb-4">
                    <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="visits">All Visits</TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="overview" className="flex-1 overflow-hidden m-0">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
                        {/* Left 2/3: Walk-in form */}
                        <div className="lg:col-span-2 h-full overflow-hidden">
                            <WalkInForm onSuccess={fetchVisits} />
                        </div>
                        {/* Right 1/3: Today's list */}
                        <div className="lg:col-span-1 h-full flex flex-col gap-6 pr-1 overflow-hidden">
                            {renderTodaysList()}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="visits" className="h-[calc(100%-40px)] m-0">
                    <VisitsTab visits={visits} loading={loading} onRefresh={fetchVisits} />
                </TabsContent>
            </Tabs>

            <EditVisitDialog
                open={editVisitOpen}
                onOpenChange={setEditVisitOpen}
                visit={selectedVisit}
                onSuccess={fetchVisits}
            />
        </div>
    )
}
