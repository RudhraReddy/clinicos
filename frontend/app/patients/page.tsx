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

import { UserPlus, Search, Eye, Edit, Loader2, AlertCircle, FileText, Download, Upload, Columns, Menu, Package, CreditCard, LayoutDashboard } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import Link from "next/link"
import { api, type Patient } from "@/lib/api"
import { AddPatientDialog } from "@/components/AddPatientDialog"
import { EditPatientDialog } from "@/components/EditPatientDialog"
import { PatientDetailsView } from "@/components/PatientDetailsView"
import { useAuth } from "@/lib/auth_context"
import { useMenu } from "@/components/layout/AppShell"
import { useSettings, ALL_PATIENT_COLUMNS } from "@/lib/settings_context"
import { toast } from "sonner"

export default function PatientsPage() {
    const { role } = useAuth()
    const { openMenu } = useMenu()
    const { defaultPatientColumns } = useSettings()
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(defaultPatientColumns))

    useEffect(() => {
        setVisibleColumns(new Set(defaultPatientColumns))
    }, [defaultPatientColumns])

    const toggleColumn = (id: string) => {
        if (id === 'name') return
        setVisibleColumns(prev => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }
    const [patients, setPatients] = useState<Patient[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [viewDialogOpen, setViewDialogOpen] = useState(false)
    const [viewMode, setViewMode] = useState<'full' | 'clinic'>('full')
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
    const [importing, setImporting] = useState(false)

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setImporting(true)
        try {
            const res = await api.importPatients(file)
            toast.success(`Batch Sync Complete: Added ${res.counts?.new || 0}, Updated ${res.counts?.updated || 0}.`)
            loadData()
        } catch (err: any) {
            toast.error(err.message || "Failed to ingest patient document.")
        } finally {
            setImporting(false)
            e.target.value = ""
        }
    }

    const handleExport = () => {
        toast.info("Aggregating registry for download...")
        api.exportPatients()
    }

    const [searchQuery, setSearchQuery] = useState("")



    const loadData = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await api.getPatients(1, 100000)
            setPatients(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load patients")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadData()
    }, [])



    // Filter patients based on search
    const filteredPatients = patients.filter(patient =>
        patient.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        patient.patient_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        patient.phone_number.includes(searchQuery)
    )

    return (
        <div className="flex flex-col gap-6 h-[calc(100vh-100px)]">
            <div className="flex items-center justify-between shrink-0 gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                    <button
                        type="button"
                        onClick={openMenu}
                        className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors"
                    >
                        <Menu className="h-6 w-6" />
                        <span className="sr-only">Toggle Menu</span>
                    </button>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground w-44 shrink-0">Patients</h1>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" asChild className="w-32">
                            <Link href="/inventory">
                                <Package className="mr-1.5 h-3.5 w-3.5" />
                                Inventory
                            </Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild className="w-32">
                            <Link href="/billing">
                                <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                                Billing
                            </Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild className="w-32">
                            <Link href="/">
                                <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" />
                                Dashboard
                            </Link>
                        </Button>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {(role === 'doctor' || role === 'admin') && (
                        <>
                            <Button variant="outline" size="sm" onClick={handleExport} className="hidden sm:flex shadow-sm">
                                <Download className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                                Export Registry
                            </Button>

                            <div className="relative">
                                <input
                                    type="file"
                                    id="bulk-import-csv"
                                    className="hidden"
                                    accept=".csv"
                                    onChange={handleImport}
                                    disabled={importing}
                                />
                                <Button variant="outline" size="sm" asChild className="shadow-sm" disabled={importing}>
                                    <label htmlFor="bulk-import-csv" className="cursor-pointer flex items-center text-sm">
                                        {importing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-2 h-3.5 w-3.5 text-muted-foreground" />}
                                        {importing ? 'Loading...' : 'Import List'}
                                    </label>
                                </Button>
                            </div>
                        </>
                    )}

                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="shadow-sm">
                                <Columns className="mr-1.5 h-3.5 w-3.5" />
                                Columns
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2" align="end">
                            <h4 className="font-medium leading-none mb-2 px-2 text-sm">Toggle Columns</h4>
                            {ALL_PATIENT_COLUMNS.map(col => (
                                <label
                                    key={col.id}
                                    className={`flex items-center gap-2 text-sm rounded px-2 py-1 hover:bg-accent transition-colors ${col.required ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={visibleColumns.has(col.id)}
                                        onChange={() => toggleColumn(col.id)}
                                        disabled={col.required}
                                        className="h-4 w-4 rounded border-gray-300"
                                    />
                                    {col.label}
                                    {col.required && <span className="text-xs text-muted-foreground ml-auto">(always)</span>}
                                </label>
                            ))}
                        </PopoverContent>
                    </Popover>

                    <AddPatientDialog
                        open={dialogOpen}
                        onOpenChange={setDialogOpen}
                        onSuccess={() => {
                            setDialogOpen(false)
                            loadData()
                        }}
                        trigger={
                            <Button className="shadow-sm" size="sm">
                                <UserPlus className="mr-2 h-4 w-4" />
                                New Patient
                            </Button>
                        }
                    />
                </div>

                {selectedPatient && (
                    <>
                        <EditPatientDialog
                            open={editDialogOpen}
                            onOpenChange={setEditDialogOpen}
                            patient={selectedPatient}
                            onSuccess={() => {
                                loadData()
                                setEditDialogOpen(false)
                            }}
                        />
                        <PatientDetailsView
                            open={viewDialogOpen}
                            onOpenChange={setViewDialogOpen}
                            patient={selectedPatient}
                            viewMode={viewMode}
                        />
                    </>
                )}
            </div>

            {error && (
                <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 flex items-center gap-3 text-red-500 shrink-0">
                    <AlertCircle className="h-5 w-5" />
                    <div className="flex-1">
                        <p className="font-medium">Connection Error</p>
                        <p className="text-sm text-red-500/90">{error}</p>
                        <p className="text-xs mt-1 text-red-500/80">
                            Make sure your backend is running and CORS is enabled.
                        </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => loadData()} className="border-red-500/20 hover:bg-red-500/20">
                        Retry
                    </Button>
                </div>
            )}

            <Card className="flex-1 flex flex-col overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-y-2 space-y-0 pb-4 shrink-0">
                    <CardTitle className="text-lg font-medium">Patient List ({filteredPatients.length})</CardTitle>
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
                <CardContent className="flex-1 overflow-hidden flex flex-col min-h-0">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <>
                            {/* Desktop table */}
                            <div className="hidden md:flex md:flex-col flex-1 overflow-hidden min-h-0 [&>div]:flex-1 [&>div]:min-h-0">
                                <Table>
                                    <TableHeader className="sticky top-0 z-10 bg-card">
                                        <TableRow>
                                            {visibleColumns.has('patient_id') && <TableHead>Public ID</TableHead>}
                                            <TableHead>Name</TableHead>
                                            {visibleColumns.has('phone_number') && <TableHead>Phone</TableHead>}
                                            {visibleColumns.has('age') && <TableHead>Age</TableHead>}
                                            {visibleColumns.has('sex') && <TableHead>Sex</TableHead>}
                                            {visibleColumns.has('address') && <TableHead>Address</TableHead>}
                                            {visibleColumns.has('reference_patient_name') && <TableHead>Referred By</TableHead>}
                                            {visibleColumns.has('created_at') && <TableHead>Joined</TableHead>}
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
                                                    {visibleColumns.has('patient_id') && (
                                                        <TableCell className="font-medium font-mono text-xs text-muted-foreground">
                                                            {patient.patient_id}
                                                        </TableCell>
                                                    )}
                                                    <TableCell className="font-semibold">{patient.name}</TableCell>
                                                    {visibleColumns.has('phone_number') && (
                                                        <TableCell>{patient.phone_number}</TableCell>
                                                    )}
                                                    {visibleColumns.has('age') && (
                                                        <TableCell>
                                                            {patient.age || (patient.dob ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)) : "N/A")}
                                                        </TableCell>
                                                    )}
                                                    {visibleColumns.has('sex') && (
                                                        <TableCell>{patient.sex || "N/A"}</TableCell>
                                                    )}
                                                    {visibleColumns.has('address') && (
                                                        <TableCell className="max-w-[150px] truncate" title={patient.address || ""}>{patient.address || "N/A"}</TableCell>
                                                    )}
                                                    {visibleColumns.has('reference_patient_name') && (
                                                        <TableCell className="max-w-[150px] truncate" title={patient.reference_patient_name || ""}>
                                                            {patient.reference_patient_name ?? "—"}
                                                        </TableCell>
                                                    )}
                                                    {visibleColumns.has('created_at') && (
                                                        <TableCell>{patient.created_at ? new Date(patient.created_at).toLocaleDateString() : "N/A"}</TableCell>
                                                    )}
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-2">
                                                            {role === 'doctor' || role === 'admin' ? (
                                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                                                                    setSelectedPatient(patient)
                                                                    setViewMode('full')
                                                                    setViewDialogOpen(true)
                                                                }} title="View Patient Details">
                                                                    <Eye className="h-4 w-4" />
                                                                    <span className="sr-only">View</span>
                                                                </Button>
                                                            ) : (
                                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                                                                    setSelectedPatient(patient)
                                                                    setViewMode('clinic')
                                                                    setViewDialogOpen(true)
                                                                }} title="View Visit Logs">
                                                                    <FileText className="h-4 w-4" />
                                                                    <span className="sr-only">View Visits</span>
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
                            </div>

                            {/* Mobile card list */}
                            <div className="md:hidden flex-1 overflow-y-auto min-h-0">
                                {filteredPatients.length === 0 ? (
                                    <p className="text-center py-8 text-muted-foreground text-sm">
                                        No patients found.
                                    </p>
                                ) : (
                                    <div className="divide-y">
                                        {filteredPatients.map((patient, index) => (
                                            <div key={`mob-${patient.patient_id}-${index}`} className="flex items-center justify-between py-3 px-1">
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-semibold text-sm truncate">{patient.name}</p>
                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                        <span className="font-mono">{patient.patient_id}</span>
                                                        {(patient.age || patient.dob) && (
                                                            <span> &middot; {patient.age || Math.floor((Date.now() - new Date(patient.dob!).getTime()) / (1000 * 60 * 60 * 24 * 365.25))} yrs</span>
                                                        )}
                                                        {patient.sex && <span> &middot; {patient.sex}</span>}
                                                        {patient.phone_number && <span> &middot; {patient.phone_number}</span>}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-1 ml-2 shrink-0">
                                                    {role === 'doctor' || role === 'admin' ? (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                                                            setSelectedPatient(patient)
                                                            setViewMode('full')
                                                            setViewDialogOpen(true)
                                                        }} title="View Patient Details">
                                                            <Eye className="h-4 w-4" />
                                                            <span className="sr-only">View</span>
                                                        </Button>
                                                    ) : (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                                                            setSelectedPatient(patient)
                                                            setViewMode('clinic')
                                                            setViewDialogOpen(true)
                                                        }} title="View Visit Logs">
                                                            <FileText className="h-4 w-4" />
                                                            <span className="sr-only">View Visits</span>
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
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
