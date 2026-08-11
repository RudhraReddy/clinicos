"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { api, InventoryItem, InventoryBatch } from "@/lib/api"
import { toast } from "sonner"
import { useSettings } from "@/lib/settings_context"
import { Pencil, Loader2, Save, Trash2, AlertCircle } from "lucide-react"

interface EditInventoryDialogProps {
    item: InventoryItem
    onSuccess: () => void
}

export function EditInventoryDialog({ item, onSuccess }: EditInventoryDialogProps) {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [batches, setBatches] = useState<InventoryBatch[]>([])
    const [loadingBatches, setLoadingBatches] = useState(false)

    useEffect(() => {
        if (open) {
            setLoadingBatches(true)
            api.getInventoryBatches(item.id)
                .then(setBatches)
                .catch(console.error)
                .finally(() => setLoadingBatches(false))
        }
    }, [open, item.id])

    // Batch Update Handlers
    const updateBatch = async (batchId: number, field: string, value: any) => {
        // Optimistic UI update
        setBatches(prev => prev.map(b => b.id === batchId ? { ...b, [field]: value } : b))
    }

    const saveBatch = async (batchId: number) => {
        const batch = batches.find(b => b.id === batchId)
        if (!batch) return
        try {
            await api.updateInventoryBatch(batchId, {
                expiry_date: batch.expiry_date || undefined,
                quantity: batch.quantity,
                mrp: batch.mrp
            })
            toast.success("Batch updated")
            onSuccess() // Refresh parent
        } catch (e) {
            console.error(e)
            toast.error("Failed to save batch")
        }
    }

    const { defaultMinStock } = useSettings()

    const [isCustomMinStock, setIsCustomMinStock] = useState<boolean>(
        item.min_stock_override ?? true
    )

    const [formData, setFormData] = useState({
        item_name: item.item_name,
        manufacturer: item.manufacturer || '',
        category: item.category,
        min_stock_level: item.min_stock_level,
        hsn_code: item.hsn_code || '',
        gst_rate: item.gst_rate || 5,
        vendors: (item.vendors || []).join(', '),
        pack_size: item.pack_size || '',
        formula: item.formula || '',
        rack_location: item.rack_location || ''
    })

    useEffect(() => {
        if (open && item) {
            setFormData({
                item_name: item.item_name,
                manufacturer: item.manufacturer || '',
                category: item.category,
                min_stock_level: item.min_stock_level,
                hsn_code: item.hsn_code || '',
                gst_rate: item.gst_rate || 5,
                vendors: (item.vendors || []).join(', '),
                pack_size: item.pack_size || '',
                formula: item.formula || '',
                rack_location: item.rack_location || ''
            })
            setIsCustomMinStock(item.min_stock_override ?? true)
        }
    }, [open, item])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        try {
            const payload = {
                ...formData,
                vendors: formData.vendors.split(',').map(v => v.trim()).filter(Boolean),
                min_stock_override: isCustomMinStock,
            }
            await api.updateInventoryItem(item.id, payload)
            setOpen(false)
            onSuccess()
        } catch (error) {
            console.error(error)
            toast.error("Failed to update item")
        } finally {
            setLoading(false)
        }
    }

    // ... Return JSX
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm">
                    <Pencil className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Edit Item</DialogTitle>
                        <DialogDescription>
                            Update master details for {item.item_name}.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="h-[400px] overflow-y-auto px-1">
                        <div className="text-sm font-semibold mb-2 text-muted-foreground border-b pb-1">Master Details</div>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="name" className="text-right">Name</Label>
                                <Input
                                    id="name"
                                    value={formData.item_name}
                                    onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                                    className="col-span-3"
                                />
                            </div>

                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="category" className="text-right">Category</Label>
                                <Input
                                    id="category"
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                    className="col-span-3"
                                />
                            </div>
                            {/* Unit removed */}
                            {/* <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="unit" className="text-right">Unit</Label>
                                <Input
                                    id="unit"
                                    value={formData.unit}
                                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                                    className="col-span-3"
                                />
                            </div> */}
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="hsn" className="text-right">HSN Code</Label>
                                <Input
                                    id="hsn"
                                    value={formData.hsn_code}
                                    onChange={(e) => setFormData({ ...formData, hsn_code: e.target.value })}
                                    className="col-span-3"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="gst" className="text-right">GST Rate (%)</Label>
                                <Input
                                    id="gst"
                                    type="number"
                                    value={formData.gst_rate}
                                    onChange={(e) => setFormData({ ...formData, gst_rate: parseFloat(e.target.value) || 0 })}
                                    className="col-span-3"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="manufacturer" className="text-right">MFG</Label>
                                <Input
                                    id="manufacturer"
                                    value={formData.manufacturer}
                                    onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                                    className="col-span-3"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="vendors" className="text-right">Vendors</Label>
                                <Input
                                    id="vendors"
                                    placeholder="Comma separated (e.g. Vendor A, Vendor B)"
                                    value={formData.vendors}
                                    onChange={(e) => setFormData({ ...formData, vendors: e.target.value })}
                                    className="col-span-3"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-start gap-4">
                                <Label htmlFor="min_stock" className="text-right pt-2">Min Stock</Label>
                                <div className="col-span-3 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Input
                                            id="min_stock"
                                            type="number"
                                            value={formData.min_stock_level}
                                            onChange={(e) => {
                                                setFormData({ ...formData, min_stock_level: parseInt(e.target.value) || 0 })
                                                setIsCustomMinStock(true)
                                            }}
                                            className="w-24"
                                        />
                                        {!isCustomMinStock && (
                                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">(default)</span>
                                        )}
                                        {isCustomMinStock && (
                                            <button
                                                type="button"
                                                className="text-xs text-primary underline underline-offset-2"
                                                onClick={() => {
                                                    setFormData({ ...formData, min_stock_level: defaultMinStock })
                                                    setIsCustomMinStock(false)
                                                }}
                                            >
                                                ↺ Use default
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="pack_size" className="text-right">Pack Size</Label>
                                <Input
                                    id="pack_size"
                                    value={formData.pack_size}
                                    onChange={(e) => setFormData({ ...formData, pack_size: e.target.value })}
                                    className="col-span-3"
                                    placeholder="e.g. 1x10, 100ml"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="formula" className="text-right">Formula</Label>
                                <Input
                                    id="formula"
                                    value={formData.formula}
                                    onChange={(e) => setFormData({ ...formData, formula: e.target.value })}
                                    className="col-span-3"
                                    placeholder="Active chemical formula"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="rack_location" className="text-right">Rack Location</Label>
                                <Input
                                    id="rack_location"
                                    value={formData.rack_location}
                                    onChange={(e) => setFormData({ ...formData, rack_location: e.target.value })}
                                    className="col-span-3"
                                    placeholder="e.g. C2, H1"
                                />
                            </div>
                        </div>

                        <div className="mt-6">
                            <div className="text-sm font-semibold mb-2 text-muted-foreground border-b pb-1 flex justify-between items-center">
                                <span>Stock Batches (Expiry/Qty)</span>
                                {loadingBatches && <Loader2 className="h-3 w-3 animate-spin" />}
                            </div>
                            <div className="space-y-3">
                                {batches.length === 0 && !loadingBatches && <div className="text-sm text-center py-2 text-muted-foreground">No active stock batches found.</div>}
                                {batches.map(batch => (
                                    <div key={batch.id} className="grid grid-cols-12 gap-2 items-center p-2 border rounded bg-muted/20">
                                        <div className="col-span-4 space-y-1">
                                            <label className="text-[10px] uppercase text-muted-foreground font-bold">Expiry</label>
                                            <Input
                                                type="text"
                                                placeholder="MM/YY"
                                                className="h-7 text-xs"
                                                value={(() => {
                                                    // Convert YYYY-MM-DD or MM/YY to MM/YY for display
                                                    const val = batch.expiry_date || ''
                                                    if (val.match(/^\d{4}-\d{2}-\d{2}$/)) {
                                                        const parts = val.split('-')
                                                        return `${parts[1]}/${parts[0].slice(2)}`
                                                    }
                                                    return val
                                                })()}
                                                onChange={(e) => {
                                                    let val = e.target.value.replace(/\D/g, '') // remove non-digits
                                                    if (val.length > 4) val = val.slice(0, 4)

                                                    if (val.length >= 2) {
                                                        val = val.slice(0, 2) + '/' + val.slice(2)
                                                    }

                                                    updateBatch(batch.id, 'expiry_date', val)
                                                }}
                                                maxLength={5}
                                            />
                                        </div>
                                        <div className="col-span-3 space-y-1">
                                            <label className="text-[10px] uppercase text-muted-foreground font-bold">Qty</label>
                                            <Input
                                                type="number"
                                                className="h-7 text-xs"
                                                value={(() => {
                                                    const pack = item.pack_size?.toLowerCase() || ''
                                                    if (pack.includes('s') || pack.includes('x')) {
                                                        const match = pack.match(/(\d+)/)
                                                        if (match) {
                                                            const num = parseInt(match[0])
                                                            if (!isNaN(num) && num > 1) {
                                                                return Math.round(batch.quantity * num)
                                                            }
                                                        }
                                                    }
                                                    return batch.quantity
                                                })()}
                                                onChange={(e) => {
                                                    const inputVal = parseFloat(e.target.value) || 0
                                                    const pack = item.pack_size?.toLowerCase() || ''
                                                    let divisor = 1
                                                    if (pack.includes('s') || pack.includes('x')) {
                                                        const match = pack.match(/(\d+)/)
                                                        if (match) {
                                                            const num = parseInt(match[0])
                                                            if (!isNaN(num) && num > 1) {
                                                                divisor = num
                                                            }
                                                        }
                                                    }
                                                    updateBatch(batch.id, 'quantity', inputVal / divisor)
                                                }}
                                            />
                                        </div>
                                        <div className="col-span-3 space-y-1">
                                            <label className="text-[10px] uppercase text-muted-foreground font-bold">MRP</label>
                                            <Input
                                                type="number"
                                                className="h-7 text-xs"
                                                value={batch.mrp}
                                                onChange={(e) => updateBatch(batch.id, 'mrp', parseFloat(e.target.value) || 0)}
                                            />
                                        </div>
                                        <div className="col-span-2 flex items-end justify-center pb-0.5">
                                            <Button type="button" size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => saveBatch(batch.id)} title="Save Batch">
                                                <Save className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="submit" disabled={loading}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Master Details
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
