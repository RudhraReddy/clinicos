"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Calendar as CalendarIcon, UserPlus, Loader2, Users, Phone, CreditCard, Pencil, Trash2 } from "lucide-react"
import { cn, getTodayIST } from "@/lib/utils"
import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth_context"
import { useSettings } from "@/lib/settings_context"
import { AddPatientDialog } from "@/components/AddPatientDialog"
import { AddVisitDialog } from "@/components/AddVisitDialog"
import { EditVisitDialog } from "@/components/EditVisitDialog"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { api, type Visit, type Patient } from "@/lib/api"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CalendarComponent } from "@/components/CalendarComponent"
import { DndProvider } from "react-dnd"
import { HTML5Backend } from "react-dnd-html5-backend"
import { format } from "date-fns"



function formatTime(timeStr: string | null | undefined, createdAt?: string | null) {
  if (!timeStr) {
    if (!createdAt) return "ASAP";
    try {
      const date = new Date(createdAt);
      const h = date.getHours();
      const m = date.getMinutes().toString().padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${m} ${ampm}`;
    } catch (e) {
      return "ASAP";
    }
  }
  try {
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  } catch (e) {
    return timeStr;
  }
}

function formatUpdatedTime(updatedAtStr?: string, createdAtStr?: string) {
  if (!updatedAtStr) return null;
  try {
    const created = createdAtStr ? new Date(createdAtStr).getTime() : 0;
    const updated = new Date(updatedAtStr).getTime();
    if (Math.abs(updated - created) > 5000) {
      const date = new Date(updatedAtStr);
      const h = date.getHours();
      const m = date.getMinutes().toString().padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${m} ${ampm}`;
    }
  } catch (e) {
    // Ignore error
  }
  return null;
}

