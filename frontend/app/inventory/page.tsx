
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
import { Search, Loader2, AlertCircle, FileText, Plus, Download, Upload, Columns, AlertTriangle, X, History, ChevronDown, ChevronRight, RotateCcw, Trash2, ShieldAlert, Menu, LayoutDashboard, CreditCard, Users, Eye } from "lucide-react"
import { useRouter } from "next/navigation"
import { api, type InventoryItem, type InventoryHistoryEntry, type Location } from "@/lib/api"
import { useAuth } from "@/lib/auth_context"
import { useMenu } from "@/components/layout/AppShell"
import { cn } from "@/lib/utils"
import { EditInventoryDialog } from "@/components/EditInventoryDialog"
import { ImportInventoryDialog } from "@/components/ImportInventoryDialog"
import { ViewBatchesDialog } from "@/components/ViewBatchesDialog"
import { ImagePreviewDialog } from "@/components/ImagePreviewDialog"
import { DataTableColumnFilter } from "@/components/DataTableColumnFilter"
import { DataTableRangeFilter } from "@/components/DataTableRangeFilter"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import Link from 'next/link'
import { DatePickerWithRange } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"
import { format, startOfDay, endOfDay } from "date-fns"
import { useSettings, ALL_INVENTORY_COLUMNS } from "@/lib/settings_context"
import { toast } from "sonner"

