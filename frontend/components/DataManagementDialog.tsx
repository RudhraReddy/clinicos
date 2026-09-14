"use client"

import { useEffect, useState } from "react"
import { api, DataManagementCounts } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { AlertCircle, Loader2, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

interface ScopeDef {
    key: string
    label: string
    description: string
}

const SCOPES: ScopeDef[] = [
    { key: 'stock_counts', label: 'Clear Stock Counts', description: 'Stock batches and movement history only. Product names and purchase invoices are kept.' },
    { key: 'inventory_all', label: 'Clear Entire Inventory', description: 'Everything in Stock Counts, plus the product catalog and purchase invoices. Patients/Visits/Bills are untouched.' },
    { key: 'images', label: 'Clear Images', description: 'Patient images and/or purchase invoice images -- pick a sub-option below.' },
    { key: 'patients', label: 'Clear Patients', description: 'Every patient, and their visits, bills, refunds, and images. Walk-in bills with no patient are kept.' },
    { key: 'all', label: 'Clear All (nuclear)', description: 'Everything above. Only user accounts, staff assignments, clinic locations, and the audit log survive.' },
]

const IMAGE_SCOPES: { key: string; label: string }[] = [
    { key: 'all', label: 'All images (patient images + invoice images)' },
    { key: 'prescriptions', label: 'Prescriptions only' },
    { key: 'invoices', label: 'Invoice images only' },
]

function labelize(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

interface DataManagementDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function DataManagementDialog({ open, onOpenChange }: DataManagementDialogProps) {
    const [scope, setScope] = useState<string>('stock_counts')
    const [imageScope, setImageScope] = useState<string>('all')
    const [counts, setCounts] = useState<DataManagementCounts | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const [totpCode, setTotpCode] = useState('')
    const [executing, setExecuting] = useState(false)
    const [executeError, setExecuteError] = useState<string | null>(null)

    const effectiveImageScope = scope === 'images' ? imageScope : undefined

    useEffect(() => {
        if (!open) return
        let cancelled = false
        setPreviewLoading(true)
        setPreviewError(null)
        setCounts(null)
        api.getDataManagementPreview(scope, effectiveImageScope)
            .then(res => { if (!cancelled) setCounts(res.counts) })
            .catch(err => { if (!cancelled) setPreviewError(err instanceof Error ? err.message : 'Failed to load preview') })
            .finally(() => { if (!cancelled) setPreviewLoading(false) })
        return () => { cancelled = true }
    }, [open, scope, effectiveImageScope])

    useEffect(() => {
        if (!open) {
            setTotpCode('')
            setExecuteError(null)
            setScope('stock_counts')
            setImageScope('all')
        }
    }, [open])

    const handleExecute = async () => {
        if (totpCode.length !== 6) return
        setExecuting(true)
        setExecuteError(null)
        try {
            // Pre-wipe backup export -- unconditional on every scope (even
            // Clear Images / Clear Stock Counts), not scope-conditional.
            // Both are pre-existing endpoints/client functions (already used
            // by the Inventory/Patients pages' own Download buttons) --
            // window.location.href navigations to a Content-Disposition:
            // attachment response, so these trigger a save without actually
            // navigating away. Images are deliberately not included; neither
            // endpoint has ever contained anything but tabular CSV data.
            // Note: 300ms delay is needed between these calls — when two
            // location.href assignments fire back-to-back, the second aborts
            // the first's in-flight request before download completes. We
            // await this delay to guarantee both export requests are
            // dispatched before the destructive execute call fires, so the
            // pre-wipe backup captures real data, not already-wiped state.
            api.exportInventory()
            await new Promise(resolve => setTimeout(resolve, 300))
            api.exportPatients()
            const res = await api.executeDataManagement(scope, totpCode, effectiveImageScope)
            toast.success(res.message)
            onOpenChange(false)
        } catch (err: unknown) {
            setExecuteError(err instanceof Error ? err.message : 'Failed to execute wipe')
            setTotpCode('')
        } finally {
            setExecuting(false)
        }
    }

    const selectedScope = SCOPES.find(s => s.key === scope)!
    const totalRows = counts ? Object.values(counts).reduce((sum, v) => sum + (v ?? 0), 0) : null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-rose-600">
                        <ShieldAlert className="h-5 w-5" />
                        Data Management
                    </DialogTitle>
                    <DialogDescription>
                        These actions permanently delete data. None can be undone.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-2 space-y-4">
                    <RadioGroup value={scope} onValueChange={setScope} className="space-y-2">
                        {SCOPES.map(s => (
                            <label
                                key={s.key}
                                htmlFor={`scope-${s.key}`}
                                className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-accent/50"
                            >
                                <RadioGroupItem value={s.key} id={`scope-${s.key}`} className="mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium">{s.label}</p>
                                    <p className="text-xs text-muted-foreground">{s.description}</p>
                                </div>
                            </label>
                        ))}
                    </RadioGroup>

                    {scope === 'images' && (
                        <RadioGroup value={imageScope} onValueChange={setImageScope} className="space-y-1 pl-4">
                            {IMAGE_SCOPES.map(s => (
                                <label key={s.key} htmlFor={`imgscope-${s.key}`} className="flex items-center gap-2 cursor-pointer text-sm">
                                    <RadioGroupItem value={s.key} id={`imgscope-${s.key}`} />
                                    {s.label}
                                </label>
                            ))}
                        </RadioGroup>
                    )}

                    <div className="rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-700 dark:text-rose-400 space-y-1">
                        <p className="font-semibold">This will permanently delete:</p>
                        {previewLoading ? (
                            <p className="text-xs flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Loading counts…</p>
                        ) : previewError ? (
                            <p className="text-xs">Failed to load counts: {previewError}</p>
                        ) : counts && totalRows === 0 ? (
                            <p className="text-xs">Nothing to delete -- {selectedScope.label.toLowerCase()} is already empty.</p>
                        ) : counts ? (
                            <ul className="list-disc list-inside space-y-0.5 text-xs">
                                {Object.entries(counts).map(([k, v]) => (
                                    <li key={k}>{v} {labelize(k)}</li>
                                ))}
                            </ul>
                        ) : null}
                    </div>

                    {executeError && (
                        <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            {executeError}
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label className="text-sm font-medium">Enter your 6-digit admin auth code to confirm</Label>
                        <Input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="000000"
                            value={totpCode}
                            onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            onKeyDown={e => { if (e.key === 'Enter' && totpCode.length === 6) handleExecute() }}
                            className="text-center text-2xl tracking-widest font-mono h-12"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button
                        variant="destructive"
                        onClick={handleExecute}
                        disabled={totpCode.length !== 6 || executing || previewLoading || counts === null || totalRows === 0}
                    >
                        {executing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Execute
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
