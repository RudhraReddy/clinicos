"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, ChevronDown, ChevronRight, RotateCcw, CalendarClock, CheckCircle2, UserX } from "lucide-react"
import { DatePickerWithRange } from "@/components/ui/date-range-picker"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DateRange } from "react-day-picker"
import { format } from "date-fns"
import { api, type PatientReviewDay, type PatientReviewEntry } from "@/lib/api"
import { getTodayIST, reviewDateFromOffset, type ReviewOffsetUnit } from "@/lib/utils"
import { ReviewOffsetInput } from "@/components/ReviewOffsetInput"
import { toast } from "sonner"

// Same counting as the offset box: week = 7 days, month = 30 days.
const REVIEW_PRESETS: { label: string; amount: number; unit: ReviewOffsetUnit }[] = [
    { label: "1 week", amount: 1, unit: "weeks" },
    { label: "2 weeks", amount: 2, unit: "weeks" },
    { label: "1 month", amount: 1, unit: "months" },
    { label: "3 months", amount: 3, unit: "months" },
]

function errorMessage(err: unknown, fallback: string) {
    let message = err instanceof Error ? err.message : fallback
    try { message = JSON.parse(message).error || message } catch { /* not JSON */ }
    return message
}

// One patient in a review day: Change date (calendar + quick presets) and
// Reviewed / No show, both of which clear the review date (outcome goes to
// the audit log). Reviewed/No show need a second click to confirm, since an
// overdue date can't be set back once cleared (past dates are rejected).
function ReviewPatientRow({ patient, reviewDate, onChanged }: {
    patient: PatientReviewEntry
    reviewDate: string
    onChanged: () => void
}) {
    const [pickerOpen, setPickerOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [confirming, setConfirming] = useState<'reviewed' | 'no_show' | null>(null)
    const [offsetAmount, setOffsetAmount] = useState("")
    const [offsetUnit, setOffsetUnit] = useState<ReviewOffsetUnit>("days")
    const offsetDate = reviewDateFromOffset(offsetAmount, offsetUnit)

    const todayDate = new Date(getTodayIST() + 'T00:00:00')

    useEffect(() => {
        if (!confirming) return
        const t = setTimeout(() => setConfirming(null), 4000)
        return () => clearTimeout(t)
    }, [confirming])

    const changeDate = async (d: Date | string | null | undefined) => {
        if (!d) return
        if (typeof d === 'string') d = new Date(d + 'T00:00:00')
        const iso = format(d, 'yyyy-MM-dd')
        if (iso === reviewDate) { setPickerOpen(false); return }
        setBusy(true)
        try {
            await api.updatePatient(patient.patient_id, { next_review_date: iso })
            toast.success(`${patient.name}: review moved to ${format(d, 'dd MMM yyyy')}`)
            setPickerOpen(false)
            setOffsetAmount("")
            onChanged()
        } catch (err) {
            toast.error(errorMessage(err, 'Failed to change review date'))
        } finally {
            setBusy(false)
        }
    }

    const close = async (outcome: 'reviewed' | 'no_show') => {
        if (confirming !== outcome) { setConfirming(outcome); return }
        setConfirming(null)
        setBusy(true)
        try {
            await api.closePatientReview(patient.patient_id, outcome)
            toast.success(`${patient.name}: marked ${outcome === 'reviewed' ? 'Reviewed' : 'No show'}`)
            onChanged()
        } catch (err) {
            toast.error(errorMessage(err, 'Failed to update review'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border px-3 py-2.5 bg-muted/30">
            <div className="flex items-baseline gap-3 min-w-0">
                <span className="font-semibold truncate">{patient.name}</span>
                <span className="text-xs text-muted-foreground">{patient.phone_number}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                    {[patient.age ? `${patient.age}y` : null, patient.sex].filter(Boolean).join(' • ') || '—'}
                </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
                {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8" disabled={busy}>
                            <CalendarClock className="h-3.5 w-3.5 mr-1.5" /> Change date
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                        <div className="p-2 border-b space-y-2 max-w-[290px]">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">In</span>
                                <ReviewOffsetInput
                                    amount={offsetAmount}
                                    unit={offsetUnit}
                                    onChange={(a, u) => { setOffsetAmount(a); setOffsetUnit(u) }}
                                    onEnter={() => changeDate(offsetDate)}
                                />
                                <Button size="sm" className="h-9" disabled={busy || !offsetDate} onClick={() => changeDate(offsetDate)}>
                                    Set
                                </Button>
                            </div>
                            {offsetDate && (
                                <p className="text-xs text-muted-foreground">
                                    → {format(new Date(offsetDate + 'T00:00:00'), 'EEE, dd MMM yyyy')}
                                </p>
                            )}
                            <div className="flex flex-wrap gap-1">
                                {REVIEW_PRESETS.map(p => {
                                    const iso = reviewDateFromOffset(p.amount, p.unit)!
                                    return (
                                        <Button
                                            key={p.label}
                                            variant="secondary"
                                            size="sm"
                                            className="h-7 text-xs"
                                            disabled={busy}
                                            onClick={() => changeDate(iso)}
                                            title={format(new Date(iso + 'T00:00:00'), 'dd MMM yyyy')}
                                        >
                                            +{p.label}
                                        </Button>
                                    )
                                })}
                            </div>
                        </div>
                        <Calendar
                            mode="single"
                            selected={new Date(reviewDate + 'T00:00:00')}
                            defaultMonth={new Date(Math.max(todayDate.getTime(), new Date(reviewDate + 'T00:00:00').getTime()))}
                            onSelect={changeDate}
                            disabled={{ before: todayDate }}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>
                <Button
                    variant={confirming === 'reviewed' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8"
                    disabled={busy}
                    onClick={() => close('reviewed')}
                >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    {confirming === 'reviewed' ? 'Confirm Reviewed?' : 'Reviewed'}
                </Button>
                <Button
                    variant={confirming === 'no_show' ? 'destructive' : 'outline'}
                    size="sm"
                    className="h-8"
                    disabled={busy}
                    onClick={() => close('no_show')}
                >
                    <UserX className="h-3.5 w-3.5 mr-1.5" />
                    {confirming === 'no_show' ? 'Confirm No show?' : 'No show'}
                </Button>
            </div>
        </div>
    )
}

// Self-contained (owns its own fetch), unlike VisitsTab which receives data
// as props — Review data isn't shared with any other tab on this page, and
// it needs its own DatePickerWithRange + Apply flow (not the header's
// auto-fetch-on-change range filter used by All Visits), matching the
// Inventory page's "All Changes" panel this is modeled on.
export function ReviewTab() {
    const [days, setDays] = useState<PatientReviewDay[]>([])
    const [loading, setLoading] = useState(true)
    const [date, setDate] = useState<DateRange | undefined>()
    const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())

    // silent: refresh in place (after a row action) without the full-page spinner
    const load = async (range = date, silent = false) => {
        if (!silent) setLoading(true)
        try {
            const from = range?.from ? format(range.from, 'yyyy-MM-dd') : undefined
            const to = range?.to ? format(range.to, 'yyyy-MM-dd') : range?.from ? format(range.from, 'yyyy-MM-dd') : undefined
            const res = await api.getPatientReviews(from, to)
            setDays(res.days || [])
        } catch (err) {
            console.error("Failed to fetch reviews:", err)
            setDays([])
        } finally {
            setLoading(false)
        }
    }

    const resetDates = () => {
        setDate(undefined)
        load(undefined)
    }

    const toggleDay = (d: string) => {
        setExpandedDays(prev => {
            const next = new Set(prev)
            if (next.has(d)) next.delete(d)
            else next.add(d)
            return next
        })
    }

    const toggleExpandAll = () => {
        setExpandedDays(prev => prev.size === days.length ? new Set() : new Set(days.map(d => d.date)))
    }

    // Fires when this tab is first selected (Radix unmounts inactive
    // TabsContent by default) and again each time the user returns to it.
    useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const today = getTodayIST()

    return (
        <div className="space-y-6 overflow-y-auto h-full pr-1">
            <div className="flex justify-between items-center flex-wrap gap-4">
                <div className="flex gap-3 items-end flex-wrap">
                    <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Date Filter</label>
                        <DatePickerWithRange date={date} setDate={setDate} className="w-[260px]" />
                    </div>
                    <Button onClick={() => load(date)} variant="outline">Apply</Button>
                    <Button onClick={resetDates} variant="ghost" size="icon" title="Reset Dates">
                        <RotateCcw className="h-4 w-4" />
                    </Button>
                </div>
                {days.length > 0 && (
                    <Button variant="outline" size="sm" onClick={toggleExpandAll}>
                        {expandedDays.size === days.length ? "Collapse All" : "Expand All"}
                    </Button>
                )}
            </div>

            {loading && (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {!loading && days.map(day => {
                const isExpanded = expandedDays.has(day.date)
                const isOverdue = day.date < today
                const isToday = day.date === today
                return (
                    <Card key={day.date}>
                        <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => toggleDay(day.date)}>
                            <div className="flex justify-between items-center flex-wrap gap-2">
                                <CardTitle className="text-base flex items-center gap-2">
                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    {new Date(day.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                    {isOverdue && (
                                        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-[10px] h-5 hover:bg-red-100">Overdue</Badge>
                                    )}
                                    {isToday && (
                                        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] h-5 hover:bg-amber-100">Today</Badge>
                                    )}
                                    {!isOverdue && !isToday && (
                                        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 text-[10px] h-5 hover:bg-blue-100">Upcoming</Badge>
                                    )}
                                </CardTitle>
                                <span className="text-sm text-muted-foreground">
                                    {day.patients.length} patient{day.patients.length !== 1 ? 's' : ''}
                                </span>
                            </div>
                        </CardHeader>
                        {isExpanded && (
                            <CardContent className="space-y-2">
                                {day.patients.map(p => (
                                    <ReviewPatientRow
                                        key={p.patient_id}
                                        patient={p}
                                        reviewDate={day.date}
                                        onChanged={() => load(date, true)}
                                    />
                                ))}
                            </CardContent>
                        )}
                    </Card>
                )
            })}

            {!loading && days.length === 0 && (
                <div className="text-center text-muted-foreground py-12">No reviews scheduled.</div>
            )}
        </div>
    )
}
