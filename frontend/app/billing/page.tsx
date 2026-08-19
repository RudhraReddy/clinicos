"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { api, type Patient, type InventorySearchResult, type BillingHistoryEntry, type Visit, type Location, type RefundMode } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Loader2, Search, Trash2, Printer, Settings, ChevronLeft, ChevronRight, Menu, Package, LayoutDashboard, Users, MapPin } from "lucide-react"
import { useMenu } from "@/components/layout/AppShell"
import Link from "next/link"
import { PatientSearch } from "@/components/PatientSearch"
import { useAuth } from "@/lib/auth_context"
import { PrintInvoiceDialog } from "@/components/PrintInvoiceDialog"
import { DraftInvoicePreviewDialog } from "@/components/DraftInvoicePreviewDialog"
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

const HISTORY_PAGE_SIZE = 25

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
    // Display-only, for the draft invoice preview (see DraftInvoicePreviewDialog) —
    // also never sent to the backend, same reason as rack_location above.
    manufacturer?: string;
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
    const [cashAmount, setCashAmount] = useState("")
    const [upiAmount, setUpiAmount] = useState("")
    const [discountType, setDiscountType] = useState<"percent" | "flat">("percent")
    const [discountValue, setDiscountValue] = useState("")

    // Visit refund — only meaningful when Billing was opened from a specific visit
    // (visit_id in the URL, e.g. the dashboard's "Go to Billing" action). A plain
    // patient search doesn't point at any one visit, so there's nothing to refund.
    const [linkedVisit, setLinkedVisit] = useState<Visit | null>(null)
    // A refund entered while building this bill. Only meaningful for a
    // visit's first bill — see the refund block, which is only rendered
    // when linkedVisit.has_bill is false. Staged client-side only: nothing
    // is sent to the backend until "Create Bill" is clicked, so clearing it
    // before then discards it silently. At most one at a time.
    //
    // Whether a settlement mode is needed is only decided (and only then
    // shown) once a refund has actually been added — refundDraftAmount is
    // the plain amount box shown before that. Once refundLine is staged and
    // exceeds what the bill can absorb (preRefundTotal), the block reveals
    // refundPendingAmount (the payout portion, defaulted from the excess
    // but freely editable like a normal text box — not reformatted on every
    // keystroke) and refundDraftMode. The block stays visible once staged
    // so everything remains editable — removeRefundLine (the trash icon on
    // its bill-table row) is the only way to clear it.
    const [refundLine, setRefundLine] = useState<{ amount: number; mode: RefundMode } | null>(null)
    const [refundDraftAmount, setRefundDraftAmount] = useState("")
    const [refundPendingAmount, setRefundPendingAmount] = useState("")
    const [refundDraftMode, setRefundDraftMode] = useState<"" | RefundMode>("")

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
    const [draftPreviewOpen, setDraftPreviewOpen] = useState(false)

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

    // Whenever the linked visit (re)loads, clear any staged refund draft —
    // it belonged to whatever visit was linked before.
    useEffect(() => {
        setRefundLine(null)
        setRefundDraftAmount("")
        setRefundPendingAmount("")
        setRefundDraftMode("")
    }, [linkedVisit])

    // The refund block only makes sense while building a visit's first bill
    // — once a bill exists, folding a refund into it is no longer possible
    // (see the backend's is_first_bill check), so offering the control at
    // all would be misleading. Stays visible once a refund is staged (not
    // gated on refundLine being unset) so the amount/mode stay editable.
    const canShowRefundBlock = !walkInMode && !!linkedVisit && !linkedVisit.has_bill

    const loadHistory = useCallback(async (page = 1) => {
        setLoadingHistory(true)
        try {
            const data = await api.getBillingHistory({
                date_from: filterDateFrom || undefined,
                date_to: filterDateTo || undefined,
                payment_type: filterPaymentType || undefined,
                is_walk_in: filterIsWalkIn || undefined,
                page,
                limit: HISTORY_PAGE_SIZE,
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
            manufacturer: item.manufacturer || undefined,
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

    // Stages the refund from the plain amount box — this is always the
    // first step, regardless of whether it'll turn out to fit in the bill.
    // Mode is fixed to 'cash' here since whether a payout is even needed is
    // only decided once staged (see the refund block's render logic below);
    // if it fits entirely within the bill, 'cash' stays inert — proven so
    // server-side, since Daily Summary's billing_refund bucket keys off the
    // bill's own payment mode in that case, not the refund's.
    const addRefundToBill = () => {
        const amount = parseFloat(refundDraftAmount || '0')
        if (!(amount > 0)) return
        setRefundLine({ amount, mode: 'cash' })
        // If this exceeds the bill, prime the pending-amount box with the
        // excess (rounded once here, not on every keystroke) so the payout
        // portion the refund block reveals next has a sensible default.
        const overflow = amount - preRefundTotal
        setRefundPendingAmount(overflow > 0 ? overflow.toFixed(2) : "")
    }

    // Re-stages an already-added refund whose amount exceeds the bill, now
    // with the payout portion (possibly hand-edited) and its settlement mode.
    const submitOverflowRefund = () => {
        const pending = parseFloat(refundPendingAmount || '0')
        if (!(pending > 0) || !refundDraftMode) return
        setRefundLine({ amount: preRefundTotal + pending, mode: refundDraftMode })
    }

    const removeRefundLine = () => {
        setRefundLine(null)
        setRefundDraftAmount("")
        setRefundPendingAmount("")
        setRefundDraftMode("")
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
        if (!paymentMatches) {
            toast.error(`Cash + UPI (₹${(parsedCashAmount + parsedUpiAmount).toFixed(2)}) must add up to the total (₹${finalTotal.toFixed(2)})`)
            return
        }

        setSubmitting(true)
        try {
            const submittedRefund = refundLine
            const payload = {
                patient_id: walkInMode ? undefined : patientId,
                walk_in_name: walkInMode ? walkInName.trim() : undefined,
                walk_in_age: walkInMode && walkInAge ? walkInAge : undefined,
                walk_in_sex: walkInMode && walkInSex ? walkInSex : undefined,
                visit_id: walkInMode ? undefined : (visitId || undefined),
                location_id: resolvedLocationId,
                cash_amount: parsedCashAmount,
                upi_amount: parsedUpiAmount,
                discount_type: parsedDiscountValue > 0 ? discountType : undefined,
                discount_value: parsedDiscountValue > 0 ? parsedDiscountValue : undefined,
                refund: refundLine ? { amount: refundLine.amount, mode: refundLine.mode } : undefined,
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
            setRefundLine(null)
            setRefundDraftAmount("")
            setRefundPendingAmount("")
            setRefundDraftMode("")
            setCashAmount("")
            setUpiAmount("")
            if (walkInMode) {
                setWalkInMode(false)
                setWalkInName("")
                setWalkInAge("")
                setWalkInSex("")
            }
            const applied = data.visit_refund_applied || 0
            const overflow = submittedRefund ? submittedRefund.amount - applied : 0
            if (applied > 0 && overflow > 0) {
                toast.success(`Bill created! Invoice #${data.invoice_id} — ₹${applied.toFixed(2)} applied to bill, ₹${overflow.toFixed(2)} paid out via ${submittedRefund!.mode === 'billing_upi' ? 'Billing UPI' : 'Cash'}`)
                loadLinkedVisit()
            } else if (applied > 0) {
                toast.success(`Bill created! Invoice #${data.invoice_id} — ₹${applied.toFixed(2)} pending refund applied`)
                loadLinkedVisit()
            } else if (overflow > 0) {
                toast.success(`Bill created! Invoice #${data.invoice_id} — ₹${overflow.toFixed(2)} refund paid out via ${submittedRefund!.mode === 'billing_upi' ? 'Billing UPI' : 'Cash'}`)
                loadLinkedVisit()
            } else {
                toast.success(`Bill created! Invoice #${data.invoice_id}`)
            }
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

    const hasInvalidQty = billItems.some(i => i.qty === '' || i.qty <= 0)

    const subtotal = calculateTotal()
    const parsedDiscountValue = parseFloat(discountValue || '0') || 0
    const discountAmount = discountType === 'percent'
        ? subtotal * Math.min(Math.max(parsedDiscountValue, 0), 100) / 100
        : Math.min(Math.max(parsedDiscountValue, 0), subtotal)
    const preRefundTotal = subtotal - discountAmount
    // Mirrors the backend: capped at the bill's own total, never negative —
    // any excess becomes a direct payout server-side instead of a bill
    // deduction (see routes/billing.py create_bill).
    const refundToApply = refundLine ? Math.min(refundLine.amount, preRefundTotal) : 0
    const finalTotal = preRefundTotal - refundToApply
    // The refund block only reveals the payout (mode + Submit) step once a
    // refund has actually been staged AND it exceeds what the bill absorbs
    // — not while just typing a draft amount, so it can't flicker mid-type.
    const refundHasPendingPayout = !!refundLine && refundLine.amount > preRefundTotal

    // Split payment — Cash + UPI must add up to finalTotal, within a small
    // rounding tolerance (mirrors the same ±₹1 check server-side).
    const parsedCashAmount = parseFloat(cashAmount || '0') || 0
    const parsedUpiAmount = parseFloat(upiAmount || '0') || 0
    const paymentRemaining = finalTotal - parsedCashAmount - parsedUpiAmount
    const paymentMatches = Math.abs(paymentRemaining) <= 1
    const fillCashFull = () => { setCashAmount(finalTotal.toFixed(2)); setUpiAmount('0') }
    const fillUpiFull = () => { setUpiAmount(finalTotal.toFixed(2)); setCashAmount('0') }

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
                            <div className="flex flex-col md:flex-row flex-wrap md:items-center justify-between gap-4 shrink-0">
                                <div className="flex items-start gap-2 flex-wrap">
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
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="shrink-0 h-10 w-10"
                                        title="Print draft invoice (no bill is created — nothing is saved)"
                                        disabled={(walkInMode ? !walkInName.trim() : !patientId) || billItems.length === 0}
                                        onClick={() => setDraftPreviewOpen(true)}
                                    >
                                        <Printer className="h-4 w-4" />
                                    </Button>
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
                                            setRefundLine(null)
                                            setRefundDraftAmount("")
                                            setRefundPendingAmount("")
                                            setRefundDraftMode("")
                                        }}
                                    >
                                        Walk-in Bill
                                    </Button>
                                </div>
                            </div>

                            {/* Items */}
                            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                                <div className="flex items-center justify-between mb-3 shrink-0 flex-wrap gap-2">
                                    <h3 className="font-semibold text-base">Items</h3>
                                </div>
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
                                        {refundLine && (
                                            <TableRow>
                                                <TableCell>{billItems.length + 1}</TableCell>
                                                <TableCell className="font-medium text-destructive">
                                                    Refund
                                                    {refundLine.amount > preRefundTotal && (
                                                        <div className="text-xs font-normal text-muted-foreground mt-0.5">
                                                            see refund block below for the pending payout
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell />
                                                <TableCell />
                                                <TableCell />
                                                <TableCell />
                                                <TableCell className="text-destructive">−{refundToApply.toFixed(2)}</TableCell>
                                                <TableCell>
                                                    <Button variant="ghost" size="sm" onClick={removeRefundLine}>
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {billItems.length === 0 && !refundLine && (
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

                            {/* Refund | Payment | Total — three columns at the bottom of the card */}
                            <div className="flex flex-col md:flex-row items-stretch justify-between gap-6 mt-4 shrink-0">
                                {/* Left: Refund (relocated from the Items header) */}
                                <div className="flex-1 min-w-[220px]">
                                    {canShowRefundBlock && (
                                        <div className="space-y-1.5">
                                            <div className="flex items-center gap-1.5 text-sm">
                                                <span className="text-muted-foreground">Refund :</span>
                                                <span className="font-medium">₹{(linkedVisit?.amount_paid ?? 0).toFixed(2)}</span>
                                            </div>

                                            {!refundHasPendingPayout ? (
                                                // Not yet added, or added but fully absorbed by the
                                                // bill — just the amount and Add to bill. Whether this
                                                // ends up needing a payout is only decided (and only
                                                // then shown, below) once it's actually added.
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <Input
                                                        type="number"
                                                        placeholder="Refund value"
                                                        className="w-28 h-8"
                                                        value={refundDraftAmount}
                                                        onChange={(e) => setRefundDraftAmount(e.target.value)}
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8"
                                                        disabled={!(parseFloat(refundDraftAmount || '0') > 0)}
                                                        onClick={addRefundToBill}
                                                    >
                                                        Add to bill
                                                    </Button>
                                                </div>
                                            ) : (
                                                // Added, and it exceeds the bill — only now does the
                                                // excess need a settlement mode. Pending amount defaults
                                                // to the excess but is a plain editable text box from
                                                // here on, same as any other amount field (not
                                                // reformatted to 2 decimals on every keystroke).
                                                <div className="space-y-1.5">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <Input
                                                            type="number"
                                                            placeholder="Pending amount"
                                                            className="w-28 h-8"
                                                            value={refundPendingAmount}
                                                            onChange={(e) => setRefundPendingAmount(e.target.value)}
                                                        />
                                                        <Select value={refundDraftMode} onValueChange={(v) => setRefundDraftMode(v as RefundMode)}>
                                                            <SelectTrigger className="w-32 h-8">
                                                                <SelectValue placeholder="Settle via..." />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="billing_upi">Billing UPI</SelectItem>
                                                                <SelectItem value="cash">Cash</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8"
                                                        disabled={!(parseFloat(refundPendingAmount || '0') > 0) || !refundDraftMode}
                                                        onClick={submitOverflowRefund}
                                                    >
                                                        Submit refund
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Center: split payment entry — Cash + UPI must add up to
                                    the total (±₹1 rounding tolerance); "Full amount" covers
                                    the single-mode case without a separate toggle. */}
                                <div className="flex-1 min-w-[240px] space-y-1.5">
                                    <span className="text-sm text-muted-foreground">Payment</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm w-9 shrink-0">Cash</span>
                                        <span className="text-sm text-muted-foreground">₹</span>
                                        <Input
                                            type="number"
                                            min={0}
                                            placeholder="0"
                                            className="w-24 h-8"
                                            value={cashAmount}
                                            onChange={(e) => setCashAmount(e.target.value)}
                                        />
                                        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={fillCashFull}>
                                            Full amount
                                        </Button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm w-9 shrink-0">UPI</span>
                                        <span className="text-sm text-muted-foreground">₹</span>
                                        <Input
                                            type="number"
                                            min={0}
                                            placeholder="0"
                                            className="w-24 h-8"
                                            value={upiAmount}
                                            onChange={(e) => setUpiAmount(e.target.value)}
                                        />
                                        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={fillUpiFull}>
                                            Full amount
                                        </Button>
                                    </div>
                                    {(parsedCashAmount > 0 || parsedUpiAmount > 0) && (
                                        <div className={cn("text-xs", paymentMatches ? "text-green-600" : "text-muted-foreground")}>
                                            {paymentMatches ? "✓ Matches total" : `Remaining: ₹${paymentRemaining.toFixed(2)}`}
                                        </div>
                                    )}
                                </div>

                                {/* Right: Discount + Total + Create Bill */}
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
                                        <div className="flex justify-between w-full text-sm text-muted-foreground">
                                            <span>Discount{discountType === "percent" ? ` (${parsedDiscountValue}%)` : ""}</span>
                                            <span>−₹{discountAmount.toFixed(2)}</span>
                                        </div>
                                    )}
                                    <span className="text-lg font-bold">
                                        Total: ₹{finalTotal.toFixed(2)}
                                    </span>
                                    <Button
                                        size="lg"
                                        disabled={submitting || (walkInMode ? !walkInName.trim() : !patientId) || billItems.length === 0 || hasInvalidQty || !resolvedLocationId || !paymentMatches}
                                        onClick={handleCreateBill}
                                    >
                                        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Create Bill
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="history" className="flex-1 overflow-hidden m-0 flex flex-col min-h-0">
                    <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
                        <CardHeader>
                            <CardTitle>Billing History</CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 flex flex-col gap-4 overflow-hidden min-h-0">
                            {/* Filter bar + pagination — fixed at the top, doesn't scroll away.
                                Filters auto-apply (loadHistory re-runs via the effect below
                                whenever a filter value changes), so there's no separate Search
                                button to click. */}
                            <div className="flex flex-wrap items-end justify-between gap-3 shrink-0">
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
                                                <SelectItem value="SPLIT">Split</SelectItem>
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
                                    {(filterDateFrom || filterDateTo || filterPaymentType || filterIsWalkIn) && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setDateRange(undefined)
                                                setFilterPaymentType('')
                                                setFilterIsWalkIn('')
                                            }}
                                        >
                                            Clear
                                        </Button>
                                    )}
                                </div>

                                <div className="flex items-center gap-3">
                                    <p className="text-sm text-muted-foreground whitespace-nowrap">{(historyPage - 1) * HISTORY_PAGE_SIZE + history.length}/{historyTotal} total</p>
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
                                        <span className="text-sm whitespace-nowrap">Page {historyPage} of {historyTotalPages}</span>
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
                            </div>

                            {/* History table — the only part that scrolls */}
                            <div className="flex-1 overflow-y-auto min-h-0">
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

            {/* Draft invoice preview — prints whatever is currently on-screen,
                no bill is created and nothing is saved. */}
            <DraftInvoicePreviewDialog
                open={draftPreviewOpen}
                onOpenChange={setDraftPreviewOpen}
                clinicName={clinicName}
                clinicAddress={clinicAddress}
                clinicPhone={clinicPhone}
                clinicLicense="TG/WLU/2025-140763"
                referenceDoctor={referenceDoctor}
                patient={walkInMode
                    ? { name: walkInName || "Walk-in", phone_number: "", age: walkInAge ? parseInt(walkInAge) : null, sex: walkInSex || null }
                    : { name: patient?.name || "", phone_number: patient?.phone_number || "", age: patient?.age ?? null, sex: patient?.sex ?? null }
                }
                billItems={billItems
                    .filter(i => i.qty !== '' && i.qty > 0)
                    .map(i => ({
                        item_name: i.item_name,
                        qty: i.qty as number,
                        mrp: i.unit === 'packs' ? i.mrp * getPackMultiplier(i.pack_size) : i.mrp,
                        manufacturer: i.manufacturer,
                        gst_rate: i.gst,
                        pack_size: i.pack_size,
                    }))
                }
                total={finalTotal}
                subtotal={subtotal}
                discountType={parsedDiscountValue > 0 ? discountType : null}
                discountValue={parsedDiscountValue > 0 ? parsedDiscountValue : null}
                visitRefundApplied={refundLine ? refundToApply : null}
                cashAmount={parsedCashAmount}
                upiAmount={parsedUpiAmount}
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
