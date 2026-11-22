"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, Copy, Loader2, Menu, Merge, Pencil, Plus, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useMenu } from "@/components/layout/AppShell"
import { VendorFormDialog, apiErrorMessage } from "@/components/VendorFormDialog"
import { VendorMergeDialog } from "@/components/VendorMergeDialog"
import { useAuth } from "@/lib/auth_context"
import { api, type Vendor, type VendorDuplicateGroup, type VendorListItem } from "@/lib/api"
import { cn, formatINR } from "@/lib/utils"

const missingDetails = (v: Vendor) => !v.dl_number || !v.gst_number || !v.contact

export default function VendorsPage() {
    const router = useRouter()
    const { openMenu } = useMenu()
    const { role } = useAuth()
    const canMerge = role === "doctor" || role === "admin"

    const [vendors, setVendors] = useState<VendorListItem[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [onlyMissing, setOnlyMissing] = useState(false)
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<Vendor | null>(null)

    const [dupGroups, setDupGroups] = useState<VendorDuplicateGroup[]>([])
    const [mergeOpen, setMergeOpen] = useState(false)
    const [mergeGroups, setMergeGroups] = useState<VendorDuplicateGroup[]>([])
    const [mergeTitle, setMergeTitle] = useState("")
    const [selecting, setSelecting] = useState(false)
    const [picked, setPicked] = useState<Set<number>>(new Set())

    const load = async () => {
        try {
            const [list, dups] = await Promise.all([
                api.listVendors(),
                canMerge ? api.getVendorDuplicates() : Promise.resolve({ groups: [] }),
            ])
            setVendors(list)
            setDupGroups(dups.groups)
        } catch (err) {
            toast.error(apiErrorMessage(err, "Could not load vendors"))
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { if (role) load() }, [role]) // eslint-disable-line react-hooks/exhaustive-deps

    const missingCount = useMemo(() => vendors.filter(missingDetails).length, [vendors])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        return vendors.filter(v =>
            (!onlyMissing || missingDetails(v)) &&
            (!q || [v.name, v.gst_number, v.dl_number, v.contact, ...(v.aliases || [])].some(f => f?.toLowerCase().includes(q))))
    }, [vendors, search, onlyMissing])

    const totals = useMemo(() => ({
        total: vendors.reduce((s, v) => s + v.total_amount, 0),
        unpaid: vendors.reduce((s, v) => s + v.unpaid_amount, 0),
    }), [vendors])

    const togglePick = (id: number) => setPicked(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
    })

    const openSuggested = () => {
        setMergeGroups(dupGroups)
        setMergeTitle("Possible duplicate vendors")
        setMergeOpen(true)
    }

    const openPicked = () => {
        const chosen = vendors.filter(v => picked.has(v.id)).sort((a, b) => b.invoice_count - a.invoice_count)
        setMergeGroups([{ same_gst: false, manual: true, vendors: chosen }])
        setMergeTitle("Merge selected vendors")
        setMergeOpen(true)
    }

    const afterMerge = () => {
        setPicked(new Set())
        setSelecting(false)
        load()
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 flex-wrap">
                <button
                    type="button"
                    onClick={openMenu}
                    className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors"
                >
                    <Menu className="h-6 w-6" />
                    <span className="sr-only">Toggle Menu</span>
                </button>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Vendors</h1>
                <div className="ml-auto flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search name, GST, DL, contact"
                            className="pl-8 w-64 max-w-full"
                        />
                    </div>
                    {canMerge && (selecting ? (
                        <>
                            <Button onClick={openPicked} disabled={picked.size < 2}>
                                <Merge className="mr-1.5 h-4 w-4" /> Merge selected ({picked.size})
                            </Button>
                            <Button variant="ghost" onClick={() => { setSelecting(false); setPicked(new Set()) }}>
                                <X className="mr-1.5 h-4 w-4" /> Cancel
                            </Button>
                        </>
                    ) : (
                        <Button variant="outline" onClick={() => setSelecting(true)} disabled={vendors.length < 2}>
                            <Merge className="mr-1.5 h-4 w-4" /> Merge vendors
                        </Button>
                    ))}
                    <Button onClick={() => setAdding(true)}>
                        <Plus className="mr-1.5 h-4 w-4" /> Add vendor
                    </Button>
                </div>
            </div>

            {!loading && vendors.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="text-muted-foreground">
                        {vendors.length} vendor{vendors.length !== 1 ? "s" : ""} · Purchases {formatINR(totals.total)}
                        {totals.unpaid > 0 && <> · <span className="text-red-600 dark:text-red-400 font-medium">Unpaid {formatINR(totals.unpaid)}</span></>}
                    </span>
                    <div className="ml-auto flex items-center gap-2 flex-wrap">
                        {missingCount > 0 && (
                            <Button
                                size="sm"
                                variant={onlyMissing ? "secondary" : "outline"}
                                onClick={() => setOnlyMissing(v => !v)}
                            >
                                <AlertTriangle className="mr-1.5 h-3.5 w-3.5 text-amber-500" />
                                {onlyMissing ? "Showing" : "Show"} {missingCount} with missing details
                            </Button>
                        )}
                        {canMerge && dupGroups.length > 0 && (
                            <Button size="sm" variant="outline" onClick={openSuggested}
                                    className="border-amber-300 text-amber-700 hover:text-amber-800 dark:border-amber-800 dark:text-amber-400">
                                <Copy className="mr-1.5 h-3.5 w-3.5" />
                                {dupGroups.length} possible duplicate{dupGroups.length !== 1 ? "s" : ""}
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {selecting && (
                <p className="text-sm text-muted-foreground -mt-3">Tick the vendors that are the same supplier, then Merge selected.</p>
            )}

            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                    ) : filtered.length === 0 ? (
                        <p className="text-center text-muted-foreground py-16">
                            {vendors.length === 0 ? "No vendors yet. Add one, or save a purchase invoice with a vendor name." : "No vendors match."}
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        {selecting && <TableHead className="w-10" />}
                                        <TableHead>Vendor</TableHead>
                                        <TableHead>GST number</TableHead>
                                        <TableHead>DL number</TableHead>
                                        <TableHead>Contact</TableHead>
                                        <TableHead className="text-right">Invoices</TableHead>
                                        <TableHead className="text-right">Total purchases</TableHead>
                                        <TableHead className="text-right">Unpaid</TableHead>
                                        <TableHead className="w-10" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filtered.map(v => {
                                        const missing = <span className="text-amber-600 dark:text-amber-500 text-xs">missing</span>
                                        return (
                                            <TableRow
                                                key={v.id}
                                                className={cn("cursor-pointer", selecting && picked.has(v.id) && "bg-primary/5")}
                                                onClick={() => selecting ? togglePick(v.id) : router.push(`/vendors/${v.id}`)}
                                            >
                                                {selecting && (
                                                    <TableCell onClick={e => e.stopPropagation()}>
                                                        <input type="checkbox" checked={picked.has(v.id)} onChange={() => togglePick(v.id)}
                                                               aria-label={`Select ${v.name}`} />
                                                    </TableCell>
                                                )}
                                                <TableCell className="font-medium">
                                                    {v.name}
                                                    {v.aliases?.length > 0 && (
                                                        <p className="text-xs text-muted-foreground font-normal">also: {v.aliases.join(", ")}</p>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-muted-foreground">{v.gst_number || missing}</TableCell>
                                                <TableCell className="text-muted-foreground">{v.dl_number || missing}</TableCell>
                                                <TableCell className="text-muted-foreground max-w-[200px] truncate">{v.contact || missing}</TableCell>
                                                <TableCell className="text-right tabular-nums">{v.invoice_count}</TableCell>
                                                <TableCell className="text-right tabular-nums">{formatINR(v.total_amount)}</TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {v.unpaid_amount > 0
                                                        ? <span className="text-red-600 dark:text-red-400 font-medium">{formatINR(v.unpaid_amount)}</span>
                                                        : <span className="text-muted-foreground">—</span>}
                                                </TableCell>
                                                <TableCell onClick={e => e.stopPropagation()}>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(v)}
                                                            aria-label={`Edit ${v.name}`}>
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <VendorFormDialog
                open={adding}
                onOpenChange={setAdding}
                onSaved={v => router.push(`/vendors/${v.id}`)}
            />
            <VendorFormDialog
                open={editing !== null}
                onOpenChange={o => { if (!o) setEditing(null) }}
                vendor={editing}
                onSaved={() => load()}
            />
            <VendorMergeDialog
                open={mergeOpen}
                onOpenChange={setMergeOpen}
                groups={mergeGroups}
                title={mergeTitle}
                onMerged={afterMerge}
            />
        </div>
    )
}
