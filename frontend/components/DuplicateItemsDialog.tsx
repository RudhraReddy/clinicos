"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Copy, Loader2, Merge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { api, type DuplicateGroup } from "@/lib/api"
import { cn, packMultiplier } from "@/lib/utils"

function errorMessage(err: unknown, fallback: string) {
    let message = err instanceof Error ? err.message : fallback
    try { message = JSON.parse(message).error || message } catch { /* not JSON */ }
    return message
}

// Inventory → "Check duplicates": groups of items that look like the same
// product. Exact = same name (ignoring case/spaces/punctuation/units) and same
// pack; Possible = near spelling, same pack and strength. For each group pick
// the item to keep and merge the others into it.
export function DuplicateItemsDialog({ onMerged }: { onMerged?: () => void }) {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [groups, setGroups] = useState<DuplicateGroup[]>([])
    // Per group (keyed by its first item id when loaded): kept id + ids to merge.
    const [keep, setKeep] = useState<Record<string, string>>({})
    const [selected, setSelected] = useState<Record<string, Set<string>>>({})
    const [confirming, setConfirming] = useState<string | null>(null)
    const [merging, setMerging] = useState<string | null>(null)

    const load = async () => {
        setLoading(true)
        try {
            const res = await api.getDuplicateItems()
            setGroups(res.groups)
            const k: Record<string, string> = {}
            const sel: Record<string, Set<string>> = {}
            res.groups.forEach(g => {
                const gid = g.items[0].id
                k[gid] = g.items[0].id    // most stock / most billed first
                // Exact duplicates are pre-ticked; possible ones you tick yourself.
                sel[gid] = new Set(g.match === "exact" ? g.items.slice(1).map(i => i.id) : [])
            })
            setKeep(k)
            setSelected(sel)
        } catch (err) {
            toast.error(errorMessage(err, "Could not check for duplicates"))
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { if (open) load() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-cancel a pending "Click again to confirm" after a few seconds.
    useEffect(() => {
        if (!confirming) return
        const t = setTimeout(() => setConfirming(null), 4000)
        return () => clearTimeout(t)
    }, [confirming])

    const chooseKeep = (gid: string, id: string) => {
        setKeep(prev => ({ ...prev, [gid]: id }))
        setSelected(prev => {
            const next = new Set(prev[gid])
            next.delete(id)
            return { ...prev, [gid]: next }
        })
        setConfirming(null)
    }

    const toggle = (gid: string, id: string) => {
        setSelected(prev => {
            const next = new Set(prev[gid])
            if (next.has(id)) next.delete(id); else next.add(id)
            return { ...prev, [gid]: next }
        })
        setConfirming(null)
    }

    const merge = async (gid: string) => {
        const ids = [...(selected[gid] || [])]
        if (!keep[gid] || ids.length === 0) return
        if (confirming !== gid) { setConfirming(gid); return }
        setConfirming(null)
        setMerging(gid)
        try {
            const res = await api.mergeDuplicateItems(keep[gid], ids)
            toast.success(res.message)
            onMerged?.()
            await load()
        } catch (err) {
            toast.error(errorMessage(err, "Merge failed"))
        } finally {
            setMerging(null)
        }
    }

    const exactCount = groups.filter(g => g.match === "exact").length
    const similarCount = groups.length - exactCount

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Check duplicates
                </Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Duplicate items</DialogTitle>
                    <DialogDescription>
                        Items that look like the same product. Pick the one to <b>keep</b>, tick the ones to merge
                        into it, then Merge. Their stock, batches, history and past bills move to the kept item and
                        the merged items are removed. Printed past bills don&apos;t change.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                ) : groups.length === 0 ? (
                    <p className="text-center text-muted-foreground py-12">No duplicate items found.</p>
                ) : (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            {exactCount} exact duplicate group{exactCount !== 1 ? "s" : ""}
                            {similarCount > 0 && <> · {similarCount} possible (similar spelling) — check these carefully</>}
                        </p>
                        {groups.map(g => {
                            const gid = g.items[0].id
                            const sel = selected[gid] || new Set<string>()
                            return (
                                <div key={gid} className="border rounded-md">
                                    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/40 flex-wrap">
                                        <Badge variant={g.match === "exact" ? "default" : "secondary"}>
                                            {g.match === "exact" ? "Exact duplicate" : "Possible duplicate"}
                                        </Badge>
                                        <Button
                                            size="sm"
                                            variant={confirming === gid ? "destructive" : "default"}
                                            disabled={sel.size === 0 || merging !== null}
                                            onClick={() => merge(gid)}
                                        >
                                            {merging === gid ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Merge className="mr-1.5 h-3.5 w-3.5" />}
                                            {confirming === gid ? "Click again to confirm" : `Merge ${sel.size} into kept item`}
                                        </Button>
                                    </div>
                                    <div className="divide-y">
                                        {g.items.map(item => {
                                            const isKeep = keep[gid] === item.id
                                            const mult = packMultiplier(item.pack_size)
                                            return (
                                                <div key={item.id} className={cn("flex items-start gap-3 px-3 py-2 text-sm", isKeep && "bg-green-50 dark:bg-green-950/20")}>
                                                    <div className="flex flex-col items-center gap-1 pt-0.5 w-14 shrink-0">
                                                        <label className="flex items-center gap-1 text-xs cursor-pointer">
                                                            <input type="radio" name={`keep-${gid}`} checked={isKeep}
                                                                   onChange={() => chooseKeep(gid, item.id)} aria-label={`Keep ${item.item_name}`} />
                                                            Keep
                                                        </label>
                                                        {!isKeep && (
                                                            <label className="flex items-center gap-1 text-xs cursor-pointer">
                                                                <input type="checkbox" checked={sel.has(item.id)}
                                                                       onChange={() => toggle(gid, item.id)} aria-label={`Merge ${item.item_name}`} />
                                                                Merge
                                                            </label>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium">
                                                            {item.item_name}
                                                            <span className="text-muted-foreground font-normal"> · {item.pack_size || "no pack"}</span>
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">
                                                            ID {item.id}
                                                            {item.manufacturer ? ` · ${item.manufacturer}` : ""}
                                                            {` · ${item.batch_count} batch${item.batch_count !== 1 ? "es" : ""}`}
                                                            {` · used on ${item.bill_count} bill line${item.bill_count !== 1 ? "s" : ""}`}
                                                        </p>
                                                    </div>
                                                    <div className="text-right text-xs shrink-0">
                                                        <p className="font-medium text-sm">{Math.round(item.total_qty * mult)} in stock</p>
                                                        {item.stock_by_clinic.map(s => (
                                                            <p key={s.location} className="text-muted-foreground">{s.location}: {Math.round(s.quantity * mult)}</p>
                                                        ))}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
