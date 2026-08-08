"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Calendar, Loader2 } from "lucide-react"
import { type Visit } from "@/lib/api"
import { VisitDetailsDialog } from "@/components/VisitDetailsDialog"

interface VisitsTabProps {
    visits: Visit[]
    loading: boolean
}

export function VisitsTab({ visits, loading }: VisitsTabProps) {
    const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)
    const [detailsOpen, setDetailsOpen] = useState(false)

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

    const handleRowClick = (visit: Visit) => {
        setSelectedVisit(visit)
        setDetailsOpen(true)
    }

    return (
        <div className="h-full flex flex-col">
            <Card className="flex-1 flex flex-col overflow-hidden">
                <CardContent className="flex-1 overflow-y-auto min-h-0 p-0">
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : visits.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No visits found</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="sticky top-0 z-10 bg-card">
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Time</TableHead>
                                    <TableHead>Patient</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Visit Fee</TableHead>
                                    <TableHead>Reason</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {visits.map((visit) => (
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
                                        <TableCell className="tabular-nums">
                                            {typeof visit.visiting_fee === 'number' ? `₹${visit.visiting_fee}` : '-'}
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

            <VisitDetailsDialog
                open={detailsOpen}
                onOpenChange={setDetailsOpen}
                visit={selectedVisit}
            />
        </div>
    )
}
