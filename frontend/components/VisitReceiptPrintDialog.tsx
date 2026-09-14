"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { VisitFeeReceipt } from "@/components/VisitFeeReceipt"
import { printElement } from "@/components/PrintInvoiceDialog"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, Printer } from "lucide-react"
import { toast } from "sonner"

interface VisitReceiptData {
    patient: { name: string; phone_number: string; age?: number | null; sex?: string | null }
    invoiceId: string
    amount: number
    paymentMode: string | null
    date: Date
}

interface VisitReceiptPrintDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    visitId: string | null
    clinicName: string
    clinicAddress: string
    clinicPhone: string
    clinicLicense?: string
    consultantName?: string
}

export function VisitReceiptPrintDialog({
    open,
    onOpenChange,
    visitId,
    clinicName,
    clinicAddress,
    clinicPhone,
    clinicLicense = "",
    consultantName = "",
}: VisitReceiptPrintDialogProps) {
    const [loading, setLoading] = useState(false)
    const [receipt, setReceipt] = useState<VisitReceiptData | null>(null)

    useEffect(() => {
        if (!open || !visitId) {
            setReceipt(null)
            return
        }

        async function fetchData() {
            setLoading(true)
            try {
                const data = await api.getVisitFeeReceipt(visitId as string)
                setReceipt({
                    patient: {
                        name: data.patient_name,
                        phone_number: data.phone_number ?? "",
                        age: data.age ?? null,
                        sex: data.sex ?? null,
                    },
                    invoiceId: data.invoice_id,
                    amount: data.amount,
                    paymentMode: data.payment_mode ?? null,
                    date: data.visit_date
                        ? new Date(`${data.visit_date}T${data.visit_time || '00:00'}:00`)
                        : new Date(),
                })
            } catch (e) {
                console.error(e)
                toast.error("Failed to load visit receipt")
                onOpenChange(false)
            } finally {
                setLoading(false)
            }
        }

        fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, visitId])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Visit Receipt Preview</DialogTitle>
                </DialogHeader>

                {loading && (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                )}

                {!loading && receipt && (
                    // Same reasoning as PrintInvoiceDialog.tsx: padding/border live on
                    // this outer wrapper, not on VisitFeeReceipt itself, which stays
                    // width-constrained to 75mm to match the real print output exactly.
                    <div className="flex justify-center p-3 bg-white border rounded-md">
                        <VisitFeeReceipt
                            clinicName={clinicName}
                            clinicAddress={clinicAddress}
                            clinicPhone={clinicPhone}
                            clinicLicense={clinicLicense}
                            consultantName={consultantName}
                            patient={receipt.patient}
                            invoiceId={receipt.invoiceId}
                            amount={receipt.amount}
                            paymentMode={receipt.paymentMode}
                            date={receipt.date}
                            className="text-black"
                        />
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    <Button
                        disabled={loading || !receipt}
                        onClick={() => printElement("visit-receipt-print-region")}
                    >
                        <Printer className="h-4 w-4 mr-2" />
                        Print
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
