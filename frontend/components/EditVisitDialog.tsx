"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Loader2 } from "lucide-react"
import { api, type Visit } from "@/lib/api"
import { getTodayIST } from "@/lib/utils"
import { useAuth } from "@/lib/auth_context"

interface EditVisitDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    visit: Visit | null
    onSuccess?: () => void
}

export function EditVisitDialog({ open, onOpenChange, visit, onSuccess }: EditVisitDialogProps) {
    const { role } = useAuth()
    const [submitting, setSubmitting] = useState(false)
    const [formData, setFormData] = useState({
        visit_date: "",
        visit_time: "",
        reason: "",
        visiting_fee: "",
        payment_mode: "" as "" | "cash" | "upi",
        status: "scheduled"
    })
    // Refund reflects the visit's current total refund and is directly editable —
    // reopening a visit that already has a refund pre-checks the box and pre-fills
    // the existing amount/mode, so increasing or decreasing it is just editing the
    // number and saving again. Unchecking the box means "don't touch the refund
    // this save" (not "clear it") — to remove a refund entirely, edit it down to 0.
    const [refundChecked, setRefundChecked] = useState(false)
    const [refundInput, setRefundInput] = useState("")
    const [refundMode, setRefundMode] = useState<"" | "cash" | "upi">("")

    useEffect(() => {
        if (visit && open) {
            setFormData({
                visit_date: visit.visit_date || getTodayIST(),
                visit_time: visit.visit_time || "",
                reason: visit.reason || "",
                visiting_fee: visit.visiting_fee?.toString() || "",
                payment_mode: (visit.payment_mode as "cash" | "upi") || "",
                status: visit.status
            })
            const existingRefund = visit.refund_amount || 0
            setRefundChecked(existingRefund > 0)
            setRefundInput(existingRefund > 0 ? existingRefund.toString() : "")
            setRefundMode((visit.refund_mode as "cash" | "upi") || "")
        }
    }, [visit, open])

    // Whatever fee is entered is treated as collected in full — there's no
    // partial/unpaid concept here. The only way money moves back out is a refund.
    const visitingFee = visit?.visiting_fee || 0
    const refundedSoFar = visit?.refund_amount || 0
    const netPaid = visitingFee - refundedSoFar
    const canRefund = role !== 'doctor' && visitingFee > 0

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!visit) return

        const newVisitingFee = formData.visiting_fee ? parseFloat(formData.visiting_fee) : 0
        if (refundedSoFar > 0 && newVisitingFee < visitingFee) {
            alert("Visiting Fee can't be lowered once a refund has been issued — use the Refund field instead.")
            return
        }

        let newRefundTotal: number | null = null
        if (refundChecked) {
            newRefundTotal = parseFloat(refundInput || '0')
            if (!(newRefundTotal >= 0) || newRefundTotal > visitingFee) {
                alert(`Enter a refund amount between ₹0 and ₹${visitingFee.toFixed(2)}`)
                return
            }
            if (newRefundTotal > 0 && refundMode !== 'cash' && refundMode !== 'upi') {
                alert("Select a refund type (Cash or UPI)")
                return
            }
        }

        setSubmitting(true)

        try {
            await api.updateVisit(visit.visit_id, {
                visit_date: formData.visit_date,
                visit_time: formData.visit_time || undefined,
                reason: formData.reason || undefined,
                visiting_fee: newVisitingFee,
                amount_paid: newVisitingFee,
                payment_mode: formData.payment_mode || undefined,
                payment_status: refundedSoFar > 0 ? 'refunded' : 'full',
                status: formData.status
            })

            if (newRefundTotal !== null) {
                await api.refundVisit(visit.visit_id, newRefundTotal, refundMode || undefined)
            }

            // Close dialog and notify success
            onOpenChange(false)
            onSuccess?.()
        } catch (err) {
            alert(`Failed to update visit: ${err instanceof Error ? err.message : "Unknown error"}`)
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async () => {
        if (!visit || !confirm("Are you sure you want to delete this visit?")) return

        setSubmitting(true)
        try {
            await api.updateVisit(visit.visit_id, { status: 'deleted' })
            onOpenChange(false)
            onSuccess?.()
        } catch (err) {
            alert(`Failed to delete visit: ${err instanceof Error ? err.message : "Unknown error"}`)
        } finally {
            setSubmitting(false)
        }
    }

    if (!visit) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] h-[95vh] flex flex-col items-center justify-center">
                <form onSubmit={handleSubmit} className="w-full max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>{visit.patient_name}</DialogTitle>
                        <DialogDescription>
                            Update appointment details.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor="edit-date" className="text-sm font-medium">
                                    Date *
                                </label>
                                <Input
                                    id="edit-date"
                                    type="date"
                                    value={formData.visit_date}
                                    onChange={(e) => setFormData({ ...formData, visit_date: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="edit-time" className="text-sm font-medium">
                                    Time
                                </label>
                                <Input
                                    id="edit-time"
                                    type="time"
                                    value={formData.visit_time}
                                    onChange={(e) => setFormData({ ...formData, visit_time: e.target.value })}
                                    onChangeCapture={(e) => { }}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="edit-status" className="text-sm font-medium">
                                Status
                            </label>
                            <select
                                id="edit-status"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={formData.status}
                                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                            >
                                <option value="scheduled">Scheduled</option>
                                <option value="in_progress">In Progress</option>
                                <option value="done">Done</option>
                                <option value="cancelled">Cancelled</option>
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="edit-reason" className="text-sm font-medium">
                                Reason
                            </label>
                            <Input
                                id="edit-reason"
                                value={formData.reason}
                                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                                placeholder="Check-up, Consultation, etc."
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor="edit-visiting_fee" className="text-sm font-medium">
                                    Visiting Fee
                                </label>
                                <Input
                                    id="edit-visiting_fee"
                                    type="number"
                                    value={formData.visiting_fee}
                                    onChange={(e) => setFormData({ ...formData, visiting_fee: e.target.value })}
                                    placeholder="0"
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="edit-payment_mode" className="text-sm font-medium">
                                    Fee Type
                                </label>
                                <select
                                    id="edit-payment_mode"
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    value={formData.payment_mode}
                                    onChange={(e) => setFormData({ ...formData, payment_mode: e.target.value as "" | "cash" | "upi" })}
                                >
                                    <option value="" disabled>Type</option>
                                    <option value="cash">Cash</option>
                                    <option value="upi">UPI</option>
                                </select>
                            </div>
                        </div>

                        {refundedSoFar > 0 && (
                            <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
                                <span>Refunded: <span className="font-medium text-foreground">₹{refundedSoFar.toFixed(2)}</span></span>
                                <span>Net: <span className="font-medium text-foreground">₹{netPaid.toFixed(2)}</span></span>
                            </div>
                        )}

                        {canRefund && (
                            <div className="space-y-2">
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="checkbox"
                                        id="edit-refund-check"
                                        checked={refundChecked}
                                        onChange={(e) => setRefundChecked(e.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                    <label htmlFor="edit-refund-check" className="text-sm font-medium cursor-pointer select-none">
                                        Refund
                                    </label>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <Input
                                        id="edit-refund-amount"
                                        type="number"
                                        value={refundInput}
                                        onChange={(e) => setRefundInput(e.target.value)}
                                        placeholder="0"
                                        disabled={!refundChecked}
                                    />
                                    <select
                                        id="edit-refund-mode"
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        value={refundMode}
                                        onChange={(e) => setRefundMode(e.target.value as "" | "cash" | "upi")}
                                        disabled={!refundChecked}
                                    >
                                        <option value="" disabled>Type</option>
                                        <option value="cash">Cash</option>
                                        <option value="upi">UPI</option>
                                    </select>
                                </div>
                            </div>
                        )}
                        {visit.created_at && (
                            <div className="text-[10px] text-muted-foreground/80 space-y-0.5 border-t pt-2 mt-1 flex flex-col gap-0.5 px-1">
                                <div>Created: {new Date(visit.created_at).toLocaleString()}</div>
                                {visit.updated_at && (
                                    <div>Last Updated: {new Date(visit.updated_at).toLocaleString()}</div>
                                )}
                            </div>
                        )}
                    </div>
                    <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={handleDelete}
                                disabled={submitting}
                            >
                                Delete
                            </Button>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={submitting}
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Updating...
                                    </>
                                ) : (
                                    "Update Visit"
                                )}
                            </Button>
                        </div>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
