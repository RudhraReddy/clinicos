import { format } from "date-fns"

interface InvoicePrintProps {
    clinicName: string
    clinicAddress: string
    clinicPhone: string
    patient: {
        name: string
        phone_number: string
        age?: number | null
        sex?: string | null
    }
    billItems: { item_name: string; qty: number; mrp: number }[]
    invoiceId?: string
    total: number
    date?: Date
    className?: string
}

export function InvoicePrint({
    clinicName = "MediCare Clinic",
    clinicAddress = "123 Health St, Medical District, City",
    clinicPhone = "+91 98765 43210",
    patient,
    billItems,
    invoiceId,
    total,
    date = new Date(),
    className,
}: InvoicePrintProps) {
    if (!patient || billItems.length === 0) return null

    return (
        <div id="invoice-print-region" className={className}>
            <style>{'@page { size: A5 portrait; margin: 8mm }'}</style>

            {/* Header */}
            <div style={{
                borderBottom: "2px solid black",
                paddingBottom: "10px",
                marginBottom: "12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
            }}>
                <div>
                    <div style={{
                        fontFamily: "Georgia, 'Times New Roman', serif",
                        fontSize: "16pt",
                        fontWeight: "bold",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: "#000",
                    }}>
                        {clinicName}
                    </div>
                    <div style={{
                        fontFamily: "Georgia, 'Times New Roman', serif",
                        fontSize: "7.5pt",
                        color: "#444",
                        marginTop: "3px",
                        maxWidth: "220px",
                        lineHeight: "1.4",
                    }}>
                        {clinicAddress}
                    </div>
                    <div style={{
                        fontFamily: "Georgia, 'Times New Roman', serif",
                        fontSize: "7.5pt",
                        color: "#444",
                        marginTop: "2px",
                    }}>
                        Tel: {clinicPhone}
                    </div>
                </div>
                <div style={{ textAlign: "right" }}>
                    <div style={{
                        fontFamily: "Georgia, 'Times New Roman', serif",
                        fontSize: "14pt",
                        fontWeight: "bold",
                        color: "#000",
                        letterSpacing: "1px",
                    }}>
                        INVOICE
                    </div>
                    <div style={{
                        fontFamily: "Arial, Helvetica, sans-serif",
                        fontSize: "7.5pt",
                        color: "#333",
                        marginTop: "3px",
                    }}>
                        {invoiceId || "DRAFT"}
                    </div>
                    <div style={{
                        fontFamily: "Arial, Helvetica, sans-serif",
                        fontSize: "7.5pt",
                        color: "#555",
                        marginTop: "2px",
                    }}>
                        {format(date, "dd MMM yyyy")}
                    </div>
                </div>
            </div>

            {/* Patient Row */}
            <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                borderBottom: "1px solid #ccc",
                paddingBottom: "7px",
                marginBottom: "12px",
                fontFamily: "Arial, Helvetica, sans-serif",
            }}>
                <div style={{ fontWeight: "bold", fontSize: "9.5pt", color: "#000" }}>
                    {patient.name}
                </div>
                {patient.phone_number && (
                    <div style={{ fontSize: "7.5pt", color: "#333" }}>
                        {patient.phone_number}
                    </div>
                )}
                {patient.sex && (
                    <div style={{ fontSize: "7.5pt", color: "#333" }}>
                        {patient.sex}
                    </div>
                )}
                {patient.age != null && (
                    <div style={{ fontSize: "7.5pt", color: "#333" }}>
                        {patient.age} yrs
                    </div>
                )}
            </div>

            {/* Items Table */}
            <table style={{
                width: "100%",
                borderCollapse: "collapse",
                fontFamily: "Arial, Helvetica, sans-serif",
                marginBottom: "14px",
            }}>
                <thead>
                    <tr style={{ borderBottom: "2px solid black" }}>
                        <th style={{
                            textAlign: "left",
                            fontSize: "6.5pt",
                            letterSpacing: "0.6px",
                            textTransform: "uppercase",
                            paddingBottom: "5px",
                            paddingTop: "2px",
                            width: "30px",
                            fontWeight: "600",
                        }}>#</th>
                        <th style={{
                            textAlign: "left",
                            fontSize: "6.5pt",
                            letterSpacing: "0.6px",
                            textTransform: "uppercase",
                            paddingBottom: "5px",
                            paddingTop: "2px",
                            fontWeight: "600",
                        }}>Item</th>
                        <th style={{
                            textAlign: "right",
                            fontSize: "6.5pt",
                            letterSpacing: "0.6px",
                            textTransform: "uppercase",
                            paddingBottom: "5px",
                            paddingTop: "2px",
                            width: "40px",
                            fontWeight: "600",
                        }}>Qty</th>
                        <th style={{
                            textAlign: "right",
                            fontSize: "6.5pt",
                            letterSpacing: "0.6px",
                            textTransform: "uppercase",
                            paddingBottom: "5px",
                            paddingTop: "2px",
                            width: "70px",
                            fontWeight: "600",
                        }}>MRP (₹)</th>
                        <th style={{
                            textAlign: "right",
                            fontSize: "6.5pt",
                            letterSpacing: "0.6px",
                            textTransform: "uppercase",
                            paddingBottom: "5px",
                            paddingTop: "2px",
                            width: "70px",
                            fontWeight: "600",
                        }}>Total (₹)</th>
                    </tr>
                </thead>
                <tbody>
                    {billItems.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #ddd" }}>
                            <td style={{
                                paddingTop: "6px",
                                paddingBottom: "6px",
                                fontSize: "8pt",
                                color: "#999",
                            }}>{idx + 1}</td>
                            <td style={{
                                paddingTop: "6px",
                                paddingBottom: "6px",
                                fontSize: "8pt",
                                color: "#000",
                            }}>{item.item_name}</td>
                            <td style={{
                                paddingTop: "6px",
                                paddingBottom: "6px",
                                fontSize: "8pt",
                                textAlign: "right",
                                color: "#000",
                            }}>{item.qty}</td>
                            <td style={{
                                paddingTop: "6px",
                                paddingBottom: "6px",
                                fontSize: "8pt",
                                textAlign: "right",
                                color: "#000",
                            }}>{item.mrp.toFixed(2)}</td>
                            <td style={{
                                paddingTop: "6px",
                                paddingBottom: "6px",
                                fontSize: "8pt",
                                textAlign: "right",
                                color: "#000",
                            }}>{(item.qty * item.mrp).toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Totals */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
                <div style={{ width: "46%", fontFamily: "Arial, Helvetica, sans-serif" }}>
                    <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "5px 0",
                        borderBottom: "1px solid #ddd",
                        fontSize: "7pt",
                        color: "#555",
                    }}>
                        <span>Subtotal</span>
                        <span>₹ {total.toFixed(2)}</span>
                    </div>
                    <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "6px 0",
                        borderTop: "2px solid black",
                        marginTop: "2px",
                        fontSize: "10pt",
                        fontWeight: "800",
                        color: "#000",
                    }}>
                        <span>Total</span>
                        <span>₹ {total.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            {/* FOLLOW-UP: uncomment when follow_up_date is wired up */}
            {/*
            <div style={{
                border: "1px solid #ccc",
                borderRadius: "3px",
                padding: "6px 10px",
                marginBottom: "14px",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: "7.5pt",
                color: "#333",
            }}>
                <span style={{ fontWeight: "600" }}>Follow-up Date:</span> {followUpDate}
            </div>
            */}

            {/* Footer */}
            <div style={{
                borderTop: "1px solid #bbb",
                paddingTop: "7px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: "6.5pt",
                color: "#888",
                marginTop: "auto",
            }}>
                <span>Thank you for visiting {clinicName}.</span>
                <span>Authorised Signature ___________</span>
            </div>
        </div>
    )
}
