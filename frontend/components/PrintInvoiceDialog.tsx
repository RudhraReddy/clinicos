"use client"

import { useEffect, useState } from "react"
import { api, type Patient } from "@/lib/api"
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
    batch_number: string
    qty: number
    mrp: number
    [key: string]: unknown
}

interface PrintInvoiceData {
    patient: Patient
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
}

function printElement(elementId: string) {
    const el = document.getElementById(elementId)
    if (!el) return
    const win = window.open('', '_blank', 'width=800,height=700')
    if (!win) return
    win.document.write(`<html><head><title>Invoice</title>
    <style>body{font-family:sans-serif;margin:0;padding:0}</style>
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
                const patient: Patient = {
                    patient_id: data.patient.id,
                    name: data.patient.name,
                    phone_number: data.patient.phone,
                }
                const billItems: PrintBillItem[] = data.items.map((i: {
                    item_name: string
                    batch_number: string
                    quantity: number
                    mrp: number
                }) => ({
                    item_name: i.item_name,
                    batch_number: i.batch_number,
                    qty: i.quantity,
                    mrp: i.mrp,
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
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
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
                        patient={invoiceData.patient}
                        billItems={invoiceData.billItems}
                        invoiceId={invoiceData.invoiceId}
                        total={invoiceData.total}
                        date={invoiceData.date}
                        className="bg-white p-8 text-black"
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
