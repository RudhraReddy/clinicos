"use client"

import { useState, useEffect, useMemo, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { api, type Patient, type InventoryItem, type InventorySearchResult } from "@/lib/api"
import { Loader2, Search, Plus, Trash2, Printer, CheckCircle2, AlertCircle, FileCheck, Smartphone } from "lucide-react"
import { PatientSearch } from "@/components/PatientSearch"
import { InvoicePrint } from "@/components/InvoicePrint"
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
import { format } from "date-fns"

interface SubItem {
    id: string;
    name: string;
    qty: number;
}

interface SearchItem extends InventoryItem {
    substitutes?: SubItem[];
    gst_rate?: number;
    generic_tags?: string;
    total_qty?: number;
}

export interface BillItem {
    item_id: string;
    item_name: string;
    batch_number: string; // "Auto-FIFO" for display initially? Or we just show name.
    qty: number;
    mrp: number; // Estimated
    gst: number;
    total: number;
}

function BillingContent() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const [showQR, setShowQR] = useState(false)

    // State
    const [activeTab, setActiveTab] = useState("new")
    const [patientId, setPatientId] = useState(searchParams.get("patient_id") || "")
    const [visitId, setVisitId] = useState(searchParams.get("visit_id") || "")
    const [patient, setPatient] = useState<Patient | null>(null)
    const [loadingPatient, setLoadingPatient] = useState(false)

    // Item Search
    const [itemQuery, setItemQuery] = useState("")
    const [searchResults, setSearchResults] = useState<InventorySearchResult[]>([])
    const [searching, setSearching] = useState(false)

    // Bill Items
    const [billItems, setBillItems] = useState<BillItem[]>([])
    const [submitting, setSubmitting] = useState(false)
    const [lastBillId, setLastBillId] = useState<string | null>(null)
    const [printData, setPrintData] = useState<any>(null) // Holds data for printing
    // History
    const [history, setHistory] = useState<any[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)

    // Load Patient if ID present
    useEffect(() => {
        if (patientId) {
            setLoadingPatient(true)
            api.getPatient(patientId)
                .then(setPatient)
                .catch(() => setPatient(null))
                .finally(() => setLoadingPatient(false))
        }
    }, [patientId])

    // Load History when tab changes
    useEffect(() => {
        if (activeTab === 'history') {
            loadHistory()
        }
    }, [activeTab])

    const loadHistory = async () => {
        setLoadingHistory(true)
        try {
            const data = await api.getBillingHistory()
            setHistory(data)
        } catch (e) {
            console.error(e)
        } finally {
            setLoadingHistory(false)
        }
    }

    // Search Inventory
    useEffect(() => {
        const timer = setTimeout(() => {
            if (itemQuery.length > 2) {
                setSearching(true)
                // Use the new API
                api.searchInventory(itemQuery)
                    .then(data => setSearchResults(data))
                    .catch(console.error)
                    .finally(() => setSearching(false))
            } else {
                setSearchResults([])
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [itemQuery])

    const addToBill = (item: InventorySearchResult) => { // Type as InventorySearchResult
        // We now have price from backend
        const newItem: BillItem = {
            item_id: item.id.toString(),
            item_name: item.item_name,
            batch_number: "Auto-FIFO",
            qty: 1,
            mrp: item.price || 0, // From Search
            gst: item.gst_rate || 0,
            total: 0
        }
        setBillItems([...billItems, newItem])
        setItemQuery("")
        setSearchResults([])
    }



    const updateQty = (index: number, newQty: number) => {
        const newItems = [...billItems]
        newItems[index].qty = newQty
        // Recalculate total if we had MRP? 
        newItems[index].total = newItems[index].mrp * newQty
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
                payment_type: "CASH", // Default for now
                items_used: billItems.map(i => ({
                    item_id: i.item_id,
                    quantity: i.qty
                }))
            }

            const data = await api.createBill(payload)
            setLastBillId(data.invoice_id)
            setBillItems([])
            // Show Success Dialog or Reset
            alert(`Bill Created! ID: ${data.invoice_id}, Total: ${data.total}`)
            setActiveTab('history')
        } catch (e) {
            console.error(e)
            alert("Failed to create bill")
        } finally {
            setSubmitting(false)
        }
    }

    const calculateTotal = () => {
        return billItems.reduce((acc, item) => acc + (item.qty * (item.mrp || 0)), 0)
    }

    const handlePrint = async (invoiceId: string | null = null) => {
        // If invoiceId provided (History), fetch details
        // If null, we print CURRENT state (New Bill Draft)

        if (invoiceId) {
            try {
                const data = await api.getBillDetails(invoiceId)
                // Map backend response to InvoicePrint format
                setPrintData({
                    patient: typeof data.patient === 'object' ? {
                        patient_id: data.patient.id,
                        name: data.patient.name,
                        phone_number: data.patient.phone
                    } : null,
                    billItems: data.items.map((i: any) => ({
                        item_name: i.item_name,
                        batch_number: i.batch_number,
                        qty: i.quantity,
                        mrp: i.mrp
                        // ... other fields if needed
                    })),
                    invoiceId: data.invoice_id,
                    total: data.total_amount,
                    date: new Date(data.created_at)
                })
                // Allow state update then print
                setTimeout(() => window.print(), 300)
            } catch (e) {
                console.error(e)
                alert("Failed to load bill for printing")
            }
        } else {
            // Print Current Draft
            if (!patient || billItems.length === 0) return
            setPrintData({
                patient: patient,
                billItems: billItems,
                invoiceId: "DRAFT", // or lastBillId if just generated?
                total: calculateTotal(),
                date: new Date()
            })
            setTimeout(() => window.print(), 100)
        }
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
                <TabsList>
                    <TabsTrigger value="new">New Bill</TabsTrigger>
                    <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <TabsContent value="new" className="space-y-6">
                    {/* Patient Section */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Patient Details</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="max-w-xl space-y-4">
                                <Label>Select Patient</Label>
                                <PatientSearch
                                    selectedPatient={patient}
                                    onSelect={(p) => {
                                        setPatient(p)
                                        setPatientId(p?.patient_id || "")
                                    }}
                                />
                                {patient && (
                                    <div className="flex justify-end gap-2">

                                        <Button variant="secondary" size="sm" onClick={() => setShowQR(true)}>
                                            <Smartphone className="mr-2 h-4 w-4" />
                                            Upload via QR
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                    <QRCodeUpload
                        open={showQR}
                        onOpenChange={setShowQR}
                        contextType="patient"
                        contextId={patientId}
                        onSuccess={() => alert("Images uploaded! Check gallery.")}
                    />

                    {/* Bill Items */}
                    <Card className="min-h-[500px] flex flex-col">
                        <CardHeader className="pb-3 flex flex-row justify-between items-center">
                            <CardTitle className="text-base">Items</CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 flex flex-col gap-4">
                            {/* Left Aligned Item Search */}
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
                                                        {item.total_qty && item.total_qty > 0 ? `${item.total_qty} in stock` : "Out of Stock"}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {item.manufacturer} | GST: {item.gst_rate || 0}%
                                                </div>
                                                {/* Substitutes */}
                                                {item.substitutes && item.substitutes.length > 0 && (
                                                    <div className="mt-1 bg-yellow-50 dark:bg-yellow-900/10 p-1 rounded text-xs">
                                                        <span className="font-semibold text-yellow-700">Substitutes: </span>
                                                        {item.substitutes.map(s => `${s.name} (${s.qty})`).join(', ')}
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
                                            <TableHead className="w-[50px]">To</TableHead>
                                            <TableHead>Product Name</TableHead>
                                            <TableHead>Batch</TableHead>
                                            <TableHead className="w-[100px]">Qty</TableHead>
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
                                                <TableCell>{item.mrp || '-'}</TableCell>
                                                <TableCell>{(item.qty * (item.mrp || 0)).toFixed(2)}</TableCell>
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

                            <div className="flex justify-end gap-3 mt-4">
                                <Button size="lg" disabled={submitting || !patientId || billItems.length === 0} onClick={handleCreateBill}>
                                    {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Create Bill
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="history">
                    <Card>
                        <CardHeader>
                            <CardTitle>Billing History</CardTitle>
                        </CardHeader>
                        <CardContent>
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
                                            <TableCell>${bill.total_amount.toFixed(2)}</TableCell>
                                            <TableCell>{bill.payment_type}</TableCell>
                                            <TableCell>
                                                <Button variant="outline" size="sm" onClick={() => handlePrint(bill.invoice_id)}>
                                                    <Printer className="h-4 w-4 mr-1" />
                                                    Print
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {history.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                No history found.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Hidden Print Template */}
            <InvoicePrint
                clinicName="MediCare Clinic"
                clinicAddress="123 Health St, Medical District, City"
                clinicPhone="+91 98765 43210"
                patient={printData?.patient || patient} // Fallback to current if printData null (should rely on printData mainly)
                billItems={printData?.billItems || []}
                invoiceId={printData?.invoiceId}
                total={printData?.total || 0}
                date={printData?.date}
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
