"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowRight, Loader2, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
    api, type Location, type TransferPayload, type TransferPlan, type TransferStockItem,
} from "@/lib/api"
import { batchQtyLabel, cn, packMultiplier } from "@/lib/utils"

type FromValue = string // location id as string, or "unassigned"

interface Row {
    product_id: string
    item_name: string
    pack_size?: string | null
    available: number // stored units at the source clinic
    count: string     // what staff typed, in displayed units (count)
}

interface TransferStockDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    locations: Location[]          // active clinics
    defaultFromId?: number | null  // pre-select the clinic being viewed
    onDone?: () => void
}

const rupees = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function errorMessage(err: unknown, fallback: string) {
    let message = err instanceof Error ? err.message : fallback
    try { message = JSON.parse(message).error || message } catch { /* not JSON */ }
    return message
}

// Move stock (and with it, its value) from one clinic to another. Staff pick
// From/To, add items with a count; the backend preview shows exactly which
// batches move (oldest expiry first) and the value leaving/arriving.
export function TransferStockDialog({ open, onOpenChange, locations, defaultFromId, onDone }: TransferStockDialogProps) {
    const [hasUnassigned, setHasUnassigned] = useState(false)
    const [from, setFrom] = useState<FromValue>("")
    const [to, setTo] = useState<string>("")
    const [rows, setRows] = useState<Row[]>([])
    const [notes, setNotes] = useState("")
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<TransferStockItem[]>([])
    const [searchOpen, setSearchOpen] = useState(false)
    const [plan, setPlan] = useState<TransferPlan | null>(null)
    const [planError, setPlanError] = useState<string | null>(null)
    const [planning, setPlanning] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const searchRef = useRef<HTMLDivElement>(null)

    // Reset each time the dialog opens.
    useEffect(() => {
        if (!open) return
        setFrom(defaultFromId ? String(defaultFromId) : "")
        setTo("")
        setRows([])
        setNotes("")
        setQuery("")
        setResults([])
        setPlan(null)
        setPlanError(null)
        api.hasUnassignedStock().then(r => setHasUnassigned(r.has_unassigned)).catch(() => setHasUnassigned(false))
    }, [open, defaultFromId])

    useEffect(() => {
        const close = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false)
        }
        document.addEventListener("mousedown", close)
        return () => document.removeEventListener("mousedown", close)
    }, [])

    const fromName = from === "unassigned" ? "Unassigned stock" : locations.find(l => String(l.id) === from)?.name ?? ""
    const toName = locations.find(l => String(l.id) === to)?.name ?? ""
    const fromApi: TransferPayload["from_location_id"] | null = from === "unassigned" ? "unassigned" : from ? Number(from) : null

    // Item search, scoped to stock at the source clinic.
    useEffect(() => {
        if (!fromApi || !searchOpen) return
        const t = setTimeout(() => {
            api.searchTransferStock(fromApi, query.trim())
                .then(setResults)
                .catch(() => setResults([]))
        }, 250)
        return () => clearTimeout(t)
    }, [fromApi, query, searchOpen])

    const payload: TransferPayload | null = useMemo(() => {
        if (!fromApi || !to) return null
        const items = rows
            .map(r => ({ product_id: r.product_id, quantity: Number(r.count) / packMultiplier(r.pack_size) }))
            .filter(i => i.quantity > 0)
        if (items.length === 0) return null
        return { from_location_id: fromApi, to_location_id: Number(to), items, notes: notes.trim() || undefined }
    }, [fromApi, to, rows, notes])

    // Live preview of which batches move and the value moved.
    useEffect(() => {
        if (!payload) { setPlan(null); setPlanError(null); setPlanning(false); return }
        setPlanning(true)
        const t = setTimeout(() => {
            api.previewTransfer(payload)
                .then(p => { setPlan(p); setPlanError(null) })
                .catch(err => { setPlan(null); setPlanError(errorMessage(err, "Could not preview transfer")) })
                .finally(() => setPlanning(false))
        }, 300)
        return () => clearTimeout(t)
    }, [payload])

    const changeFrom = (v: FromValue) => {
        if (v === from) return
        setFrom(v)
        setRows([]) // stock differs per clinic
        if (v === to) setTo("")
    }

    const addItem = (item: TransferStockItem) => {
        setRows(prev => prev.some(r => r.product_id === item.product_id) ? prev : [...prev, {
            product_id: item.product_id,
            item_name: item.item_name,
            pack_size: item.pack_size,
            available: item.quantity,
            count: "",
        }])
        setQuery("")
        setSearchOpen(false)
    }

    const lineFor = (pid: string) => plan?.lines.find(l => l.product_id === pid)
    const shortageFor = (pid: string) =>
        plan?.errors.find(e => typeof e !== "string" && e.product_id === pid) as
            { requested: number; available: number } | undefined

    const rowsComplete = rows.length > 0 && rows.every(r => Number(r.count) > 0)
    const canSubmit = !!plan && plan.errors.length === 0 && rowsComplete && !planning && !submitting

    const submit = async () => {
        if (!payload || !canSubmit) return
        setSubmitting(true)
        try {
            const res = await api.createTransfer(payload)
            toast.success(`Transfer ${res.transfer_number}: ${rupees(res.total_value)} moved from ${fromName} to ${toName}`)
            onOpenChange(false)
            onDone?.()
        } catch (err) {
            toast.error(errorMessage(err, "Transfer failed"))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Transfer Stock</DialogTitle>
                    <DialogDescription>
                        Move items from one clinic to another. Stock and its value leave the source clinic and are
                        added to the destination, oldest expiry first.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* From → To */}
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-end gap-2">
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">From</label>
                            <Select value={from} onValueChange={changeFrom}>
                                <SelectTrigger aria-label="From clinic"><SelectValue placeholder="Select clinic..." /></SelectTrigger>
                                <SelectContent>
                                    {locations.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                                    {hasUnassigned && <SelectItem value="unassigned">Unassigned stock (old)</SelectItem>}
                                </SelectContent>
                            </Select>
                        </div>
                        <ArrowRight className="hidden sm:block h-4 w-4 mb-2.5 text-muted-foreground" />
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">To</label>
                            <Select value={to} onValueChange={setTo}>
                                <SelectTrigger aria-label="To clinic"><SelectValue placeholder="Select clinic..." /></SelectTrigger>
                                <SelectContent>
                                    {locations.filter(l => String(l.id) !== from).map(l => (
                                        <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Item search (stock at the source clinic) */}
                    <div className="relative" ref={searchRef}>
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={query}
                            onChange={e => { setQuery(e.target.value); setSearchOpen(true) }}
                            onFocus={() => setSearchOpen(true)}
                            placeholder={from ? `Add item from ${fromName}...` : "Select the From clinic first"}
                            disabled={!from}
                            className="pl-9"
                            aria-label="Search items to transfer"
                            autoComplete="off"
                        />
                        {searchOpen && from && (
                            <div className="absolute z-30 top-full left-0 mt-1 w-full bg-popover border rounded-md shadow-md max-h-64 overflow-y-auto">
                                {results.length === 0 ? (
                                    <p className="px-3 py-2 text-sm text-muted-foreground">No items in stock at {fromName}{query ? ` matching "${query}"` : ""}.</p>
                                ) : results.map(r => {
                                    const added = rows.some(x => x.product_id === r.product_id)
                                    return (
                                        <button
                                            key={r.product_id}
                                            type="button"
                                            onClick={() => addItem(r)}
                                            disabled={added}
                                            className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-left hover:bg-accent disabled:opacity-50"
                                        >
                                            <span className="truncate">
                                                <span className="font-medium">{r.item_name}</span>
                                                {r.pack_size && <span className="text-muted-foreground"> · {r.pack_size}</span>}
                                                {r.manufacturer && <span className="text-muted-foreground"> · {r.manufacturer}</span>}
                                            </span>
                                            <span className="text-xs text-muted-foreground shrink-0">
                                                {added ? "Added" : `${Math.round(r.quantity * packMultiplier(r.pack_size))} in stock · ${rupees(r.value)}`}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Items */}
                    {rows.length > 0 && (
                        <div className="border rounded-md divide-y">
                            {rows.map(r => {
                                const mult = packMultiplier(r.pack_size)
                                const line = lineFor(r.product_id)
                                const short = shortageFor(r.product_id)
                                return (
                                    <div key={r.product_id} className="p-3 space-y-1.5">
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <div className="flex-1 min-w-[180px]">
                                                <p className="font-medium text-sm">{r.item_name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {Math.round(r.available * mult)} in stock at {fromName}{r.pack_size ? ` · ${r.pack_size}` : ""}
                                                </p>
                                            </div>
                                            <Input
                                                inputMode="numeric"
                                                value={r.count}
                                                onChange={e => {
                                                    const v = e.target.value.replace(/\D/g, "").slice(0, 6)
                                                    setRows(prev => prev.map(x => x.product_id === r.product_id ? { ...x, count: v } : x))
                                                }}
                                                placeholder="Qty"
                                                aria-label={`Quantity of ${r.item_name}`}
                                                className={cn("w-24", short && "border-destructive")}
                                            />
                                            <span className="w-28 text-right text-sm tabular-nums">
                                                {line ? rupees(line.value) : "—"}
                                            </span>
                                            <Button
                                                type="button" variant="ghost" size="icon" className="h-8 w-8"
                                                onClick={() => setRows(prev => prev.filter(x => x.product_id !== r.product_id))}
                                                aria-label={`Remove ${r.item_name}`}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        {short && (
                                            <p className="text-xs text-destructive">
                                                Only {Math.round(short.available * mult)} available at {fromName}.
                                            </p>
                                        )}
                                        {line && line.portions.length > 0 && (
                                            <p className="text-[11px] text-muted-foreground">
                                                {line.portions.map(p =>
                                                    batchQtyLabel(p.quantity, p.mrp, mult) +
                                                    (p.batch_number ? ` · batch ${p.batch_number}` : "") +
                                                    (p.expiry_date ? ` · exp ${p.expiry_date.slice(5, 7)}/${p.expiry_date.slice(2, 4)}` : "")
                                                ).join("   |   ")}
                                            </p>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    <Textarea
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        placeholder="Notes (optional) — e.g. reason for transfer"
                        rows={2}
                    />

                    {planError && <p className="text-sm text-destructive">{planError}</p>}

                    {/* Value summary */}
                    {plan && plan.lines.length > 0 && fromName && toName && (
                        <div className="rounded-md bg-muted/50 p-3 text-sm grid grid-cols-1 sm:grid-cols-2 gap-1">
                            <span>{fromName}: <span className="font-semibold text-red-600 dark:text-red-400">−{rupees(plan.total_value)}</span></span>
                            <span>{toName}: <span className="font-semibold text-green-600 dark:text-green-400">+{rupees(plan.total_value)}</span></span>
                            <span className="text-xs text-muted-foreground sm:col-span-2">Value at MRP, same as the inventory stock value.</span>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                    <Button onClick={submit} disabled={!canSubmit}>
                        {(submitting || planning) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {plan && plan.lines.length > 0 ? `Transfer ${rupees(plan.total_value)}` : "Transfer"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
