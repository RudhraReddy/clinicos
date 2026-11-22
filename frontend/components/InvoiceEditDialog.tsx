"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Loader2, Plus, Trash2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, type InventoryItem, type InvoiceEditLine } from "@/lib/api"
import { apiErrorMessage } from "@/components/VendorFormDialog"
import { cn, formatINR, normalizePackSize } from "@/lib/utils"

// A line in the editor. Existing lines carry batch_id and their item name;
// new lines carry the typed item name / pack (matched to an existing item
// when the text equals one of the suggestions).
interface Row {
    key: string
    batch_id?: number
    product_id?: string
    product_name: string
    pack_size: string
    manufacturer?: string
    used: number          // already sold/moved out (existing lines)
    removed: boolean
    qty: string
    free: string
    rate: string
    mrp: string
    gst: string
    expiry: string
    batch_number: string
}

const num = (v: string) => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : 0
}

const productLabel = (p: { item_name: string; pack_size?: string | null }) =>
    p.pack_size ? `${p.item_name} · ${p.pack_size}` : p.item_name

// Shapes from GET /inventory/invoices/<no> (only the fields used here).
export interface EditableInvoice {
    invoice_number: string
    vendor_name?: string | null
    gst_number?: string | null
    invoice_date?: string | null
    total_amount?: number | null
}

export interface EditableInvoiceItem {
    batch_id: number
    product_id: string
    product_name: string
    pack_size?: string | null
    manufacturer?: string | null
    used?: number
    quantity: number        // paid + free
    free_quantity: number
    purchase_rate?: number | null
    mrp?: number | null
    gst_rate?: number | null
    expiry_date?: string | null
    batch_number?: string | null
}

let rowSeq = 0
const blankRow = (): Row => ({
    key: `new-${++rowSeq}`, product_name: "", pack_size: "", used: 0, removed: false,
    qty: "", free: "", rate: "", mrp: "", gst: "", expiry: "", batch_number: "",
})

