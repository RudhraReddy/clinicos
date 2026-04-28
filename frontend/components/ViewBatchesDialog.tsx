"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Loader2, CalendarClock } from "lucide-react"
import { api, type InventoryItem, type InventoryBatch } from "@/lib/api"

interface ViewBatchesDialogProps {
    item: InventoryItem
}

export function ViewBatchesDialog({ item }: ViewBatchesDialogProps) {
    const [open, setOpen] = useState(false)
    const [batches, setBatches] = useState<InventoryBatch[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (open) {
            setLoading(true)
            api.getInventoryBatches(item.id)
                .then(setBatches)
                .catch(console.error)
                .finally(() => setLoading(false))
        }
    }, [open, item.id])

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" title="View Batches / Expiry Dates">
                    <CalendarClock className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>{item.item_name} - Batch Details</DialogTitle>
                    <DialogDescription>
                        View all active batches and expiry dates for this product.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {loading ? (
                        <div className="flex justify-center p-4">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Expiry Date</TableHead>
                                    <TableHead>Qty</TableHead>
                                    <TableHead>MRP</TableHead>
                                    <TableHead>Vendor</TableHead>
                                    <TableHead>Invoice</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {batches.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                                            No active batches found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    batches.map((batch) => (
                                        <TableRow key={batch.id}>
                                            <TableCell className="font-medium">
                                                {batch.expiry_date || 'No Expiry'}
                                            </TableCell>
                                            <TableCell>{batch.quantity}</TableCell>
                                            <TableCell>${batch.mrp.toFixed(2)}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {batch.vendor || '-'}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground font-mono">
                                                {batch.invoice_number || '-'}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
