"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, TriangleAlert } from "lucide-react"
import { api, type Visit } from "@/lib/api"
import { toast } from "sonner"

interface DeleteVisitDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    visit: Visit | null
    onDeleted: (visitId: string) => void
}

export function DeleteVisitDialog({ open, onOpenChange, visit, onDeleted }: DeleteVisitDialogProps) {
    const [refundChecked, setRefundChecked] = useState(true)
    const [submitting, setSubmitting] = useState(false)

    // Reset to the default (refund on) each time a new visit is targeted —
    // otherwise an uncheck on one delete would silently carry over to the next.
    useEffect(() => {
        if (open) setRefundChecked(true)
    }, [open, visit?.visit_id])

    if (!visit) return null

    const hasBill = (visit.bills && visit.bills.length > 0) || visit.billed_amount != null
    const unrefunded = Math.max(0, (visit.amount_paid || 0) - (visit.refund_amount || 0))
    const isRefundable = unrefunded > 0
    const bucketLabel = visit.payment_mode === 'upi' ? 'Visit UPI' : 'Billing Cash'

    const handleConfirm = async () => {
        setSubmitting(true)
        try {
            const res = await api.deleteVisit(visit.visit_id, refundChecked && isRefundable)
            onDeleted(visit.visit_id)
            toast.success(
                res.refunded_amount
                    ? `Visit deleted — ₹${res.refunded_amount.toFixed(2)} refunded via ${res.refund_mode === 'visit_upi' ? 'Visit UPI' : 'Billing Cash'}`
                    : "Visit deleted"
            )
            onOpenChange(false)
        } catch (err: any) {
            let message = err?.message || "Failed to delete visit"
            try { message = JSON.parse(message).error || message } catch { /* not JSON, use as-is */ }
            toast.error(message)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Delete Visit</DialogTitle>
                    <DialogDescription>
                        {visit.patient_name} — {visit.visit_date}
                    </DialogDescription>
                </DialogHeader>

                {hasBill ? (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        <TriangleAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <span>
                            This visit already has a bill attached, so it can&apos;t be deleted here —
                            resolve or refund the bill first from Billing.
                        </span>
                    </div>
                ) : (
                    <>
                        <p className="text-sm text-muted-foreground">
                            This will permanently remove this visit from the queue and history.
                        </p>
                        {isRefundable && (
                            <label className="flex items-start gap-2 rounded-md border p-3 text-sm cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={refundChecked}
                                    onChange={(e) => setRefundChecked(e.target.checked)}
                                    className="mt-0.5"
                                />
                                <span>
                                    Refund <span className="font-semibold">₹{unrefunded.toFixed(2)}</span> via{" "}
                                    <span className="font-semibold">{bucketLabel}</span>
                                    {" "}(how the visit fee was originally paid)
                                </span>
                            </label>
                        )}
                    </>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button variant="destructive" onClick={handleConfirm} disabled={submitting || hasBill}>
                        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Delete Visit
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
