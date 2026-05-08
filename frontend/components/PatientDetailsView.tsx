"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogTrigger,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { api, Patient, API_BASE_URL, Visit } from "@/lib/api"
import { Loader2, X, AlertCircle, Image as ImageIcon, FileText, Maximize2, ChevronDown, ChevronUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ImagePreviewDialog } from "@/components/ImagePreviewDialog"
import { PrintInvoiceDialog } from "@/components/PrintInvoiceDialog"

interface PatientDetailsViewProps {
    patient: Patient
    open: boolean
    onOpenChange: (open: boolean) => void
    trigger?: React.ReactNode
    viewMode?: 'full' | 'visits-only'
}

export function PatientDetailsView({ patient, open, onOpenChange, trigger, viewMode = 'full' }: PatientDetailsViewProps) {
    const [loading, setLoading] = useState(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [timelineData, setTimelineData] = useState<any[]>([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [lightboxState, setLightboxState] = useState<{ image: any; context: any[] } | null>(null)
    const [invoiceId, setInvoiceId] = useState<string | null>(null)
    const [invoiceOpen, setInvoiceOpen] = useState(false)

    // Visit History collapsible state
    const [visitHistoryOpen, setVisitHistoryOpen] = useState(false)
    const [visits, setVisits] = useState<Visit[]>([])
    const [visitsLoading, setVisitsLoading] = useState(false)
    const [visitsLoaded, setVisitsLoaded] = useState(false)

    useEffect(() => {
        if (open && patient) {
            loadAllData()
            // Reset visit history when dialog opens with a new patient
            setVisitHistoryOpen(false)
            setVisits([])
            setVisitsLoaded(false)
        }
    }, [open, patient]) // eslint-disable-line react-hooks/exhaustive-deps

    const loadVisitHistory = async () => {
        if (visitsLoaded) return
        setVisitsLoading(true)
        try {
            const data = await api.getVisits(patient.patient_id)
            setVisits(data)
            setVisitsLoaded(true)
        } catch (err) {
            console.error("Failed to load visit history", err)
        } finally {
            setVisitsLoading(false)
        }
    }

    const toggleVisitHistory = () => {
        const next = !visitHistoryOpen
        setVisitHistoryOpen(next)
        if (next) {
            loadVisitHistory()
        }
    }

    const loadAllData = async () => {
        setLoading(true)
        try {
            const [visitsData, imagesData, billsData] = await Promise.all([
                api.getVisits(patient.patient_id),
                viewMode === 'full' ? api.getPatientImages(patient.patient_id) : Promise.resolve([]),
                viewMode === 'full' ? api.getPatientBillingHistory(patient.patient_id) : Promise.resolve([])
            ])

            // Group everything by Date (YYYY-MM-DD)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const groupedByDate: Record<string, { date: string, visits: any[], images: any[], bills: any[] }> = {}

            // Helper to ensure date group exists
            const getOrCreateGroup = (dateStr: string) => {
                const dateKey = dateStr.split('T')[0] // Handle ISO strings if present
                if (!groupedByDate[dateKey]) {
                    groupedByDate[dateKey] = {
                        date: dateKey,
                        visits: [],
                        images: [],
                        bills: []
                    }
                }
                return groupedByDate[dateKey]
            }

            // 1. Process Visits
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            visitsData.forEach((visit: any) => {
                // Ensure date is valid, fallback to created_at or today if missing
                const date = visit.visit_date || visit.created_at || new Date().toISOString().split('T')[0]
                const group = getOrCreateGroup(date)
                group.visits.push(visit)
            })

            // 2. Process Images
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            imagesData.forEach((img: any) => {
                // Should use image timestamp for date
                const date = img.timestamp ? img.timestamp.split('T')[0] : new Date().toISOString().split('T')[0]
                const group = getOrCreateGroup(date)

                // Avoid duplicates if we were to link by visit_id AND date (though here we just put them in the date bucket)
                // If we wanted to nest them under visits, we'd need a more complex structure.
                // For now, "Timeline Row" requests flattening per date.
                group.images.push(img)
            })

            // 3. Process Bills
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            billsData.forEach((bill: any) => {
                const date = bill.date ? bill.date.split(' ')[0] : new Date().toISOString().split('T')[0]
                const group = getOrCreateGroup(date)
                group.bills.push(bill)
            })

            // Convert to array and sort descending by date
            const sortedTimeline = Object.values(groupedByDate).sort((a, b) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime()
            })

            setTimelineData(sortedTimeline)

        } catch (err) {
            console.error("Failed to load patient data", err)
        } finally {
            setLoading(false)
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getImageUrl = (img: any) => {
        return `${API_BASE_URL}/api/patients/images/${img.id}/file`
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
            <DialogContent className="max-w-[95vw] h-[95vh] flex flex-col p-0 gap-0">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b shrink-0 bg-background z-10">
                    <div className="flex-1">
                        <DialogTitle className="text-2xl font-bold">{patient.name}</DialogTitle>
                        <DialogDescription className="sr-only">Detailed view of patient history including visits, images, and billing.</DialogDescription>
                        <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                            <span>ID: <span className="font-mono text-foreground">{patient.patient_id}</span></span>
                            <span>Phone: <span className="text-foreground">{patient.phone_number}</span></span>
                            {patient.age && <span>Age: <span className="text-foreground">{patient.age}</span></span>}
                            {patient.sex && <span>Sex: <span className="text-foreground">{patient.sex}</span></span>}
                            {patient.created_at && <span>Joined: <span className="text-foreground">{new Date(patient.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span></span>}
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                {/* Content - Scrollable */}
                <div className="flex-1 overflow-y-auto p-6 bg-muted/10">
                    {/* Visit History collapsible section */}
                    <div className="max-w-5xl mx-auto mb-6">
                        <button
                            onClick={toggleVisitHistory}
                            className="w-full flex items-center justify-between px-4 py-3 bg-card border rounded-lg text-sm font-medium hover:bg-muted/50 transition-colors"
                        >
                            <span className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                Visit History
                            </span>
                            {visitHistoryOpen ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                        </button>

                        {visitHistoryOpen && (
                            <div className="mt-2 bg-card border rounded-lg overflow-hidden">
                                {visitsLoading ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                    </div>
                                ) : visits.length === 0 ? (
                                    <div className="py-8 text-center text-sm text-muted-foreground">
                                        No visits yet.
                                    </div>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Reason</TableHead>
                                                <TableHead>Payment Status</TableHead>
                                                <TableHead className="text-right">Amount Paid</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {visits.map((visit) => (
                                                <TableRow key={visit.visit_id}>
                                                    <TableCell className="text-sm">
                                                        {visit.visit_date
                                                            ? new Date(visit.visit_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                                                            : "—"}
                                                    </TableCell>
                                                    <TableCell className="text-sm">{visit.reason || "—"}</TableCell>
                                                    <TableCell>
                                                        <Badge
                                                            variant="outline"
                                                            className={
                                                                visit.payment_status === "full"
                                                                    ? "border-green-500 text-green-600"
                                                                    : visit.payment_status === "partial"
                                                                    ? "border-yellow-500 text-yellow-600"
                                                                    : "border-muted-foreground text-muted-foreground"
                                                            }
                                                        >
                                                            {visit.payment_status ?? "unpaid"}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right text-sm">
                                                        {visit.amount_paid != null ? `₹${visit.amount_paid.toFixed(2)}` : "—"}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </div>
                        )}
                    </div>

                    {loading ? (
                        <div className="h-full flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="max-w-5xl mx-auto space-y-0">
                            {timelineData.length === 0 ? (
                                <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border-2 border-dashed rounded-lg bg-background/50">
                                    <AlertCircle className="h-10 w-10 mb-2 opacity-50" />
                                    <p>No history found for this patient.</p>
                                </div>
                            ) : (
                                <>
                                    {/* Timeline Loop */}
                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                    {timelineData.map((group: any) => (
                                        <div key={group.date} className="flex gap-6 group">
                                            {/* Left: Date */}
                                            <div className="w-24 text-right pt-1 shrink-0">
                                                <div className="font-bold text-foreground">
                                                    {new Date(group.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {new Date(group.date).getFullYear()}
                                                </div>
                                            </div>

                                            {/* Center: Timeline Line */}
                                            <div className="flex flex-col items-center shrink-0 relative">
                                                <div className={`w-3 h-3 rounded-full border-2 z-10 ${group.visits.length > 0 ? 'bg-primary border-primary' : 'bg-background border-muted-foreground'
                                                    }`} />
                                                <div className="w-px bg-border flex-1 -my-1 group-last:hidden" />
                                            </div>

                                            {/* Right: Content */}
                                            <div className="flex-1 pb-12 pt-0.5 min-w-0">
                                                {/* Visits Section */}
                                                {group.visits.length > 0 && (
                                                    <div className="mb-6 space-y-4">
                                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                        {group.visits.map((visit: any) => (
                                                            <div key={visit.visit_id} className="flex items-center gap-2">
                                                                <span className="font-semibold text-lg">{visit.reason || "Visit"}</span>
                                                                <Badge variant="outline" className="text-[10px] h-5">{visit.status}</Badge>
                                                                <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                                                                    {visit.visit_time?.substring(0, 5)}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                    {/* Images Column */}
                                                    {group.images.length > 0 && (
                                                        <div className="space-y-2">
                                                            <h4 className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                                                                <ImageIcon className="h-3 w-3" /> Images
                                                            </h4>
                                                            <div className="grid grid-cols-4 gap-2">
                                                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                                {group.images.map((img: any) => (
                                                                    <div
                                                                        key={img.id}
                                                                        className="aspect-square bg-black/5 rounded-md overflow-hidden border cursor-pointer hover:ring-2 ring-primary/50 transition-all relative group/img"
                                                                        onClick={() => setLightboxState({ image: img, context: group.images })}
                                                                    >
                                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                        <img
                                                                            src={getImageUrl(img)}
                                                                            alt="Thumbnail"
                                                                            className="w-full h-full object-cover"
                                                                            loading="lazy"
                                                                            onError={(e) => {
                                                                                (e.target as HTMLImageElement).style.display = 'none'
                                                                            }}
                                                                        />
                                                                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">
                                                                            <Maximize2 className="h-4 w-4 text-white" />
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Billing Column */}
                                                    {group.bills.length > 0 && (
                                                        <div className="space-y-2">
                                                            <h4 className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                                                                <FileText className="h-3 w-3" /> Billing
                                                            </h4>
                                                            <div className="space-y-2">
                                                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                                {group.bills.map((bill: any) => (
                                                                    <div key={bill.invoice_id} className="bg-card border rounded-md p-3 text-sm flex justify-between items-center shadow-sm cursor-pointer hover:bg-muted/50 hover:border-primary/40 transition-colors" onClick={() => { setInvoiceId(bill.invoice_id); setInvoiceOpen(true) }}>
                                                                        <div>
                                                                            <div className="font-mono text-xs text-muted-foreground">{bill.invoice_id}</div>
                                                                            <div className="font-medium">{bill.payment_type}</div>
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <div className="font-bold">₹{bill.total_amount.toFixed(2)}</div>
                                                                            <div className="text-xs text-muted-foreground">
                                                                                {bill.date.includes(' ') ? bill.date.split(' ')[1] : ''}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </div>

                <ImagePreviewDialog
                    image={lightboxState?.image}
                    isOpen={!!lightboxState}
                    onClose={() => setLightboxState(null)}
                    allImages={lightboxState?.context ?? []}
                    onNavigate={(dir) => {
                        if (!lightboxState) return
                        const { image, context } = lightboxState
                        const idx = context.findIndex((i: any) => i.id === image.id)
                        if (dir === 'next' && idx < context.length - 1) setLightboxState({ image: context[idx + 1], context })
                        if (dir === 'prev' && idx > 0) setLightboxState({ image: context[idx - 1], context })
                    }}
                    onSave={async (img, notes, tag) => {
                        await api.updatePatientImage(img.id, { notes, tag })
                        loadAllData()
                    }}
                    onDelete={async (img) => {
                        await api.deletePatientImage(img.id)
                        loadAllData()
                    }}
                    fullScreen={true}
                />

                <PrintInvoiceDialog
                    open={invoiceOpen}
                    onOpenChange={(v) => { setInvoiceOpen(v); if (!v) setInvoiceId(null) }}
                    invoiceId={invoiceId}
                    clinicName="MediCare Clinic"
                    clinicAddress=""
                    clinicPhone=""
                    clinicLicense=""
                />
            </DialogContent>
        </Dialog>
    )
}
