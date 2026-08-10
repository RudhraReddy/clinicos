"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { api, type Patient, type InventorySearchResult, type BillingHistoryEntry, type Visit, type Location } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Loader2, Search, Trash2, Printer, Settings, ChevronLeft, ChevronRight, Menu, Package, LayoutDashboard, Users, MapPin } from "lucide-react"
import { useMenu } from "@/components/layout/AppShell"
import Link from "next/link"
import { PatientSearch } from "@/components/PatientSearch"
import { useAuth } from "@/lib/auth_context"
import { PrintInvoiceDialog } from "@/components/PrintInvoiceDialog"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "sonner"
import { useSettings } from "@/lib/settings_context"
import { DatePickerWithRange } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"
import { format } from "date-fns"

export interface BillItem {
    item_id: string;
    item_name: string;
    batch_number: string;
    qty: number | '';
    mrp: number;
    gst: number;
    total: number;
    pack_size?: string;
    unit: 'packs' | 'ea';
    // Display-only — where to physically find the item while building the bill.
    // Deliberately never sent to the backend: see handleCreateBill's payload, which
    // maps billItems to an explicit field list that excludes it.
    rack_location?: string;
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
    const { role, user } = useAuth()
    const { openMenu } = useMenu()

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

    // Walk-in bill (no patient/visit link)
    const [walkInMode, setWalkInMode] = useState(false)
    const [walkInName, setWalkInName] = useState("")
    const [walkInAge, setWalkInAge] = useState("")
    const [walkInSex, setWalkInSex] = useState("")

    // Item search
    const [itemQuery, setItemQuery] = useState("")
    const [searchResults, setSearchResults] = useState<InventorySearchResult[]>([])
    const [highlightedIndex, setHighlightedIndex] = useState(0)
    const itemSearchInputRef = useRef<HTMLInputElement>(null)
    const highlightedItemRef = useRef<HTMLDivElement>(null)

    // Bill items
    const [billItems, setBillItems] = useState<BillItem[]>([])
    const [submitting, setSubmitting] = useState(false)

    // Payment type
    const [paymentType, setPaymentType] = useState<"CASH" | "UPI">("CASH")
    const [discountType, setDiscountType] = useState<"percent" | "flat">("percent")
    const [discountValue, setDiscountValue] = useState("")

    // Visit refund — only meaningful when Billing was opened from a specific visit
    // (visit_id in the URL, e.g. the dashboard's "Go to Billing" action). A plain
    // patient search doesn't point at any one visit, so there's nothing to refund.
    const [linkedVisit, setLinkedVisit] = useState<Visit | null>(null)
    const [refundChecked, setRefundChecked] = useState(false)
    const [refundValue, setRefundValue] = useState("")
    const [refundMode, setRefundMode] = useState<"" | "cash" | "upi">("")
    const [refundSubmitting, setRefundSubmitting] = useState(false)

    // Clinic assignment — every bill is tagged to a clinic, same as the visit it may
    // be linked to. A visit-linked bill is locked to that visit's own clinic (can't
    // disagree with it); otherwise admin/doctor pick one explicitly and frontdesk is
    // locked to their own assigned clinic.
    const [locations, setLocations] = useState<Location[]>([])
    const [selectedLocationId, setSelectedLocationId] = useState<number | "">("")

    useEffect(() => {
        api.getLocations().then(locs => setLocations(locs.filter(l => l.is_active))).catch(() => {})
    }, [])

    // History
    const [history, setHistory] = useState<BillingHistoryEntry[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)

    // History filters
    const [dateRange, setDateRange] = useState<DateRange | undefined>()
    const filterDateFrom = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : ''
    const filterDateTo = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : ''
    const [filterPaymentType, setFilterPaymentType] = useState('')
    const [filterIsWalkIn, setFilterIsWalkIn] = useState<'' | 'true' | 'false'>('')
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

