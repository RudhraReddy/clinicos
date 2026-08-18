"use client"

import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Printer } from "lucide-react"
import { InvoicePrint } from "@/components/InvoicePrint"
import { printElement } from "@/components/PrintInvoiceDialog"

interface DraftBillItem {
    item_name: string
    qty: number
    mrp: number
    manufacturer?: string | null
    gst_rate?: number | null
    pack_size?: string | null
}

interface DraftInvoicePreviewDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    clinicName: string
    clinicAddress: string
    clinicPhone: string
    clinicLicense?: string
    referenceDoctor?: string
    patient: {
        name: string
        phone_number: string
        age?: number | null
        sex?: string | null
    }
    billItems: DraftBillItem[]
    total: number
    subtotal: number
    discountType: "percent" | "flat" | null
    discountValue: number | null
    visitRefundApplied?: number | null
    cashAmount: number
    upiAmount: number
}

// A preview of what the invoice would look like, printed from whatever is
// currently on-screen in the "New Bill" form — no invoice ID, nothing saved
// to the backend, nothing added to Billing History. Purely so a copy can be
// handed to the patient before the bill is actually finalized. Deliberately
// missing HSN/Batch/Expiry per line item: the real batch (and its expiry) is
// only decided by FIFO consumption on the backend at actual creation time,
// so there's no real value to show here yet — showing a placeholder would be
// misleading. InvoicePrint already prints "INVOICE NO : DRAFT" whenever no
// invoiceId is given, and paid is always false here since nothing has been
// paid or recorded — only a saved bill (PrintInvoiceDialog) can be "paid".
export function DraftInvoicePreviewDialog({
    open,
    onOpenChange,
    clinicName,
    clinicAddress,
    clinicPhone,
    clinicLicense,
    referenceDoctor,
    patient,
    billItems,
    total,
    subtotal,
    discountType,
    discountValue,
    visitRefundApplied = null,
    cashAmount,
    upiAmount,
}: DraftInvoicePreviewDialogProps) {
    const paymentType = cashAmount > 0 && upiAmount > 0 ? "SPLIT" : upiAmount > 0 ? "UPI" : cashAmount > 0 ? "CASH" : null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Draft Invoice Preview</DialogTitle>
                </DialogHeader>

                <div className="flex justify-center p-3 bg-white border rounded-md">
                    <InvoicePrint
                        clinicName={clinicName}
                        clinicAddress={clinicAddress}
                        clinicPhone={clinicPhone}
                        clinicLicense={clinicLicense}
                        referenceDoctor={referenceDoctor}
                        patient={patient}
                        billItems={billItems}
                        total={total}
                        subtotal={subtotal}
                        discountType={discountType}
                        discountValue={discountValue}
                        visitRefundApplied={visitRefundApplied}
                        paymentType={paymentType}
                        cashAmount={cashAmount}
                        upiAmount={upiAmount}
                        paid={false}
                        className="text-black"
                    />
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    <Button onClick={() => printElement("invoice-print-region")}>
                        <Printer className="h-4 w-4 mr-2" />
                        Print
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
