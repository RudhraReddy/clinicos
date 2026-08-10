"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Calendar, Loader2, X } from "lucide-react"
import { type Visit } from "@/lib/api"
import { VisitDetailsDialog } from "@/components/VisitDetailsDialog"
import { DataTableColumnFilter } from "@/components/DataTableColumnFilter"
import { DataTableRangeFilter } from "@/components/DataTableRangeFilter"

interface VisitsTabProps {
    visits: Visit[]
    loading: boolean
}

const yesNo = (b: boolean) => (b ? "Yes" : "No")

export function VisitsTab({ visits, loading }: VisitsTabProps) {
    const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)
    const [detailsOpen, setDetailsOpen] = useState(false)

    // Per-column filters — the header's date range already scopes `visits` itself,
    // these narrow further within whatever range is currently loaded.
    const [filterPatient, setFilterPatient] = useState<Set<string>>(new Set())
    const [filterStatus, setFilterStatus] = useState<Set<string>>(new Set())
    const [filterBilling, setFilterBilling] = useState<Set<string>>(new Set())
    const [filterPrescription, setFilterPrescription] = useState<Set<string>>(new Set())
    const [filterReason, setFilterReason] = useState<Set<string>>(new Set())
    const [filterFeeRange, setFilterFeeRange] = useState<[number, number] | null>(null)
    const [filterRefundRange, setFilterRefundRange] = useState<[number, number] | null>(null)

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

    const optionsPatient = useMemo(() => Array.from(new Set(visits.map(v => v.patient_name))).filter(Boolean).sort(), [visits])
    const optionsStatus = useMemo(() => Array.from(new Set(visits.map(v => v.status))).filter(Boolean).sort(), [visits])
    const optionsReason = useMemo(() => Array.from(new Set(visits.map(v => v.reason || ''))).filter(Boolean).sort(), [visits])

    const feeValues = visits.map(v => v.visiting_fee || 0)
    const feeMin = feeValues.length ? Math.min(...feeValues) : 0
    const feeMax = feeValues.length ? Math.max(...feeValues) : 0

    const refundValues = visits.map(v => v.refund_amount || 0)
    const refundMin = refundValues.length ? Math.min(...refundValues) : 0
    const refundMax = refundValues.length ? Math.max(...refundValues) : 0

    const isFiltered = filterPatient.size > 0 || filterStatus.size > 0 || filterBilling.size > 0 ||
        filterPrescription.size > 0 || filterReason.size > 0 || filterFeeRange !== null || filterRefundRange !== null

    const clearAllFilters = () => {
        setFilterPatient(new Set())
        setFilterStatus(new Set())
        setFilterBilling(new Set())
        setFilterPrescription(new Set())
        setFilterReason(new Set())
        setFilterFeeRange(null)
        setFilterRefundRange(null)
    }

    const filteredVisits = visits.filter(v => {
        const hasBill = v.billed_amount != null
        const hasPrescription = !!v.has_prescription
        const fee = v.visiting_fee || 0
        const refund = v.refund_amount || 0

        if (filterPatient.size > 0 && !filterPatient.has(v.patient_name)) return false
        if (filterStatus.size > 0 && !filterStatus.has(v.status)) return false
        if (filterBilling.size > 0 && !filterBilling.has(yesNo(hasBill))) return false
        if (filterPrescription.size > 0 && !filterPrescription.has(yesNo(hasPrescription))) return false
        if (filterReason.size > 0 && !filterReason.has(v.reason || '')) return false
        if (filterFeeRange && (fee < filterFeeRange[0] || fee > filterFeeRange[1])) return false
        if (filterRefundRange && (refund < filterRefundRange[0] || refund > filterRefundRange[1])) return false
        return true
    })

    return (
        <div className="h-full flex flex-col">
            <Card className="flex-1 flex flex-col overflow-hidden">
                {isFiltered && (
                    <div className="flex items-center justify-end px-4 pt-3 shrink-0">
                        <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-8 text-xs">
                            <X className="mr-1.5 h-3.5 w-3.5" />
                            Clear filters
                        </Button>
                    </div>
                )}
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
                                    <TableHead>
                                        <DataTableColumnFilter title="Patient" options={optionsPatient} selectedValues={filterPatient} onChange={setFilterPatient} />
                                    </TableHead>
                                    <TableHead>
                                        <DataTableColumnFilter title="Status" options={optionsStatus} selectedValues={filterStatus} onChange={setFilterStatus} />
                                    </TableHead>
                                    <TableHead>
                                        <DataTableRangeFilter title="Visit Fee" min={feeMin} max={feeMax} selectedRange={filterFeeRange} onChange={setFilterFeeRange} />
                                    </TableHead>
                                    <TableHead>
                                        <DataTableRangeFilter title="Refund" min={refundMin} max={refundMax} selectedRange={filterRefundRange} onChange={setFilterRefundRange} />
                                    </TableHead>
                                    <TableHead>
                                        <DataTableColumnFilter title="Billing" options={["Yes", "No"]} selectedValues={filterBilling} onChange={setFilterBilling} />
                                    </TableHead>
                                    <TableHead>
                                        <DataTableColumnFilter title="Prescription" options={["Yes", "No"]} selectedValues={filterPrescription} onChange={setFilterPrescription} />
                                    </TableHead>
                                    <TableHead>
                                        <DataTableColumnFilter title="Reason" options={optionsReason} selectedValues={filterReason} onChange={setFilterReason} />
                                    </TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredVisits.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                                            No visits match these filters
                                        </TableCell>
                                    </TableRow>
                                ) : filteredVisits.map((visit) => {
                                    const hasBill = visit.billed_amount != null
                                    const hasPrescription = !!visit.has_prescription
                                    return (
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
                                            <TableCell className="tabular-nums">
                                                {visit.refund_amount ? (
                                                    <span className="text-red-600 dark:text-red-400">₹{visit.refund_amount}</span>
                                                ) : '-'}
                                            </TableCell>
                                            <TableCell>
                                                <span className={hasBill ? "text-green-600 dark:text-green-400 font-medium" : "text-muted-foreground"}>
                                                    {yesNo(hasBill)}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <span className={hasPrescription ? "text-green-600 dark:text-green-400 font-medium" : "text-muted-foreground"}>
                                                    {yesNo(hasPrescription)}
                                                </span>
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
                                    )
                                })}
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
