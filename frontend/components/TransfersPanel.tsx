"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowRight, ChevronDown, ChevronRight, Loader2, Plus } from "lucide-react"
import { api, type Location, type StockTransferRecord } from "@/lib/api"
import { batchQtyLabel, packMultiplier, TRANSFER_VALUE_ENABLED } from "@/lib/utils"
import { TransferStockDialog } from "@/components/TransferStockDialog"

// "Est." while transfers don't record value (TRANSFER_VALUE_ENABLED off).
const valueLabel = TRANSFER_VALUE_ENABLED ? "" : "Est. "
const rupees = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Inventory → Transfers tab: list of stock transfer slips (newest first),
// each expandable to its items, plus the "New Transfer" entry point.
export function TransfersPanel({ onTransferred }: { onTransferred?: () => void }) {
    const [transfers, setTransfers] = useState<StockTransferRecord[]>([])
    const [locations, setLocations] = useState<Location[]>([])
    const [filterLoc, setFilterLoc] = useState<string>("all")
    const [loading, setLoading] = useState(true)
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const [dialogOpen, setDialogOpen] = useState(false)

    const load = async (loc = filterLoc) => {
        setLoading(true)
        try {
            setTransfers(await api.getTransfers(loc === "all" ? undefined : Number(loc)))
        } catch {
            setTransfers([])
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        api.getLocations().then(l => setLocations(l.filter(x => x.is_active))).catch(() => {})
        load()
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const toggle = (n: string) => setExpanded(prev => {
        const next = new Set(prev)
        if (next.has(n)) next.delete(n); else next.add(n)
        return next
    })

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <Select value={filterLoc} onValueChange={v => { setFilterLoc(v); load(v) }}>
                    <SelectTrigger className="w-56" aria-label="Filter by clinic"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All clinics</SelectItem>
                        {locations.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Button size="sm" onClick={() => setDialogOpen(true)} disabled={locations.length < 2}
                        title={locations.length < 2 ? "Needs at least two active clinics" : undefined}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> New Transfer
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : transfers.length === 0 ? (
                <p className="text-center text-muted-foreground py-12">No stock transfers yet.</p>
            ) : transfers.map(t => {
                const open = expanded.has(t.transfer_number)
                return (
                    <Card key={t.transfer_number}>
                        <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3" onClick={() => toggle(t.transfer_number)}>
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
                                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    <span className="font-mono">{t.transfer_number}</span>
                                    <span className="text-muted-foreground font-normal">
                                        {t.created_at ? new Date(t.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : ""}
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        {t.from_location_name} <ArrowRight className="h-3.5 w-3.5" /> {t.to_location_name}
                                    </span>
                                </CardTitle>
                                <span className="text-sm text-muted-foreground">
                                    {t.items.length} item{t.items.length !== 1 ? "s" : ""} · <span className="font-semibold text-foreground">{valueLabel}{rupees(t.total_value)}</span>
                                    {t.username ? ` · by ${t.username}` : ""}
                                </span>
                            </div>
                        </CardHeader>
                        {open && (
                            <CardContent className="pt-0 space-y-1">
                                {t.items.map(i => {
                                    const mult = packMultiplier(i.pack_size)
                                    return (
                                        <div key={i.product_id} className="flex items-baseline justify-between gap-3 text-sm border-b last:border-0 py-1.5">
                                            <div className="min-w-0">
                                                <p className="font-medium truncate">{i.item_name}</p>
                                                <p className="text-[11px] text-muted-foreground">
                                                    {i.batches.map(b =>
                                                        batchQtyLabel(b.quantity, b.mrp, mult) +
                                                        (b.batch_number ? ` · batch ${b.batch_number}` : "") +
                                                        (b.expiry_date ? ` · exp ${b.expiry_date.slice(5, 7)}/${b.expiry_date.slice(2, 4)}` : "")
                                                    ).join("   |   ")}
                                                </p>
                                            </div>
                                            <span className="shrink-0 tabular-nums">
                                                {Math.round(i.quantity * mult)} · {valueLabel}{rupees(i.value)}
                                            </span>
                                        </div>
                                    )
                                })}
                                {t.notes && <p className="text-xs text-muted-foreground pt-1">Note: {t.notes}</p>}
                            </CardContent>
                        )}
                    </Card>
                )
            })}

            <TransferStockDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                locations={locations}
                onDone={() => { load(); onTransferred?.() }}
            />
        </div>
    )
}