    const loadLinkedVisit = useCallback(() => {
        if (!visitId) {
            setLinkedVisit(null)
            return
        }
        api.getVisit(visitId)
            .then(setLinkedVisit)
            .catch(() => setLinkedVisit(null))
    }, [visitId])

    useEffect(() => { loadLinkedVisit() }, [loadLinkedVisit])

    // Refund reflects the visit's current total refund and is directly editable —
    // whenever the linked visit (re)loads, pre-check the box and pre-fill the
    // existing amount/mode if one exists, so increasing/decreasing it is just
    // editing the number and resubmitting.
    useEffect(() => {
        const existingRefund = linkedVisit?.refund_amount || 0
        setRefundChecked(existingRefund > 0)
        setRefundValue(existingRefund > 0 ? existingRefund.toString() : "")
        setRefundMode((linkedVisit?.refund_mode as "cash" | "upi") || "")
    }, [linkedVisit])

    const loadHistory = useCallback(async (page = 1) => {
        setLoadingHistory(true)
        try {
            const data = await api.getBillingHistory({
                date_from: filterDateFrom || undefined,
                date_to: filterDateTo || undefined,
                payment_type: filterPaymentType || undefined,
                is_walk_in: filterIsWalkIn || undefined,
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
    }, [filterDateFrom, filterDateTo, filterPaymentType, filterIsWalkIn])

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
                    .then(data => {
                        setSearchResults(data)
                        setHighlightedIndex(0)
                    })
                    .catch(console.error)
            } else {
                setSearchResults([])
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [itemQuery])

    // Keep the highlighted result scrolled into view as arrow keys move it
    useEffect(() => {
        highlightedItemRef.current?.scrollIntoView({ block: 'nearest' })
    }, [highlightedIndex])

    const handleItemSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (searchResults.length === 0) return
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlightedIndex(i => Math.min(i + 1, searchResults.length - 1))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlightedIndex(i => Math.max(i - 1, 0))
        } else if (e.key === 'Enter') {
            e.preventDefault()
            const item = searchResults[highlightedIndex]
            if (item) addToBill(item)
        } else if (e.key === 'Escape') {
            setSearchResults([])
        }
    }

    const addToBill = (item: InventorySearchResult) => {
        const multiplier = getPackMultiplier(item.pack_size)
        const unitMRP = (item.price || 0) / multiplier
        const newItem: BillItem = {
            item_id: item.id.toString(),
            item_name: item.item_name,
            batch_number: "Auto-FIFO",
            qty: '',
            mrp: unitMRP,
            gst: item.gst_rate || 0,
            total: 0,
            pack_size: item.pack_size,
            unit: 'ea',
            rack_location: item.rack_location || undefined,
        }
        setBillItems([...billItems, newItem])
        setItemQuery("")
        setSearchResults([])
        itemSearchInputRef.current?.focus()
    }

    const updateQty = (index: number, newQty: number | '') => {
        const newItems = [...billItems]
        const item = newItems[index]
        item.qty = newQty
        const multiplier = getPackMultiplier(item.pack_size)
        const numericQty = newQty === '' ? 0 : newQty
        const count = item.unit === 'packs' ? numericQty * multiplier : numericQty
        item.total = item.mrp * count
        setBillItems(newItems)
    }

    const updateUnit = (index: number, newUnit: 'packs' | 'ea') => {
        const newItems = [...billItems]
        const item = newItems[index]
        item.unit = newUnit
        const multiplier = getPackMultiplier(item.pack_size)
        const numericQty = item.qty === '' ? 0 : item.qty
        const count = newUnit === 'packs' ? numericQty * multiplier : numericQty
        item.total = item.mrp * count
        setBillItems(newItems)
    }

    const removeItem = (index: number) => {
        setBillItems(billItems.filter((_, i) => i !== index))
    }

