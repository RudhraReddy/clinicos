import { format } from "date-fns"

interface BillItem {
    item_name: string
    qty: number
    mrp: number
    hsn_code?: string | null
    manufacturer?: string | null
    batch_number?: string | null
    expiry_date?: string | null  // YYYY-MM-DD
    gst_rate?: number | null
}

interface InvoicePrintProps {
    clinicName: string
    clinicAddress: string
    clinicPhone: string
    clinicLicense?: string
    patient: {
        name: string
        phone_number: string
        age?: number | null
        sex?: string | null
        reference?: string | null
    }
    billItems: BillItem[]
    invoiceId?: string
    total: number
    date?: Date
    referenceDoctor?: string
    className?: string
}

function formatExpiry(dateStr: string | null | undefined): string {
    if (!dateStr) return ""
    try {
        const d = new Date(dateStr)
        const mm = String(d.getMonth() + 1).padStart(2, "0")
        const yy = String(d.getFullYear()).slice(-2)
        return `${mm}/${yy}`
    } catch {
        return dateStr
    }
}

export function InvoicePrint({
    clinicName = "MediCare Clinic",
    clinicAddress = "",
    clinicPhone = "",
    clinicLicense = "",
    patient,
    billItems,
    invoiceId,
    total,
    date = new Date(),
    referenceDoctor,
    className,
}: InvoicePrintProps) {
    if (!patient || billItems.length === 0) return null

    const printTime = format(date, "HH:mm")
    const printDate = format(date, "dd/MM/yyyy")

    const cellStyle: React.CSSProperties = {
        borderLeft: "1px solid black",
        borderRight: "1px solid black",
        padding: "4px 6px",
        fontSize: "8pt",
        fontFamily: "Arial, Helvetica, sans-serif",
    }
    const headerCellStyle: React.CSSProperties = {
        ...cellStyle,
        borderTop: "1px solid black",
        borderBottom: "1px solid black",
        fontWeight: "bold",
        fontSize: "7.5pt",
        textAlign: "center",
        background: "#fff",
    }

    return (
        <div id="invoice-print-region" className={className}>
            <style>{'@page { size: A4 landscape; margin: 8mm }'}</style>

            {/* Clinic Name — centered */}
            <div style={{
                textAlign: "center",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: "16pt",
                fontWeight: "bold",
                letterSpacing: "0.5px",
                marginBottom: "6px",
            }}>
                {clinicName.toUpperCase()}
            </div>

            {/* Sub-header: address | phone | DL + time */}
            <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: "8pt",
                marginBottom: "8px",
            }}>
                <div style={{ maxWidth: "38%", lineHeight: "1.5" }}>
                    {clinicAddress}
                </div>
                <div style={{ textAlign: "center" }}>
                    {clinicPhone && `Ph. ${clinicPhone}`}
                </div>
                <div style={{ textAlign: "right", lineHeight: "1.5" }}>
                    {clinicLicense && <div>D.L.No: {clinicLicense}</div>}
                </div>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid black", margin: "4px 0 8px 0" }} />

            {/* Patient info row */}
            <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: "8.5pt",
                marginBottom: "8px",
            }}>
                <div style={{ lineHeight: "1.8" }}>
                    <div><strong>Name:</strong>&nbsp;&nbsp;{patient.name}</div>
                    {(referenceDoctor || patient.reference) && (
                        <div><strong>Ref. Doc Name:</strong>&nbsp;&nbsp;{referenceDoctor || patient.reference}</div>
                    )}
                </div>
                <div style={{ textAlign: "center" }}>
                    <strong>Ph:</strong>&nbsp;&nbsp;{patient.phone_number || ""}
                </div>
                <div style={{ textAlign: "right", lineHeight: "1.8" }}>
                    <div><strong>Invoice No. :</strong>&nbsp;{invoiceId || "DRAFT"}</div>
                    <div><strong>Date :</strong>&nbsp;{printDate}&nbsp;&nbsp;&nbsp;<strong>Time :</strong>&nbsp;{printTime}</div>
                </div>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid black", margin: "4px 0 8px 0" }} />

            {/* Items table */}
            <table style={{
                width: "100%",
                borderCollapse: "collapse",
                fontFamily: "Arial, Helvetica, sans-serif",
                marginBottom: "12px",
            }}>
                <thead>
                    <tr>
                        <th style={{ ...headerCellStyle, width: "36px" }}>S. No.</th>
                        <th style={{ ...headerCellStyle, textAlign: "left" }}>Item Name</th>
                        <th style={{ ...headerCellStyle, width: "70px" }}>HSN Code</th>
                        <th style={{ ...headerCellStyle, width: "50px" }}>MFR</th>
                        <th style={{ ...headerCellStyle, width: "70px" }}>Batch No.</th>
                        <th style={{ ...headerCellStyle, width: "46px" }}>Expiry</th>
                        <th style={{ ...headerCellStyle, width: "55px" }}>MRP</th>
                        <th style={{ ...headerCellStyle, width: "50px" }}>CGST%</th>
                        <th style={{ ...headerCellStyle, width: "50px" }}>SGST%</th>
                        <th style={{ ...headerCellStyle, width: "52px" }}>Quantity</th>
                        <th style={{ ...headerCellStyle, width: "65px" }}>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {billItems.map((item, idx) => {
                        const halfGst = item.gst_rate ? (item.gst_rate / 2).toFixed(2) + "%" : ""
                        const amount = (item.qty * item.mrp).toFixed(2)
                        return (
                            <tr key={idx}>
                                <td style={{ ...cellStyle, textAlign: "center" }}>{idx + 1}</td>
                                <td style={{ ...cellStyle }}>{item.item_name}</td>
                                <td style={{ ...cellStyle, textAlign: "center" }}>{item.hsn_code || ""}</td>
                                <td style={{ ...cellStyle, textAlign: "center" }}>{item.manufacturer || ""}</td>
                                <td style={{ ...cellStyle, textAlign: "center" }}>{item.batch_number || ""}</td>
                                <td style={{ ...cellStyle, textAlign: "center" }}>{formatExpiry(item.expiry_date)}</td>
                                <td style={{ ...cellStyle, textAlign: "right" }}>{item.mrp.toFixed(2)}</td>
                                <td style={{ ...cellStyle, textAlign: "center" }}>{halfGst}</td>
                                <td style={{ ...cellStyle, textAlign: "center" }}>{halfGst}</td>
                                <td style={{ ...cellStyle, textAlign: "center" }}>{item.qty}</td>
                                <td style={{ ...cellStyle, textAlign: "right" }}>{amount}</td>
                            </tr>
                        )
                    })}
                    {/* Empty filler rows to pad the table (min 8 rows total) */}
                    {Array.from({ length: Math.max(0, 8 - billItems.length) }).map((_, i) => (
                        <tr key={`empty-${i}`}>
                            {Array.from({ length: 11 }).map((_, j) => (
                                <td key={j} style={{ ...cellStyle, height: "22px" }}>&nbsp;</td>
                            ))}
                        </tr>
                    ))}
                    {/* Total row */}
                    <tr>
                        <td colSpan={9} style={{
                            ...cellStyle,
                            borderTop: "1px solid black",
                            borderBottom: "1px solid black",
                            textAlign: "right",
                            fontWeight: "bold",
                            fontSize: "9pt",
                        }}>Total</td>
                        <td style={{ ...cellStyle, borderTop: "1px solid black", borderBottom: "1px solid black" }}></td>
                        <td style={{
                            ...cellStyle,
                            borderTop: "1px solid black",
                            borderBottom: "1px solid black",
                            textAlign: "right",
                            fontWeight: "bold",
                            fontSize: "9pt",
                        }}>{total.toFixed(2)}</td>
                    </tr>
                </tbody>
            </table>

            {/* Footer */}
            <div style={{
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: "7.5pt",
                color: "#333",
                lineHeight: "1.6",
            }}>
                <div>Goods once sold will not be taken back or exchanged</div>
                <div>Subject to Hanamkonda Jurisdiction</div>
            </div>
        </div>
    )
}
