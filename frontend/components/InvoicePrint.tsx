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
    unit?: string | null
    pack_size?: string | null
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
    subtotal?: number
    discountType?: "percent" | "flat" | null
    discountValue?: number | null
    // Amount of a pending visit-fee refund folded into this bill's total.
    visitRefundApplied?: number | null
    paymentType?: string | null
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

// "Eris Lifesciences" -> "ERIS", "Sun Pharma" -> "SUN" — first word, letters
// only, capped at 4 chars. Keeps the MFG line compact on an 80mm receipt.
function abbreviateManufacturer(name: string | null | undefined): string {
    if (!name) return ""
    const firstWord = name.trim().split(/\s+/)[0] || ""
    return firstWord.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase()
}

// Dashed text divider spanning the receipt width — printed as literal
// repeated characters (not a CSS border) to match a classic receipt look.
function Divider() {
    return (
        <div style={{ whiteSpace: "nowrap", overflow: "hidden" }}>
            {"-".repeat(44)}
        </div>
    )
}

const row: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "6px",
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
    subtotal,
    discountType = null,
    visitRefundApplied = null,
    paymentType = null,
    date = new Date(),
    referenceDoctor,
    className,
}: InvoicePrintProps) {
    if (!patient || billItems.length === 0) return null

    const printTime = format(date, "HH:mm")
    const printDate = format(date, "dd/MM/yyyy")
    // total = subtotal − discount − visitRefundApplied, so back the refund out
    // before computing the discount amount — otherwise a refund-only bill (no
    // real discount) would misreport its refund as a "discount".
    const discountAmount = (subtotal ?? total) - total - (visitRefundApplied ?? 0)
    const hasDiscount = !!discountType && discountAmount > 0

    const hasAge = patient.age !== null && patient.age !== undefined

    const base: React.CSSProperties = {
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: "9.5pt",
        lineHeight: 1.35,
        color: "#000",
    }

    return (
        <div id="invoice-print-region" className={className} style={{ ...base, width: "74mm", maxWidth: "74mm" }}>
            <style>{'@page { size: 80mm auto; margin: 2.5mm 3mm }'}</style>

            {/* Pharmacy name */}
            <div style={{ textAlign: "center", fontWeight: 700, fontSize: "14pt", textTransform: "uppercase" }}>
                {clinicName}
            </div>

            {/* Pharmacy details */}
            {clinicAddress && (
                <div style={{ textAlign: "center", fontSize: "8.5pt" }}>{clinicAddress}</div>
            )}
            {(clinicPhone || clinicLicense) && (
                <div style={{ textAlign: "center", fontSize: "8.5pt" }}>
                    {clinicPhone && `PH: ${clinicPhone}`}
                    {clinicPhone && clinicLicense && "    "}
                    {clinicLicense && `DL NO: ${clinicLicense}`}
                </div>
            )}

            <Divider />

            {/* Patient details */}
            <div style={row}>
                <span>NAME : {patient.name.toUpperCase()}</span>
                {hasAge && <span style={{ whiteSpace: "nowrap" }}>AGE : {patient.age}</span>}
            </div>
            {patient.phone_number && <div>PH   : {patient.phone_number}</div>}
            {referenceDoctor && <div>REF  : {referenceDoctor}</div>}

            <Divider />

            {/* Invoice details. INVOICE NO and PAYMENT MODE each get their own
                line — real invoice IDs (DDMMYY-XXX-XXX, ~15 chars) don't fit
                alongside a second field the way a short mockup ID would.
                DATE/TIME are short enough to safely share one row. */}
            <div>INVOICE NO : {invoiceId || "DRAFT"}</div>
            <div>PAYMENT MODE : {(paymentType || "CASH").toUpperCase()}</div>
            <div style={row}>
                <span>DATE : {printDate}</span>
                <span style={{ whiteSpace: "nowrap" }}>TIME : {printTime}</span>
            </div>

            <Divider />

            {/* Price header — once, not per item */}
            <div style={{ ...row, fontWeight: 700 }}>
                <span>QTY &times; MRP</span>
                <span>AMOUNT</span>
            </div>
            <Divider />

            {/* Items */}
            {billItems.map((item, idx) => {
                const mfg = abbreviateManufacturer(item.manufacturer)
                const detailLine1 = [
                    mfg && `MFG: ${mfg}`,
                    item.pack_size && `PACK: ${item.pack_size}`,
                    item.batch_number && `BATCH: ${item.batch_number}`,
                ].filter(Boolean).join("   ")
                const detailLine2 = [
                    item.hsn_code && `HSN: ${item.hsn_code}`,
                    item.gst_rate ? `GST: ${item.gst_rate}%` : null,
                    item.expiry_date && `EXP: ${formatExpiry(item.expiry_date)}`,
                ].filter(Boolean).join("   ")
                const amount = item.qty * item.mrp

                return (
                    <div key={idx}>
                        <div style={{ fontWeight: 700, fontSize: "10.5pt", paddingLeft: "1.4em", textIndent: "-1.4em", wordBreak: "break-word" }}>
                            {idx + 1}. {item.item_name.toUpperCase()}
                        </div>
                        {detailLine1 && <div style={{ fontSize: "8pt" }}>{detailLine1}</div>}
                        {detailLine2 && <div style={{ fontSize: "8pt" }}>{detailLine2}</div>}
                        <div style={row}>
                            <span>{Math.round(item.qty)} &times; {item.mrp.toFixed(2)}</span>
                            <span>{amount.toFixed(2)}</span>
                        </div>
                        <Divider />
                    </div>
                )
            })}

            {/* Totals — SUBTOTAL and DISCOUNT always shown (₹0.00 discount included),
                matching the reference receipt; REFUND stays conditional since it's
                a rarer, visit-specific line, not a routine per-bill field. */}
            <div style={row}>
                <span>SUBTOTAL</span>
                <span>{(subtotal ?? total).toFixed(2)}</span>
            </div>
            <div style={row}>
                <span>DISCOUNT</span>
                <span>{(hasDiscount ? discountAmount : 0).toFixed(2)}</span>
            </div>
            {!!visitRefundApplied && (
                <div style={row}>
                    <span>REFUND</span>
                    <span>{visitRefundApplied.toFixed(2)}</span>
                </div>
            )}
            <Divider />
            <div style={{ ...row, fontWeight: 700, fontSize: "13pt" }}>
                <span>NET TOTAL</span>
                <span>&#8377; {total.toFixed(2)}</span>
            </div>
            <Divider />

            {/* Footer */}
            <div style={{ textAlign: "center", fontSize: "7.5pt", lineHeight: 1.4 }}>
                <div>GOODS ONCE SOLD WILL NOT BE</div>
                <div>TAKEN BACK OR EXCHANGED</div>
                <div>SUBJECT TO HANAMKONDA JURISDICTION</div>
            </div>
        </div>
    )
}
