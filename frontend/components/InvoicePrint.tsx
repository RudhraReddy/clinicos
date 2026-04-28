import { type BillItem } from "@/app/billing/page" // We might need to share this type or import carefully
import { type Patient } from "@/lib/api"
import { format } from "date-fns"

interface InvoicePrintProps {
    clinicName: string
    clinicAddress: string
    clinicPhone: string
    patient: Patient | null
    billItems: any[] // Using any to avoid circular dependency issues if types aren't shared well. Ideally use BillItem type.
    invoiceId?: string
    total: number
    date?: Date
}

export function InvoicePrint({
    clinicName = "MediCare Clinic",
    clinicAddress = "123 Health St, Medical District, City",
    clinicPhone = "+91 98765 43210",
    patient,
    billItems,
    invoiceId,
    total,
    date = new Date()
}: InvoicePrintProps) {
    if (!patient || billItems.length === 0) return null

    return (
        <div className="hidden print:block print-only bg-white p-8 text-black">
            {/* Header */}
            <div className="border-b-2 border-black pb-4 mb-6">
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-3xl font-bold uppercase tracking-wider">{clinicName}</h1>
                        <p className="text-sm mt-1 text-gray-600 max-w-[250px]">{clinicAddress}</p>
                        <p className="text-sm text-gray-600">Tel: {clinicPhone}</p>
                    </div>
                    <div className="text-right">
                        <h2 className="text-2xl font-semibold text-gray-800">INVOICE</h2>
                        <p className="text-sm font-medium mt-1">Invoice #: {invoiceId || "DRAFT"}</p>
                        <p className="text-sm text-gray-600">Date: {format(date, "dd MMM yyyy")}</p>
                    </div>
                </div>
            </div>

            {/* Patient Info */}
            <div className="mb-8 border p-4 rounded-sm">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <span className="text-xs uppercase text-gray-500 font-bold block mb-1">Bill To:</span>
                        <p className="font-bold text-lg">{patient.name}</p>
                        <p className="text-sm">{patient.phone_number}</p>
                        <p className="text-sm">ID: {patient.patient_id}</p>
                    </div>
                    {/* Could add Doctor info here if available */}
                </div>
            </div>

            {/* Table */}
            <table className="w-full text-left text-sm mb-6">
                <thead>
                    <tr className="border-b-2 border-black">
                        <th className="py-2 w-[50px]">#</th>
                        <th className="py-2">Item / Description</th>
                        <th className="py-2 w-[100px] text-right">Qty</th>
                        <th className="py-2 w-[100px] text-right">Price</th>
                        <th className="py-2 w-[100px] text-right">Total</th>
                    </tr>
                </thead>
                <tbody>
                    {billItems.map((item, idx) => (
                        <tr key={idx} className="border-b border-gray-200">
                            <td className="py-3 text-gray-500">{idx + 1}</td>
                            <td className="py-3 font-medium">
                                {item.item_name}
                                {item.batch_number && item.batch_number !== "Auto-FIFO" && (
                                    <span className="block text-xs text-gray-500">Batch: {item.batch_number}</span>
                                )}
                            </td>
                            <td className="py-3 text-right">{item.qty}</td>
                            <td className="py-3 text-right">{item.mrp?.toFixed(2)}</td>
                            <td className="py-3 text-right font-bold">{(item.qty * (item.mrp || 0)).toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Totals */}
            <div className="flex justify-end mb-12">
                <div className="w-[250px]">
                    <div className="flex justify-between py-2 border-b">
                        <span className="font-medium">Subtotal</span>
                        <span>{total.toFixed(2)}</span>
                    </div>
                    {/* Tax logic if needed */}
                    <div className="flex justify-between py-2 border-b-2 border-black text-xl font-bold bg-gray-50">
                        <span>Grand Total</span>
                        <span>₹ {total.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="fixed bottom-10 left-8 right-8 text-center text-xs text-gray-400">
                <p>Thank you for visiting {clinicName}. get well soon!</p>
                <div className="mt-4 border-t pt-4 flex justify-between">
                    <span>Authorized Signature</span>
                    <span>Patient Signature</span>
                </div>
            </div>
        </div>
    )
}
