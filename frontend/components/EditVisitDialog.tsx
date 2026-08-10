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
        amount_paid: "",
        payment_status: "unpaid",
        paid_full: false,
        status: "scheduled"
    })
    // Refund is an action slot, not a stored field — it always starts unchecked/empty
    // and represents "amount to refund right now", not the running refunded total.
    const [refundChecked, setRefundChecked] = useState(false)
    const [refundInput, setRefundInput] = useState("")

    useEffect(() => {
        if (visit && open) {
            setFormData({
                visit_date: visit.visit_date || getTodayIST(),
                visit_time: visit.visit_time || "",
                reason: visit.reason || "",
                visiting_fee: visit.visiting_fee?.toString() || "",
                amount_paid: visit.amount_paid?.toString() || "",
                payment_status: visit.payment_status || "unpaid",
                paid_full: (visit.payment_status === 'full'),
                status: visit.status
            })
            setRefundChecked(false)
            setRefundInput("")
        }
    }, [visit, open])

    const amountPaid = visit?.amount_paid || 0
    const refundedSoFar = visit?.refund_amount || 0
    const netPaid = amountPaid - refundedSoFar
    const remainingRefundable = Math.max(0, netPaid)
    const canRefund = role !== 'doctor' && amountPaid > 0

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!visit) return

        const newAmountPaid = formData.amount_paid ? parseFloat(formData.amount_paid) : 0
        if (refundedSoFar > 0 && newAmountPaid < amountPaid) {
            alert("Amount Paid can't be lowered once a refund has been issued — use the Refund field instead.")
            return
        }

        let refundAmount = 0
        if (refundChecked) {
            refundAmount = parseFloat(refundInput || '0')
            if (!(refundAmount > 0) || refundAmount > remainingRefundable) {
                alert(`Enter a refund amount between ₹0 and ₹${remainingRefundable.toFixed(2)}`)
                return
            }
        }

        setSubmitting(true)

        try {
            await api.updateVisit(visit.visit_id, {
                visit_date: formData.visit_date,
                visit_time: formData.visit_time || undefined,
                reason: formData.reason || undefined,
                visiting_fee: formData.visiting_fee ? parseFloat(formData.visiting_fee) : 0,
                amount_paid: formData.amount_paid ? parseFloat(formData.amount_paid) : 0,
                payment_status: formData.payment_status,
                status: formData.status
            })

            if (refundAmount > 0) {
                await api.refundVisit(visit.visit_id, refundAmount)
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
            <DialogContent className="sm:max-w-[425px]">
                <form onSubmit={handleSubmit}>
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
                                    onChange={(e) => {
                                        const fee = e.target.value;
                                        setFormData(prev => ({
                                            ...prev,
                                            visiting_fee: fee,
                                            amount_paid: prev.paid_full ? fee : prev.amount_paid
                                        }));
                                    }}
                                    placeholder="0"
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label htmlFor="edit-amount_paid" className="text-sm font-medium">
                                        Amount Paid
                                    </label>
                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="checkbox"
                                            id="edit-paid_full"
                                            checked={formData.paid_full}
                                            onChange={(e) => {
                                                const isFull = e.target.checked;
                                                setFormData(prev => ({
                                                    ...prev,
                                                    paid_full: isFull,
                                                    amount_paid: isFull ? prev.visiting_fee : prev.amount_paid,
                                                    payment_status: isFull ? 'full' : (parseFloat(prev.amount_paid || '0') > 0 ? 'partial' : 'unpaid')
                                                }));
                                            }}
                                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        />
                                        <label htmlFor="edit-paid_full" className="text-xs font-medium cursor-pointer select-none">
                                            Paid in Full
                                        </label>
                                    </div>
                                </div>
                                <Input
                                    id="edit-amount_paid"
                                    type="number"
                                    value={formData.amount_paid}
                                    onChange={(e) => {
                                        const paid = e.target.value;
                                        const fee = parseFloat(formData.visiting_fee || '0');
                                        const paidNum = parseFloat(paid || '0');

                                        setFormData(prev => ({
                                            ...prev,
                                            amount_paid: paid,
                                            paid_full: paidNum >= fee && fee > 0,
                                            payment_status: paidNum >= fee && fee > 0 ? 'full' : (paidNum > 0 ? 'partial' : 'unpaid')
                                        }));
                                    }}
                                    placeholder="0"
                                    disabled={formData.paid_full}
                                />
                            </div>
                        </div>

                        {refundedSoFar > 0 && (
                            <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
                                <span>Amount Paid: <span className="font-medium text-foreground">₹{amountPaid.toFixed(2)}</span></span>
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
                                        onChange={(e) => {
                                            setRefundChecked(e.target.checked)
                                            if (!e.target.checked) setRefundInput("")
                                        }}
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                    <label htmlFor="edit-refund-check" className="text-sm font-medium cursor-pointer select-none">
                                        Refund
                                    </label>
                                </div>
                                <Input
                                    id="edit-refund-amount"
                                    type="number"
                                    value={refundInput}
                                    onChange={(e) => setRefundInput(e.target.value)}
                                    placeholder="0"
                                    disabled={!refundChecked}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Max refundable right now: ₹{remainingRefundable.toFixed(2)}
                                </p>
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