// Date-only strings ("YYYY-MM-DD") parse as UTC midnight — appending a local
// time avoids the off-by-one-day shift that causes in negative-UTC timezones.
const parseDateOnly = (dateStr?: string | null) => {
    if (!dateStr) return null
    return new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`)
}

const getDisplayQuantity = (quantity: number, pack_size?: string) => {
    const pack = pack_size?.toLowerCase() || ''
    if (pack.includes('s') || pack.includes('x')) {
        const match = pack.match(/(\d+)/)
        if (match) {
            const num = parseInt(match[0])
            if (!isNaN(num) && num > 1) {
                return Math.round(quantity * num)
            }
        }
    }
    return Math.round(quantity)
}

function AllChangesPanel() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [date, setDate] = useState<DateRange | undefined>()
    const [filterType, setFilterType] = useState('ALL') // 'ALL', 'SALE', 'ADJUSTMENT', 'PURCHASE'

    const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())

    const load = async (range = date) => {
        setLoading(true)
        try {
            const from = range?.from ? format(range.from, 'yyyy-MM-dd') : undefined;
            const to = range?.to ? format(range.to, 'yyyy-MM-dd') : range?.from ? format(range.from, 'yyyy-MM-dd') : undefined;
            const res = await api.getInventoryAllChanges(from, to)
            setData(res)
        } catch {
            setData(null)
        } finally {
            setLoading(false)
        }
    }

    const resetDates = () => {
        setDate(undefined)
        setFilterType('ALL')
        load(undefined)
    }

    const toggleExpandAll = () => {
        if (!data?.days) return
        if (expandedDays.size === data.days.length) {
            setExpandedDays(new Set())
        } else {
            setExpandedDays(new Set(data.days.map((d: any) => d.date)))
        }
    }

    const toggleDay = (date: string) => {
        const newSet = new Set(expandedDays)
        if (newSet.has(date)) {
            newSet.delete(date)
        } else {
            newSet.add(date)
        }
        setExpandedDays(newSet)
    }

    useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4">
                <div className="flex gap-3 items-end flex-wrap">
                    <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Date Filter</label>
                        <DatePickerWithRange date={date} setDate={setDate} className="w-[260px]" />
                    </div>
                    <Button onClick={() => load(date)} variant="outline">Apply</Button>
                    <Button onClick={resetDates} variant="ghost" size="icon" title="Reset Dates">
                        <RotateCcw className="h-4 w-4" />
                    </Button>
                </div>
                <div className="flex items-end gap-3">
                    <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                        <Select value={filterType} onValueChange={setFilterType}>
                            <SelectTrigger className="w-[140px] h-9">
                                <SelectValue placeholder="All Changes" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">All Changes</SelectItem>
                                <SelectItem value="SALE">Sales</SelectItem>
                                <SelectItem value="ADJUSTMENT">Manual</SelectItem>
                                <SelectItem value="PURCHASE">Invoice</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {data?.days && data.days.length > 0 && (
                        <Button variant="outline" size="sm" className="h-9" onClick={toggleExpandAll}>
                            {expandedDays.size === data.days.length ? "Collapse All" : "Expand All"}
                        </Button>
                    )}
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {!loading && data?.days?.map((dayRaw: any) => {
                let sales = dayRaw.sales || [];
                let manual = dayRaw.manual || [];
                
                if (filterType === 'SALE') {
                    manual = [];
                } else if (filterType === 'ADJUSTMENT') {
                    sales = [];
                    // Keep anything that isn't a PURCHASE/Invoice
                    manual = manual.filter((e: any) => e.type !== 'PURCHASE');
                } else if (filterType === 'PURCHASE') {
                    sales = [];
                    // Keep only PURCHASE/Invoice
                    manual = manual.filter((e: any) => e.type === 'PURCHASE');
                }
                
                if (sales.length === 0 && manual.length === 0) return null;
                
                const day = { ...dayRaw, sales, manual };
                const isExpanded = expandedDays.has(day.date)
                return (
                <Card key={day.date}>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => toggleDay(day.date)}>
                        <div className="flex justify-between items-center">
                            <CardTitle className="text-base flex items-center gap-2">
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                {new Date(day.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                            </CardTitle>
                            <span className="text-sm text-muted-foreground">
                                {[
                                    day.sales.length > 0 ? `Sales (${day.sales.length})` : null,
                                    day.manual.filter((e: any) => e.type === 'PURCHASE').length > 0 ? `Invoices Added (${day.manual.filter((e: any) => e.type === 'PURCHASE').length})` : null,
                                    day.manual.filter((e: any) => e.type !== 'PURCHASE').length > 0 ? `Manual Changes (${day.manual.filter((e: any) => e.type !== 'PURCHASE').length})` : null
                                ].filter(Boolean).join(' • ') || 'No changes'}
                            </span>
                        </div>
                    </CardHeader>
                    {isExpanded && (
                    <CardContent className="space-y-4">
                        {day.manual.length > 0 && (
                            <div>
                                <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                                    Manual Changes ({day.manual.length})
                                </h4>
                                <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Product</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead className="text-right">Qty Change</TableHead>
                                            <TableHead>Notes</TableHead>
                                            <TableHead>Time</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                        {day.manual.map((e: any) => (
                                            <TableRow key={e.id}>
                                                <TableCell className="font-medium">{e.product_name}</TableCell>
                                                <TableCell><Badge variant="outline">{e.type}</Badge></TableCell>
                                                <TableCell className="text-right">
                                                    {e.change_amount > 0 ? `+${e.change_amount}` : e.change_amount}
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground">{e.notes || '—'}</TableCell>
                                                <TableCell className="text-sm">
                                                    {e.timestamp ? new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                                </div>
                            </div>
                        )}

                        {day.sales.length > 0 && (
                            <div>
                                <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                                    Sales ({day.sales.length})
                                </h4>
                                <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Product</TableHead>
                                            <TableHead>Bill ID</TableHead>
                                            <TableHead className="text-right">Qty Sold</TableHead>
                                            <TableHead>Time</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                        {day.sales.map((e: any) => (
                                            <TableRow key={e.id}>
                                                <TableCell className="font-medium">{e.product_name}</TableCell>
                                                <TableCell className="font-mono text-sm">{e.bill_id || '—'}</TableCell>
                                                <TableCell className="text-right text-red-600">{e.change_amount}</TableCell>
                                                <TableCell className="text-sm">
                                                    {e.timestamp ? new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                                </div>
                            </div>
                        )}

                        {day.manual.length === 0 && day.sales.length === 0 && (
                            <p className="text-sm text-muted-foreground">No changes recorded.</p>
                        )}
                    </CardContent>
                    )}
                </Card>
            )})}

            {!loading && (!data?.days || data.days.length === 0) && (
                <div className="text-center text-muted-foreground py-12">No changes found.</div>
            )}
        </div>
    )
}

function InvoiceHistoryPanel() {
    const router = useRouter()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [invoices, setInvoices] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [date, setDate] = useState<DateRange | undefined>()
    const [searchQuery, setSearchQuery] = useState("")

    // Table filters
    const [filterVendor, setFilterVendor] = useState<Set<string>>(new Set())
    const [filterSource, setFilterSource] = useState<Set<string>>(new Set())
    const [filterAmount, setFilterAmount] = useState<[number, number] | null>(null)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [previewInvoice, setPreviewInvoice] = useState<any>(null)

    // Optional columns, off by default — toggled via the Columns button
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set())
    const toggleColumn = (id: string) => {
        setVisibleColumns(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }
    const OPTIONAL_COLUMNS = [
        { id: 'source', label: 'Source' },
        { id: 'date_added', label: 'Date Added' },
        { id: 'gst_number', label: 'GST Number' },
    ]

    // Clinic switcher
    const [locations, setLocations] = useState<Location[]>([])
    const [activeLocationId, setActiveLocationId] = useState<number | 'all'>('all')

    useEffect(() => {
        api.getLocations().then(locs => setLocations(locs.filter(l => l.is_active))).catch(() => {})
    }, [])

    useEffect(() => {
        loadInvoices()
    }, [activeLocationId]) // eslint-disable-line react-hooks/exhaustive-deps

    const loadInvoices = async () => {
        setLoading(true)
        try {
            const data = await api.getInvoices(activeLocationId === 'all' ? undefined : activeLocationId)
            setInvoices(data)
        } catch (error) {
            console.error("Failed to load invoices", error)
        } finally {
            setLoading(false)
        }
    }

    const invoiceAgeDays = (invoiceDateStr: string | null | undefined) => {
        const parsed = parseDateOnly(invoiceDateStr)
        if (!parsed) return null
        const diffMs = Date.now() - parsed.getTime()
        return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
    }

    const filteredInvoices = invoices.filter(inv => {
        let matchesDate = true;
        if (date?.from) {
            const invDate = parseDateOnly(inv.invoice_date) || new Date(inv.upload_date);
            const start = startOfDay(date.from);
            const end = date.to ? endOfDay(date.to) : endOfDay(date.from);
            matchesDate = invDate >= start && invDate <= end;
        }

        const matchesSearch = inv.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (inv.vendor_name || '').toLowerCase().includes(searchQuery.toLowerCase());

        const matchesVendor = filterVendor.size === 0 || filterVendor.has(inv.vendor_name || 'N/A');
        const matchesSource = filterSource.size === 0 || filterSource.has(inv.source || 'UNKNOWN');
        const matchesAmount = filterAmount === null || ((inv.total_amount || 0) >= filterAmount[0] && (inv.total_amount || 0) <= filterAmount[1]);

        return matchesDate && matchesSearch && matchesVendor && matchesSource && matchesAmount;
    });

    const optionsVendor = Array.from(new Set(invoices.map(i => i.vendor_name || 'N/A'))).sort();
    const optionsSource = Array.from(new Set(invoices.map(i => i.source || 'UNKNOWN'))).sort();

    const amountValues = invoices.map(i => i.total_amount || 0);
    const minAmount = Math.min(...(amountValues.length ? amountValues : [0]));
    const maxAmount = Math.max(...(amountValues.length ? amountValues : [100]));

    const columnCount = 9 + visibleColumns.size

    return (
        <Card>
            <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between pb-4">
                <CardTitle>Uploaded Invoices ({filteredInvoices.length})</CardTitle>
                <div className="flex flex-wrap items-center gap-3">
                    {locations.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                            <button
                                onClick={() => setActiveLocationId('all')}
                                className={cn(
                                    "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                                    activeLocationId === 'all'
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                                )}
                            >
                                All Locations
                            </button>
                            {locations.map(loc => (
                                <button
                                    key={loc.id}
                                    onClick={() => setActiveLocationId(loc.id)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                                        activeLocationId === loc.id
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                                    )}
                                >
                                    {loc.name}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="relative w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search invoice # or vendor..."
                            className="pl-9 h-9"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div>
                        <DatePickerWithRange date={date} setDate={setDate} className="w-[260px]" placeholder="Filter by date..." />
                    </div>
                    {(searchQuery || date || filterVendor.size > 0 || filterSource.size > 0 || filterAmount !== null) && (
                        <Button variant="ghost" size="icon" onClick={() => {
                            setSearchQuery("");
                            setDate(undefined);
                            setFilterVendor(new Set());
                            setFilterSource(new Set());
                            setFilterAmount(null);
                        }} title="Reset Filters">
                            <RotateCcw className="h-4 w-4" />
                        </Button>
                    )}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="h-9">
                                <Columns className="mr-1.5 h-3.5 w-3.5" />
                                Columns
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2" align="end">
                            <h4 className="font-medium leading-none mb-2 px-2 text-sm">Toggle Columns</h4>
                            {OPTIONAL_COLUMNS.map(col => (
                                <label
                                    key={col.id}
                                    className="flex items-center gap-2 text-sm rounded px-2 py-1 hover:bg-accent transition-colors cursor-pointer"
                                >
                                    <input
                                        type="checkbox"
                                        checked={visibleColumns.has(col.id)}
                                        onChange={() => toggleColumn(col.id)}
                                        className="h-4 w-4 rounded border-gray-300"
                                    />
                                    {col.label}
                                </label>
                            ))}
                        </PopoverContent>
                    </Popover>
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Invoice Date</TableHead>
                            <TableHead>Invoice Number</TableHead>
                            <TableHead>
                                <DataTableColumnFilter
                                    title="Vendor"
                                    options={optionsVendor}
                                    selectedValues={filterVendor}
                                    onChange={setFilterVendor}
                                />
                            </TableHead>
                            <TableHead>
                                <DataTableRangeFilter
                                    title="Total Amount"
                                    min={minAmount}
                                    max={maxAmount}
                                    selectedRange={filterAmount}
                                    onChange={setFilterAmount}
                                />
                            </TableHead>
                            <TableHead>Clinic</TableHead>
                            <TableHead>Age</TableHead>
                            <TableHead>Paid Date</TableHead>
                            <TableHead>Pay Type</TableHead>
                            {visibleColumns.has('source') && (
                                <TableHead>
                                    <DataTableColumnFilter
                                        title="Source"
                                        options={optionsSource}
                                        selectedValues={filterSource}
                                        onChange={setFilterSource}
                                    />
                                </TableHead>
                            )}
                            {visibleColumns.has('date_added') && <TableHead>Date Added</TableHead>}
                            {visibleColumns.has('gst_number') && <TableHead>GST Number</TableHead>}
                            <TableHead className="text-right">
                                {(filterVendor.size > 0 || filterSource.size > 0 || filterAmount !== null) && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-foreground mr-2"
                                        onClick={() => {
                                            setFilterVendor(new Set())
                                            setFilterSource(new Set())
                                            setFilterAmount(null)
                                        }}
                                        title="Reset table filters"
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                    </Button>
                                )}
                                Action
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={columnCount} className="text-center py-4">Loading...</TableCell>
                            </TableRow>
                        ) : filteredInvoices.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={columnCount} className="text-center py-4 text-muted-foreground">
                                    No invoices found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredInvoices.map((inv) => {
                                const age = invoiceAgeDays(inv.invoice_date)
                                return (
                                <TableRow key={inv.invoice_number}>
                                    <TableCell>{parseDateOnly(inv.invoice_date)?.toLocaleDateString() ?? '—'}</TableCell>
                                    <TableCell className="font-medium">
                                        {inv.has_image ? (
                                            <button
                                                type="button"
                                                onClick={() => setPreviewInvoice(inv)}
                                                className="flex items-center gap-2 hover:underline decoration-blue-500 underline-offset-2"
                                                title="View attached invoice image"
                                            >
                                                <FileText className="h-4 w-4 text-blue-500" />
                                                {inv.invoice_number}
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                <FileText className="h-4 w-4" />
                                                {inv.invoice_number}
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span>{inv.vendor_name || 'N/A'}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>₹{inv.total_amount.toFixed(2)}</TableCell>
                                    <TableCell>{inv.location_name || '—'}</TableCell>
                                    <TableCell className="text-muted-foreground">{age != null ? `${age}d` : '—'}</TableCell>
                                    <TableCell>{parseDateOnly(inv.paid_date)?.toLocaleDateString() ?? '—'}</TableCell>
                                    <TableCell>
                                        {inv.payment_mode ? (
                                            <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-900/20 dark:text-green-400">
                                                {inv.payment_mode.toUpperCase()}
                                            </span>
                                        ) : '—'}
                                    </TableCell>
                                    {visibleColumns.has('source') && (
                                        <TableCell>
                                            <span className={cn(
                                                "inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset",
                                                inv.source === 'OCR' ? "bg-blue-50 text-blue-700 ring-blue-600/20" :
                                                    inv.source === 'MANUAL' ? "bg-yellow-50 text-yellow-700 ring-yellow-600/20" :
                                                        "bg-purple-50 text-purple-700 ring-purple-600/20"
                                            )}>
                                                {inv.source || 'UNKNOWN'}
                                            </span>
                                        </TableCell>
                                    )}
                                    {visibleColumns.has('date_added') && (
                                        <TableCell>{new Date(inv.upload_date).toLocaleDateString()}</TableCell>
                                    )}
                                    {visibleColumns.has('gst_number') && (
                                        <TableCell>{inv.gst_number || '—'}</TableCell>
                                    )}
                                    <TableCell className="text-right">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => router.push(`/inventory/history/${inv.invoice_number}`)}
                                        >
                                            <Eye className="h-4 w-4 mr-2" />
                                            View
                                        </Button>
                                    </TableCell>
                                </TableRow>
                                )
                            })
                        )}
                    </TableBody>
                </Table>
            </CardContent>

            <ImagePreviewDialog
                image={previewInvoice}
                isOpen={!!previewInvoice}
                onClose={() => setPreviewInvoice(null)}
                title={previewInvoice ? `Invoice ${previewInvoice.invoice_number}` : undefined}
                subtitle={previewInvoice?.vendor_name || undefined}
            />
        </Card>
    )
}

export default function InventoryPage() {
    const { appFontSize, expiryReminderMonths, defaultInventoryColumns } = useSettings()
    const { role } = useAuth()
    const { openMenu } = useMenu()
    const [activeTab, setActiveTab] = useState<'inventory' | 'all-changes' | 'history'>('inventory')
    const [inventory, setInventory] = useState<InventoryItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [filterName, setFilterName] = useState<Set<string>>(new Set())
    const [filterMfg, setFilterMfg] = useState<Set<string>>(new Set())
    const [filterVendor, setFilterVendor] = useState<Set<string>>(new Set())
    const [filterCategory, setFilterCategory] = useState<Set<string>>(new Set())
    const [filterRackLocation, setFilterRackLocation] = useState<Set<string>>(new Set())
    const [filterStatus, setFilterStatus] = useState<Set<string>>(new Set())

    // Additional Filters
    // Additional Filters
    const [filterId, setFilterId] = useState<Set<string>>(new Set())
    const [filterQty, setFilterQty] = useState<[number, number] | null>(null)
    const [filterPrice, setFilterPrice] = useState<[number, number] | null>(null)
    const [filterValue, setFilterValue] = useState<[number, number] | null>(null)
    const [filterExpiry, setFilterExpiry] = useState<Set<string>>(new Set())

    // New Column Filters
    const [filterPack, setFilterPack] = useState<Set<string>>(new Set())
    const [filterGST, setFilterGST] = useState<Set<string>>(new Set())
    const [filterHSN, setFilterHSN] = useState<Set<string>>(new Set())
    const [filterMinStock, setFilterMinStock] = useState<[number, number] | null>(null)
    const [filterFormula, setFilterFormula] = useState<Set<string>>(new Set())

    // Low-stock alert banner
    const [stockAlertDismissed, setStockAlertDismissed] = useState(false)

    // History drawer state
    const [historyOpen, setHistoryOpen] = useState(false)
    const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null)
    const [historyEntries, setHistoryEntries] = useState<InventoryHistoryEntry[]>([])
    const [historyLoading, setHistoryLoading] = useState(false)

    const [locations, setLocations] = useState<Location[]>([])
    const [activeLocationId, setActiveLocationId] = useState<number | 'all'>('all')
    const [exportDialogOpen, setExportDialogOpen] = useState(false)
    const [exportScope, setExportScope] = useState<string>('all')
    const [wipeDialogOpen, setWipeDialogOpen] = useState(false)
    const [wipeCode, setWipeCode] = useState('')
    const [wipeLoading, setWipeLoading] = useState(false)
    const [wipeError, setWipeError] = useState<string | null>(null)

    const handleWipeInventory = async () => {
        if (!wipeCode.trim()) return
        setWipeLoading(true)
        setWipeError(null)
        try {
            const res = await api.wipeInventory(wipeCode.trim())
            setWipeDialogOpen(false)
            setWipeCode('')
            toast.success(res.message)
            loadData()
        } catch (err: unknown) {
            setWipeError(err instanceof Error ? err.message : 'Failed to wipe inventory')
        } finally {
            setWipeLoading(false)
        }
    }

    const openHistory = async (item: InventoryItem) => {
        setHistoryItem(item)
        setHistoryEntries([])
        setHistoryOpen(true)
        setHistoryLoading(true)
        try {
            const res = await api.getInventoryHistory(item.id)
            setHistoryEntries(res.history)
        } catch {
            setHistoryEntries([])
        } finally {
            setHistoryLoading(false)
        }
    }

    const formatHistoryTimestamp = (ts: string) => {
        try {
            const d = new Date(ts)
            return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
        } catch {
            return ts
        }
    }

    useEffect(() => {
        api.getLocations().then(locs => setLocations(locs.filter(l => l.is_active))).catch(() => {})
    }, [])

    const loadData = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await api.getInventory(expiryReminderMonths, activeLocationId === 'all' ? undefined : activeLocationId)
            setInventory(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load inventory")
        } finally {
            setLoading(false)
        }
    }

    const handleDeleteProduct = async (id: string, name: string) => {
        if (!window.confirm(`PERMANENT DELETE WARNING!\n\nAre you absolutely certain you wish to permanently purge "${name}" and all associated batches from inventory?\n\nThis action strictly targets ADMIN rights and CANNOT be reversed.`)) {
            return
        }
        try {
            await api.deleteInventoryItem(id)
            toast.success(`Successfully purged ${name} from server registry.`)
            loadData()
        } catch {
            toast.error("Deletion attempt prohibited. Check authentication or backend logs.")
        }
    }

    useEffect(() => {
        loadData()
    }, [activeLocationId]) // eslint-disable-line react-hooks/exhaustive-deps

    // Extract Unique Values for Filters
    const optionsName = Array.from(new Set(inventory.map(i => i.item_name))).filter(Boolean).sort()
    const optionsMfg = Array.from(new Set(inventory.map(i => i.manufacturer || "")) as Set<string>).filter(Boolean).sort()
    const optionsVendor = Array.from(new Set(inventory.flatMap(i => i.vendors || []))).filter(Boolean).sort()
    const optionsCategory = Array.from(new Set(inventory.map(i => i.category))).filter(Boolean).sort()
    const optionsRackLocation = Array.from(new Set(inventory.map(i => i.rack_location || ""))).filter(Boolean).sort()
    const optionsStatus = Array.from(new Set(inventory.flatMap(i => i.status))).filter(Boolean).sort()

    // New Options
    const optionsPack = Array.from(new Set(inventory.map(i => i.pack_size || ""))).filter(Boolean).sort()
    const optionsGST = Array.from(new Set(inventory.map(i => i.gst_rate ? i.gst_rate.toString() : ""))).filter(Boolean).sort()
    const optionsHSN = Array.from(new Set(inventory.map(i => i.hsn_code || ""))).filter(Boolean).sort()
    const optionsFormula = Array.from(new Set(inventory.map(i => i.formula || ""))).filter(Boolean).sort()

    const optionsId = Array.from(new Set(inventory.map(i => i.id.toString()))).sort((a, b) => parseInt(a) - parseInt(b))

    // Range Calculations
    const qtyValues = inventory.map(i => i.quantity)
    const priceValues = inventory.map(i => i.price)
    const valueValues = inventory.map(i => i.total_value || 0)

    const minQty = Math.min(...(qtyValues.length ? qtyValues : [0]))
    const maxQty = Math.max(...(qtyValues.length ? qtyValues : [100]))

    const minPrice = Math.min(...(priceValues.length ? priceValues : [0]))
    const maxPrice = Math.max(...(priceValues.length ? priceValues : [100]))

    const minValue = Math.min(...(valueValues.length ? valueValues : [0]))
    const maxValue = Math.max(...(valueValues.length ? valueValues : [100]))

    const minStockValues = inventory.map(i => i.min_stock_level)
    const minMinStock = Math.min(...(minStockValues.length ? minStockValues : [0]))
    const maxMinStock = Math.max(...(minStockValues.length ? minStockValues : [100]))

    // Expiry Formatted Options (MM-YYYY)
    // Expiry Formatted Options (MM-YYYY)
    const formatExpiryMonth = (dateStr?: string) => {
        if (!dateStr || dateStr === 'N/A') return 'N/A'
        // Handle "MM/YY" format directly
        if (dateStr.includes('/')) {
            const [m, y] = dateStr.split('/')
            if (m && y) {
                // If y is 2 digits, assume 20xx
                const year = y.length === 2 ? `20${y}` : y
                return `${m}-${year}`
            }
        }
        try {
            const date = new Date(dateStr)
            if (isNaN(date.getTime())) return 'N/A'
            return `${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getFullYear()}`
        } catch { return 'N/A' }
    }
    const optionsExpiry = Array.from(new Set(inventory.map(i => formatExpiryMonth(i.expiry_date)))).sort()

    const filteredInventory = inventory.filter(item => {
        const matchesSearch = item.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.manufacturer?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (item.formula || '').toLowerCase().includes(searchQuery.toLowerCase())

        const matchesName = filterName.size === 0 || filterName.has(item.item_name)
        const matchesMfg = filterMfg.size === 0 || (item.manufacturer && filterMfg.has(item.manufacturer))
        const matchesVendor = filterVendor.size === 0 || (item.vendors && item.vendors.some(v => filterVendor.has(v)))
        const matchesCategory = filterCategory.size === 0 || filterCategory.has(item.category)
        const matchesRackLocation = filterRackLocation.size === 0 || filterRackLocation.has(item.rack_location || "")
        const matchesStatus = filterStatus.size === 0 || item.status.some(s => filterStatus.has(s))

        // New Matches
        const matchesId = filterId.size === 0 || filterId.has(item.id.toString())

        const matchesQty = filterQty === null || (item.quantity >= filterQty[0] && item.quantity <= filterQty[1])
        const matchesPrice = filterPrice === null || (item.price >= filterPrice[0] && item.price <= filterPrice[1])
        const matchesValue = filterValue === null || ((item.total_value || 0) >= filterValue[0] && (item.total_value || 0) <= filterValue[1])

        const itemExpiryMonth = formatExpiryMonth(item.expiry_date)
        const matchesExpiry = filterExpiry.size === 0 || filterExpiry.has(itemExpiryMonth)

        const matchesPack = filterPack.size === 0 || filterPack.has(item.pack_size || "")
        const matchesGST = filterGST.size === 0 || filterGST.has(item.gst_rate ? item.gst_rate.toString() : "")
        const matchesHSN = filterHSN.size === 0 || filterHSN.has(item.hsn_code || "")
        const matchesFormula = filterFormula.size === 0 || filterFormula.has(item.formula || "")
        const matchesMinStock = filterMinStock === null || (item.min_stock_level >= filterMinStock[0] && item.min_stock_level <= filterMinStock[1])

        return matchesSearch && matchesName && matchesMfg && matchesVendor && matchesCategory && matchesRackLocation && matchesStatus &&
            matchesId && matchesQty && matchesPrice && matchesValue && matchesExpiry &&
            matchesPack && matchesGST && matchesHSN && matchesFormula && matchesMinStock
    })

    // Column Visibility — starts from admin-configured defaults, adjusts for large font
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(defaultInventoryColumns))

    useEffect(() => {
        if (appFontSize > 16) {
            setVisibleColumns(prev => {
                const next = new Set(prev)
                const toRemove = ['id', 'manufacturer', 'vendor', 'pack_size', 'price', 'expiry_date', 'category', 'hsn_code', 'gst_rate', 'min_stock_level', 'total_value']
                toRemove.forEach(c => next.delete(c))
                return next
            })
        } else {
            setVisibleColumns(new Set(defaultInventoryColumns))
        }
    }, [appFontSize, defaultInventoryColumns])

    const toggleColumn = (col: string) => {
        const newSet = new Set(visibleColumns)
        newSet.has(col) ? newSet.delete(col) : newSet.add(col)
        setVisibleColumns(newSet)
    }

    // Column definitions come from settings_context so they stay in sync with admin config
    const allColumns = ALL_INVENTORY_COLUMNS

    const lowCount = inventory.filter(i => i.status.includes("LOW STOCK")).length
    const outCount = inventory.filter(i => i.status.includes("OUT OF STOCK")).length

    return (
        <div className="flex flex-col gap-6 h-[calc(100vh-100px)]">
            <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as 'inventory' | 'all-changes' | 'history')} className="flex-1 flex flex-col overflow-hidden gap-4">
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
                        <h1 className="text-3xl font-bold tracking-tight text-foreground w-44 shrink-0">Inventory</h1>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" asChild className="w-32">
                                <Link href="/">
                                    <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" />
                                    Dashboard
                                </Link>
                            </Button>
                            <Button variant="outline" size="sm" asChild className="w-32">
                                <Link href="/billing">
                                    <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                                    Billing
                                </Link>
                            </Button>
                            <Button variant="outline" size="sm" asChild className="w-32">
                                <Link href="/patients">
                                    <Users className="mr-1.5 h-3.5 w-3.5" />
                                    Patients
                                </Link>
                            </Button>
                        </div>
                        <TabsList className="shrink-0">
                            <TabsTrigger value="inventory">Inventory</TabsTrigger>
                            <TabsTrigger value="all-changes">All Changes</TabsTrigger>
                            <TabsTrigger value="history">Invoices</TabsTrigger>
                        </TabsList>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {(role === 'doctor' || role === 'admin') && (
                            <>
                                <Button variant="outline" size="sm" onClick={() => setExportDialogOpen(true)}>
                                    <Download className="mr-1.5 h-3.5 w-3.5" />
                                    Export
                                </Button>
                                <ImportInventoryDialog trigger={
                                    <Button variant="outline" size="sm">
                                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                                        Import
                                    </Button>
                                } onSuccess={loadData} />
                            </>
                        )}
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm">
                                    <Columns className="mr-1.5 h-3.5 w-3.5" />
                                    Columns
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-56" align="end">
                                <div className="space-y-2">
                                    <h4 className="font-medium leading-none mb-2">Toggle Columns</h4>
                                    {allColumns.map(col => (
                                        <div key={col.id} className="flex items-center space-x-2 rounded px-2 hover:bg-accent py-1">
                                            <input
                                                type="checkbox"
                                                id={`col-${col.id}`}
                                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                                checked={visibleColumns.has(col.id)}
                                                onChange={() => toggleColumn(col.id)}
                                            />
                                            <label
                                                htmlFor={`col-${col.id}`}
                                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
                                            >
                                                {col.label}
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </PopoverContent>
                        </Popover>
                        <Link href="/inventory/invoice_edit?manual=true">
                            <Button size="sm">
                                <Plus className="mr-1.5 h-3.5 w-3.5" />
                                Add Invoice
                            </Button>
                        </Link>
                        {role === 'admin' && (
                            <Button
                                variant="ghost"
                                size="icon"
                                title="Wipe Inventory"
                                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                onClick={() => { setWipeDialogOpen(true); setWipeCode(''); setWipeError(null) }}
                            >
                                <ShieldAlert className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>

                <TabsContent value="all-changes" className="flex-1 overflow-y-auto m-0">
                    <AllChangesPanel />
                </TabsContent>

                <TabsContent value="history" className="flex-1 overflow-y-auto m-0">
                    <InvoiceHistoryPanel />
                </TabsContent>

                <TabsContent value="inventory" className="flex-1 flex flex-col overflow-hidden gap-6 m-0">


            {!stockAlertDismissed && !loading && (lowCount > 0 || outCount > 0) && (
                <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4 flex items-center gap-3 text-yellow-700 dark:text-yellow-400 shrink-0">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <p className="flex-1 text-sm font-medium">
                        {lowCount > 0 && outCount > 0
                            ? `${lowCount} item(s) low on stock, ${outCount} item(s) out of stock`
                            : lowCount > 0
                                ? `${lowCount} item(s) low on stock`
                                : `${outCount} item(s) out of stock`}
                    </p>
                    <button
                        onClick={() => setStockAlertDismissed(true)}
                        className="shrink-0 rounded p-1 hover:bg-yellow-500/20 transition-colors"
                        aria-label="Dismiss alert"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {
                error && (
                    <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 flex items-center gap-3 text-red-500 shrink-0">
                        <AlertCircle className="h-5 w-5" />
                        <div className="flex-1">
                            <p className="font-medium">Connection Error</p>
                            <p className="text-sm text-red-500/90">{error}</p>
                        </div>
                    </div>
                )
            }

            <Card className="flex-1 flex flex-col overflow-hidden">
                <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between space-y-0 pb-4 shrink-0">
                    <CardTitle className="text-lg font-medium">Inventory List ({filteredInventory.length})</CardTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Location switcher */}
                        {locations.length > 0 && (
                            <div className="flex gap-2 flex-wrap">
                                <button
                                    onClick={() => setActiveLocationId('all')}
                                    className={cn(
                                        "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                                        activeLocationId === 'all'
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                                    )}
                                >
                                    All Locations
                                </button>
                                {locations.map(loc => (
                                    <button
                                        key={loc.id}
                                        onClick={() => setActiveLocationId(loc.id)}
                                        className={cn(
                                            "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                                            activeLocationId === loc.id
                                                ? "bg-primary text-primary-foreground"
                                                : "bg-muted text-muted-foreground hover:bg-muted/80"
                                        )}
                                    >
                                        {loc.name}
                                    </button>
                                ))}
                            </div>
                        )}
                        {/* Quick Search */}
                        <div className="relative w-64">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Quick search..."
                                className="pl-9 h-9"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden flex flex-col min-h-0">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <>
                        {/* Desktop table — hidden on mobile */}
                        <div className="hidden md:flex md:flex-col flex-1 overflow-hidden min-h-0 [&>div]:flex-1 [&>div]:min-h-0">
                            <Table>
                                <TableHeader className="sticky top-0 z-10 bg-card">
                                    <TableRow>
                                        {visibleColumns.has('id') && <TableHead>
                                            <DataTableColumnFilter
                                                title="ID"
                                                options={optionsId}
                                                selectedValues={filterId}
                                                onChange={setFilterId}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('item_name') && <TableHead>
                                            <DataTableColumnFilter
                                                title="Item Name"
                                                options={optionsName}
                                                selectedValues={filterName}
                                                onChange={setFilterName}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('manufacturer') && <TableHead>
                                            <DataTableColumnFilter
                                                title="MFG"
                                                options={optionsMfg}
                                                selectedValues={filterMfg}
                                                onChange={setFilterMfg}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('vendor') && <TableHead>
                                            <DataTableColumnFilter
                                                title="Vendor"
                                                options={optionsVendor}
                                                selectedValues={filterVendor}
                                                onChange={setFilterVendor}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('pack_size') && <TableHead>
                                            <DataTableColumnFilter
                                                title="Pack"
                                                options={optionsPack}
                                                selectedValues={filterPack}
                                                onChange={setFilterPack}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('quantity') && <TableHead>
                                            <DataTableRangeFilter
                                                title="Qty"
                                                min={minQty}
                                                max={maxQty}
                                                selectedRange={filterQty}
                                                onChange={setFilterQty}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('price') && <TableHead>
                                            <DataTableRangeFilter
                                                title="MRP"
                                                min={minPrice}
                                                max={maxPrice}
                                                selectedRange={filterPrice}
                                                onChange={setFilterPrice}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('gst_rate') && <TableHead>
                                            <DataTableColumnFilter
                                                title="GST %"
                                                options={optionsGST}
                                                selectedValues={filterGST}
                                                onChange={setFilterGST}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('total_value') && <TableHead>
                                            <DataTableRangeFilter
                                                title="Total Value"
                                                min={minValue}
                                                max={maxValue}
                                                selectedRange={filterValue}
                                                onChange={setFilterValue}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('category') && <TableHead>
                                            <DataTableColumnFilter
                                                title="Category"
                                                options={optionsCategory}
                                                selectedValues={filterCategory}
                                                onChange={setFilterCategory}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('rack_location') && <TableHead>
                                            <DataTableColumnFilter
                                                title="Rack"
                                                options={optionsRackLocation}
                                                selectedValues={filterRackLocation}
                                                onChange={setFilterRackLocation}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('hsn_code') && <TableHead>
                                            <DataTableColumnFilter
                                                title="HSN"
                                                options={optionsHSN}
                                                selectedValues={filterHSN}
                                                onChange={setFilterHSN}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('min_stock_level') && <TableHead>
                                            <DataTableRangeFilter
                                                title="Min Stock"
                                                min={minMinStock}
                                                max={maxMinStock}
                                                selectedRange={filterMinStock}
                                                onChange={setFilterMinStock}
                                            />
                                        </TableHead>}

                                        {visibleColumns.has('expiry_date') && <TableHead>
                                            <DataTableColumnFilter
                                                title="Next Expiry"
                                                options={optionsExpiry}
                                                selectedValues={filterExpiry}
                                                onChange={setFilterExpiry}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('status') && <TableHead>
                                            <DataTableColumnFilter
                                                title="Status"
                                                options={optionsStatus}
                                                selectedValues={filterStatus}
                                                onChange={setFilterStatus}
                                            />
                                        </TableHead>}
                                        <TableHead className="w-[50px]">
                                            {(filterName.size > 0 || filterMfg.size > 0 || filterVendor.size > 0 ||
                                                filterCategory.size > 0 || filterRackLocation.size > 0 || filterStatus.size > 0 ||
                                                filterId.size > 0 || filterQty !== null || filterPrice !== null || filterExpiry.size > 0 ||
                                                filterPack.size > 0 || filterGST.size > 0 || filterHSN.size > 0 || filterFormula.size > 0 || filterMinStock !== null || filterValue !== null
                                            ) && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                        onClick={() => {
                                                            setFilterName(new Set())
                                                            setFilterMfg(new Set())
                                                            setFilterVendor(new Set())
                                                            setFilterCategory(new Set())
                                                            setFilterRackLocation(new Set())
                                                            setFilterStatus(new Set())
                                                            setFilterId(new Set())
                                                            setFilterQty(null)
                                                            setFilterPrice(null)
                                                            setFilterValue(null)
                                                            setFilterExpiry(new Set())
                                                            setFilterPack(new Set())
                                                            setFilterGST(new Set())
                                                            setFilterHSN(new Set())
                                                            setFilterFormula(new Set())
                                                            setFilterMinStock(null)
                                                        }}
                                                        title="Reset all filters"
                                                    >
                                                        <span className="sr-only">Reset</span>
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                                    </Button>
                                                )}
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredInventory.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                                                No items found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredInventory.map((item) => (
                                            <TableRow key={item.id}>
                                                {visibleColumns.has('id') && <TableCell className="font-medium font-mono text-xs text-muted-foreground">
                                                    {item.id}
                                                </TableCell>}
                                                {visibleColumns.has('item_name') && (
                                                    <TableCell>
                                                        <div className="font-semibold">{item.item_name}</div>
                                                        {item.formula && (
                                                            <div className="text-xs text-muted-foreground mt-0.5 italic">{item.formula}</div>
                                                        )}
                                                    </TableCell>
                                                )}
                                                {visibleColumns.has('manufacturer') && <TableCell className="text-sm text-muted-foreground">{item.manufacturer || '-'}</TableCell>}
                                                {visibleColumns.has('vendor') && <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate" title={item.vendors?.join(', ')}>
                                                    {item.vendors?.slice(0, 2).join(', ')}{item.vendors && item.vendors.length > 2 ? '...' : ''}
                                                </TableCell>}
                                                {visibleColumns.has('pack_size') && <TableCell className="text-muted-foreground text-xs">{item.pack_size || '-'}</TableCell>}
                                                {visibleColumns.has('quantity') && <TableCell className="font-medium text-foreground">
                                                    {getDisplayQuantity(item.quantity, item.pack_size).toLocaleString()}
                                                </TableCell>}
                                                {visibleColumns.has('price') && <TableCell>
                                                    {`₹${item.price}`}
                                                </TableCell>}
                                                {visibleColumns.has('gst_rate') && <TableCell>
                                                    {item.gst_rate ? `${item.gst_rate}%` : '-'}
                                                </TableCell>}
                                                {visibleColumns.has('total_value') && <TableCell>
                                                    {item.total_value ? `₹${item.total_value.toLocaleString()}` : '-'}
                                                </TableCell>}
                                                {visibleColumns.has('category') && <TableCell className="text-muted-foreground text-xs">{item.category}</TableCell>}
                                                {visibleColumns.has('rack_location') && <TableCell className="text-muted-foreground text-xs">{item.rack_location || '-'}</TableCell>}
                                                {visibleColumns.has('hsn_code') && <TableCell className="text-muted-foreground text-xs">{item.hsn_code || '-'}</TableCell>}
                                                {visibleColumns.has('min_stock_level') && <TableCell className="text-muted-foreground text-xs">{item.min_stock_level}</TableCell>}
                                                {visibleColumns.has('expiry_date') && <TableCell>{item.expiry_date}</TableCell>}
                                                {visibleColumns.has('status') && <TableCell>
                                                    <div className="flex gap-1 flex-wrap">
                                                        {item.status.map(s => (
                                                            <span key={s} className={cn(
                                                                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                                                                s === "OK" && "bg-green-500/10 text-green-500",
                                                                s === "LOW STOCK" && "bg-yellow-500/10 text-yellow-500",
                                                                s === "EXPIRED" && "bg-red-500/10 text-red-500",
                                                                s === "EXPIRES SOON" && "bg-orange-500/10 text-orange-500",
                                                                s === "OUT OF STOCK" && "bg-destructive/10 text-destructive",
                                                            )}>
                                                                {s}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </TableCell>}
                                                <TableCell>
                                                    <div className="flex items-center gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8"
                                                            title="View movement history"
                                                            onClick={() => openHistory(item)}
                                                        >
                                                            <History className="h-4 w-4" />
                                                        </Button>
                                                        <ViewBatchesDialog item={item} />
                                                        <EditInventoryDialog item={item} onSuccess={loadData} />
                                                        {role === 'admin' && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                                                title="Permanently delete product"
                                                                onClick={() => handleDeleteProduct(item.id, item.item_name)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Mobile card list — shown only on mobile */}
                        <div className="md:hidden flex-1 overflow-y-auto min-h-0 divide-y">
                            {filteredInventory.length === 0 ? (
                                <p className="text-center py-8 text-muted-foreground text-sm">No items found.</p>
                            ) : (
                                filteredInventory.map((item) => (
                                    <div key={item.id} className="py-3 px-1 flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold text-sm truncate">{item.item_name}</p>
                                            <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-1.5">
                                                <span>{item.category}</span>
                                                <span>·</span>
                                                <span className={cn(
                                                    item.status.includes("LOW STOCK") && "text-red-600 font-semibold"
                                                )}>
                                                    {getDisplayQuantity(item.quantity, item.pack_size)} count
                                                    {item.status.includes("LOW STOCK") && " ⚠"}
                                                </span>
                                                {item.expiry_date && (
                                                    <>
                                                        <span>·</span>
                                                        <span>Exp {item.expiry_date}</span>
                                                    </>
                                                )}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <EditInventoryDialog item={item} onSuccess={loadData} />
                                            <ViewBatchesDialog item={item} />
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        </>
                    )}
                </CardContent>
            </Card>
            {/* History Drawer */}
            <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
                <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
                    <SheetHeader className="mb-4">
                        <SheetTitle>
                            Movement History{historyItem ? ` — ${historyItem.item_name}` : ''}
                        </SheetTitle>
                    </SheetHeader>
                    {historyLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : historyEntries.length === 0 ? (
                        <p className="text-center text-muted-foreground py-12">No history yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Date / Time</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Change</TableHead>
                                        <TableHead>Batch ID</TableHead>
                                        <TableHead>Bill ID</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {historyEntries.map(entry => (
                                        <TableRow key={entry.id}>
                                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                                {formatHistoryTimestamp(entry.timestamp)}
                                            </TableCell>
                                            <TableCell>
                                                <span className={cn(
                                                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                                    entry.type === 'PURCHASE' && "bg-green-500/10 text-green-600",
                                                    entry.type === 'SALE' && "bg-blue-500/10 text-blue-600",
                                                    entry.type === 'ADJUSTMENT' && "bg-yellow-500/10 text-yellow-600",
                                                    entry.type === 'EXPIRED' && "bg-red-500/10 text-red-600",
                                                    entry.type === 'RETURN' && "bg-purple-500/10 text-purple-600",
                                                )}>
                                                    {entry.type}
                                                </span>
                                            </TableCell>
                                            <TableCell className={cn(
                                                "font-medium tabular-nums",
                                                entry.change_amount > 0 ? "text-green-600" : "text-red-600"
                                            )}>
                                                {entry.change_amount > 0 ? `+${entry.change_amount}` : entry.change_amount}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {entry.batch_id ?? '-'}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground font-mono">
                                                {entry.bill_id ?? '-'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </SheetContent>
            </Sheet>
                </TabsContent>
            </Tabs>

            {/* Export Dialog */}
            <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Export Inventory</DialogTitle>
                        <DialogDescription>Choose what to export.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <button
                            className="w-full text-left rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                            onClick={() => { api.exportInventory(); setExportDialogOpen(false) }}
                        >
                            <p className="font-semibold text-sm">Total Inventory</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Full batch-level dump with all fields. Use for records or backup.
                            </p>
                        </button>
                        <div className="rounded-lg border p-4 space-y-3">
                            <div>
                                <p className="font-semibold text-sm">Edit Inventory</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    One row per product with per-clinic quantities. Use to adjust stock and re-import.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Select value={exportScope} onValueChange={setExportScope}>
                                    <SelectTrigger className="h-8 flex-1 text-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All clinics</SelectItem>
                                        {locations.map(l => (
                                            <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button size="sm" onClick={() => {
                                    api.exportInventoryEdit(exportScope)
                                    setExportDialogOpen(false)
                                }}>
                                    Download
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Wipe Inventory Dialog */}
            <Dialog open={wipeDialogOpen} onOpenChange={(v) => { setWipeDialogOpen(v); if (!v) { setWipeCode(''); setWipeError(null) } }}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-rose-600">
                            <ShieldAlert className="h-5 w-5" />
                            Wipe Entire Inventory
                        </DialogTitle>
                        <DialogDescription>
                            This permanently deletes <strong>all stock batches and movement history</strong>.
                            Product names and billing records are preserved.
                            This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-700 dark:text-rose-400 space-y-1">
                            <p className="font-semibold">What will be deleted:</p>
                            <ul className="list-disc list-inside space-y-0.5 text-xs">
                                <li>All inventory batches (all stock quantities reset to zero)</li>
                                <li>All inventory movement history</li>
                            </ul>
                            <p className="font-semibold mt-2">What is kept:</p>
                            <ul className="list-disc list-inside space-y-0.5 text-xs">
                                <li>Product master catalog (names, categories, etc.)</li>
                                <li>Purchase invoices and billing records</li>
                            </ul>
                        </div>
                        {wipeError && (
                            <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                {wipeError}
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Enter your 6-digit admin auth code to confirm</label>
                            <Input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                placeholder="000000"
                                value={wipeCode}
                                onChange={e => setWipeCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                onKeyDown={e => { if (e.key === 'Enter' && wipeCode.length === 6) handleWipeInventory() }}
                                className="text-center text-2xl tracking-widest font-mono h-12"
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setWipeDialogOpen(false)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            onClick={handleWipeInventory}
                            disabled={wipeCode.length !== 6 || wipeLoading}
                        >
                            {wipeLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Wipe Inventory
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div >
    )
}
