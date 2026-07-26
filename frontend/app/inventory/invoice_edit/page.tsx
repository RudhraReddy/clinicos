"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Trash2, Plus, Save, ArrowLeft, Check, AlertCircle, Smartphone, Menu, Loader2 } from "lucide-react"
import { useMenu } from "@/components/layout/AppShell"
import { api, API_BASE_URL, InventoryItem } from "@/lib/api"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
// import { ImagePreviewDialog } from "@/components/ImagePreviewDialog" // Actually I'll let the user add it or I add it separately to be safe with line numbers
import { ImagePreviewDialog } from "@/components/ImagePreviewDialog"
import { QRCodeUpload } from "@/components/QRCodeUpload"
import { toast } from "sonner"

interface ProductRow {
    matched_id?: string
    product_name: string
    // dosage: string // Removed
    batch: string
    expiry: string
    mrp: string
    rate: string
    qty: string
    free: string // New
    // amount: string // Removed
    mfg: string
    pack: string
    company?: string // company alias for mfg? No, let's stick to mfg. Made optional to fix lint.
    hsn: string // New
    gst: string // New (was missing in interface but used in backend?)
    category: string
    formula: string
    match_type?: 'exact' | 'partial'
}

export default function InvoiceEditPage() {
    const { openMenu } = useMenu()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [viewImage, setViewImage] = useState(false)
    const [showQR, setShowQR] = useState(false)
    const [qrContextId] = useState<string>(() => crypto.randomUUID())

    // Invoice Header Data
    const [invoiceNo, setInvoiceNo] = useState("")
    const [gstNo, setGstNo] = useState("")
    const [totalAmount, setTotalAmount] = useState("")
    const [vendorName, setVendorName] = useState("")

    // Rows
    const [rows, setRows] = useState<ProductRow[]>([])

    // Inventory for matching
    const [inventory, setInventory] = useState<InventoryItem[]>([])

    const [imagePath, setImagePath] = useState("")

    useEffect(() => {
        const load = async () => {
            // 1. Load Inventory for autocomplete
            try {
                const invData = await api.getInventory()
                setInventory(invData)
            } catch (e) {
                console.error("Failed to load inventory", e)
            }

            // 2. Load Data (Session or Manual Init)
            const searchParams = new URLSearchParams(window.location.search)
            const isManual = searchParams.get('manual') === 'true'

            if (isManual) {
                // Initialize with one empty row
                setRows([{ product_name: "", batch: "", expiry: "", mrp: "", rate: "", qty: "", free: "0", mfg: "", pack: "", hsn: "", gst: "", category: "Medicine", formula: "" }])
                setLoading(false)
                return
            }

            const raw = sessionStorage.getItem("currentInvoice")
            if (raw) {
                try {
                    const data = JSON.parse(raw)
                    setInvoiceNo(data.invoice_number || "")
                    setGstNo(data.gst_number || "")
                    setTotalAmount(data.total_amount || "")
                    setVendorName(data.vendor_name || "")
                    setImagePath(data.image_path || "")

                    const products = (data.product_details || []).map((p: any) => ({
                        product_name: p.product_name || "",
                        // dosage: p.dosage || "",
                        batch: p.batch || "",
                        expiry: p.expiry || "",
                        mrp: p.mrp || "",
                        rate: p.rate || "",
                        qty: p.qty || "",
                        free: p.free || "0",
                        // amount: p.amount || "", // Removed
                        mfg: p.mfg || "",
                        pack: p.pack || "",
                        hsn: p.hsn || "",
                        gst: p.gst || "",
                        category: p.category || "Medicine",
                        formula: p.formula || ""
                    }))

                    setRows(products)
                } catch (e) {
                    console.error("Parse error", e)
                }
            }
            setLoading(false)
        }
        load()
    }, [])

    // Auto-match logic (run once after both inventory and rows are loaded? Or just when rows init)
    // Actually simplicity: passing matched_id from OCR is unlikely. We likely need to fuzzy match here.
    // For now, let's keep it manual as requested, or simple exact match init.
    // Helper to find best match
    const findBestMatch = (name: string, inventory: InventoryItem[]) => {
        if (!name || name.length < 3) return null
        const normName = name.toLowerCase()

        // 1. Exact Match
        const exact = inventory.find(i => i.item_name.toLowerCase() === normName)
        if (exact) return { item: exact, type: 'exact' as const }

        // 2. Partial Match (Containment)
        // Check if inventory item contains the row name OR row name contains inventory item
        // sorting by length diff to find "closest" string match might be better but simple includes is good start
        const partial = inventory.find(i =>
            i.item_name.toLowerCase().includes(normName) ||
            normName.includes(i.item_name.toLowerCase())
        )
        if (partial) return { item: partial, type: 'partial' as const }

        return null
    }

    // Auto-match logic
    useEffect(() => {
        if (inventory.length > 0 && rows.length > 0) {
            setRows(prev => prev.map(row => {
                // If already manually matched/selected, skip
                if (row.matched_id) return row

                const match = findBestMatch(row.product_name, inventory)

                if (match) {
                    return {
                        ...row,
                        matched_id: match.item.id,
                        match_type: match.type,
                        product_name: match.type === 'exact' ? match.item.item_name : row.product_name, // Only overwrite name if exact? or never overwrite? Text said "auto filled". Let's dont overwrite name on partial so user sees what they typed/OCR'd
                        // But we DO fill details
                        // dosage removed
                        category: match.item.category || row.category,
                        mfg: match.item.manufacturer || row.mfg,
                        pack: match.item.pack_size || row.pack,
                        hsn: match.item.hsn_code || row.hsn,
                        gst: match.item.gst_rate != null ? match.item.gst_rate.toString() : row.gst
                    }
                }
                return row
            }))
        }
    }, [inventory.length, loading]) // Run once when everything loaded

    const handleSave = async () => {
        setSaving(true)
        try {
            const payload = {
                invoice_number: invoiceNo,
                gst_number: gstNo,
                total_amount: totalAmount,
                vendor_name: vendorName,
                image_path: imagePath,
                product_details: rows
            }
            const result = await api.saveInvoice(payload)

            if (result.warnings && result.warnings.length > 0) {
                result.warnings.forEach(w => toast.warning(w))
            }

            sessionStorage.removeItem("currentInvoice")
            toast.success(result.message || "Saved successfully!")
            setTimeout(() => { window.location.href = "/inventory" }, 800)
        } catch (e) {
            toast.error("Failed to save: " + (e instanceof Error ? e.message : String(e)))
        } finally {
            setSaving(false)
        }
    }

    const updateRow = (index: number, field: keyof ProductRow, value: any) => {
        const newRows = [...rows]
        newRows[index] = { ...newRows[index], [field]: value }

        // If product name changes typing, clear matched_id unless user selects from dropdown
        if (field === 'product_name') {
            newRows[index].matched_id = undefined
            newRows[index].match_type = undefined
        }
        setRows(newRows)
    }

    const selectProduct = (index: number, item: InventoryItem) => {
        setRows(prev => {
            const newRows = [...prev]
            newRows[index] = {
                ...newRows[index],
                product_name: item.item_name,
                // dosage removed
                mfg: item.manufacturer || "",
                category: item.category || "Medicine",
                pack: item.pack_size || "",
                hsn: item.hsn_code || "",
                gst: item.gst_rate != null ? item.gst_rate.toString() : "",
                mrp: item.price != null ? item.price.toString() : newRows[index].mrp,
                matched_id: item.id,
                match_type: 'exact'
            }
            return newRows
        })

        // Rate (purchase cost) isn't on the product catalog itself — pull it
        // from the most recent batch as a starting suggestion.
        api.getInventoryBatches(item.id).then(batches => {
            if (batches.length === 0) return
            const latest = batches.reduce((a, b) => (b.id > a.id ? b : a))
            if (!latest.purchase_rate) return
            setRows(prev => {
                if (prev[index]?.matched_id !== item.id) return prev
                const newRows = [...prev]
                newRows[index] = { ...newRows[index], rate: latest.purchase_rate.toString() }
                return newRows
            })
        }).catch(e => console.error("Failed to fetch last purchase rate", e))
    }

    const addRow = () => {
        setRows([...rows, { product_name: "", batch: "", expiry: "", mrp: "", rate: "", qty: "", free: "0", mfg: "", pack: "", hsn: "", gst: "", category: "Medicine", formula: "" }])
    }

    const deleteRow = (index: number) => {
        setRows(rows.filter((_, i) => i !== index))
    }

    if (loading) return (
        <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        type="button"
                        onClick={openMenu}
                        className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors"
                    >
                        <Menu className="h-6 w-6" />
                        <span className="sr-only">Toggle Menu</span>
                    </button>
                    <Button variant="ghost" onClick={() => window.history.back()}>
                        <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                    <h1 className="text-2xl font-bold">Edit Invoice Details</h1>
                </div>
                <div className="flex gap-2">
                    {/* Replaced Dialog with ImagePreviewDialog */}
                    {imagePath && (
                        <ImagePreviewDialog
                            image={{
                                invoice_number: invoiceNo,
                                image_path: imagePath,
                                vendor_name: vendorName
                            }}
                            isOpen={viewImage}
                            onClose={() => setViewImage(false)}
                            title="Invoice Image"
                        />
                    )}

                    <Button variant={imagePath ? "secondary" : "outline"} onClick={() => {
                        if (imagePath) setViewImage(true)
                        else document.getElementById('invoice-upload')?.click()
                    }}>
                        {imagePath ? "View Attached Image" : "Attach Image"}
                    </Button>
                    <Input
                        id="invoice-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                            if (e.target.files?.[0]) {
                                try {
                                    const res = await api.uploadInventoryReport(e.target.files[0])
                                    setImagePath(res.path)
                                } catch (err) {
                                    toast.error("Upload failed")
                                }
                            }
                        }}
                    />
                    <Button variant="outline" onClick={() => setShowQR(true)}>
                        <Smartphone className="mr-2 h-4 w-4" />
                        Upload via QR
                    </Button>
                    <QRCodeUpload
                        open={showQR}
                        onOpenChange={setShowQR}
                        contextType="inventory"
                        contextId={invoiceNo || qrContextId}
                        onSuccess={() => toast.success("Image uploaded via QR — will be linked on save")}
                    />
                    {imagePath && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive ml-2" onClick={() => setImagePath("")} title="Remove Image">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    )}
                    <Button onClick={handleSave} disabled={saving}>
                        <Save className="mr-2 h-4 w-4" />
                        {saving ? "Saving..." : "Save to Inventory"}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-6 border rounded-lg bg-card">
                <div className="space-y-2">
                    <label className="text-sm font-medium">Vendor Name</label>
                    <Input value={vendorName} onChange={e => setVendorName(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">Invoice Number</label>
                    <Input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">GST Number</label>
                    <Input value={gstNo} onChange={e => setGstNo(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">Total Amount</label>
                    <Input value={totalAmount} onChange={e => setTotalAmount(e.target.value)} />
                </div>
            </div>

            <div className="border rounded-sm bg-card overflow-hidden">
                {/* Desktop View */}
                <div className="hidden md:block">
                    <Table className="border-collapse [&_td]:border [&_td]:border-border [&_td]:p-0 [&_th]:border [&_th]:border-border [&_th]:p-0">
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[200px] px-2 py-1.5">Product Name</TableHead>
                                <TableHead className="px-2 py-1.5">MFG</TableHead>
                                {/* <TableHead className="px-2 py-1.5">Dose</TableHead> */}
                                <TableHead className="px-2 py-1.5">Packs</TableHead>
                                <TableHead className="px-2 py-1.5">HSN</TableHead>
                                <TableHead className="px-2 py-1.5">Batch</TableHead>
                                <TableHead className="px-2 py-1.5">Exp</TableHead>
                                <TableHead className="px-2 py-1.5">MRP</TableHead>
                                <TableHead className="px-2 py-1.5">Rate</TableHead>
                                <TableHead className="px-2 py-1.5" title="GST %">GST</TableHead>
                                <TableHead className="px-2 py-1.5">Qty</TableHead>
                                <TableHead className="px-2 py-1.5">Free</TableHead>
                                <TableHead className="px-2 py-1.5">Formula</TableHead>
                                {/* <TableHead className="px-2 py-1.5">Amount</TableHead> */}
                                <TableHead className="w-[50px] px-2 py-1.5"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row, i) => (
                                <TableRow key={i}>
                                    <TableCell className="align-top">
                                        <div className="px-1 py-0.5">
                                            <ProductSelector
                                                value={row.product_name}
                                                inventory={inventory}
                                                onSelect={(item) => selectProduct(i, item)}
                                                onChangeValue={(val) => updateRow(i, 'product_name', val)}
                                                matchType={row.match_type}
                                            />
                                            {row.match_type === 'exact' && <span className="text-xs text-green-600 flex items-center mt-1"><Check className="w-3 h-3 mr-1" /> Matched</span>}
                                            {row.match_type === 'partial' && <span className="text-xs text-orange-500 flex items-center mt-1"><AlertCircle className="w-3 h-3 mr-1" /> Partial Match (Verify)</span>}
                                        </div>
                                    </TableCell>
                                    <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" value={row.mfg} onChange={e => updateRow(i, 'mfg', e.target.value)} /></TableCell>
                                    {/* <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" value={row.dosage} onChange={e => updateRow(i, 'dosage', e.target.value)} /></TableCell> */}
                                    <TableCell>
                                        <input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" placeholder="e.g. 1x10" value={row.pack} onChange={e => updateRow(i, 'pack', e.target.value)} />
                                    </TableCell>
                                    <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" value={row.hsn} onChange={e => updateRow(i, 'hsn', e.target.value)} /></TableCell>
                                    <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" value={row.batch} onChange={e => updateRow(i, 'batch', e.target.value)} /></TableCell>
                                    <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" value={row.expiry} onChange={e => updateRow(i, 'expiry', e.target.value)} /></TableCell>
                                    <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" value={row.mrp} onChange={e => updateRow(i, 'mrp', e.target.value)} /></TableCell>
                                    <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" value={row.rate} onChange={e => updateRow(i, 'rate', e.target.value)} /></TableCell>
                                    <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" value={row.gst} onChange={e => updateRow(i, 'gst', e.target.value)} /></TableCell>
                                    <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" value={row.qty} onChange={e => updateRow(i, 'qty', e.target.value)} /></TableCell>
                                    <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" value={row.free} onChange={e => updateRow(i, 'free', e.target.value)} /></TableCell>
                                    <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" placeholder="e.g. Tab 500mg" value={row.formula} onChange={e => updateRow(i, 'formula', e.target.value)} /></TableCell>
                                    {/* <TableCell><input className="w-full h-full min-h-[34px] px-2 py-1 text-sm bg-transparent border-0 outline-none focus:bg-blue-50 dark:focus:bg-blue-950/30" value={row.amount} onChange={e => updateRow(i, 'amount', e.target.value)} /></TableCell> */}
                                    <TableCell className="text-center">
                                        <Button variant="ghost" size="sm" onClick={() => deleteRow(i)}>
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* Mobile View */}
                <div className="block md:hidden space-y-4 p-4">
                    {rows.map((row, i) => (
                        <div key={i} className="flex flex-col gap-3 p-4 border rounded-lg bg-card shadow-sm relative">
                            <div className="absolute top-2 right-2">
                                <Button variant="ghost" size="sm" onClick={() => deleteRow(i)} className="h-8 w-8 p-0">
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>

                            <div className="space-y-1 pr-8">
                                <label className="text-xs font-semibold text-muted-foreground">Product Name</label>
                                <ProductSelector
                                    value={row.product_name}
                                    inventory={inventory}
                                    onSelect={(item) => selectProduct(i, item)}
                                    onChangeValue={(val) => updateRow(i, 'product_name', val)}
                                    matchType={row.match_type}
                                />
                                {row.match_type === 'exact' && <span className="text-xs text-green-600 flex items-center"><Check className="w-3 h-3 mr-1" /> Matched</span>}
                                {row.match_type === 'partial' && <span className="text-xs text-orange-500 flex items-center"><AlertCircle className="w-3 h-3 mr-1" /> Partial Match</span>}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">MFG</label>
                                    <Input className="h-9" value={row.mfg} onChange={e => updateRow(i, 'mfg', e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">HSN</label>
                                    <Input className="h-9" value={row.hsn} onChange={e => updateRow(i, 'hsn', e.target.value)} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">Batch</label>
                                    <Input className="h-9" value={row.batch} onChange={e => updateRow(i, 'batch', e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">Expiry</label>
                                    <Input className="h-9" value={row.expiry} onChange={e => updateRow(i, 'expiry', e.target.value)} />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">MRP</label>
                                    <Input className="h-9" value={row.mrp} onChange={e => updateRow(i, 'mrp', e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">Rate</label>
                                    <Input className="h-9" value={row.rate} onChange={e => updateRow(i, 'rate', e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">Category</label>
                                    <Input className="h-9" value={row.category} onChange={e => updateRow(i, 'category', e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">Packs</label>
                                    <Input className="h-9" placeholder="e.g. 1x10" value={row.pack} onChange={e => updateRow(i, 'pack', e.target.value)} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 p-2 bg-muted/20 rounded">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-muted-foreground">Qty</label>
                                    <Input className="h-9 bg-background" value={row.qty} onChange={e => updateRow(i, 'qty', e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">Formula</label>
                                    <Input className="h-9" placeholder="e.g. Tab 500mg" value={row.formula} onChange={e => updateRow(i, 'formula', e.target.value)} />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="p-4 border-t bg-muted/20">
                    <Button variant="outline" size="sm" onClick={addRow}>
                        <Plus className="mr-2 h-4 w-4" /> Add Row
                    </Button>
                </div>
            </div>
        </div>
    )
}

// Sub-component for Product Autocomplete
function ProductSelector({
    value,
    inventory,
    onSelect,
    onChangeValue,
    matchType
}: {
    value: string,
    inventory: InventoryItem[],
    onSelect: (item: InventoryItem) => void,
    onChangeValue: (val: string) => void,
    matchType?: 'exact' | 'partial'
}) {
    const [open, setOpen] = useState(false)

    const filtered = value.trim()
        ? inventory.filter(i => i.item_name.toLowerCase().includes(value.trim().toLowerCase()))
        : inventory

    return (
        <div className="relative">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <div className="relative">
                        <Input
                            className={cn(
                                "h-8 w-full",
                                matchType === 'exact' ? "border-green-500 ring-green-500/20" : "",
                                matchType === 'partial' ? "border-orange-500 ring-orange-500/20" : ""
                            )}
                            value={value}
                            onChange={(e) => {
                                onChangeValue(e.target.value)
                                if (!open) setOpen(true)
                            }}
                        />
                    </div>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
                    <Command shouldFilter={false}>
                        <CommandList>
                            <CommandEmpty>No item found (New Item)</CommandEmpty>
                            <CommandGroup>
                                {filtered.slice(0, 50).map((item) => (
                                    <CommandItem
                                        key={item.id}
                                        value={item.item_name}
                                        onSelect={() => {
                                            onSelect(item)
                                            setOpen(false)
                                        }}
                                    >
                                        <Check
                                            className={cn(
                                                "mr-2 h-4 w-4",
                                                value === item.item_name ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                        {item.item_name}
                                        <span className="ml-2 text-xs text-muted-foreground">({item.pack_size})</span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    )
}