    const handleCreateBill = async () => {
        if (walkInMode ? !walkInName.trim() : !patientId) return
        if (billItems.length === 0) return
        if (hasInvalidQty) {
            toast.error("Enter a quantity for every item before creating the bill")
            return
        }
        if (!resolvedLocationId) {
            toast.error(isAdminOrDoctor ? "Select a clinic for this bill" : "No clinic assigned to your account — contact an admin")
            return
        }

        setSubmitting(true)
        try {
            const payload = {
                patient_id: walkInMode ? undefined : patientId,
                walk_in_name: walkInMode ? walkInName.trim() : undefined,
                walk_in_age: walkInMode && walkInAge ? walkInAge : undefined,
                walk_in_sex: walkInMode && walkInSex ? walkInSex : undefined,
                visit_id: walkInMode ? undefined : (visitId || undefined),
                location_id: resolvedLocationId,
                payment_type: paymentType,
                discount_type: parsedDiscountValue > 0 ? discountType : undefined,
                discount_value: parsedDiscountValue > 0 ? parsedDiscountValue : undefined,
                items_used: billItems.map(i => {
                    const qty = i.qty === '' ? 0 : i.qty
                    const multiplier = getPackMultiplier(i.pack_size)
                    const count = i.unit === 'packs' ? qty * multiplier : qty
                    return {
                        item_id: i.item_id,
                        quantity: count / multiplier,
                        qty,
                        unit: i.unit,
                        mrp: i.unit === 'packs' ? i.mrp * multiplier : i.mrp,
                        total_value: i.total,
                    }
                }),
            }

            const data = await api.createBill(payload)
            setBillItems([])
            setDiscountValue("")
            if (walkInMode) {
                setWalkInMode(false)
                setWalkInName("")
                setWalkInAge("")
                setWalkInSex("")
            }
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

    const handleRefund = async () => {
        if (!linkedVisit) return
        const amount = parseFloat(refundValue || '0')
        const cap = linkedVisit.amount_paid || 0
        if (!(amount >= 0) || amount > cap) {
            toast.error(`Enter a refund amount between ₹0 and ₹${cap.toFixed(2)}`)
            return
        }
        if (amount > 0 && refundMode !== 'cash' && refundMode !== 'upi') {
            toast.error("Select a refund type (Cash or UPI)")
            return
        }

        setRefundSubmitting(true)
        try {
            await api.refundVisit(linkedVisit.visit_id, amount, refundMode || undefined)
            toast.success("Refund recorded")
            loadLinkedVisit()
        } catch (e: unknown) {
            console.error(e)
            let errorMessage = "Failed to record refund"
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
            setRefundSubmitting(false)
        }
    }

    const calculateTotal = () => {
        return billItems.reduce((acc, item) => acc + (item.total || 0), 0)
    }

    const hasInvalidQty = billItems.some(i => i.qty === '' || i.qty <= 0)

    const subtotal = calculateTotal()
    const parsedDiscountValue = parseFloat(discountValue || '0') || 0
    const discountAmount = discountType === 'percent'
        ? subtotal * Math.min(Math.max(parsedDiscountValue, 0), 100) / 100
        : Math.min(Math.max(parsedDiscountValue, 0), subtotal)
    const finalTotal = subtotal - discountAmount

    // Clinic resolution — mirrors the backend's own resolution order exactly, so the
    // UI never shows/enables something the server would reject.
    const isAdminOrDoctor = role === 'admin' || role === 'doctor'
    const visitLocationId = (!walkInMode && linkedVisit) ? (linkedVisit.location_id ?? null) : null
    const isLockedToVisit = !!visitLocationId
    const frontdeskLocationId = user?.location_id ?? null
    const resolvedLocationId = isLockedToVisit
        ? visitLocationId
        : isAdminOrDoctor
            ? (selectedLocationId || null)
            : frontdeskLocationId
    const locationName = (id: number | null) => locations.find(l => l.id === id)?.name
    const noClinicAssigned = !isLockedToVisit && !isAdminOrDoctor && !frontdeskLocationId

    return (
        <div className="flex flex-col gap-6 h-[calc(100vh-100px)]">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden gap-4 min-h-0">
                <div className="flex items-center gap-3 flex-wrap shrink-0">
                    <button
                        type="button"
                        onClick={openMenu}
                        className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors"
                    >
                        <Menu className="h-6 w-6" />
                        <span className="sr-only">Toggle Menu</span>
                    </button>
                    <h1 className="text-3xl font-bold tracking-tight w-44 shrink-0">Billing</h1>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" asChild className="w-32">
                            <Link href="/inventory">
                                <Package className="mr-1.5 h-3.5 w-3.5" />
                                Inventory
                            </Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild className="w-32">
                            <Link href="/">
                                <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" />
                                Dashboard
                            </Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild className="w-32">
                            <Link href="/patients">
                                <Users className="mr-1.5 h-3.5 w-3.5" />
                                Patients
                            </Link>
                        </Button>
                    </div>
                    {role !== 'doctor' && (
                        <TabsList>
                            <TabsTrigger value="new">New Bill</TabsTrigger>
                            <TabsTrigger value="history">History</TabsTrigger>
                        </TabsList>
                    )}
                </div>

                <TabsContent value="new" className="flex-1 overflow-hidden m-0 flex flex-col gap-6 min-h-0">
                    <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
                        <CardContent className="p-6 flex flex-col gap-6 flex-1 overflow-hidden min-h-0">
                            {/* Patient & Actions Row */}
                            <div className="flex flex-col md:flex-row gap-4 md:items-center justify-between shrink-0">
                                <div className="flex items-start gap-2">
                                    {walkInMode ? (
                                        <>
                                            <Input
                                                autoFocus
                                                placeholder="Walk-in customer name"
                                                className="w-80 shrink-0 h-10"
                                                value={walkInName}
                                                onChange={(e) => setWalkInName(e.target.value)}
                                                maxLength={100}
                                            />
                                            <Input
                                                type="number"
                                                placeholder="Age"
                                                className="w-20 shrink-0 h-10"
                                                min={0}
                                                max={150}
                                                value={walkInAge}
                                                onChange={(e) => setWalkInAge(e.target.value)}
                                            />
                                            <Select value={walkInSex} onValueChange={setWalkInSex}>
                                                <SelectTrigger className="w-28 shrink-0 h-10">
                                                    <SelectValue placeholder="Sex" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Male">Male</SelectItem>
                                                    <SelectItem value="Female">Female</SelectItem>
                                                    <SelectItem value="Other">Other</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </>
                                    ) : (
                                        <div className="w-80 shrink-0">
                                            <PatientSearch
                                                selectedPatient={patient}
                                                onSelect={(p) => {
                                                    setPatient(p)
                                                    setPatientId(p?.patient_id || "")
                                                }}
                                            />
                                        </div>
                                    )}
                                    <div className="shrink-0">
                                        {(isLockedToVisit || !isAdminOrDoctor) ? (
                                            <div className={cn(
                                                "h-10 px-3 flex items-center gap-1.5 text-sm rounded-md border w-44",
                                                noClinicAssigned
                                                    ? "border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-400"
                                                    : "border-input bg-muted/40 text-muted-foreground"
                                            )}>
                                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                                <span className="truncate">
                                                    {isLockedToVisit
                                                        ? (locationName(visitLocationId) || 'Unknown clinic')
                                                        : noClinicAssigned
                                                            ? 'No clinic assigned'
                                                            : (locationName(frontdeskLocationId) || 'Unknown clinic')}
                                                </span>
                                            </div>
                                        ) : (
                                            <Select
                                                value={selectedLocationId ? selectedLocationId.toString() : ""}
                                                onValueChange={(v) => setSelectedLocationId(parseInt(v))}
                                            >
                                                <SelectTrigger className="h-10 w-44">
                                                    <MapPin className="w-3.5 h-3.5 mr-1.5 text-muted-foreground shrink-0" />
                                                    <SelectValue placeholder="Select clinic" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {locations.map(l => (
                                                        <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    </div>
                                    <Button
                                        type="button"
                                        variant={walkInMode ? "default" : "outline"}
                                        className="shrink-0 h-10"
                                        onClick={() => {
                                            setWalkInMode(m => !m)
                                            setPatient(null)
                                            setPatientId("")
                                            setWalkInName("")
                                            setWalkInAge("")
                                            setWalkInSex("")
                                        }}
                                    >
                                        Walk-in Bill
                                    </Button>
                                    {linkedVisit && !walkInMode && (
                                        <div className="flex items-center gap-2 shrink-0">
                                            <div className="flex items-center space-x-2">
                                                <input
                                                    type="checkbox"
                                                    id="billing-refund-check"
                                                    checked={refundChecked}
                                                    onChange={(e) => {
                                                        setRefundChecked(e.target.checked)
                                                        if (!e.target.checked) {
                                                            setRefundValue("")
                                                            setRefundMode("")
                                                        }
                                                    }}
                                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                                />
                                                <label htmlFor="billing-refund-check" className="text-sm font-medium cursor-pointer select-none">
                                                    Refund
                                                </label>
                                            </div>
                                            <Input
                                                type="number"
                                                placeholder="Value"
                                                className="w-24 h-10"
                                                value={refundValue}
                                                onChange={(e) => setRefundValue(e.target.value)}
                                                disabled={!refundChecked}
                                            />
                                            <Select value={refundMode} onValueChange={(v) => setRefundMode(v as "cash" | "upi")} disabled={!refundChecked}>
                                                <SelectTrigger className="w-24 h-10">
                                                    <SelectValue placeholder="Type" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="cash">Cash</SelectItem>
                                                    <SelectItem value="upi">UPI</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="h-10 shrink-0"
                                                disabled={!refundChecked || refundSubmitting}
                                                onClick={handleRefund}
                                            >
                                                {refundSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                Submit Refund
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <Select value={paymentType} onValueChange={(val) => setPaymentType(val as "CASH" | "UPI")}>
                                        <SelectTrigger id="payment-type" className="w-[140px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="CASH">Cash</SelectItem>
                                            <SelectItem value="UPI">UPI</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Button
                                        size="lg"
                                        disabled={submitting || (walkInMode ? !walkInName.trim() : !patientId) || billItems.length === 0 || hasInvalidQty || !resolvedLocationId}
                                        onClick={handleCreateBill}
                                    >
                                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Create Bill
                                    </Button>
                                </div>
                            </div>

                            {/* Items */}
                            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                                <h3 className="font-semibold text-base mb-3 shrink-0">Items</h3>
                                <div className="flex-1 overflow-auto border rounded-md min-h-0">
                                    <Table>
                                        <TableHeader className="sticky top-0 bg-background z-10">
                                            <TableRow>
                                                <TableHead className="w-[50px]">No.</TableHead>
                                                <TableHead>
                                                    <Popover open={searchResults.length > 0} onOpenChange={(o) => { if (!o) setSearchResults([]) }}>
                                                        <PopoverTrigger asChild>
                                                            <div className="relative">
                                                                <Search className="absolute left-2.5 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                                                                <Input
                                                                    ref={itemSearchInputRef}
                                                                    className="h-8 pl-8 font-normal"
                                                                    placeholder="Search by Product ID or Formula..."
                                                                    value={itemQuery}
                                                                    onChange={(e) => setItemQuery(e.target.value)}
                                                                    onKeyDown={handleItemSearchKeyDown}
                                                                />
                                                            </div>
                                                        </PopoverTrigger>
                                                        <PopoverContent
                                                            className="p-0 w-[var(--radix-popover-trigger-width)] max-h-72 overflow-y-auto"
                                                            align="start"
                                                            onOpenAutoFocus={(e) => e.preventDefault()}
                                                            onCloseAutoFocus={(e) => e.preventDefault()}
                                                        >
                                                            {searchResults.map((item, idx) => (
                                                                <div
                                                                    key={item.id}
                                                                    ref={idx === highlightedIndex ? highlightedItemRef : undefined}
                                                                    className={cn(
                                                                        "p-2 cursor-pointer border-b last:border-0",
                                                                        idx === highlightedIndex ? "bg-accent" : "hover:bg-accent"
                                                                    )}
                                                                    onMouseEnter={() => setHighlightedIndex(idx)}
                                                                    onClick={() => addToBill(item)}
                                                                >
                                                                    <div className="flex justify-between">
                                                                        <span className="font-medium">{item.item_name}</span>
                                                                        <span className="flex flex-col items-end">
                                                                            <span className={item.total_qty && item.total_qty > 0 ? "text-green-600 text-xs" : "text-red-500 text-xs"}>
                                                                                {item.total_qty && item.total_qty > 0 ? `${Math.round(item.total_qty * getPackMultiplier(item.pack_size))} in stock` : "Out of Stock"}
                                                                            </span>
                                                                            <span className="text-xs text-muted-foreground">
                                                                                ₹{((item.price || 0) / getPackMultiplier(item.pack_size)).toFixed(2)}/ea
                                                                            </span>
                                                                        </span>
                                                                    </div>
                                                                    <div className="text-xs text-muted-foreground">
                                                                        {item.vendors && item.vendors.length > 0 ? item.vendors.join(', ') : 'No vendor'} | {item.formula || 'No formula'}
                                                                    </div>
                                                                    {item.substitutes && item.substitutes.length > 0 && (
                                                                        <div className="mt-1 bg-yellow-50 dark:bg-yellow-900/10 p-1 rounded text-xs">
                                                                            <span className="font-semibold text-yellow-700">Substitutes: </span>
                                                                            {item.substitutes.map((s: { name: string; qty: number }) => `${s.name} (${s.qty})`).join(', ')}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </PopoverContent>
                                                    </Popover>
                                                </TableHead>
                                                <TableHead>Batch</TableHead>
                                                <TableHead className="w-[100px]">Qty</TableHead>
                                                <TableHead className="w-[100px]">Unit</TableHead>
                                                <TableHead className="w-[100px]">Price</TableHead>
                                                <TableHead className="w-[100px]">Total</TableHead>
                                                <TableHead className="w-[50px]"></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {billItems.map((item, idx) => (
                                            <TableRow key={idx}>
                                                <TableCell>{idx + 1}</TableCell>
                                                <TableCell className="font-medium">
                                                    {item.item_name}
                                                    {item.rack_location && (
                                                        <div className="mt-0.5">
                                                            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 rounded px-1.5 py-0.5">
                                                                📍 {item.rack_location}
                                                            </span>
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-xs text-muted-foreground">{item.batch_number}</TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        placeholder="Qty"
                                                        className="h-8 w-20"
                                                        value={item.qty}
                                                        onChange={(e) => {
                                                            const raw = e.target.value
                                                            updateQty(idx, raw === '' ? '' : parseInt(raw) || 0)
                                                        }}
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
                            </div>

                            {billItems.length > 0 && (
                                <div className="flex justify-end mt-4 shrink-0">
                                    <div className="flex flex-col items-end gap-2 min-w-[260px]">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-muted-foreground">Discount</span>
                                            <div className="flex rounded-md border overflow-hidden">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant={discountType === "percent" ? "default" : "ghost"}
                                                    className="rounded-none h-8 px-2.5"
                                                    onClick={() => setDiscountType("percent")}
                                                >
                                                    %
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant={discountType === "flat" ? "default" : "ghost"}
                                                    className="rounded-none h-8 px-2.5"
                                                    onClick={() => setDiscountType("flat")}
                                                >
                                                    ₹
                                                </Button>
                                            </div>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={discountType === "percent" ? 100 : subtotal}
                                                value={discountValue}
                                                onChange={(e) => setDiscountValue(e.target.value)}
                                                placeholder="0"
                                                className="w-24 h-8"
                                            />
                                        </div>
                                        {discountAmount > 0 && (
                                            <>
                                                <div className="flex justify-between w-full text-sm text-muted-foreground">
                                                    <span>Subtotal</span>
                                                    <span>₹{subtotal.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between w-full text-sm text-muted-foreground">
                                                    <span>Discount{discountType === "percent" ? ` (${parsedDiscountValue}%)` : ""}</span>
                                                    <span>−₹{discountAmount.toFixed(2)}</span>
                                                </div>
                                            </>
                                        )}
                                        <span className="text-lg font-bold">
                                            Total: ₹{finalTotal.toFixed(2)}
                                        </span>
                                    </div>
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
                                    <Label className="text-xs">Date Range</Label>
                                    <DatePickerWithRange date={dateRange} setDate={setDateRange} className="w-[260px]" />
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
                                            <SelectItem value="UPI">UPI</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Patient Type</Label>
                                    <Select value={filterIsWalkIn || "ALL"} onValueChange={(val) => setFilterIsWalkIn(val === "ALL" ? "" : val as 'true' | 'false')}>
                                        <SelectTrigger className="w-[170px]">
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ALL">All</SelectItem>
                                            <SelectItem value="false">Registered Patients</SelectItem>
                                            <SelectItem value="true">Walk-in Only</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <Button onClick={() => { setHistoryPage(1); loadHistory(1) }}>
                                    <Search className="h-4 w-4 mr-2" />
                                    Search
                                </Button>
                                {(filterDateFrom || filterDateTo || filterPaymentType || filterIsWalkIn) && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setDateRange(undefined)
                                            setFilterPaymentType('')
                                            setFilterIsWalkIn('')
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
                                <>
                                    {/* Desktop table */}
                                    <div className="hidden md:block">
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
                                                        <TableCell>
                                                            <div className="flex items-center gap-2">
                                                                {bill.patient_name}
                                                                {bill.is_walk_in && (
                                                                    <Badge variant="outline" className="text-[10px]">Walk-in</Badge>
                                                                )}
                                                            </div>
                                                        </TableCell>
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
                                                                {role === 'admin' && (
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
                                    </div>

                                    {/* Mobile cards */}
                                    <div className="md:hidden divide-y border rounded-lg overflow-hidden">
                                        {history.map(bill => (
                                            <div key={bill.invoice_id} className="flex flex-col gap-1 p-3 bg-background">
                                                <div className="flex items-center justify-between">
                                                    <span className="font-mono text-xs text-muted-foreground">{bill.invoice_id}</span>
                                                    <span className="font-bold text-sm">₹{bill.total_amount.toFixed(2)}</span>
                                                </div>
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="flex-1 text-xs text-muted-foreground">
                                                        {bill.patient_name}
                                                        {bill.is_walk_in && <Badge variant="outline" className="text-[10px] ml-1">Walk-in</Badge>}
                                                        {' · '}{bill.date}
                                                    </span>
                                                    <Badge variant="outline" className="text-[10px]">{bill.payment_type}</Badge>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => {
                                                            setPrintInvoiceId(bill.invoice_id)
                                                            setPrintDialogOpen(true)
                                                        }}
                                                    >
                                                        <Printer className="h-4 w-4" />
                                                    </Button>
                                                    {role === 'admin' && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-destructive hover:text-destructive"
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
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                        {history.length === 0 && (
                                            <div className="text-center py-8 text-sm text-muted-foreground">
                                                No bills found.
                                            </div>
                                        )}
                                    </div>
                                </>
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
