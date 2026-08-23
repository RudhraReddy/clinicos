"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, ChevronDown, ChevronRight, RotateCcw } from "lucide-react"
import { DatePickerWithRange } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"
import { format } from "date-fns"
import { api, type PatientReviewDay } from "@/lib/api"
import { getTodayIST } from "@/lib/utils"

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

    const load = async (range = date) => {
        setLoading(true)
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
                                    <div
                                        key={p.patient_id}
                                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 bg-muted/30"
                                    >
                                        <div className="flex items-baseline gap-3 min-w-0">
                                            <span className="font-semibold truncate">{p.name}</span>
                                            <span className="text-xs text-muted-foreground">{p.phone_number}</span>
                                        </div>
                                        <span className="text-xs text-muted-foreground shrink-0">
                                            {[p.age ? `${p.age}y` : null, p.sex].filter(Boolean).join(' • ') || '—'}
                                        </span>
                                    </div>
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
