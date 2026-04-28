"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Plus, Calendar, Loader2, AlertCircle } from "lucide-react"
import { api, type Visit, type Patient } from "@/lib/api"

export default function VisitsPage() {
    const [visits, setVisits] = useState<Visit[]>([])
    const [patients, setPatients] = useState<Patient[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [submitting, setSubmitting] = useState(false)

    // Form state
    const [formData, setFormData] = useState({
        patient_id: "",
        visit_date: new Date().toISOString().split('T')[0],
        reason: "",
        prescription: "",
        notes: "",
    })

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        setLoading(true)
        setError(null)
        try {
            const [visitsData, patientsData] = await Promise.all([
                api.getVisits(),
                api.getPatients(),
            ])
            setVisits(visitsData)
            setPatients(patientsData)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load data")
        } finally {
            setLoading(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!formData.patient_id) {
            alert("Please select a patient")
            return
        }

        setSubmitting(true)
        try {
            await api.createVisit({
                patient_id: formData.patient_id,
                visit_date: formData.visit_date,
                reason: formData.reason || undefined,
                prescription: formData.prescription || undefined,

            })

            // Reset form
            setFormData({
                patient_id: "",
                visit_date: new Date().toISOString().split('T')[0],
                reason: "",
                prescription: "",
                notes: "",
            })

            // Close dialog and reload data
            setDialogOpen(false)
            await loadData()
        } catch (err) {
            alert(`Failed to create visit: ${err instanceof Error ? err.message : "Unknown error"}`)
        } finally {
            setSubmitting(false)
        }
    }

    const getPatientPublicIdFromVisit = (visit: Visit) => {
        // Extracting patient ID from visit_id (format: PATIENTID-DATE-RANDOM)
        return visit.visit_id.split('-')[0] || "N/A"
    }

    const formatTime = (timeStr: string | null | undefined, createdAt?: string | null) => {
        if (!timeStr) {
            if (!createdAt) return "-"
            try {
                const date = new Date(createdAt)
                const h = date.getHours()
                const m = date.getMinutes().toString().padStart(2, '0')
                const ampm = h >= 12 ? 'PM' : 'AM'
                const h12 = h % 12 || 12
                return `${h12}:${m} ${ampm}`
            } catch (e) {
                return "-"
            }
        }
        try {
            const [hours, minutes] = timeStr.split(':')
            const h = parseInt(hours, 10)
            const ampm = h >= 12 ? 'PM' : 'AM'
            const h12 = h % 12 || 12
            return `${h12}:${minutes} ${ampm}`
        } catch (e) {
            return timeStr
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Visits</h1>
                    <p className="text-muted-foreground">Manage patient visits and records</p>
                </div>
                <Card className="border-red-500/50 bg-red-500/10">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-red-500">
                            <AlertCircle className="h-5 w-5" />
                            Connection Error
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm">{error}</p>
                        <Button onClick={loadData} className="mt-4" variant="outline">
                            Retry
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Visits</h1>
                    <p className="text-muted-foreground">
                        Manage patient visits and records
                    </p>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Visit
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[500px]">
                        <form onSubmit={handleSubmit}>
                            <DialogHeader>
                                <DialogTitle>Add New Visit</DialogTitle>
                                <DialogDescription>
                                    Record a new patient visit. All fields except patient and date are optional.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="space-y-2">
                                    <label htmlFor="patient" className="text-sm font-medium">
                                        Patient *
                                    </label>
                                    <select
                                        id="patient"
                                        value={formData.patient_id}
                                        onChange={(e) => setFormData({ ...formData, patient_id: e.target.value })}
                                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        required
                                    >
                                        <option value="">Select a patient</option>
                                        {patients.map((patient) => (
                                            <option key={patient.patient_id} value={patient.patient_id}>
                                                {patient.name} ({patient.patient_id})
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <label htmlFor="visit_date" className="text-sm font-medium">
                                        Visit Date *
                                    </label>
                                    <Input
                                        id="visit_date"
                                        type="date"
                                        value={formData.visit_date}
                                        onChange={(e) => setFormData({ ...formData, visit_date: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label htmlFor="reason" className="text-sm font-medium">
                                        Reason for Visit
                                    </label>
                                    <Input
                                        id="reason"
                                        value={formData.reason}
                                        onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                                        placeholder="Enter reason for visit"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label htmlFor="prescription" className="text-sm font-medium">
                                        Prescription
                                    </label>
                                    <Input
                                        id="prescription"
                                        value={formData.prescription}
                                        onChange={(e) => setFormData({ ...formData, prescription: e.target.value })}
                                        placeholder="Enter prescription"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label htmlFor="notes" className="text-sm font-medium">
                                        Notes
                                    </label>
                                    <textarea
                                        id="notes"
                                        value={formData.notes}
                                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                        placeholder="Additional notes"
                                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[100px]"
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setDialogOpen(false)}
                                    disabled={submitting}
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={submitting}>
                                    {submitting ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Creating...
                                        </>
                                    ) : (
                                        "Create Visit"
                                    )}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        Recent Visits
                    </CardTitle>
                    <CardDescription>
                        {visits.length} total visits recorded
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {visits.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No visits recorded yet</p>
                            <p className="text-sm mt-2">Click "Add Visit" to create your first visit record</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Visit Date</TableHead>
                                    <TableHead>Visit Time</TableHead>
                                    <TableHead>Patient</TableHead>
                                    <TableHead>Patient ID</TableHead>
                                    <TableHead>Visit ID</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Reason</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {visits.sort((a, b) => new Date(b.visit_date).getTime() - new Date(a.visit_date).getTime()).map((visit) => (
                                    <TableRow
                                        key={visit.visit_id}
                                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900"
                                        onClick={() => window.location.href = `/visits/${visit.visit_id}`}
                                    >
                                        <TableCell className="font-medium">
                                            {new Date(visit.visit_date).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {formatTime(visit.visit_time, visit.created_at)}
                                        </TableCell>
                                        <TableCell className="font-semibold">{visit.patient_name}</TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                            {getPatientPublicIdFromVisit(visit)}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                            {visit.visit_id}
                                        </TableCell>
                                        <TableCell>{visit.status}</TableCell>
                                        <TableCell>{visit.reason || "-"}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
