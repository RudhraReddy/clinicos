"use client"

import { useState, useMemo } from "react"
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
import { Plus, Calendar, Loader2, Search } from "lucide-react"
import { type Visit, api } from "@/lib/api"
import { AddVisitDialog } from "@/components/AddVisitDialog"
import { EditVisitDialog } from "@/components/EditVisitDialog"

interface VisitsTabProps {
    visits: Visit[]
    loading: boolean
    onRefresh: () => void
}

export function VisitsTab({ visits, loading, onRefresh }: VisitsTabProps) {
    const [searchQuery, setSearchQuery] = useState("")
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)
    const [editDialogOpen, setEditDialogOpen] = useState(false)

    // Derived state for filtered visits
    const filteredVisits = useMemo(() => {
        if (!searchQuery.trim()) return visits;

        const query = searchQuery.toLowerCase();
        return visits.filter(v =>
            v.patient_name.toLowerCase().includes(query) ||
            v.visit_id.toLowerCase().includes(query) ||
            v.reason?.toLowerCase().includes(query) ||
            v.status.toLowerCase().includes(query) ||
            (v.phone_number && v.phone_number.includes(query))
        );
    }, [visits, searchQuery]);

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

    const handleVisitCreated = () => {
        setAddDialogOpen(false)
        onRefresh()
    }

    const handleVisitUpdated = () => {
        setEditDialogOpen(false)
        setSelectedVisit(null)
        onRefresh()
    }

    const handleRowClick = (visit: Visit) => {
        setSelectedVisit(visit)
        setEditDialogOpen(true)
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="relative w-72">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search visits..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8"
                    />
                </div>

                <AddVisitDialog
                    open={addDialogOpen}
                    onOpenChange={setAddDialogOpen}
                    onSuccess={handleVisitCreated}
                    trigger={
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            New Visit
                        </Button>
                    }
                />
            </div>

            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : filteredVisits.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No visits found</p>
                            {searchQuery && <p className="text-sm mt-1">Try adjusting your search</p>}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Time</TableHead>
                                    <TableHead>Patient</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Reason</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredVisits.map((visit) => (
                                    <TableRow
                                        key={visit.visit_id}
                                        className="cursor-pointer hover:bg-muted/50"
                                        onClick={() => handleRowClick(visit)}
                                    >
                                        <TableCell className="font-medium">
                                            {visit.visit_date ? new Date(visit.visit_date).toLocaleDateString() : '-'}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                            {formatTime(visit.visit_time, visit.created_at)}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-medium">{visit.patient_name}</span>
                                                <span className="text-xs text-muted-foreground">{visit.phone_number || 'No phone'}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className={`
                                                inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
                                                ${visit.status.toLowerCase() === 'done' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                                                    visit.status.toLowerCase() === 'cancelled' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                                                        visit.status.toLowerCase() === 'in_progress' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                                                            'bg-secondary text-secondary-foreground hover:bg-secondary/80'}
                                            `}>
                                                {visit.status}
                                            </div>
                                        </TableCell>
                                        <TableCell className="max-w-[200px] truncate">
                                            {visit.reason || "-"}
                                        </TableCell>
                                        <TableCell onClick={(e) => e.stopPropagation()}>
                                            {/* Stop propagation so row click isn't triggered when clicking actions if we add buttons here */}
                                            <Button variant="ghost" size="sm" onClick={() => handleRowClick(visit)}>
                                                View
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <EditVisitDialog
                open={editDialogOpen}
                onOpenChange={setEditDialogOpen}
                visit={selectedVisit}
                onSuccess={handleVisitUpdated}
            />
        </div>
    )
}
