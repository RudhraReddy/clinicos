"use client"

import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useRouter } from "next/navigation"
import { FileText, Eye, Search, RotateCcw, ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { DatePickerWithRange } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"
import { startOfDay, endOfDay } from "date-fns"
import { DataTableColumnFilter } from "@/components/DataTableColumnFilter"
import { DataTableRangeFilter } from "@/components/DataTableRangeFilter"

export default function InvoiceHistoryPage() {
    const router = useRouter()
    const [invoices, setInvoices] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [date, setDate] = useState<DateRange | undefined>()
    const [searchQuery, setSearchQuery] = useState("")
    
    // Table filters
    const [filterVendor, setFilterVendor] = useState<Set<string>>(new Set())
    const [filterSource, setFilterSource] = useState<Set<string>>(new Set())
    const [filterAmount, setFilterAmount] = useState<[number, number] | null>(null)

    useEffect(() => {
        loadInvoices()
    }, [])

    const loadInvoices = async () => {
        try {
            const data = await api.getInvoices()
            setInvoices(data)
        } catch (error) {
            console.error("Failed to load invoices", error)
        } finally {
            setLoading(false)
        }
    }

    const filteredInvoices = invoices.filter(inv => {
        let matchesDate = true;
        if (date?.from) {
            const invDate = new Date(inv.upload_date);
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

    return (
        <div className="container mx-auto py-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Invoice History</h1>
                    <p className="text-muted-foreground mt-2">
                        View past uploads and their extraction logs.
                    </p>
                </div>
                <Button variant="outline" onClick={() => router.push('/inventory')}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Inventory
                </Button>
            </div>

            <Card>
                <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between pb-4">
                    <CardTitle>Uploaded Invoices ({filteredInvoices.length})</CardTitle>
                    <div className="flex flex-wrap items-center gap-3">
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
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date Uploaded</TableHead>
                                <TableHead>Invoice #</TableHead>
                                <TableHead>
                                    <DataTableColumnFilter
                                        title="Vendor"
                                        options={optionsVendor}
                                        selectedValues={filterVendor}
                                        onChange={setFilterVendor}
                                    />
                                </TableHead>
                                <TableHead>
                                    <DataTableColumnFilter
                                        title="Source"
                                        options={optionsSource}
                                        selectedValues={filterSource}
                                        onChange={setFilterSource}
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
                                    Actions
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-4">Loading...</TableCell>
                                </TableRow>
                            ) : filteredInvoices.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                                        No invoices found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredInvoices.map((inv) => (
                                    <TableRow key={inv.invoice_number}>
                                        <TableCell>{new Date(inv.upload_date).toLocaleDateString()}</TableCell>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <FileText className="h-4 w-4 text-blue-500" />
                                                {inv.invoice_number}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span>{inv.vendor_name || 'N/A'}</span>
                                            </div>
                                        </TableCell>
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
                                        <TableCell>₹{inv.total_amount.toFixed(2)}</TableCell>
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
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
