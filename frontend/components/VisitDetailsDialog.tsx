"use client"

import { useState, useEffect } from "react"
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import { api, type Visit, API_BASE_URL } from "@/lib/api"
import { formatVisitFee } from "@/lib/utils"
import { Loader2, AlertCircle, Image as ImageIcon, FileText, Maximize2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ImagePreviewDialog } from "@/components/ImagePreviewDialog"
import { PrintInvoiceDialog } from "@/components/PrintInvoiceDialog"
import { useSettings } from "@/lib/settings_context"
import { useAuth } from "@/lib/auth_context"

interface VisitDetailsDialogProps {
    visit: Visit | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

// Matches only the date portion of an ISO timestamp ("...T...") or a
// "YYYY-MM-DD HH:MM" billing-history string against a plain "YYYY-MM-DD" date.
function sameDay(dateStr: string | null | undefined, visitDate: string) {
    if (!dateStr) return false
    return dateStr.split(/[T ]/)[0] === visitDate
}

// Builds the Date from explicit y/m/d components (not by parsing the
// "YYYY-MM-DD" string directly) so the browser's local timezone can't shift
// it a day off when rendering.
function formatVisitDate(dateStr: string) {
    const [y, m, d] = dateStr.split('-').map(Number)
    if (!y || !m || !d) return dateStr
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function VisitDetailsDialog({ visit, open, onOpenChange }: VisitDetailsDialogProps) {
    const [loading, setLoading] = useState(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [images, setImages] = useState<any[]>([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [bills, setBills] = useState<any[]>([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [lightboxState, setLightboxState] = useState<{ image: any; context: any[] } | null>(null)
    const [invoiceId, setInvoiceId] = useState<string | null>(null)
    const [invoiceOpen, setInvoiceOpen] = useState(false)
    const [invoicePhotos, setInvoicePhotos] = useState<any[]>([]) // eslint-disable-line @typescript-eslint/no-explicit-any
    const { clinicName, clinicAddress, clinicPhone, referenceDoctor } = useSettings()
    const { role } = useAuth()

    useEffect(() => {
        if (open && visit) {
            loadData()
        }
    }, [open, visit]) // eslint-disable-line react-hooks/exhaustive-deps

    const loadData = async () => {
        if (!visit) return
        setLoading(true)
        try {
            const [imagesRaw, billsRaw] = await Promise.all([
                api.getPatientImages(visit.patient_id),
                api.getPatientBillingHistory(visit.patient_id),
            ])

            // Images/bills aren't reliably linked to a specific visit_id yet, so
            // scope by same calendar day as the visit — same convention already
            // used by PatientDetailsView's timeline grouping.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let dayImages = imagesRaw.filter((img: any) => sameDay(img.timestamp, visit.visit_date))
            // Clinic (frontdesk) view only ever sees Prescription-tagged images
            if (role !== 'doctor' && role !== 'admin') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                dayImages = dayImages.filter((img: any) => img.tag === 'Prescription')
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dayBills = billsRaw.filter((b: any) => sameDay(b.date, visit.visit_date))

            setImages(dayImages)
            setBills(dayBills)
        } catch (err) {
            console.error("Failed to load visit details", err)
        } finally {
            setLoading(false)
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getImageUrl = (img: any) => `${API_BASE_URL}/api/patients/images/${img.id}/file`

    if (!visit) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
                <div className="p-6 pr-12 border-b shrink-0">
                    <div className="min-w-0">
                        <DialogTitle className="text-xl font-bold truncate">{visit.patient_name}</DialogTitle>
                        <DialogDescription className="sr-only">Visit details including images and billing.</DialogDescription>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground mt-1 items-center">
                            <Badge variant="outline" className="capitalize">{visit.status}</Badge>
                            <span>{formatVisitDate(visit.visit_date)}</span>
                            {visit.visit_time && <span>{visit.visit_time.substring(0, 5)}</span>}
                            {visit.phone_number && <span>{visit.phone_number}</span>}
                            {typeof visit.visiting_fee === 'number' && (
                                <span>
                                    Fee: {formatVisitFee(visit.visiting_fee)}
                                    {!!visit.refund_amount && (
                                        <span className="text-red-600 dark:text-red-400">/₹{visit.refund_amount}</span>
                                    )}
                                </span>
                            )}
                            {visit.reason && <span className="italic truncate max-w-[220px]">{visit.reason}</span>}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-muted/10">
                    {loading ? (
                        <div className="h-full flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : images.length === 0 && bills.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border-2 border-dashed rounded-lg bg-background/50">
                            <AlertCircle className="h-10 w-10 mb-2 opacity-50" />
                            <p>No images or bills for this visit.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {images.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                                        <ImageIcon className="h-3 w-3" /> Images
                                    </h4>
                                    <div className="grid grid-cols-4 gap-2">
                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                        {images.map((img: any) => (
                                            <div
                                                key={img.id}
                                                className="aspect-square bg-black/5 rounded-md overflow-hidden border cursor-pointer hover:ring-2 ring-primary/50 transition-all relative group"
                                                onClick={() => setLightboxState({ image: img, context: images })}
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
                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Maximize2 className="h-4 w-4 text-white" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {bills.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                                        <FileText className="h-3 w-3" /> Billing
                                    </h4>
                                    <div className="space-y-2">
                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                        {bills.map((bill: any) => (
                                            <div
                                                key={bill.invoice_id}
                                                className="bg-card border rounded-md p-3 text-sm flex justify-between items-center shadow-sm cursor-pointer hover:bg-muted/50 hover:border-primary/40 transition-colors"
                                                onClick={() => { setInvoiceId(bill.invoice_id); setInvoicePhotos(images); setInvoiceOpen(true) }}
                                            >
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
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const idx = context.findIndex((i: any) => i.id === image.id)
                        if (dir === 'next' && idx < context.length - 1) setLightboxState({ image: context[idx + 1], context })
                        if (dir === 'prev' && idx > 0) setLightboxState({ image: context[idx - 1], context })
                    }}
                    onSave={async (img, notes, tag) => {
                        await api.updatePatientImage(img.id, { notes, tag })
                        loadData()
                    }}
                    onDelete={async (img) => {
                        await api.deletePatientImage(img.id)
                        loadData()
                    }}
                    fullScreen={true}
                />

                <PrintInvoiceDialog
                    open={invoiceOpen}
                    onOpenChange={(v) => { setInvoiceOpen(v); if (!v) { setInvoiceId(null); setInvoicePhotos([]) } }}
                    invoiceId={invoiceId}
                    clinicName={clinicName}
                    clinicAddress={clinicAddress}
                    clinicPhone={clinicPhone}
                    clinicLicense="TG/WLU/2025-140763"
                    referenceDoctor={referenceDoctor}
                    photos={invoicePhotos}
                />
            </DialogContent>
        </Dialog>
    )
}
