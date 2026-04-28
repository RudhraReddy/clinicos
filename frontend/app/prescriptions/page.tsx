"use client"

import { useState, useEffect, Fragment } from "react"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Search, Loader2, Pill, ChevronDown, ChevronRight } from "lucide-react"
import { api } from "@/lib/api"

export default function PrescriptionsPage() {
    const [history, setHistory] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState("")
    const [expandedVisitId, setExpandedVisitId] = useState<string | null>(null)

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        setLoading(true)
        try {
            const data = await api.getAllPrescriptions()
            setHistory(data)
        } catch (e) {
            console.error("Failed to load prescriptions", e)
        } finally {
            setLoading(false)
        }
    }

    const filteredHistory = history.filter(h =>
        h.patient_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.visit_id.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const toggleExpand = (visitId: string) => {
        if (expandedVisitId === visitId) {
            setExpandedVisitId(null)
        } else {
            setExpandedVisitId(visitId)
        }
    }

    return (
        <div className="space-y-6 pt-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Prescriptions Log</h1>
                    <p className="text-muted-foreground">
                        Global history of all prescriptions issued.
                    </p>
                </div>
                <div className="relative w-72">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search patient name or ID..."
                        className="pl-9"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <div className="rounded-md border bg-background">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : filteredHistory.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">No prescriptions found.</div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]"></TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Patient</TableHead>
                                <TableHead>Medicines Count</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredHistory.map((record) => (
                                <Fragment key={record.visit_id}>
                                    <TableRow
                                        className="cursor-pointer hover:bg-muted/50"
                                        onClick={() => toggleExpand(record.visit_id)}
                                    >
                                        <TableCell>
                                            {expandedVisitId === record.visit_id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            {record.visit_date}
                                        </TableCell>
                                        <TableCell className="font-semibold">{record.patient_name}</TableCell>
                                        <TableCell>
                                            <Badge variant="secondary">{record.items.length} Medicines</Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm">
                                                {expandedVisitId === record.visit_id ? 'Hide' : 'View'} Details
                                            </Button>
                                        </TableCell>
                                    </TableRow>

                                    {/* EXPANDED ROW */}
                                    {expandedVisitId === record.visit_id && (
                                        <TableRow className="bg-muted/5 hover:bg-muted/5">
                                            <TableCell colSpan={5} className="p-0">
                                                <div className="border-t border-b bg-muted/10 p-4 pl-12">
                                                    <div className="rounded-md border bg-background overflow-hidden">
                                                        <Table>
                                                            <TableHeader className="bg-muted/50">
                                                                <TableRow>
                                                                    <TableHead>Medicine</TableHead>
                                                                    <TableHead>Dosage</TableHead>
                                                                    <TableHead>Duration</TableHead>
                                                                    <TableHead>Quantity</TableHead>
                                                                    <TableHead>Notes</TableHead>
                                                                </TableRow>
                                                            </TableHeader>
                                                            <TableBody>
                                                                {record.items.map((item: any, idx: number) => (
                                                                    <TableRow key={idx} className="hover:bg-transparent">
                                                                        <TableCell className="font-medium">
                                                                            <div className="flex items-center gap-2">
                                                                                <Pill className="h-3 w-3 text-muted-foreground" />
                                                                                {item.item_name}
                                                                            </div>
                                                                        </TableCell>
                                                                        <TableCell>{item.dosage_instructions}</TableCell>
                                                                        <TableCell>{item.duration}</TableCell>
                                                                        <TableCell>{item.quantity}</TableCell>
                                                                        <TableCell className="text-muted-foreground italic text-xs">{item.notes}</TableCell>
                                                                    </TableRow>
                                                                ))}
                                                            </TableBody>
                                                        </Table>
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </Fragment>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>
        </div>
    )
}
