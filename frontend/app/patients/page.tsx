"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

import { UserPlus, Search, Eye, Edit, Loader2, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react"
import { api, type Patient } from "@/lib/api"
import { AddPatientDialog } from "@/components/AddPatientDialog"
import { EditPatientDialog } from "@/components/EditPatientDialog"
import { PatientDetailsView } from "@/components/PatientDetailsView"
import { useAuth } from "@/lib/auth_context"

const PAGE_LIMIT = 50

export default function PatientsPage() {
    const { role } = useAuth()
    const [patients, setPatients] = useState<Patient[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [viewDialogOpen, setViewDialogOpen] = useState(false)
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
    const [page, setPage] = useState(1)

    const [searchQuery, setSearchQuery] = useState("")



    const loadData = async (pageNum = page) => {
        setLoading(true)
        setError(null)
        try {
            const data = await api.getPatients(pageNum, PAGE_LIMIT)
            setPatients(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load patients")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadData(page)
    }, [page]) // eslint-disable-line react-hooks/exhaustive-deps



    // Filter patients based on search
    const filteredPatients = patients.filter(patient =>
        patient.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        patient.patient_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        patient.phone_number.includes(searchQuery)
    )

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Patients</h1>
                    <p className="text-muted-foreground">
                        Manage patient records and history.
                    </p>
                </div>

                <AddPatientDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    onSuccess={() => {
                        setDialogOpen(false)
                        loadData(page)
                    }}
                    trigger={
                        <Button>
                            <UserPlus className="mr-2 h-4 w-4" />
                            Add Patient
                        </Button>
                    }
                />

                {selectedPatient && (
                    <>
                        <EditPatientDialog
                            open={editDialogOpen}
                            onOpenChange={setEditDialogOpen}
                            patient={selectedPatient}
                            onSuccess={() => {
                                loadData(page)
                                setEditDialogOpen(false)
                            }}
                        />
                        {role === 'doctor' && (
                            <PatientDetailsView
                                open={viewDialogOpen}
                                onOpenChange={setViewDialogOpen}
                                patient={selectedPatient}
                            />
                        )}
                    </>
                )}
            </div>

            {error && (
                <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 flex items-center gap-3 text-red-500">
                    <AlertCircle className="h-5 w-5" />
                    <div className="flex-1">
                        <p className="font-medium">Connection Error</p>
                        <p className="text-sm text-red-500/90">{error}</p>
                        <p className="text-xs mt-1 text-red-500/80">
                            Make sure your backend is running and CORS is enabled.
                        </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => loadData(page)} className="border-red-500/20 hover:bg-red-500/20">
                        Retry
                    </Button>
                </div>
            )}

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                    <CardTitle className="text-lg font-medium">Patient List — Page {page}</CardTitle>
                    <div className="relative w-72">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search patients..."
                            className="pl-9"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Public ID</TableHead>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Phone</TableHead>
                                        <TableHead>Date of Birth</TableHead>
                                        <TableHead>Joined</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredPatients.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                No patients found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredPatients.map((patient, index) => (
                                            <TableRow key={`${patient.patient_id}-${index}`}>
                                                <TableCell className="font-medium font-mono text-xs text-muted-foreground">
                                                    {patient.patient_id}
                                                </TableCell>
                                                <TableCell className="font-semibold">{patient.name}</TableCell>
                                                <TableCell>{patient.phone_number}</TableCell>
                                                <TableCell>{patient.dob ? new Date(patient.dob).toLocaleDateString() : "N/A"}</TableCell>
                                                <TableCell>{patient.created_at ? new Date(patient.created_at).toLocaleDateString() : "N/A"}</TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        {role === 'doctor' && (
                                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                                                                setSelectedPatient(patient)
                                                                setViewDialogOpen(true)
                                                            }}>
                                                                <Eye className="h-4 w-4" />
                                                                <span className="sr-only">View</span>
                                                            </Button>
                                                        )}
                                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                                                            setSelectedPatient(patient)
                                                            setEditDialogOpen(true)
                                                        }}>
                                                            <Edit className="h-4 w-4" />
                                                            <span className="sr-only">Edit</span>
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                            {/* Pagination controls */}
                            <div className="flex items-center justify-between pt-4 border-t mt-4">
                                <p className="text-sm text-muted-foreground">
                                    Page {page} &middot; {patients.length} records
                                </p>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage(p => p - 1)}
                                        disabled={page === 1}
                                    >
                                        <ChevronLeft className="h-4 w-4 mr-1" />
                                        Previous
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage(p => p + 1)}
                                        disabled={patients.length < PAGE_LIMIT}
                                    >
                                        Next
                                        <ChevronRight className="h-4 w-4 ml-1" />
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