export function InvoiceEditDialog({
    open, onOpenChange, invoice, items, onSaved,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    invoice: EditableInvoice
    items: EditableInvoiceItem[]
    onSaved: (newInvoiceNumber: string) => void
}) {
    const [invoiceNo, setInvoiceNo] = useState("")
    const [vendor, setVendor] = useState("")
    const [gst, setGst] = useState("")
    const [invoiceDate, setInvoiceDate] = useState("")
    const [total, setTotal] = useState("")
    const [rows, setRows] = useState<Row[]>([])
    const [saving, setSaving] = useState(false)

    const [vendors, setVendors] = useState<{ vendor_name: string; gst_number: string }[]>([])
    const [products, setProducts] = useState<InventoryItem[]>([])

    useEffect(() => {
        if (!open) return
        setInvoiceNo(invoice.invoice_number || "")
        setVendor(invoice.vendor_name || "")
        setGst(invoice.gst_number || "")
        setInvoiceDate((invoice.invoice_date || "").slice(0, 10))
        setTotal(String(invoice.total_amount ?? ""))
        setRows(items.map(it => ({
            key: `b-${it.batch_id}`,
            batch_id: it.batch_id,
            product_id: it.product_id,
            product_name: it.product_name,
            pack_size: it.pack_size || "",
            manufacturer: it.manufacturer || "",
            used: Number(it.used || 0),
            removed: false,
            qty: String(Number(it.quantity || 0) - Number(it.free_quantity || 0)),
            free: String(Number(it.free_quantity || 0)),
            rate: String(it.purchase_rate ?? ""),
            mrp: String(it.mrp ?? ""),
            gst: String(it.gst_rate ?? ""),
            expiry: it.expiry_date || "",
            batch_number: it.batch_number || "",
        })))
        api.getVendors().then(setVendors).catch(() => {})
        api.getInventory().then(setProducts).catch(() => {})
    }, [open, invoice, items])

    const productByLabel = useMemo(() => {
        const m = new Map<string, InventoryItem>()
        products.forEach(p => m.set(productLabel(p).toLowerCase(), p))
        return m
    }, [products])

    const update = (key: string, patch: Partial<Row>) =>
        setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r))

    // New line item text: picking a suggestion links the existing item.
    const setNewItemName = (key: string, text: string) => {
        const match = productByLabel.get(text.trim().toLowerCase())
        update(key, match
            ? { product_name: match.item_name, pack_size: match.pack_size || "", product_id: match.id }
            : { product_name: text, product_id: undefined })
    }

    const activeRows = rows.filter(r => !r.removed)
    const linesTotal = activeRows.reduce((s, r) => s + num(r.qty) * num(r.rate) * (1 + num(r.gst) / 100), 0)

    // Problems that would be rejected by the server, shown inline.
    const rowError = (r: Row): string | null => {
        if (r.removed) return null
        if (!r.batch_id && !r.product_name.trim()) return "Item name needed"
        if (num(r.qty) + num(r.free) <= 0) return "Quantity needed"
        if (r.batch_id && num(r.qty) + num(r.free) < r.used - 0.005)
            return `${r.used} already sold/moved — can't go below ${r.used}`
        return null
    }
    const hasErrors = activeRows.length === 0 || rows.some(r => rowError(r)) || !invoiceNo.trim()

    const save = async () => {
        if (hasErrors) return
        setSaving(true)
        try {
            const lines: InvoiceEditLine[] = activeRows.map(r => ({
                ...(r.batch_id ? { batch_id: r.batch_id } : r.product_id
                    ? { product_id: r.product_id }
                    : { product_name: r.product_name.trim(), pack_size: r.pack_size }),
                qty: r.qty, free: r.free, mrp: r.mrp, rate: r.rate, gst: r.gst,
                expiry: r.expiry.trim(), batch_number: r.batch_number.trim(),
            }))
            const res = await api.editInvoice(invoice.invoice_number, {
                header: {
                    invoice_number: invoiceNo.trim(),
                    vendor_name: vendor.trim(),
                    gst_number: gst.trim(),
                    invoice_date: invoiceDate || null,
                    total_amount: total,
                },
                lines,
                deleted_batch_ids: rows.filter(r => r.removed && r.batch_id).map(r => r.batch_id!),
            })
            toast.success(res.changes.length ? `Invoice updated (${res.changes.length} change${res.changes.length !== 1 ? "s" : ""})` : "No changes")
            onSaved(res.invoice_number)
            onOpenChange(false)
        } catch (err) {
            toast.error(apiErrorMessage(err, "Could not save invoice"))
        } finally {
            setSaving(false)
        }
    }

    const cellInput = "h-8 px-2 text-sm"

    return (
        <Dialog open={open} onOpenChange={o => { if (!saving) onOpenChange(o) }}>
            <DialogContent className="w-[98vw] max-w-[98vw] xl:max-w-7xl max-h-[95vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit invoice</DialogTitle>
                    <DialogDescription>
                        Quantity changes move stock by the difference. A line can&apos;t go below what has already been
                        sold or moved from it, and only unused lines can be removed. Every stock change is recorded in the
                        item&apos;s history.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <div className="space-y-1">
                        <Label htmlFor="ie-no">Invoice no</Label>
                        <Input id="ie-no" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} maxLength={50} />
                    </div>
                    <div className="space-y-1 lg:col-span-2">
                        <Label htmlFor="ie-vendor">Vendor</Label>
                        <Input
                            id="ie-vendor"
                            list="ie-vendor-list"
                            value={vendor}
                            maxLength={100}
                            onChange={e => {
                                setVendor(e.target.value)
                                const v = vendors.find(x => x.vendor_name.toLowerCase() === e.target.value.trim().toLowerCase())
                                if (v?.gst_number && !gst) setGst(v.gst_number)
                            }}
                        />
                        <datalist id="ie-vendor-list">
                            {vendors.map(v => <option key={v.vendor_name} value={v.vendor_name} />)}
                        </datalist>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="ie-gst">GST number</Label>
                        <Input id="ie-gst" value={gst} onChange={e => setGst(e.target.value)} maxLength={50} />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="ie-date">Invoice date</Label>
                        <Input id="ie-date" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                    </div>
                </div>

                <div className="border rounded-md overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="min-w-[220px]">Item</TableHead>
                                <TableHead className="w-28">Batch</TableHead>
                                <TableHead className="w-20">Exp</TableHead>
                                <TableHead className="w-20 text-right">Qty</TableHead>
                                <TableHead className="w-20 text-right">Free</TableHead>
                                <TableHead className="w-24 text-right">Rate</TableHead>
                                <TableHead className="w-24 text-right">MRP</TableHead>
                                <TableHead className="w-16 text-right">GST%</TableHead>
                                <TableHead className="w-10" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map(r => {
                                const err = rowError(r)
                                return (
                                    <TableRow key={r.key} className={cn(r.removed && "opacity-50")}>
                                        <TableCell className="align-top">
                                            {r.batch_id ? (
                                                <div className={cn(r.removed && "line-through")}>
                                                    <p className="font-medium">{r.product_name}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {[r.pack_size, r.manufacturer].filter(Boolean).join(" · ")}
                                                        {r.used > 0 && <span className="text-amber-600 dark:text-amber-500"> · {r.used} sold/moved</span>}
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="flex gap-1.5">
                                                    <Input
                                                        list="ie-product-list"
                                                        placeholder="Item name"
                                                        value={r.product_id ? productLabel({ item_name: r.product_name, pack_size: r.pack_size }) : r.product_name}
                                                        onChange={e => setNewItemName(r.key, e.target.value)}
                                                        className={cellInput}
                                                    />
                                                    {!r.product_id && (
                                                        <Input
                                                            placeholder="Pack"
                                                            value={r.pack_size}
                                                            onChange={e => update(r.key, { pack_size: e.target.value })}
                                                            onBlur={e => update(r.key, { pack_size: normalizePackSize(e.target.value) })}
                                                            className={cn(cellInput, "w-24")}
                                                        />
                                                    )}
                                                </div>
                                            )}
                                            {err && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{err}</p>}
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <Input value={r.batch_number} disabled={r.removed} onChange={e => update(r.key, { batch_number: e.target.value })} className={cellInput} />
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <Input value={r.expiry} disabled={r.removed} placeholder="MM/YY" onChange={e => update(r.key, { expiry: e.target.value })} className={cellInput} />
                                        </TableCell>
                                        {(["qty", "free", "rate", "mrp", "gst"] as const).map(f => (
                                            <TableCell key={f} className="align-top">
                                                <Input
                                                    type="number" min={0} step="any" inputMode="decimal"
                                                    value={r[f]} disabled={r.removed}
                                                    onChange={e => update(r.key, { [f]: e.target.value })}
                                                    className={cn(cellInput, "text-right")}
                                                />
                                            </TableCell>
                                        ))}
                                        <TableCell className="align-top">
                                            {r.batch_id ? (
                                                r.removed ? (
                                                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Undo remove"
                                                            onClick={() => update(r.key, { removed: false })}>
                                                        <Undo2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                ) : (
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                            disabled={r.used > 0}
                                                            title={r.used > 0 ? "Some of this line was already sold or moved — change its quantity instead" : "Remove line"}
                                                            onClick={() => update(r.key, { removed: true })}>
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                )
                                            ) : (
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Remove line"
                                                        onClick={() => setRows(prev => prev.filter(x => x.key !== r.key))}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                    <datalist id="ie-product-list">
                        {products.map(p => <option key={p.id} value={productLabel(p)} />)}
                    </datalist>
                </div>

                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <Button variant="outline" size="sm" onClick={() => setRows(prev => [...prev, blankRow()])}>
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> Add line
                    </Button>
                    <div className="flex items-end gap-3 flex-wrap">
                        <div className="text-xs text-muted-foreground text-right">
                            Lines: qty × rate + GST = <span className="font-medium text-foreground">{formatINR(Math.round(linesTotal * 100) / 100)}</span>
                            <br />
                            <button type="button" className="underline hover:text-foreground"
                                    onClick={() => setTotal((Math.round(linesTotal * 100) / 100).toString())}>
                                use as total
                            </button>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="ie-total">Invoice total ₹</Label>
                            <Input id="ie-total" type="number" min={0} step="any" value={total}
                                   onChange={e => setTotal(e.target.value)} className="w-36 text-right" />
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
                    <Button onClick={save} disabled={saving || hasErrors}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
