"use client"

import { useState, useEffect } from "react"
import { getTodayIST } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Loader2 } from "lucide-react"
import { api, type Patient, type Visit } from "@/lib/api"
import { PatientSearch } from "@/components/PatientSearch"
import { format } from "date-fns"

interface AddVisitDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess?: () => void
    trigger?: React.ReactNode
    initialDate?: string
    initialTime?: string
}

const getCurrentTimeStr = () => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
};

export function AddVisitDialog({ open, onOpenChange, onSuccess, trigger, initialDate, initialTime }: AddVisitDialogProps) {
    const [submitting, setSubmitting] = useState(false)
    const [formData, setFormData] = useState({
        patient_id: "",
        visit_date: initialDate || getTodayIST(),
        visit_time: initialTime || getCurrentTimeStr(),
        reason: "",
        addToQueue: true,
        visiting_fee: "",
        amount_paid: "",
        payment_status: "unpaid",
        paid_full: false
    })

    // History State
    const [history, setHistory] = useState<Visit[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)

    useEffect(() => {
        if (open) {
            setFormData(prev => ({
                ...prev,
                visit_date: initialDate || getTodayIST(),
                visit_time: initialTime || getCurrentTimeStr()
            }))
            // Reset history when reopening
            if (!initialDate) {
                // If we are opening fresh (not from calendar slot), maybe keep history if patient was selected? 
                // But usually dialog unmounts or we want fresh state. 
                // For now, if we want to clear patient:
                // setFormData(...) clears patient_id usually if we want fresh.
            }
        }
    }, [open, initialDate, initialTime])

    // Fetch history when patient changes
    useEffect(() => {
        if (!formData.patient_id) {
            setHistory([])
            return
        }

        const fetchHistory = async () => {
            setLoadingHistory(true)
            try {
                const res = await api.getVisits(formData.patient_id)
                setHistory(res)
            } catch (e) {
                console.error("Failed to fetch history", e)
            } finally {
                setLoadingHistory(false)
            }
        }

        fetchHistory()
    }, [formData.patient_id])

    const isToday = formData.visit_date === getTodayIST();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)

        try {
            await api.createVisit({
                patient_id: formData.patient_id,
                visit_date: formData.visit_date,
                visit_time: formData.visit_time || undefined,
                status: "scheduled",
                reason: formData.reason || undefined,
                visiting_fee: formData.visiting_fee ? parseFloat(formData.visiting_fee) : 0,
                amount_paid: formData.amount_paid ? parseFloat(formData.amount_paid) : 0,
                payment_status: formData.payment_status,
            })

            // Reset form
            setFormData({
                patient_id: "",
                visit_date: getTodayIST(),
                visit_time: "",
                reason: "",
                addToQueue: true,
                visiting_fee: "",
                amount_paid: "",
                payment_status: "unpaid",
                paid_full: false
            })
            setHistory([])

            // Close dialog and notify success
            onOpenChange(false)
            onSuccess?.()
        } catch (err) {
            alert(`Failed to create visit: ${err instanceof Error ? err.message : "Unknown error"}`)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
            <DialogContent className="sm:max-w-[900px] max-h-[90vh] gap-0 p-0 overflow-y-auto overflow-x-hidden">
                <div className="grid grid-cols-1 md:grid-cols-2 min-h-[600px] md:h-full">
                    {/* Left Column: Form */}
                    <div className="p-6 overflow-y-auto flex flex-col">
                        <DialogHeader className="mb-4">
                            <DialogTitle>Schedule Visit</DialogTitle>
                            <DialogDescription>
                                Create a new visit record.
                            </DialogDescription>
                        </DialogHeader>

                        <form id="visit-form" onSubmit={handleSubmit} className="space-y-4 flex-1">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">
                                    Patient *
                                </label>
                                <PatientSearch
                                    key={open ? "active" : "inactive"}
                                    onSelect={(patient: Patient | null) => {
                                        setFormData(prev => ({
                                            ...prev,
                                            patient_id: patient?.patient_id || ""
                                        }))
                                    }}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label htmlFor="date" className="text-sm font-medium">
                                        Date *
                                    </label>
                                    <Input
                                        id="date"
                                        type="date"
                                        value={formData.visit_date}
                                        onChange={(e) => setFormData({ ...formData, visit_date: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="time" className="text-sm font-medium">
                                        Time
                                    </label>
                                    <Input
                                        id="time"
                                        type="time"
                                        value={formData.visit_time}
                                        onChange={(e) => setFormData({ ...formData, visit_time: e.target.value })}
                                    />
                                </div>
                            </div>

                            {isToday && (
                                <div className="flex items-center gap-3 p-3 border rounded-lg bg-secondary/20">
                                    <input
                                        type="checkbox"
                                        id="addToQueue"
                                        checked={formData.addToQueue}
                                        onChange={(e) => setFormData({ ...formData, addToQueue: e.target.checked })}
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                    <div className="space-y-0.5">
                                        <label htmlFor="addToQueue" className="text-sm font-medium leading-none cursor-pointer">
                                            Add to Today&apos;s Queue
                                        </label>
                                        <p className="text-xs text-muted-foreground">
                                            Patient will appear in the dashboard queue.
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label htmlFor="reason" className="text-sm font-medium">
                                    Reason
                                </label>
                                <Input
                                    id="reason"
                                    value={formData.reason}
                                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                                    placeholder="Check-up, Consultation, etc."
                                />
                            </div>



                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label htmlFor="visiting_fee" className="text-sm font-medium">
                                        Visiting Fee
                                    </label>
                                    <Input
                                        id="visiting_fee"
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
                                        <label htmlFor="amount_paid" className="text-sm font-medium">
                                            Amount Paid
                                        </label>
                                        <div className="flex items-center space-x-2">
                                            <input
                                                type="checkbox"
                                                id="paid_full"
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
                                            <label htmlFor="paid_full" className="text-xs font-medium cursor-pointer select-none">
                                                Paid in Full
                                            </label>
                                        </div>
                                    </div>
                                    <Input
                                        id="amount_paid"
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
                        </form>

                        <div className="mt-auto pt-4">
                            <Button
                                type="submit"
                                form="visit-form"
                                disabled={submitting || !formData.patient_id}
                                className="w-full"
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Saving...
                                    </>
                                ) : !formData.patient_id ? (
                                    "Select a Patient"
                                ) : (
                                    "Schedule Visit"
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* Right Column: History */}
                    <div className="bg-muted/30 border-l p-6 overflow-y-auto hidden md:block">
                        <h3 className="font-semibold mb-1">Previous Visits</h3>
                        <p className="text-xs text-muted-foreground mb-4">
                            History for selected patient.
                        </p>

                        {!formData.patient_id ? (
                            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground border-2 border-dashed rounded-lg">
                                Select a patient to view history
                            </div>
                        ) : loadingHistory ? (
                            <div className="flex justify-center p-8">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : history.length === 0 ? (
                            <div className="text-sm text-muted-foreground text-center p-4">
                                No previous visits found.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {history.map((visit) => {
                                    const visitDate = visit.visit_date ? new Date(visit.visit_date) : new Date();
                                    const targetDate = formData.visit_date ? new Date(formData.visit_date) : new Date();

                                    // Reset hours to compare just dates
                                    visitDate.setHours(0, 0, 0, 0);
                                    targetDate.setHours(0, 0, 0, 0);

                                    const diffTime = targetDate.getTime() - visitDate.getTime();
                                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                                    let timeText = "";
                                    if (diffDays === 0) timeText = "Same day";
                                    else if (diffDays > 0) timeText = `${diffDays} days ago`;
                                    else timeText = `In ${Math.abs(diffDays)} days`;

                                    return (
                                        <div key={visit.visit_id} className="bg-background p-3 rounded-lg border shadow-sm text-sm">
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="font-medium">
                                                    {visit.visit_date ? format(new Date(visit.visit_date), "MMM d, yyyy") : "No Date"}
                                                </span>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full uppercase border ${visit.status === 'done' ? 'bg-green-50 text-green-700 border-green-200' :
                                                    visit.status === 'cancelled' ? 'bg-red-50 text-red-700 border-red-200' :
                                                        'bg-blue-50 text-blue-700 border-blue-200'
                                                    }`}>
                                                    {visit.status}
                                                </span>
                                            </div>
                                            <p className="text-muted-foreground truncate font-medium flex items-center gap-2">
                                                <span className="text-primary font-bold bg-primary/10 px-2 py-0.5 rounded text-xs">{timeText}</span>
                                                {/* Show reason if exists, but secondary */}
                                                {visit.reason && <span className="text-xs font-normal opacity-70">({visit.reason})</span>}
                                            </p>

                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
