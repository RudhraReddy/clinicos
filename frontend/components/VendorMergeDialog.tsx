"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Merge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { api, type VendorDuplicateGroup } from "@/lib/api"
import { apiErrorMessage } from "@/components/VendorFormDialog"
import { cn } from "@/lib/utils"

// Merge vendors that are the same supplier. Shows either the suggested
// duplicate groups (`groups` from GET /vendors/duplicates) or one group the
// user picked by hand on the list. For each group: pick the vendor to keep,
// tick the ones to merge into it.
export function VendorMergeDialog({
    open, onOpenChange, groups, title, onMerged,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    groups: VendorDuplicateGroup[]
    title: string
    onMerged: () => void
}) {
    const [keep, setKeep] = useState<Record<number, number>>({})
    const [selected, setSelected] = useState<Record<number, Set<number>>>({})
    const [confirming, setConfirming] = useState<number | null>(null)
    const [merging, setMerging] = useState<number | null>(null)
    const [done, setDone] = useState<Set<number>>(new Set())

    // Groups are keyed by their first vendor's id.
    useEffect(() => {
        if (!open) return
        const k: Record<number, number> = {}
        const sel: Record<number, Set<number>> = {}
        groups.forEach(g => {
            const gid = g.vendors[0].id
            k[gid] = g.vendors[0].id // most invoices first
            // Same GST number = same business, and a hand-picked group is already
            // the user's choice, so pre-tick those; similar names you tick yourself.
            sel[gid] = new Set(g.same_gst || g.manual ? g.vendors.slice(1).map(v => v.id) : [])
        })
        setKeep(k)
        setSelected(sel)
        setDone(new Set())
        setConfirming(null)
    }, [open, groups])

    useEffect(() => {
        if (confirming === null) return
        const t = setTimeout(() => setConfirming(null), 4000)
        return () => clearTimeout(t)
    }, [confirming])

    const chooseKeep = (gid: number, id: number) => {
        setKeep(prev => ({ ...prev, [gid]: id }))
        setSelected(prev => {
            const next = new Set(prev[gid])
            next.delete(id)
            return { ...prev, [gid]: next }
        })
        setConfirming(null)
    }

    const toggle = (gid: number, id: number) => {
        setSelected(prev => {
            const next = new Set(prev[gid])
            if (next.has(id)) next.delete(id); else next.add(id)
            return { ...prev, [gid]: next }
        })
        setConfirming(null)
    }

    const merge = async (gid: number) => {
        const ids = [...(selected[gid] || [])]
        if (!keep[gid] || ids.length === 0) return
        if (confirming !== gid) { setConfirming(gid); return }
        setConfirming(null)
        setMerging(gid)
        try {
            const res = await api.mergeVendors(keep[gid], ids)
            toast.success(res.message)
            setDone(prev => new Set(prev).add(gid))
            onMerged()
        } catch (err) {
            toast.error(apiErrorMessage(err, "Merge failed"))
        } finally {
            setMerging(null)
        }
    }

    const remaining = groups.filter(g => !done.has(g.vendors[0].id))

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        Pick the vendor to <b>keep</b> and tick the ones to merge into it. Their invoices move to the
                        kept vendor, missing details (DL, GST, contact) are filled in from them and notes are combined.
                        Their names are remembered, so invoices typed with those spellings link to the kept vendor.
                    </DialogDescription>
                </DialogHeader>

                {remaining.length === 0 ? (
                    <p className="text-center text-muted-foreground py-10">
                        {groups.length === 0 ? "No duplicate vendors found." : "All merged."}
                    </p>
                ) : (
                    <div className="space-y-4">
                        {remaining.map(g => {
                            const gid = g.vendors[0].id
                            const sel = selected[gid] || new Set<number>()
                            return (
                                <div key={gid} className="border rounded-md">
                                    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/40 flex-wrap">
                                        <Badge variant={g.same_gst || g.manual ? "default" : "secondary"}>
                                            {g.manual ? "Selected by you" : g.same_gst ? "Same GST number" : "Similar name"}
                                        </Badge>
                                        <Button
                                            size="sm"
                                            variant={confirming === gid ? "destructive" : "default"}
                                            disabled={sel.size === 0 || merging !== null}
                                            onClick={() => merge(gid)}
                                        >
                                            {merging === gid ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Merge className="mr-1.5 h-3.5 w-3.5" />}
                                            {confirming === gid ? "Click again to confirm" : `Merge ${sel.size} into kept vendor`}
                                        </Button>
                                    </div>
                                    <div className="divide-y">
                                        {g.vendors.map(v => {
                                            const isKeep = keep[gid] === v.id
                                            return (
                                                <div key={v.id} className={cn("flex items-start gap-3 px-3 py-2 text-sm", isKeep && "bg-green-50 dark:bg-green-950/20")}>
                                                    <div className="flex flex-col items-start gap-1 pt-0.5 w-16 shrink-0">
                                                        <label className="flex items-center gap-1 text-xs cursor-pointer">
                                                            <input type="radio" name={`keep-${gid}`} checked={isKeep}
                                                                   onChange={() => chooseKeep(gid, v.id)} aria-label={`Keep ${v.name}`} />
                                                            Keep
                                                        </label>
                                                        {!isKeep && (
                                                            <label className="flex items-center gap-1 text-xs cursor-pointer">
                                                                <input type="checkbox" checked={sel.has(v.id)}
                                                                       onChange={() => toggle(gid, v.id)} aria-label={`Merge ${v.name}`} />
                                                                Merge
                                                            </label>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium break-words">{v.name}</p>
                                                        <p className="text-xs text-muted-foreground break-words">
                                                            {[
                                                                v.gst_number && `GST ${v.gst_number}`,
                                                                v.dl_number && `DL ${v.dl_number}`,
                                                                v.contact,
                                                            ].filter(Boolean).join(" · ") || "No details"}
                                                        </p>
                                                    </div>
                                                    <div className="text-right text-xs text-muted-foreground shrink-0">
                                                        {v.invoice_count} invoice{v.invoice_count !== 1 ? "s" : ""}
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
