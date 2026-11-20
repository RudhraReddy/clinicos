"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { format } from "date-fns"
import { ReviewOffsetInput } from "@/components/ReviewOffsetInput"
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
import { getTodayIST, reviewDateFromOffset, type ReviewOffsetUnit } from "@/lib/utils"
import { toast } from "sonner"

interface MarkVisitDoneDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    visit: Visit | null
    // nextReviewDate is only passed when a review date was actually entered
    // and saved — a blank field leaves the patient's existing value untouched.
    onDone: (visitId: string, nextReviewDate?: string) => void
}

export function MarkVisitDoneDialog({ open, onOpenChange, visit, onDone }: MarkVisitDoneDialogProps) {
    // Notes is disabled for now (not saved anywhere yet) — to be built later.
    const [notes, setNotes] = useState("")
    // Saved to the patient's next_review_date on confirm (shows in the
    // Dashboard's Review tab); blank leaves the existing value untouched.
    const [reviewDate, setReviewDate] = useState("")
    // Alternative to picking a date: "in N days/weeks/months" from today.
    const [offsetAmount, setOffsetAmount] = useState("")
    const [offsetUnit, setOffsetUnit] = useState<ReviewOffsetUnit>("days")
    const [submitting, setSubmitting] = useState(false)

    const today = getTodayIST()

    // Reset the form each time a new visit is targeted
    useEffect(() => {
        if (open) {
            setNotes("")
            setReviewDate("")
            setOffsetAmount("")
            setOffsetUnit("days")
        }
    }, [open, visit?.visit_id])

    if (!visit) return null

    const applyOffset = (amount: string, unit: ReviewOffsetUnit) => {
        setOffsetAmount(amount)
        setOffsetUnit(unit)
        setReviewDate(reviewDateFromOffset(amount, unit) ?? "")
    }

    const handleConfirm = async () => {
        // Review date is optional, but if set it can't be in the past.
        if (reviewDate && reviewDate < today) {
            toast.error("Review date can't be in the past")
            return
        }

        setSubmitting(true)
        try {
            await api.updateVisit(visit.visit_id, { status: 'done' })
            if (reviewDate) {
                await api.updatePatient(visit.patient_id, { next_review_date: reviewDate })
            }
            onDone(visit.visit_id, reviewDate || undefined)
            toast.success("Visit marked as done")
            onOpenChange(false)
        } catch (err: any) {
            let message = err?.message || "Failed to update visit"
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
                    <DialogTitle>Mark Visit as Done</DialogTitle>
                    <DialogDescription>
                        This sets the visit status to Done.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="text-sm space-y-1 rounded-md border p-3">
                        <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{visit.patient_name}</span></div>
                        <div><span className="text-muted-foreground">Date:</span> <span className="font-medium">{visit.visit_date}</span></div>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="done-notes" className="text-sm font-medium text-muted-foreground">
                            Notes <span className="text-xs font-normal">(coming soon)</span>
                        </label>
                        <Textarea
                            id="done-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Notes will be available in a future update"
                            rows={3}
                            disabled
                        />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="done-review-date" className="text-sm font-medium">
                            Review Date
                        </label>
                        <div className="flex items-center gap-2 flex-wrap">
                            <Input
                                id="done-review-date"
                                type="date"
                                min={today}
                                value={reviewDate}
                                onChange={(e) => {
                                    // Picking a date directly overrides the "in N …" entry.
                                    setReviewDate(e.target.value)
                                    setOffsetAmount("")
                                }}
                                className="w-auto flex-1 min-w-[150px]"
                            />
                            <span className="text-sm text-muted-foreground">or in</span>
                            <ReviewOffsetInput amount={offsetAmount} unit={offsetUnit} onChange={applyOffset} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {reviewDate
                                ? <>Review on <span className="font-medium text-foreground">{format(new Date(reviewDate + "T00:00:00"), "EEE, dd MMM yyyy")}</span>{offsetAmount && ` (${offsetAmount} ${offsetAmount === "1" ? offsetUnit.slice(0, -1) : offsetUnit} from today)`}</>
                                : "When the patient should come back for a follow-up. Pick a date or enter a number of days/weeks/months. Leave blank if none."}
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} disabled={submitting}>
                        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Mark Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
