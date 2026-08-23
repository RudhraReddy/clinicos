"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
    const [notes, setNotes] = useState("")
    // Not saved yet — UI placeholder only, storage/use TBD.
    const [reviewDate, setReviewDate] = useState("")
    const [submitting, setSubmitting] = useState(false)

    const today = getTodayIST()

    // Reset the form each time a new visit is targeted
    useEffect(() => {
        if (open) {
            setNotes("")
            setReviewDate("")
        }
    }, [open, visit?.visit_id])

    if (!visit) return null

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
                        <label htmlFor="done-notes" className="text-sm font-medium">
                            Notes
                        </label>
                        <Textarea
                            id="done-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Add any notes..."
                            rows={3}
                        />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="done-review-date" className="text-sm font-medium">
                            Review Date
                        </label>
                        <Input
                            id="done-review-date"
                            type="date"
                            min={today}
                            value={reviewDate}
                            onChange={(e) => setReviewDate(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            When the patient should come back for a follow-up. Leave blank if none.
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
