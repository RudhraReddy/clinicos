"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { InvoicePrint } from "@/components/InvoicePrint"
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

interface PrintBillItem {
    item_name: string
    qty: number
    mrp: number
    hsn_code?: string | null
    manufacturer?: string | null
    batch_number?: string | null
    expiry_date?: string | null
    gst_rate?: number | null
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
}

function printElement(elementId: string) {
    const el = document.getElementById(elementId)
    if (!el) return
    const win = window.open('', '_blank', 'width=900,height=650')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><title>Invoice</title>
    <style>body{margin:0;padding:0}@page{size:A4 landscape;margin:8mm}</style>
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
}: PrintInvoiceDialogProps) {
    const [loading, setLoading] = useState(false)
    const [invoiceData, setInvoiceData] = useState<PrintInvoiceData | null>(null)

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
                const billItems: PrintBillItem[] = data.items.map((i: any) => ({
                    item_name: i.item_name,
                    qty: i.quantity,
                    mrp: i.mrp,
                    hsn_code: i.hsn_code ?? null,
                    manufacturer: i.manufacturer ?? null,
                    batch_number: i.batch_number ?? null,
                    expiry_date: i.expiry_date ?? null,
                    gst_rate: i.gst_rate ?? null,
                }))
                setInvoiceData({
                    patient,
                    billItems,
                    invoiceId: data.invoice_id,
                    total: data.total_amount,
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
            <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Invoice Preview</DialogTitle>
                </DialogHeader>

                {loading && (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                )}

                {!loading && invoiceData && (
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
                        date={invoiceData.date}
                        className="bg-white p-6 text-black"
                    />
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
        </Dialog>
    )
}
