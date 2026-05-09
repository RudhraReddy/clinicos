"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { api, type Patient, type InventorySearchResult, type BillingHistoryEntry } from "@/lib/api"
import { Loader2, Search, Trash2, Printer, Smartphone, Settings, ChevronLeft, ChevronRight } from "lucide-react"
import { PatientSearch } from "@/components/PatientSearch"
import { useAuth } from "@/lib/auth_context"
import { PrintInvoiceDialog } from "@/components/PrintInvoiceDialog"
import { QRCodeUpload } from "@/components/QRCodeUpload"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { useSettings } from "@/lib/settings_context"

export interface BillItem {
    item_id: string;
    item_name: string;
    batch_number: string;
    qty: number;
    mrp: number;
    gst: number;
    total: number;
    pack_size?: string;
    unit: 'packs' | 'ea';
}

const getPackMultiplier = (packSize?: string) => {
    const pack = packSize?.toLowerCase() || ''
    if (pack.includes('s') || pack.includes('x')) {
        const match = pack.match(/(\d+)/)
        if (match) {
            const num = parseInt(match[0])
            if (!isNaN(num) && num > 1) {
                return num
            }
        }
    }
    return 1
}

function BillingContent() {
    const searchParams = useSearchParams()
    const { role } = useAuth()
    const [showQR, setShowQR] = useState(false)

    // Tab
    const [activeTab, setActiveTab] = useState("new")

    // Automatically switch to history tab for doctors
    useEffect(() => {
        if (role === 'doctor') {
            setActiveTab('history')
        }
    }, [role])

    // Patient
    const [patientId, setPatientId] = useState(searchParams.get("patient_id") || "")
    const [visitId] = useState(searchParams.get("visit_id") || "")
    const [patient, setPatient] = useState<Patient | null>(null)

    // Item search
    const [itemQuery, setItemQuery] = useState("")
    const [searchResults, setSearchResults] = useState<InventorySearchResult[]>([])

    // Bill items
    const [billItems, setBillItems] = useState<BillItem[]>([])
    const [submitting, setSubmitting] = useState(false)

    // Payment type
    const [paymentType, setPaymentType] = useState<"CASH" | "CARD" | "UPI">("CASH")

    // History
    const [history, setHistory] = useState<BillingHistoryEntry[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)

    // History filters
    const [filterDateFrom, setFilterDateFrom] = useState('')
    const [filterDateTo, setFilterDateTo] = useState('')
    const [filterPaymentType, setFilterPaymentType] = useState('')
    const [historyPage, setHistoryPage] = useState(1)
    const [historyTotal, setHistoryTotal] = useState(0)
    const [historyTotalPages, setHistoryTotalPages] = useState(1)

    // Print dialog
    const [printDialogOpen, setPrintDialogOpen] = useState(false)
    const [printInvoiceId, setPrintInvoiceId] = useState<string | null>(null)

    const { clinicName, clinicAddress, clinicPhone, referenceDoctor } = useSettings()

    // Load patient if ID present in URL
    useEffect(() => {
        if (patientId) {
            api.getPatient(patientId)
                .then(setPatient)
                .catch(() => setPatient(null))
        }
    }, [patientId])

    const loadHistory = useCallback(async (page = 1) => {
        setLoadingHistory(true)
        try {
            const data = await api.getBillingHistory({
                date_from: filterDateFrom || undefined,
                date_to: filterDateTo || undefined,
                payment_type: filterPaymentType || undefined,
                page,
                limit: 25,
            })
            setHistory(data.bills)
            setHistoryPage(data.page)
            setHistoryTotal(data.total)
            setHistoryTotalPages(data.pages)
        } catch (e) {
            console.error(e)
        } finally {
            setLoadingHistory(false)
        }
    }, [filterDateFrom, filterDateTo, filterPaymentType])

    // Load history when tab changes
    useEffect(() => {
        if (activeTab === 'history') {
            loadHistory(1)
        }
    }, [activeTab, loadHistory])

    // Search inventory
    useEffect(() => {
        const timer = setTimeout(() => {
            if (itemQuery.length > 2) {
                api.searchInventory(itemQuery)
                    .then(data => setSearchResults(data))
                    .catch(console.error)
            } else {
                setSearchResults([])
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [itemQuery])

    const addToBill = (item: InventorySearchResult) => {
        const multiplier = getPackMultiplier(item.pack_size)
        const unitMRP = (item.price || 0) / multiplier
        const newItem: BillItem = {
            item_id: item.id.toString(),
            item_name: item.item_name,
            batch_number: "Auto-FIFO",
            qty: 1,
            mrp: unitMRP,
            gst: item.gst_rate || 0,
            total: unitMRP,
            pack_size: item.pack_size,
            unit: 'ea',
        }
        setBillItems([...billItems, newItem])
        setItemQuery("")
        setSearchResults([])
    }

    const updateQty = (index: number, newQty: number) => {
        const newItems = [...billItems]
        const item = newItems[index]
        item.qty = newQty
        const multiplier = getPackMultiplier(item.pack_size)
        const count = item.unit === 'packs' ? newQty * multiplier : newQty
        item.total = item.mrp * count
        setBillItems(newItems)
    }

    const updateUnit = (index: number, newUnit: 'packs' | 'ea') => {
        const newItems = [...billItems]
        const item = newItems[index]
        item.unit = newUnit
        const multiplier = getPackMultiplier(item.pack_size)
        const count = newUnit === 'packs' ? item.qty * multiplier : item.qty
        item.total = item.mrp * count
        setBillItems(newItems)
    }

    const removeItem = (index: number) => {
        setBillItems(billItems.filter((_, i) => i !== index))
    }

    const handleCreateBill = async () => {
        if (!patientId || billItems.length === 0) return

        setSubmitting(true)
        try {
            const payload = {
                patient_id: patientId,
                visit_id: visitId || undefined,
                payment_type: paymentType,
                items_used: billItems.map(i => {
                    const multiplier = getPackMultiplier(i.pack_size)
                    const count = i.unit === 'packs' ? i.qty * multiplier : i.qty
                    return {
                        item_id: i.item_id,
                        quantity: count / multiplier,
                        qty: i.qty,
                        unit: i.unit,
                        mrp: i.unit === 'packs' ? i.mrp * multiplier : i.mrp,
                        total_value: i.total,
                    }
                }),
            }

            const data = await api.createBill(payload)
            setBillItems([])
            toast.success(`Bill created! Invoice #${data.invoice_id}`)
            setActiveTab('history')
            setPrintInvoiceId(data.invoice_id)
            setPrintDialogOpen(true)
        } catch (e: unknown) {
            console.error(e)
            let errorMessage = "Failed to create bill"
            if (e instanceof Error) {
                try {
                    const parsed = JSON.parse(e.message) as { error?: string }
                    if (parsed?.error) errorMessage = parsed.error
                } catch {
                    errorMessage = e.message
                }
            }
            toast.error(errorMessage)
        } finally {
            setSubmitting(false)
        }
    }

    const calculateTotal = () => {
        return billItems.reduce((acc, item) => acc + (item.total || 0), 0)
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
                    <p className="text-muted-foreground">Create invoices and manage history.</p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                {role !== 'doctor' && (
                    <TabsList>
                        <TabsTrigger value="new">New Bill</TabsTrigger>
                        <TabsTrigger value="history">History</TabsTrigger>
                    </TabsList>
                )}

                <TabsContent value="new" className="space-y-6">
                    {/* Patient & Actions Section */}
                    <Card>
                        <CardContent className="p-6">
                            <div className="flex flex-col md:flex-row gap-6 md:items-start justify-between">
                                <div className="flex-1 max-w-xl space-y-4">
                                    <Label>Select Patient</Label>
                                    <PatientSearch
                                        selectedPatient={patient}
                                        onSelect={(p) => {
                                            setPatient(p)
                                            setPatientId(p?.patient_id || "")
                                        }}
                                    />
                                    {patient && (
                                        <div className="flex justify-start gap-2">
                                            <Button variant="secondary" size="sm" onClick={() => setShowQR(true)}>
                                                <Smartphone className="mr-2 h-4 w-4" />
                                                Upload via QR
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-4 bg-muted/30 p-4 rounded-lg border">
                                    <div className="space-y-1">
                                        <Label htmlFor="payment-type" className="text-sm font-medium">
                                            Payment Method
                                        </Label>
                                        <Select value={paymentType} onValueChange={(val) => setPaymentType(val as "CASH" | "CARD" | "UPI")}>
                                            <SelectTrigger id="payment-type" className="w-[140px] bg-background">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="CASH">Cash</SelectItem>
                                                <SelectItem value="CARD">Card</SelectItem>
                                                <SelectItem value="UPI">UPI</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="text-sm font-medium text-foreground h-5 flex items-center">
                                            {billItems.length > 0 ? `Total: ₹${calculateTotal().toFixed(2)}` : 'Total: ₹0.00'}
                                        </span>
                                        <Button size="lg" disabled={submitting || !patientId || billItems.length === 0} onClick={handleCreateBill} className="w-full sm:w-auto">
                                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Create Bill
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <QRCodeUpload
                        open={showQR}
                        onOpenChange={setShowQR}
                        contextType="patient"
                        contextId={patientId}
                        onSuccess={() => toast.success("Images uploaded! Check gallery.")}
                    />

                    {/* Bill Items */}
                    <Card className="min-h-[500px] flex flex-col">
                        <CardHeader className="pb-3 flex flex-row justify-between items-center">
                            <CardTitle className="text-base">Items</CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 flex flex-col gap-4">
                            {/* Item search */}
                            <div className="relative w-full max-w-md">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    className="pl-9"
                                    placeholder="Search by Product ID, Name, or Generic..."
                                    value={itemQuery}
                                    onChange={(e) => setItemQuery(e.target.value)}
                                />
                                {searchResults.length > 0 && (
                                    <div className="absolute z-10 w-full bg-popover border rounded-md shadow-md mt-1 max-h-60 overflow-y-auto">
                                        {searchResults.map((item) => (
                                            <div
                                                key={item.id}
                                                className="p-2 hover:bg-accent cursor-pointer border-b last:border-0"
                                                onClick={() => addToBill(item)}
                                            >
                                                <div className="flex justify-between">
                                                    <span className="font-medium">{item.item_name}</span>
                                                    <span className={item.total_qty && item.total_qty > 0 ? "text-green-600 text-xs" : "text-red-500 text-xs"}>
                                                        {item.total_qty && item.total_qty > 0 ? `${Math.round(item.total_qty * getPackMultiplier(item.pack_size))} in stock` : "Out of Stock"}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {item.manufacturer} | GST: {item.gst_rate || 0}%
                                                </div>
                                                {item.substitutes && item.substitutes.length > 0 && (
                                                    <div className="mt-1 bg-yellow-50 dark:bg-yellow-900/10 p-1 rounded text-xs">
                                                        <span className="font-semibold text-yellow-700">Substitutes: </span>
                                                        {item.substitutes.map((s: { name: string; qty: number }) => `${s.name} (${s.qty})`).join(', ')}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p className="text-xs text-center text-muted-foreground mt-2">
                                    Type to search inventory. Click to add to bill.
                                </p>
                            </div>

                            {/* Table */}
                            <div className="border rounded-md flex-1">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[50px]">No.</TableHead>
                                            <TableHead>Product Name</TableHead>
                                            <TableHead>Batch</TableHead>
                                            <TableHead className="w-[100px]">Qty</TableHead>
                                            <TableHead className="w-[100px]">Unit</TableHead>
                                            <TableHead className="w-[100px]">Price (Est)</TableHead>
                                            <TableHead className="w-[100px]">Total</TableHead>
                                            <TableHead className="w-[50px]"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {billItems.map((item, idx) => (
                                            <TableRow key={idx}>
                                                <TableCell>{idx + 1}</TableCell>
                                                <TableCell className="font-medium">{item.item_name}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground">{item.batch_number}</TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        className="h-8 w-20"
                                                        value={item.qty}
                                                        onChange={(e) => updateQty(idx, parseInt(e.target.value) || 1)}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    {getPackMultiplier(item.pack_size) > 1 ? (
                                                        <Select
                                                            value={item.unit}
                                                            onValueChange={(val) => updateUnit(idx, val as 'packs' | 'ea')}
                                                        >
                                                            <SelectTrigger className="h-8 w-[85px] bg-background">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="ea">ea</SelectItem>
                                                                <SelectItem value="packs">packs</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground font-medium px-2 py-1 bg-muted rounded">ea</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>{(item.unit === 'packs' ? item.mrp * getPackMultiplier(item.pack_size) : item.mrp).toFixed(2)}</TableCell>
                                                <TableCell>{item.total.toFixed(2)}</TableCell>
                                                <TableCell>
                                                    <Button variant="ghost" size="sm" onClick={() => removeItem(idx)}>
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {billItems.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                                    Search and add items to bill.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {billItems.length > 0 && (
                                <div className="flex justify-end mt-4">
                                    <span className="text-lg font-bold">
                                        Total: ₹{calculateTotal().toFixed(2)}
                                    </span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="history">
                    <Card>
                        <CardHeader>
                            <CardTitle>Billing History</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Filter bar */}
                            <div className="flex flex-wrap items-end gap-3">
                                <div className="space-y-1">
                                    <Label htmlFor="filter-date-from" className="text-xs">From</Label>
                                    <Input
                                        id="filter-date-from"
                                        type="date"
                                        className="w-[160px]"
                                        value={filterDateFrom}
                                        onChange={(e) => setFilterDateFrom(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="filter-date-to" className="text-xs">To</Label>
                                    <Input
                                        id="filter-date-to"
                                        type="date"
                                        className="w-[160px]"
                                        value={filterDateTo}
                                        onChange={(e) => setFilterDateTo(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Payment Type</Label>
                                    <Select value={filterPaymentType || "ALL"} onValueChange={(val) => setFilterPaymentType(val === "ALL" ? "" : val)}>
                                        <SelectTrigger className="w-[140px]">
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ALL">All</SelectItem>
                                            <SelectItem value="CASH">Cash</SelectItem>
                                            <SelectItem value="CARD">Card</SelectItem>
                                            <SelectItem value="UPI">UPI</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <Button onClick={() => { setHistoryPage(1); loadHistory(1) }}>
                                    <Search className="h-4 w-4 mr-2" />
                                    Search
                                </Button>
                                {(filterDateFrom || filterDateTo || filterPaymentType) && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setFilterDateFrom('')
                                            setFilterDateTo('')
                                            setFilterPaymentType('')
                                            setHistoryPage(1)
                                            loadHistory(1)
                                        }}
                                    >
                                        Clear
                                    </Button>
                                )}
                            </div>

                            {/* History table */}
                            {loadingHistory ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Invoice ID</TableHead>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Patient</TableHead>
                                            <TableHead>Amount</TableHead>
                                            <TableHead>Payment</TableHead>
                                            <TableHead>Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {history.map(bill => (
                                            <TableRow key={bill.invoice_id}>
                                                <TableCell className="font-mono">{bill.invoice_id}</TableCell>
                                                <TableCell>{bill.date}</TableCell>
                                                <TableCell>{bill.patient_name}</TableCell>
                                                <TableCell>₹{bill.total_amount.toFixed(2)}</TableCell>
                                                <TableCell>{bill.payment_type}</TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => {
                                                                setPrintInvoiceId(bill.invoice_id)
                                                                setPrintDialogOpen(true)
                                                            }}
                                                        >
                                                            <Printer className="h-4 w-4 mr-1" />
                                                            Print
                                                        </Button>
                                                        {role === 'doctor' && (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 dark:hover:bg-rose-950/30 dark:border-rose-900/50"
                                                                onClick={async () => {
                                                                    if (window.confirm(`Are you sure you want to delete invoice ${bill.invoice_id}? This will restore the deducted inventory stocks!`)) {
                                                                        try {
                                                                            await api.deleteBill(bill.invoice_id)
                                                                            toast.success("Bill successfully deleted and stock restored.")
                                                                            loadHistory(historyPage)
                                                                        } catch (err) {
                                                                            console.error(err)
                                                                            toast.error("Failed to delete bill")
                                                                        }
                                                                    }
                                                                }}
                                                            >
                                                                <Trash2 className="h-4 w-4 mr-1" />
                                                                Delete
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {history.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                    No bills found.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            )}

                            {/* Pagination */}
                            <div className="flex items-center justify-between mt-4">
                                <p className="text-sm text-muted-foreground">{historyTotal} total bills</p>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={historyPage <= 1 || loadingHistory}
                                        onClick={() => loadHistory(historyPage - 1)}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        Previous
                                    </Button>
                                    <span className="text-sm">Page {historyPage} of {historyTotalPages}</span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={historyPage >= historyTotalPages || loadingHistory}
                                        onClick={() => loadHistory(historyPage + 1)}
                                    >
                                        Next
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Print invoice dialog */}
            <PrintInvoiceDialog
                open={printDialogOpen}
                onOpenChange={setPrintDialogOpen}
                invoiceId={printInvoiceId}
                clinicName={clinicName}
                clinicAddress={clinicAddress}
                clinicPhone={clinicPhone}
                clinicLicense="TG/WLU/2025-140763"
                referenceDoctor={referenceDoctor}
            />
        </div>
    )
}

export default function BillingPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <BillingContent />
        </Suspense>
    )
}
