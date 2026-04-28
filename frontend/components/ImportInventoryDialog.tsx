"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Loader2, Upload, AlertCircle, CheckCircle2 } from "lucide-react"
import { api } from "@/lib/api"

interface ImportInventoryDialogProps {
    onSuccess?: () => void
    trigger?: React.ReactNode
}

export function ImportInventoryDialog({ onSuccess, trigger }: ImportInventoryDialogProps) {
    const [open, setOpen] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [mode, setMode] = useState<"update" | "overwrite">("update")
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!file) return

        setSubmitting(true)
        setResult(null)
        try {
            const formData = new FormData()
            formData.append("file", file)
            formData.append("mode", mode)

            // We need to extend API for this, roughly checking
            // But since api.ts is strictly typed, let's assume we add it. 
            // For now using fetch if api not ready, but better update api.ts first. Awaiting task order.
            // I'll assume api.importInventory exists or I'll implement it next step.
            await api.importInventory(file, mode)

            setResult({ success: true, message: "Inventory processed successfully." })
            onSuccess?.()
        } catch (err) {
            setResult({
                success: false,
                message: err instanceof Error ? err.message : "Failed to import"
            })
        } finally {
            setSubmitting(false)
        }
    }

    const reset = () => {
        setResult(null)
        setFile(null)
        setMode("update")
    }

    return (
        <Dialog open={open} onOpenChange={(val) => {
            setOpen(val)
            if (!val) setTimeout(reset, 300)
        }}>
            {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
            <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-[425px] rounded-lg">
                {result?.success ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
                        <div className="rounded-full bg-green-100 p-3 dark:bg-green-900/20">
                            <CheckCircle2 className="h-6 w-6 text-green-600" />
                        </div>
                        <DialogTitle>Import Complete</DialogTitle>
                        <DialogDescription>{result.message}</DialogDescription>
                        <Button onClick={() => setOpen(false)}>Close</Button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>Import Inventory CSV</DialogTitle>
                            <DialogDescription>
                                Upload a CSV file to update or overwrite your inventory stock.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="grid gap-6 py-4">
                            {result && !result.success && (
                                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4" />
                                    {result.message}
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="file">CSV File</Label>
                                <Input
                                    id="file"
                                    type="file"
                                    accept=".csv"
                                    onChange={(e) => {
                                        const f = e.target.files?.[0]
                                        if (f) setFile(f)
                                    }}
                                    required
                                />
                            </div>

                            <div className="space-y-3">
                                <Label>Import Mode</Label>
                                <RadioGroup value={mode} onValueChange={(v: any) => setMode(v)}>
                                    <div className="flex items-start space-x-2">
                                        <RadioGroupItem value="update" id="update" className="mt-1" />
                                        <div className="grid gap-1.5">
                                            <Label htmlFor="update" className="font-medium">
                                                Update (Add to Stock)
                                            </Label>
                                            <p className="text-sm text-muted-foreground">
                                                Adds quantities from the CSV to your existing stock. Use for restocking.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-start space-x-2">
                                        <RadioGroupItem value="overwrite" id="overwrite" className="mt-1" />
                                        <div className="grid gap-1.5">
                                            <Label htmlFor="overwrite" className="font-medium">
                                                Overwrite (Set Stock)
                                            </Label>
                                            <p className="text-sm text-muted-foreground">
                                                Sets stock to exactly what is in the CSV. Calculates adjustments automatically.
                                            </p>
                                        </div>
                                    </div>
                                </RadioGroup>
                            </div>
                        </div>

                        <DialogFooter>
                            <Button type="submit" disabled={submitting || !file}>
                                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Import
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    )
}
