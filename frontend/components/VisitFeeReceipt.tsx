import { format } from "date-fns"

interface VisitFeeReceiptProps {
    clinicName: string
    clinicAddress: string
    clinicPhone: string
    clinicLicense?: string
    consultantName?: string
    patient: {
        name: string
        phone_number: string
        age?: number | null
        sex?: string | null
    }
    invoiceId: string
    amount: number
    paymentMode?: string | null
    date?: Date
    className?: string
}

// Dashed text divider spanning the receipt width — literal repeated
// characters (not a CSS border), matching InvoicePrint.tsx's receipt look.
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
    gap: "4px",
}

// Duplicated from InvoicePrint.tsx's own Label helper rather than shared —
// InvoicePrint's print mechanics have already been the source of two tricky
// font-related bugs (see CLAUDE.md's Invoice Print System history), so this
// file intentionally doesn't import from or modify that one.
function Label({ children, width }: { children: string; width?: number }) {
    return <span style={{ fontWeight: 600, whiteSpace: "pre" }}>{width ? children.padEnd(width) : children}</span>
}

export function VisitFeeReceipt({
    clinicName = "MediCare Clinic",
    clinicAddress = "",
    clinicPhone = "",
    clinicLicense = "",
    consultantName,
    patient,
    invoiceId,
    amount,
    paymentMode,
    date = new Date(),
    className,
}: VisitFeeReceiptProps) {
    if (!patient) return null

    const printTime = format(date, "HH:mm")
    const printDate = format(date, "dd/MM/yyyy")
    const hasAge = patient.age !== null && patient.age !== undefined

    const base: React.CSSProperties = {
        // Same font/rendering approach as InvoicePrint.tsx — Roboto Mono,
        // no fallback, no web-font loading, printed via the same
        // printElement() (outerHTML + fonts.ready wait) from
        // PrintInvoiceDialog.tsx.
        fontFamily: '"Roboto Mono"',
        fontSize: "9.5pt",
        lineHeight: 1.2,
        color: "#000",
    }

    return (
        <div id="visit-receipt-print-region" className={className} style={{ ...base, width: "75mm", maxWidth: "75mm" }}>
            <style>{'@page { size: 80mm auto; margin: 2.5mm }'}</style>

            {/* Pharmacy name */}
            <div style={{ textAlign: "center", fontWeight: 700, fontSize: "12.5pt", textTransform: "uppercase" }}>
                {clinicName}
            </div>

            {/* Pharmacy details */}
            {clinicAddress && (
                <div style={{ textAlign: "center", fontSize: "8.5pt" }}>{clinicAddress}</div>
            )}
            {(clinicPhone || clinicLicense) && (
                <div style={{ ...row, fontSize: "7pt", whiteSpace: "nowrap" }}>
                    <span>{clinicPhone && `PH: ${clinicPhone}`}</span>
                    <span>{clinicLicense && `DL NO: ${clinicLicense}`}</span>
                </div>
            )}

            <Divider />

            {/* Invoice no + date/time, one row */}
            <div style={row}>
                <span><Label width={10}>INV NO</Label> : {invoiceId}</span>
                <span style={{ whiteSpace: "nowrap" }}>{printDate} {printTime}</span>
            </div>

            {/* Patient details — NAME alone (hanging-indent wrap for long
                names, matching InvoicePrint.tsx), then PHONE + AGE sharing a
                row, then SEX alone, then CONSULTANT alone if set. NAME/
                PHONE/CONSULTANT share a padded label width (10 —
                "CONSULTANT" is the longest) so their colons line up. */}
            <div style={{ paddingLeft: "10ch", textIndent: "-10ch", wordBreak: "break-word" }}>
                <Label width={10}>NAME</Label> : {patient.name.toUpperCase()}
            </div>
            {(patient.phone_number || hasAge) && (
                <div style={row}>
                    <span>{patient.phone_number && <><Label width={10}>PHONE</Label> : {patient.phone_number}</>}</span>
                    {hasAge && <span style={{ whiteSpace: "nowrap" }}><Label>AGE</Label> : {patient.age}</span>}
                </div>
            )}
            {patient.sex && <div><Label>SEX</Label> : {patient.sex}</div>}
            {consultantName && <div><Label width={10}>CONSULTANT</Label> : {consultantName}</div>}

            <Divider />

            {/* Price header — DESCRIPTION / AMOUNT, once */}
            <div style={{ ...row, fontWeight: 700 }}>
                <span>DESCRIPTION</span>
                <span>AMOUNT</span>
            </div>
            <Divider />

            {/* Single line item — always "VISIT FEE", never itemized like a
                pharmacy bill (no HSN/batch/expiry applies to a consultation
                fee). */}
            <div style={row}>
                <span>VISIT FEE</span>
                <span>{amount.toFixed(2)}</span>
            </div>
            <Divider />

            <div style={{ ...row, fontWeight: 700, fontSize: "13pt" }}>
                <span>TOTAL</span>
                <span>&#8377;{amount.toFixed(2)}</span>
            </div>
            <Divider />

            <div><Label width={12}>PAYMENT MODE</Label> : {(paymentMode || "CASH").toUpperCase()}</div>

            <Divider />

            {/* Footer — no legal disclaimer here; a consultation fee isn't
                "goods sold", so InvoicePrint's footer text doesn't apply. */}
            <div style={{ textAlign: "center", fontSize: "8pt", lineHeight: 1.2 }}>
                <div>THANK YOU FOR YOUR VISIT</div>
                <div>TAKE CARE, STAY HEALTHY</div>
            </div>
        </div>
    )
}