const PatientContactPopover = ({ patientId }: { patientId: string }) => {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open && !patient) {
      setLoading(true)
      api.getPatient(patientId)
        .then(setPatient)
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [open, patient, patientId])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center justify-center p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <Phone className="h-3.5 w-3.5" />
          <span className="sr-only">Contact Info</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-4">
          <h4 className="font-semibold leading-none">Contact Information</h4>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : patient ? (
            <div className="grid gap-2">
              <div className="grid grid-cols-3 items-center gap-4">
                <span className="text-sm font-medium">Name:</span>
                <span className="text-sm col-span-2">{patient.name}</span>
              </div>
              <div className="grid grid-cols-3 items-center gap-4">
                <span className="text-sm font-medium">Phone:</span>
                <span className="text-sm col-span-2">{patient.phone_number}</span>
              </div>
              <div className="grid grid-cols-3 items-center gap-4">
                <span className="text-sm font-medium">DOB:</span>
                <span className="text-sm col-span-2">{patient.dob}</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-destructive">Failed to load details</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VisitsTab } from "@/components/VisitsTab"

export default function Dashboard() {
  const { appFontSize } = useSettings()
  const [showCalendar, setShowCalendar] = useState(true)

  useEffect(() => {
    if (appFontSize > 16) {
      setShowCalendar(false)
    } else {
      setShowCalendar(true)
    }
  }, [appFontSize])

  const [addPatientOpen, setAddPatientOpen] = useState(false)

  // Dialog State
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [calendarAddOpen, setCalendarAddOpen] = useState(false)
  const [editVisitOpen, setEditVisitOpen] = useState(false)

  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)

  // Selection State
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined)
  const [selectedTime, setSelectedTime] = useState<string | undefined>(undefined)
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)

  const fetchVisits = async () => {
    try {
      setLoading(true)
      const allVisits = await api.getVisits()
      // We use all visits for the calendar
      // But we still need to filter for the list "Today's Appointments" which is now on the right
      setVisits(allVisits.filter(v => v.status !== 'deleted'))
    } catch (err) {
      console.error("Failed to fetch visits:", err)
    } finally {
      setLoading(false)
    }
  }

  const { role, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // Only redirect once we are sure of the role
    if (!isLoading && role === 'doctor') {
      router.push('/doctor')
    }
  }, [role, isLoading, router])

  useEffect(() => {
    fetchVisits()
  }, [])

  // Prevent flash of content:
  // If loading, OR if we are a doctor (waiting for redirect), show loader.
  if (isLoading || role === 'doctor') {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const handleVisitCreated = () => {
    fetchVisits()
  }

  const handleVisitUpdated = () => {
    fetchVisits()
  }

  const handleEventDrop = async (event: any, start: Date, end: Date) => {
    const dateStr = format(start, 'yyyy-MM-dd')
    try {
      const timeStr = format(start, 'HH:mm')

      // Optimistic update
      const updatedVisits = visits.map(v =>
        v.visit_id === event.id
          ? { ...v, visit_date: dateStr, visit_time: timeStr }
          : v
      )
      setVisits(updatedVisits)

      await api.updateVisit(event.id, {
        visit_date: dateStr,
        visit_time: timeStr
      })

      // fetchVisits() // Optional: confirm from server
    } catch (error) {
      console.error("Failed to update visit drop:", error)
      fetchVisits() // Revert on error
    }
  }

  const handleSelectSlot = (start: Date) => {
    setSelectedDate(format(start, 'yyyy-MM-dd'))
    setSelectedTime(format(start, 'HH:mm'))
    setCalendarAddOpen(true)
  }

  const onSelectEvent = (visit: Visit) => {
    setSelectedVisit(visit)
    setEditVisitOpen(true)
  }

  // Calculate stats for "Today's List"
  const today = getTodayIST()
  const todayVisits = visits.filter(v => v.visit_date === today)

  // Sort strictly by time, ignoring status
  const orderedTodayVisits = [...todayVisits].sort((a, b) => {
    const timeA = a.visit_time || "23:59" // Push undefined times to end? Or start? Usually appointments have time.
    const timeB = b.visit_time || "23:59"
    if (timeA === timeB) {
      return (a.created_at || "").localeCompare(b.created_at || "")
    }
    return timeA.localeCompare(timeB)
  })

  const waitingCount = todayVisits.filter(v =>
    !['in_progress', 'done', 'cancelled'].includes(v.status.toLowerCase())
  ).length;

  const renderQuickActions = () => (
    <Card>
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-lg">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-5 pb-5">
        <AddVisitDialog
          open={quickAddOpen}
          onOpenChange={setQuickAddOpen}
          onSuccess={handleVisitCreated}
          trigger={
            <Button
              variant="outline"
              className="w-full justify-start h-10 text-sm font-normal"
            >
              <CalendarIcon className="mr-3 h-4 w-4 text-muted-foreground" />
              Make Appointment
            </Button>
          }
        />
        <Button
          variant="outline"
          className="w-full justify-start h-10 text-sm font-normal"
          onClick={() => setAddPatientOpen(true)}
        >
          <UserPlus className="mr-3 h-4 w-4 text-muted-foreground" />
          New Patient
        </Button>
        <Button variant="outline" className="w-full justify-start h-10 text-sm font-normal" asChild>
          <Link href="/patients">
            <Users className="mr-3 h-4 w-4 text-muted-foreground" />
            Manage Patients
          </Link>
        </Button>
      </CardContent>
    </Card>
  );

  const handleDeleteVisit = async (visitId: string) => {
    if (confirm("Are you sure you want to delete this visit?")) {
      try {
        await api.updateVisit(visitId, { status: 'deleted' });
        fetchVisits();
      } catch (err) {
        console.error("Failed to delete visit:", err);
        alert("Failed to delete visit");
      }
    }
  };

  const handleDoneAndBill = async (visit: Visit) => {
    try {
      if (visit.status !== 'done') {
        await api.updateVisit(visit.visit_id, { status: 'done' });
      }
      router.push(`/billing?patient_id=${visit.patient_id}&visit_id=${visit.visit_id}`);
    } catch (err) {
      console.error("Failed to complete visit for billing:", err);
      alert("Failed to complete visit for billing");
    }
  };

  const renderTodaysList = () => (
    <Card className="flex-1 flex flex-col overflow-hidden">
      <CardHeader className="pb-3 pt-5 px-5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Today&apos;s List</CardTitle>
          <span className="text-xs font-normal text-muted-foreground bg-secondary px-2 py-1 rounded-md">
            {loading ? "..." : waitingCount} Waiting
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto p-0 custom-scrollbar">
        <style jsx global>{`
          /* Custom Scrollbar for Today's List */
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background-color: #cbd5e1; /* slate-300 */
            border-radius: 20px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background-color: #94a3b8; /* slate-400 */
          }
          :global(.dark) .custom-scrollbar::-webkit-webkit-scrollbar-thumb {
            background-color: #475569; /* slate-600 */
          }
        `}</style>
        {loading ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            Loading...
          </div>
        ) : orderedTodayVisits.length === 0 ? (
          <div className="py-4 mx-5 text-center text-muted-foreground text-sm border-2 border-dashed rounded-lg mt-2">
            No appointments today.
          </div>
        ) : (
          <div className="space-y-0 text-sm">
            {orderedTodayVisits.map((visit) => (
              <div
                key={visit.visit_id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 border-b last:border-0 border-border/50 hover:bg-muted/30 transition-all rounded-sm px-5"
              >
                <div className="space-y-0.5 text-left overflow-hidden">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm leading-none truncate">{visit.patient_name}</p>
                    {visit.patient_id && <PatientContactPopover patientId={visit.patient_id} />}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {visit.reason || "No reason"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-end mr-1">
                    <span className="text-xs font-mono text-muted-foreground tabular-nums">
                      {formatTime(visit.visit_time, visit.created_at)}
                    </span>
                    {formatUpdatedTime(visit.updated_at, visit.created_at) && (
                      <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 tabular-nums">
                        Edited {formatUpdatedTime(visit.updated_at, visit.created_at)}
                      </span>
                    )}
                  </div>

                  {/* Actions Row */}
                  <div className="flex items-center gap-1">
                    {/* Done & Bill */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-500/20 dark:hover:text-green-400"
                      onClick={() => handleDoneAndBill(visit)}
                      title="Done & Bill"
                    >
                      <CreditCard className="h-4 w-4 text-muted-foreground hover:text-green-600 dark:hover:text-green-400 transition-colors" />
                    </Button>

                    {/* Edit */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-500/20 dark:hover:text-blue-400"
                      onClick={() => onSelectEvent(visit)}
                      title="Edit Appointment"
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors" />
                    </Button>

                    {/* Delete */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-500/20 dark:hover:text-red-400"
                      onClick={() => handleDeleteVisit(visit.visit_id)}
                      title="Delete Appointment"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
        {/* Header - Fixed Height */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Overview of clinic activities and patient status.
          </p>
        </div>

        <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="visits">All Visits</TabsTrigger>
            </TabsList>
            <Button variant="outline" size="sm" onClick={() => setShowCalendar(!showCalendar)}>
              {showCalendar ? "Hide Calendar" : "Show Calendar"}
            </Button>
          </div>

          <TabsContent value="overview" className="flex-1 overflow-hidden m-0">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
              {showCalendar ? (
                <>
                  {/* Left Column: Interactive Calendar (Span 2) */}
                  <div className="lg:col-span-2 h-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <CalendarComponent
                      visits={visits}
                      onEventDrop={handleEventDrop}
                      onSelectSlot={handleSelectSlot}
                      onSelectEvent={onSelectEvent}
                    />
                  </div>

                  {/* Right Column: Actions & Today's List */}
                  <div className="lg:col-span-1 h-full flex flex-col gap-6 pr-1 overflow-hidden transition-all duration-300">
                    {renderQuickActions()}
                    {renderTodaysList()}
                  </div>
                </>
              ) : (
                <>
                  {/* Left Column: Today's List (Span 2) */}
                  <div className="lg:col-span-2 h-full flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    {renderTodaysList()}
                  </div>

                  {/* Right Column: Quick Actions */}
                  <div className="lg:col-span-1 h-full flex flex-col gap-6 pr-1 overflow-hidden transition-all duration-300">
                    {renderQuickActions()}
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="visits" className="h-[calc(100%-40px)] m-0">
            <VisitsTab visits={visits} loading={loading} onRefresh={fetchVisits} />
          </TabsContent>
        </Tabs>

        <AddPatientDialog
          open={addPatientOpen}
          onOpenChange={setAddPatientOpen}
          onSuccess={() => {
            setAddPatientOpen(false)
          }}
        />

        <AddVisitDialog
          open={calendarAddOpen}
          onOpenChange={setCalendarAddOpen}
          initialDate={selectedDate}
          initialTime={selectedTime}
          onSuccess={() => {
            fetchVisits()
            setCalendarAddOpen(false)
          }}
          trigger={null}
        />

        <EditVisitDialog
          open={editVisitOpen}
          onOpenChange={setEditVisitOpen}
          visit={selectedVisit}
          onSuccess={handleVisitUpdated}
        />
      </div>
    </DndProvider >
  )
}
