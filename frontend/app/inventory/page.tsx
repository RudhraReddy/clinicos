
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
import { Search, Loader2, AlertCircle, Package, FileText, Plus, Download, Upload, Columns, AlertTriangle, X, History, ChevronDown, ChevronRight, RotateCcw } from "lucide-react"
import { api, type InventoryItem, type InventoryHistoryEntry } from "@/lib/api"
import { cn } from "@/lib/utils"
import { UploadInventoryReportDialog } from "@/components/UploadInventoryReportDialog"
import { EditInventoryDialog } from "@/components/EditInventoryDialog"
import { ImportInventoryDialog } from "@/components/ImportInventoryDialog"
import { ViewBatchesDialog } from "@/components/ViewBatchesDialog"
import { DataTableColumnFilter } from "@/components/DataTableColumnFilter"
import { DataTableRangeFilter } from "@/components/DataTableRangeFilter"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import Link from 'next/link'

function AllChangesPanel() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [filterType, setFilterType] = useState('ALL') // 'ALL', 'SALE', 'ADJUSTMENT', 'PURCHASE'

    const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())

    const load = async (from = dateFrom, to = dateTo) => {
        setLoading(true)
        try {
            const res = await api.getInventoryAllChanges(from || undefined, to || undefined)
            setData(res)
        } catch {
            setData(null)
        } finally {
            setLoading(false)
        }
    }

    const resetDates = () => {
        setDateFrom('')
        setDateTo('')
        setFilterType('ALL')
        load('', '')
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
                        <label className="text-xs text-muted-foreground mb-1 block">From</label>
                        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground mb-1 block">To</label>
                        <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
                    </div>
                    <Button onClick={() => load()} variant="outline">Apply</Button>
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
                        )}

                        {day.sales.length > 0 && (
                            <div>
                                <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                                    Sales ({day.sales.length})
                                </h4>
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

export default function InventoryPage() {
    const [role, setRole] = useState<string>('')
    const [activeTab, setActiveTab] = useState<'inventory' | 'all-changes'>('inventory')
    const [inventory, setInventory] = useState<InventoryItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [filterName, setFilterName] = useState<Set<string>>(new Set())
    const [filterMfg, setFilterMfg] = useState<Set<string>>(new Set())
    const [filterVendor, setFilterVendor] = useState<Set<string>>(new Set())
    const [filterCategory, setFilterCategory] = useState<Set<string>>(new Set())
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

    const loadData = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await api.getInventory()
            setInventory(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load inventory")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadData()
        setRole(localStorage.getItem('clinic_role') || '')
    }, [])

    // Extract Unique Values for Filters
    const optionsName = Array.from(new Set(inventory.map(i => i.item_name))).filter(Boolean).sort()
    const optionsMfg = Array.from(new Set(inventory.map(i => i.manufacturer || "")) as Set<string>).filter(Boolean).sort()
    const optionsVendor = Array.from(new Set(inventory.flatMap(i => i.vendors || []))).filter(Boolean).sort()
    const optionsCategory = Array.from(new Set(inventory.map(i => i.category))).filter(Boolean).sort()
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

        return matchesSearch && matchesName && matchesMfg && matchesVendor && matchesCategory && matchesStatus &&
            matchesId && matchesQty && matchesPrice && matchesValue && matchesExpiry &&
            matchesPack && matchesGST && matchesHSN && matchesFormula && matchesMinStock
    })

    // Column Visibility State
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set([
        'item_name', 'pack_size', 'manufacturer', 'vendor', 'quantity', 'expiry_date', 'status', 'formula'
    ]))

    const toggleColumn = (col: string) => {
        const newSet = new Set(visibleColumns)
        if (newSet.has(col)) {
            newSet.delete(col)
        } else {
            newSet.add(col)
        }
        setVisibleColumns(newSet)
    }

    // Column Definitions for Toggle
    const allColumns = [
        { id: 'id', label: 'ID' },
        { id: 'item_name', label: 'Item Name' },
        { id: 'manufacturer', label: 'MFG' },
        { id: 'vendor', label: 'Vendor' },
        { id: 'pack_size', label: 'Pack' },
        { id: 'quantity', label: 'Qty' },
        { id: 'price', label: 'MRP' },
        { id: 'expiry_date', label: 'Next Expiry' },
        { id: 'status', label: 'Status' },
        { id: 'category', label: 'Category' },
        { id: 'hsn_code', label: 'HSN' },
        { id: 'gst_rate', label: 'GST %' },
        { id: 'formula', label: 'Formula' },
        { id: 'min_stock_level', label: 'Min Stock' },
        { id: 'total_value', label: 'Total Value' },
    ]

    const lowCount = inventory.filter(i => i.status.includes("LOW STOCK")).length
    const outCount = inventory.filter(i => i.status.includes("OUT OF STOCK")).length

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Inventory</h1>
                    <p className="text-muted-foreground">
                        Manage clinic supplies, medicines, and equipment.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="icon" title="Export CSV" onClick={() => api.exportInventory()}>
                        <Download className="h-4 w-4" />
                    </Button>
                    <ImportInventoryDialog trigger={
                        <Button variant="ghost" size="icon" title="Import CSV">
                            <Upload className="h-4 w-4" />
                        </Button>
                    } onSuccess={loadData} />
                </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as 'inventory' | 'all-changes')} className="space-y-4">
                {role === 'doctor' && (
                    <TabsList>
                        <TabsTrigger value="inventory">Inventory</TabsTrigger>
                        <TabsTrigger value="all-changes">All Changes</TabsTrigger>
                    </TabsList>
                )}

                <TabsContent value="all-changes">
                    <AllChangesPanel />
                </TabsContent>

                <TabsContent value="inventory" className="space-y-6 mt-0">
            <div className="flex gap-2 items-center flex-wrap justify-between">
                <div className="flex gap-2 items-center flex-wrap">
                    <Button variant="outline" onClick={() => window.location.href = '/inventory/history'}>
                        <FileText className="mr-2 h-4 w-4" />
                        View History
                    </Button>
                    <Link href="/inventory/invoice_edit?manual=true">
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            Manual Entry
                        </Button>
                    </Link>
                    <UploadInventoryReportDialog
                        trigger={
                            <Button>
                                <Package className="mr-2 h-4 w-4" />
                                Upload Report
                            </Button>
                        }
                    />
                </div>

                {/* Column Toggle */}
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className="ml-auto">
                            <Columns className="mr-2 h-4 w-4" />
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
            </div>


            {!stockAlertDismissed && !loading && (lowCount > 0 || outCount > 0) && (
                <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4 flex items-center gap-3 text-yellow-700 dark:text-yellow-400">
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
                    <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 flex items-center gap-3 text-red-500">
                        <AlertCircle className="h-5 w-5" />
                        <div className="flex-1">
                            <p className="font-medium">Connection Error</p>
                            <p className="text-sm text-red-500/90">{error}</p>
                        </div>
                    </div>
                )
            }

            <Card>
                <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between space-y-0 pb-4">
                    <CardTitle className="text-lg font-medium">Inventory List ({filteredInventory.length})</CardTitle>
                    <div className="flex items-center gap-2">
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
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
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
                                        {visibleColumns.has('hsn_code') && <TableHead>
                                            <DataTableColumnFilter
                                                title="HSN"
                                                options={optionsHSN}
                                                selectedValues={filterHSN}
                                                onChange={setFilterHSN}
                                            />
                                        </TableHead>}
                                        {visibleColumns.has('formula') && <TableHead>
                                            <DataTableColumnFilter
                                                title="Formula"
                                                options={optionsFormula}
                                                selectedValues={filterFormula}
                                                onChange={setFilterFormula}
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
                                                filterCategory.size > 0 || filterStatus.size > 0 ||
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
                                                {visibleColumns.has('item_name') && <TableCell className="font-semibold">{item.item_name}</TableCell>}
                                                {visibleColumns.has('manufacturer') && <TableCell className="text-sm text-muted-foreground">{item.manufacturer || '-'}</TableCell>}
                                                {visibleColumns.has('vendor') && <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate" title={item.vendors?.join(', ')}>
                                                    {item.vendors?.slice(0, 2).join(', ')}{item.vendors && item.vendors.length > 2 ? '...' : ''}
                                                </TableCell>}
                                                {visibleColumns.has('pack_size') && <TableCell className="text-muted-foreground text-xs">{item.pack_size || '-'}</TableCell>}
                                                {visibleColumns.has('quantity') && <TableCell className="font-medium text-foreground">
                                                    {item.quantity}
                                                    {(() => {
                                                        // Parse pack size for total count
                                                        // User logic: "only for onces with 's'" (e.g. 10s). 
                                                        // We also support 'x' (e.g. 1x10) as it's common.
                                                        const pack = item.pack_size?.toLowerCase() || ''
                                                        if (pack.includes('s') || pack.includes('x')) {
                                                            const match = pack.match(/(\d+)/)
                                                            if (match) {
                                                                const num = parseInt(match[0])
                                                                if (!isNaN(num) && num > 1) {
                                                                    return (
                                                                        <div className="text-[10px] text-muted-foreground font-normal">
                                                                            ({(item.quantity * num).toLocaleString()} total)
                                                                        </div>
                                                                    )
                                                                }
                                                            }
                                                        }
                                                        return null
                                                    })()}
                                                </TableCell>}
                                                {visibleColumns.has('price') && <TableCell>
                                                    {item.min_price && item.max_price && item.min_price !== item.max_price
                                                        ? `$${item.min_price} - $${item.max_price}`
                                                        : `$${item.price}`
                                                    }
                                                </TableCell>}
                                                {visibleColumns.has('gst_rate') && <TableCell>
                                                    {item.gst_rate ? `${item.gst_rate}%` : '-'}
                                                </TableCell>}
                                                {visibleColumns.has('total_value') && <TableCell>
                                                    {item.total_value ? `$${item.total_value.toLocaleString()}` : '-'}
                                                </TableCell>}
                                                {visibleColumns.has('category') && <TableCell className="text-muted-foreground text-xs">{item.category}</TableCell>}
                                                {visibleColumns.has('hsn_code') && <TableCell className="text-muted-foreground text-xs">{item.hsn_code || '-'}</TableCell>}
                                                {visibleColumns.has('formula') && <TableCell className="text-muted-foreground text-xs">{item.formula || '-'}</TableCell>}
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
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
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
        </div >
    )
}
