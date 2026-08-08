"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChevronLeft, ChevronRight, Loader2, Menu, Calendar as CalendarIcon, MapPin, Receipt } from "lucide-react"
import { useMenu } from "@/components/layout/AppShell"
import { api, type DailySummaryResponse, type Location } from "@/lib/api"
import { getTodayIST } from "@/lib/utils"
import { format, addDays, subDays, parseISO } from "date-fns"

function FeeCell({ amount, mode }: { amount: number | null; mode: string | null }) {
    if (amount === null || amount === undefined) {
        return <span className="text-muted-foreground">-</span>
    }
    return (
        <div className="flex items-center gap-2">
            <span className="tabular-nums font-medium">₹{amount}</span>
            {mode === 'cash' && (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-[10px] h-5 hover:bg-green-100">Cash</Badge>
            )}
            {mode === 'upi' && (
                <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 text-[10px] h-5 hover:bg-blue-100">UPI</Badge>
            )}
        </div>
    )
}

export default function DailySummaryPage() {
    const { openMenu } = useMenu()
    const [dateStr, setDateStr] = useState(getTodayIST())
    const [locationId, setLocationId] = useState<number | 'all'>('all')
    const [locations, setLocations] = useState<Location[]>([])
    const [data, setData] = useState<DailySummaryResponse | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        api.getLocations()
            .then(locs => setLocations(locs.filter(l => l.is_active)))
            .catch(() => {})
    }, [])

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const res = await api.getDailySummary(dateStr, locationId)
            setData(res)
        } catch (err) {
            console.error("Failed to fetch daily summary", err)
            setData(null)
        } finally {
            setLoading(false)
        }
    }, [dateStr, locationId])

    useEffect(() => { fetchData() }, [fetchData])

    const shiftDay = (delta: number) => {
        const d = delta > 0 ? addDays(parseISO(dateStr), delta) : subDays(parseISO(dateStr), -delta)
        setDateStr(format(d, 'yyyy-MM-dd'))
    }

    const summary = data?.summary
    const rows = data?.rows ?? []

    return (
        <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
            <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
                <button
                    type="button"
                    onClick={openMenu}
                    className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors"
                >
                    <Menu className="h-6 w-6" />
                    <span className="sr-only">Toggle Menu</span>
                </button>
                <h1 className="text-3xl font-bold tracking-tight text-foreground shrink-0">Daily Summary</h1>

                <div className="flex items-center gap-1 ml-2">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftDay(-1)}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="relative flex items-center">
                        <CalendarIcon className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                            type="date"
                            value={dateStr}
                            onChange={e => e.target.value && setDateStr(e.target.value)}
                            className="h-8 pl-8 pr-2 text-sm rounded-md border border-input bg-background"
                        />
                    </div>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftDay(1)}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>

                <div className="ml-auto">
                    <Select
                        value={locationId === 'all' ? 'all' : locationId.toString()}
                        onValueChange={val => setLocationId(val === 'all' ? 'all' : parseInt(val))}
                    >
                        <SelectTrigger className="h-8 w-44">
                            <MapPin className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Locations</SelectItem>
                            {locations.map(l => (
                                <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Summary cross-tab */}
            <Card className="shrink-0">
                <CardContent className="p-4">
                    {loading || !summary ? (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead></TableHead>
                                    <TableHead className="text-right">Cash</TableHead>
                                    <TableHead className="text-right">UPI</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                <TableRow>
                                    <TableCell className="font-medium">Visit Fee</TableCell>
                                    <TableCell className="text-right tabular-nums">₹{summary.visit_fee.cash}</TableCell>
                                    <TableCell className="text-right tabular-nums">₹{summary.visit_fee.upi}</TableCell>
                                    <TableCell className="text-right tabular-nums font-semibold">₹{summary.visit_fee.total}</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell className="font-medium">Billing Fee</TableCell>
                                    <TableCell className="text-right tabular-nums">₹{summary.billing_fee.cash}</TableCell>
                                    <TableCell className="text-right tabular-nums">₹{summary.billing_fee.upi}</TableCell>
                                    <TableCell className="text-right tabular-nums font-semibold">₹{summary.billing_fee.total}</TableCell>
                                </TableRow>
                                <TableRow className="border-t-2">
                                    <TableCell className="font-bold">Total</TableCell>
                                    <TableCell className="text-right tabular-nums font-bold">₹{summary.total.cash}</TableCell>
                                    <TableCell className="text-right tabular-nums font-bold">₹{summary.total.upi}</TableCell>
                                    <TableCell className="text-right tabular-nums font-bold">₹{summary.total.total}</TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Row table */}
            <Card className="flex-1 flex flex-col overflow-hidden">
                <CardContent className="flex-1 overflow-y-auto min-h-0 p-0">
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No visits or bills for this day</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="sticky top-0 z-10 bg-card">
                                <TableRow>
                                    <TableHead>Patient name</TableHead>
                                    <TableHead>Cell number</TableHead>
                                    <TableHead>Visit fee</TableHead>
                                    <TableHead>Billing fee</TableHead>
                                    <TableHead>Reason</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((row, i) => (
                                    <TableRow key={`${row.type}-${row.visit_id ?? row.invoice_id ?? i}`}>
                                        <TableCell className="font-medium">{row.patient_name}</TableCell>
                                        <TableCell className="text-muted-foreground">{row.phone_number || '-'}</TableCell>
                                        <TableCell><FeeCell amount={row.visit_fee} mode={row.visit_fee_mode} /></TableCell>
                                        <TableCell><FeeCell amount={row.billing_fee} mode={row.billing_fee_mode} /></TableCell>
                                        <TableCell className="max-w-[240px] truncate text-muted-foreground">{row.reason || '-'}</TableCell>
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
