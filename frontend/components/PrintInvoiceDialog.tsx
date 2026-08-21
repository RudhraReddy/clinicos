"use client"

import { useEffect, useState } from "react"
import { api, API_BASE_URL } from "@/lib/api"
import { InvoicePrint } from "@/components/InvoicePrint"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, Printer, Image as ImageIcon, Maximize2 } from "lucide-react"
import { toast } from "sonner"
import { ImagePreviewDialog } from "@/components/ImagePreviewDialog"

interface PrintBillItem {
    item_name: string
    qty: number
    mrp: number
    hsn_code?: string | null
    manufacturer?: string | null
    batch_number?: string | null
    expiry_date?: string | null
    gst_rate?: number | null
    unit?: string | null
    pack_size?: string | null
}

interface PrintInvoicePatient {
    name: string
    phone_number: string
    age?: number | null
    sex?: string | null
    reference?: string | null
}

interface PrintInvoiceData {
    patient: PrintInvoicePatient
    billItems: PrintBillItem[]
    invoiceId: string
    total: number
    subtotal: number
    discountType: "percent" | "flat" | null
    discountValue: number | null
    visitRefundApplied: number | null
    paymentType: string | null
    cashAmount: number | null
    upiAmount: number | null
    paid: boolean
    date: Date
}

interface PrintInvoiceDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    invoiceId: string | null
    clinicName: string
    clinicAddress: string
    clinicPhone: string
    clinicLicense?: string
    referenceDoctor?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    photos?: any[]
}

export function printElement(elementId: string) {
    const el = document.getElementById(elementId)
    if (!el) return
    const win = window.open('', '_blank', 'width=380,height=700')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><title>Invoice</title>
    <style>body{margin:0;padding:0}@page{size:80mm auto;margin:2.5mm}</style>
    </head><body>${el.innerHTML}</body></html>`)
    win.document.close()
    win.focus()
    win.print()
    win.close()
}

export function PrintInvoiceDialog({
    open,
    onOpenChange,
    invoiceId,
    clinicName,
    clinicAddress,
    clinicPhone,
    clinicLicense = "",
    referenceDoctor = "",
    photos = [],
}: PrintInvoiceDialogProps) {
    const [loading, setLoading] = useState(false)
    const [invoiceData, setInvoiceData] = useState<PrintInvoiceData | null>(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [lightboxImg, setLightboxImg] = useState<any>(null)

    useEffect(() => {
        if (!open || !invoiceId) {
            setInvoiceData(null)
            return
        }

        async function fetchData() {
            setLoading(true)
            try {
                const data = await api.getBillDetails(invoiceId as string)
                const patient: PrintInvoicePatient = {
                    name: data.patient.name,
                    phone_number: data.patient.phone,
                    age: data.patient.age ?? null,
                    sex: data.patient.sex ?? null,
                    reference: data.patient.reference ?? null,
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const billItems: PrintBillItem[] = data.items.map((i: any) => {
                    const parts = (i.batch_number || "").split('|')
                    const cleanBatch = parts[0]
                    const unit = parts[1] || 'ea'
                    return {
                        item_name: i.item_name,
                        qty: i.quantity,
                        mrp: i.mrp,
                        hsn_code: i.hsn_code ?? null,
                        manufacturer: i.manufacturer ?? null,
                        batch_number: cleanBatch,
                        expiry_date: i.expiry_date ?? null,
                        gst_rate: i.gst_rate ?? null,
                        unit: unit,
                        pack_size: i.pack_size ?? null,
                    }
                })
                setInvoiceData({
                    patient,
                    billItems,
                    invoiceId: data.invoice_id,
                    total: data.total_amount,
                    subtotal: data.subtotal_amount ?? data.total_amount,
                    discountType: data.discount_type ?? null,
                    discountValue: data.discount_value ?? null,
                    visitRefundApplied: data.visit_refund_applied ?? null,
                    paymentType: data.payment_type ?? null,
                    cashAmount: data.cash_amount ?? null,
                    upiAmount: data.upi_amount ?? null,
                    // A saved bill was only ever creatable once Cash+UPI matched the
                    // total (±₹1 tolerance) — computed rather than hardcoded true so
                    // this stays correct if that validation ever loosens.
                    paid: (data.cash_amount ?? 0) + (data.upi_amount ?? 0) >= data.total_amount - 1,
                    date: new Date(data.created_at),
                })
            } catch (e) {
                console.error(e)
                toast.error("Failed to load invoice for printing")
                onOpenChange(false)
            } finally {
                setLoading(false)
            }
        }

        fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, invoiceId])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Invoice Preview</DialogTitle>
                </DialogHeader>

                {loading && (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                )}

                {!loading && invoiceData && (
                    // The padding/border live on this OUTER wrapper, not on InvoicePrint itself —
                    // InvoicePrint's own element is width-constrained to 75mm to match the real
                    // print output exactly; adding padding directly to it (as className) would
                    // shrink its usable content width in this preview only, making the preview
                    // wrap text that the actual print (which copies just its innerHTML, without
                    // this dialog's styling) would not.
                    <div className="flex justify-center p-3 bg-white border rounded-md">
                        <InvoicePrint
                            clinicName={clinicName}
                            clinicAddress={clinicAddress}
                            clinicPhone={clinicPhone}
                            clinicLicense={clinicLicense}
                            referenceDoctor={referenceDoctor}
                            patient={invoiceData.patient}
                            billItems={invoiceData.billItems}
                            invoiceId={invoiceData.invoiceId}
                            total={invoiceData.total}
                            subtotal={invoiceData.subtotal}
                            discountType={invoiceData.discountType}
                            discountValue={invoiceData.discountValue}
                            visitRefundApplied={invoiceData.visitRefundApplied}
                            paymentType={invoiceData.paymentType}
                            cashAmount={invoiceData.cashAmount}
                            upiAmount={invoiceData.upiAmount}
                            paid={invoiceData.paid}
                            date={invoiceData.date}
                            className="text-black"
                        />
                    </div>
                )}

                {!loading && invoiceData && photos.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                            <ImageIcon className="h-3 w-3" /> Visit Photos
                        </h4>
                        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                            {photos.map((img) => (
                                <div
                                    key={img.id}
                                    className="aspect-square bg-black/5 rounded-md overflow-hidden border cursor-pointer hover:ring-2 ring-primary/50 transition-all relative group"
                                    onClick={() => setLightboxImg(img)}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={`${API_BASE_URL}/api/patients/images/${img.id}/file`}
                                        alt="Visit"
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                    />
                                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Maximize2 className="h-4 w-4 text-white" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    <Button
                        disabled={loading || !invoiceData}
                        onClick={() => printElement("invoice-print-region")}
                    >
                        <Printer className="h-4 w-4 mr-2" />
                        Print
                    </Button>
                </DialogFooter>
            </DialogContent>

            <ImagePreviewDialog
                image={lightboxImg}
                isOpen={!!lightboxImg}
                onClose={() => setLightboxImg(null)}
                allImages={photos}
                onNavigate={(dir) => {
                    if (!lightboxImg) return
                    const idx = photos.findIndex((i) => i.id === lightboxImg.id)
                    if (dir === 'next' && idx < photos.length - 1) setLightboxImg(photos[idx + 1])
                    if (dir === 'prev' && idx > 0) setLightboxImg(photos[idx - 1])
                }}
                fullScreen={true}
            />
        </Dialog>
    )
}
