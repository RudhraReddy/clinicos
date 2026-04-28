"use client"

import { useState, useMemo } from "react"
import { Calendar, dateFnsLocalizer, Views, View } from "react-big-calendar"
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop"
import { format, parse, startOfWeek, getDay } from "date-fns"
import { enUS } from "date-fns/locale"
import { Visit } from "@/lib/api"
import "react-big-calendar/lib/css/react-big-calendar.css"
import "react-big-calendar/lib/addons/dragAndDrop/styles.css"
import { Card, CardContent } from "@/components/ui/card"
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn, getTodayIST } from "@/lib/utils"

const locales = {
    "en-US": enUS,
}

const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek,
    getDay,
    locales,
})

const DnDCalendar = withDragAndDrop(Calendar)

interface CalendarComponentProps {
    visits: Visit[]
    onEventDrop: (event: any, start: Date, end: Date) => void
    onSelectSlot: (start: Date) => void
    onSelectEvent: (visit: Visit) => void
}

export function CalendarComponent({ visits, onEventDrop, onSelectSlot, onSelectEvent }: CalendarComponentProps) {
    const [view, setView] = useState<View>(Views.DAY)
    // Initialize with IST Today (Local Midnight of the IST Date)
    const [date, setDate] = useState(() => new Date(getTodayIST() + "T00:00:00"))

    // define resources for Day View (10-min columns)
    // USING STRING IDs to be safe
    const minuteColumns = useMemo(() => [
        { id: '0', title: '' },
        { id: '10', title: '' },
        { id: '20', title: '' },
        { id: '30', title: '' },
        { id: '40', title: '' },
        { id: '50', title: '' },
    ], [])

    // Transform visits to calendar events
    const events = useMemo(() => {
        return visits.map((visit) => {
            if (!visit.visit_date) return null

            const start = new Date(`${visit.visit_date}T${visit.visit_time || "00:00"}`)
            const minutes = start.getMinutes()
            // bucket minutes to nearest 10
            const resourceId = (Math.floor(minutes / 10) * 10).toString()

            // Visual: Normalize to top of hour (XX:00:00) to snap to grid line
            const visualStart = new Date(start)
            visualStart.setMinutes(0, 0, 0)

            // Visual: Fill the 1-hour slot (60 mins) to look like a full cell
            const end = new Date(visualStart.getTime() + 60 * 60000)

            return {
                id: visit.visit_id,
                title: visit.patient_name,
                start: visualStart, // Use Normalized Start for Visuals
                end,
                resourceId: resourceId, // String ID
                resource: visit,
                status: visit.status
            }
        }).filter(Boolean) as any[]
    }, [visits])

    const { formats } = useMemo(() => ({
        formats: {
            eventTimeRangeFormat: () => "", // Hide time text
        }
    }), [])

    const eventStyleGetter = (event: any) => {
        let color = "#f97316" // orange-500 (Default/Next)
        if (event.status === 'done') color = "#22c55e" // green-500
        if (event.status === 'cancelled') color = "#ef4444" // red-500
        if (event.status === 'in_progress') color = "#3b82f6" // blue-500

        // We return inline style for the border color which is dynamic based on status
        // But we rely on CSS for the background and text color to handle dark mode
        return {
            style: {
                borderLeft: `4px solid ${color}`,
            },
            className: "event-node"
        }
    }

    const handleEventDrop = async (event: any, start: Date, end: Date, resourceId?: string) => {
        // If resourceId implies we are in Day View (Column Mode)
        let newDateStr = format(start, 'yyyy-MM-dd')
        let newTimeStr = ""

        if (view === Views.DAY && resourceId) {
            // New Time = Dropped Hour + Dropped Resource Minute
            const hour = start.getHours()
            const minute = parseInt(resourceId, 10)
            newTimeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
        } else {
            // Standard Drop
            newTimeStr = format(start, 'HH:mm')
        }

        // Optimistic Update
        try {
            onEventDrop(event, new Date(`${newDateStr}T${newTimeStr}`), new Date(`${newDateStr}T${newTimeStr}`))
        } catch (e) {
            console.error("Drop update failed", e)
        }
    }

    const handleNavigate = (action: 'PREV' | 'NEXT' | 'TODAY') => {
        if (action === 'PREV') {
            const newDate = new Date(date)
            if (view === Views.DAY) newDate.setDate(date.getDate() - 1)
            else if (view === Views.WEEK) newDate.setDate(date.getDate() - 7)
            else if (view === Views.MONTH) newDate.setMonth(date.getMonth() - 1)
            setDate(newDate)
        } else if (action === 'NEXT') {
            const newDate = new Date(date)
            if (view === Views.DAY) newDate.setDate(date.getDate() + 1)
            else if (view === Views.WEEK) newDate.setDate(date.getDate() + 7)
            else if (view === Views.MONTH) newDate.setMonth(date.getMonth() + 1)
            setDate(newDate)
        } else {
            // Reset to IST Today
            setDate(new Date(getTodayIST() + "T00:00:00"))
        }
    }

    return (
        <Card className="h-full shadow-sm flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={() => handleNavigate('PREV')}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" onClick={() => handleNavigate('TODAY')}>
                        Today
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => handleNavigate('NEXT')}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <span className="text-lg font-semibold ml-2">
                        {format(date, view === Views.DAY ? 'MMMM d, yyyy' : 'MMMM yyyy')}
                    </span>
                    <div className="relative">
                        <Button variant="ghost" size="icon" className="h-8 w-8 ml-2">
                            <CalendarIcon className="h-4 w-4" />
                        </Button>
                        <input
                            type="date"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={(e) => {
                                if (e.target.value) {
                                    setDate(new Date(e.target.value))
                                }
                            }}
                            value={format(date, 'yyyy-MM-dd')}
                        />
                    </div>
                </div>

                <div className="flex items-center bg-muted p-1 rounded-lg">
                    <button
                        onClick={() => setView(Views.MONTH)}
                        className={cn("px-3 py-1 text-sm rounded-md transition-all", view === Views.MONTH ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")}
                    >
                        Month
                    </button>
                    <button
                        onClick={() => setView(Views.WEEK)}
                        className={cn("px-3 py-1 text-sm rounded-md transition-all", view === Views.WEEK ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")}
                    >
                        Week
                    </button>
                    <button
                        onClick={() => setView(Views.DAY)}
                        className={cn("px-3 py-1 text-sm rounded-md transition-all", view === Views.DAY ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")}
                    >
                        Day
                    </button>
                </div>
            </div>
            <CardContent className="p-0 flex-1 overflow-hidden">
                <style jsx global>{`
                   /* Resource Header Styling */
                   .rbc-header {
                       font-size: 0.85rem;
                       font-weight: 500;
                       color: #6b7280;
                   }
                   
                   .event-node {
                       background-color: #f1f5f9;
                       color: #1f2937;
                       border-top: 1px solid #e5e7eb;
                       border-right: 1px solid #e5e7eb;
                       border-bottom: 1px solid #e5e7eb;
                       border-radius: 4px;
                       font-size: 0.85rem;
                       font-weight: 500;
                       box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
                       padding: 2px 4px;
                   }
                   
                   :global(.dark) .event-node {
                       background-color: #2B2B2B;
                       color: #CCCCCC;
                       border-top-color: #BFBFBF;
                       border-right-color: #BFBFBF;
                       border-bottom-color: #BFBFBF;
                   }
                   /* Hide All Day Row */
                   .rbc-allday-cell {
                       display: none !important;
                   }

                   /* Dark Mode Time Gutter & Label Fixes */
                   :global(.dark) .rbc-time-gutter .rbc-timeslot-group {
                       border-bottom-color: rgba(191, 191, 191, 0.5) !important;
                       background-color: #1f1f1f !important;
                   }
                   :global(.dark) .rbc-time-gutter {
                       background-color: #1f1f1f !important;
                   }
                   :global(.dark) .rbc-label {
                       color: #BFBFBF; /* Matching separation color or slightly darker */
                   }
                   :global(.dark) .rbc-time-view .rbc-allday-cell {
                        display: none;
                   }
                   /* Dark Mode Overrides */
                   :global(.dark) .rbc-calendar {
                       color: #CCCCCC;
                       background-color: #1f1f1f;
                   }
                   :global(.dark) .rbc-time-view {
                       background-color: #1f1f1f;
                   }
                   :global(.dark) .rbc-day-slot {
                       background-color: #1f1f1f;
                   }
                   :global(.dark) .rbc-time-column {
                       background-color: #1f1f1f !important;
                   }
                   :global(.dark) .rbc-time-slot {
                       background-color: #1f1f1f !important;
                   }
                   :global(.dark) .rbc-off-range-bg {
                       background-color: #1a1a1a;
                   }
                   :global(.dark) .rbc-header {
                       color: #CCCCCC;
                       border-bottom-color: rgba(191, 191, 191, 0.5);
                   }
                   :global(.dark) .rbc-day-bg, 
                   :global(.dark) .rbc-time-content, 
                   :global(.dark) .rbc-time-header-content {
                       border-color: rgba(191, 191, 191, 0.5) !important;
                   }
                   :global(.dark) .rbc-timeslot-group {
                       border-bottom-color: rgba(191, 191, 191, 0.5) !important;
                       background-color: #1f1f1f !important; /* Fix white background in slots */
                   }
                   :global(.dark) .rbc-time-view, 
                   :global(.dark) .rbc-month-view, 
                   :global(.dark) .rbc-header + .rbc-header {
                       border-color: rgba(191, 191, 191, 0.5) !important;
                   }
                   :global(.dark) .rbc-day-slot .rbc-time-slot {
                       border-top-color: rgba(191, 191, 191, 0.5) !important;
                   }
                   :global(.dark) .rbc-today {
                       background-color: #252525;
                   }
                   :global(.dark) button.rbc-button-link {
                       color: #CCCCCC;
                   }
                `}</style>
                <DnDCalendar
                    localizer={localizer}
                    events={events}
                    startAccessor={(event: any) => event.start}
                    endAccessor={(event: any) => event.end}
                    defaultView={Views.DAY}
                    view={view}
                    onView={setView}
                    date={date}
                    onNavigate={setDate}
                    toolbar={false}
                    formats={formats}
                    style={{ height: "100%" }}

                    // Custom Event Component
                    components={{
                        event: ({ event }: any) => (
                            <div className="flex flex-col h-full justify-center">
                                <div className="font-semibold text-sm leading-none">{event.title}</div>
                                {event.resource.reason && (
                                    <div className="text-[10px] opacity-75 mt-1 truncate leading-tight">
                                        {event.resource.reason}
                                    </div>
                                )}
                            </div>
                        )
                    }}

                    // Resource Props for Day View
                    resources={view === Views.DAY ? minuteColumns : undefined}
                    resourceIdAccessor={(r: any) => r.id}
                    resourceTitleAccessor={(r: any) => r.title}
                    resourceAccessor={(e: any) => e.resourceId}

                    onEventDrop={({ event, start, end, resourceId }: any) => handleEventDrop(event, start, end, resourceId)}
                    onSelectSlot={({ start }: { start: Date }) => {
                        if (view === Views.MONTH) {
                            setDate(start)
                            setView(Views.DAY)
                        } else {
                            onSelectSlot(start)
                        }
                    }}
                    onSelectEvent={(event: any) => onSelectEvent(event.resource)}
                    selectable
                    resizable={false} // Simplify for now
                    eventPropGetter={eventStyleGetter}

                    // 1 Hour slots for the Rows (since minutes are now columns)
                    step={60}
                    timeslots={1}
                />
            </CardContent>
        </Card >
    )
}
