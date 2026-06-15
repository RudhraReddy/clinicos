"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { api } from "@/lib/api"
import { useSettings } from "@/lib/settings_context"

const KNOWN_FIELD_OPTIONS = [
    'Product ID', 'Item Name', 'Pack Size', 'Formula', 'Category',
    'Manufacturer', 'MRP', 'Expiry Date', 'Quantity', 'Batch Number',
    'Purchase Rate', 'Batch GST Rate', 'Product GST Rate', 'HSN Code',
    'Min Stock', 'Generic Tags', 'Initial Quantity', 'Free Quantity',
]

interface ImportInventoryDialogProps {
    onSuccess?: () => void
    trigger?: React.ReactNode
}

type Step = 'pick' | 'mapping' | 'import' | 'done'

export function ImportInventoryDialog({ onSuccess, trigger }: ImportInventoryDialogProps) {
    const { defaultMinStock } = useSettings()
    const [open, setOpen] = useState(false)
    const [step, setStep] = useState<Step>('pick')
    const [file, setFile] = useState<File | null>(null)
    const [parsing, setParsing] = useState(false)
    const [parseResult, setParseResult] = useState<{
        unknown: string[]
    } | null>(null)
    const [rawMapping, setRawMapping] = useState<Record<string, string>>({})
    const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({})
    const [clinicMapping, setClinicMapping] = useState<Record<string, number>>({})
    const [locations, setLocations] = useState<{ id: number; name: string }[]>([])
    const [mode, setMode] = useState<'update' | 'overwrite'>('update')
    const [submitting, setSubmitting] = useState(false)
    const [result, setResult] = useState<{ message: string } | null>(null)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    const reset = () => {
        setStep('pick')
        setFile(null)
        setParseResult(null)
        setRawMapping({})
        setFieldMapping({})
        setClinicMapping({})
        setMode('update')
        setResult(null)
        setErrorMsg(null)
    }

    const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        if (!f) return
        setFile(f)
        setParsing(true)
        setErrorMsg(null)
        try {
            const [parsed, locs] = await Promise.all([
                api.parseImportHeaders(f),
                api.getLocations(),
            ])
            setLocations(locs.filter(l => l.is_active))
            if (parsed.needs_mapping) {
                setParseResult({ unknown: parsed.unknown })
                setStep('mapping')
            } else {
                setStep('import')
            }
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to parse file')
        } finally {
            setParsing(false)
        }
    }

    const handleSubmitMapping = () => {
        const missing = (parseResult?.unknown || []).filter(h => !rawMapping[h])
        if (missing.length > 0) {
            setErrorMsg(`Map all columns before continuing. Unmapped: ${missing.join(', ')}`)
            return
        }
        // Split rawMapping into fieldMapping and clinicMapping
        const fm: Record<string, string> = {}
        const cm: Record<string, number> = {}
        Object.entries(rawMapping).forEach(([header, val]) => {
            if (val === 'IGNORE') return
            if (val.startsWith('__clinic__')) {
                cm[header] = parseInt(val.replace('__clinic__', ''))
            } else {
                fm[header] = val
            }
        })
        setFieldMapping(fm)
        setClinicMapping(cm)
        setErrorMsg(null)
        setStep('import')
    }

    const handleImport = async () => {
        if (!file) return
        setSubmitting(true)
        setErrorMsg(null)
        try {
            const data = await api.importInventory(file, mode, fieldMapping, clinicMapping, defaultMinStock)
            setResult({ message: data.message || 'Imported successfully.' })
            setStep('done')
            onSuccess?.()
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : 'Import failed')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={val => { setOpen(val); if (!val) setTimeout(reset, 300) }}>
            {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
            <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-[500px] rounded-lg">

                {step === 'done' && (
                    <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
                        <div className="rounded-full bg-green-100 p-3 dark:bg-green-900/20">
                            <CheckCircle2 className="h-6 w-6 text-green-600" />
                        </div>
                        <DialogTitle>Import Complete</DialogTitle>
                        <DialogDescription>{result?.message}</DialogDescription>
                        <Button onClick={() => setOpen(false)}>Close</Button>
                    </div>
                )}

                {step === 'pick' && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Import Inventory CSV</DialogTitle>
                            <DialogDescription>
                                Upload a CSV to update or overwrite inventory stock.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            {errorMsg && (
                                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 shrink-0" />
                                    {errorMsg}
                                </div>
                            )}
                            <div className="space-y-2">
                                <Label>CSV File</Label>
                                <Input type="file" accept=".csv" onChange={handleFilePick} />
                            </div>
                            {parsing && (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Analysing headers…
                                </div>
                            )}
                        </div>
                    </>
                )}

                {step === 'mapping' && parseResult && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Map Columns</DialogTitle>
                            <DialogDescription>
                                Some columns were not recognised. Tell us what each one is.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                            {errorMsg && (
                                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 shrink-0" />
                                    {errorMsg}
                                </div>
                            )}
                            {parseResult.unknown.map(h => (
                                <div key={h} className="flex items-center gap-2">
                                    <span className="text-sm font-mono flex-1 truncate" title={h}>{h}</span>
                                    <span className="text-muted-foreground text-xs shrink-0">→</span>
                                    <Select
                                        value={rawMapping[h] || ''}
                                        onValueChange={val => setRawMapping(prev => ({ ...prev, [h]: val }))}
                                    >
                                        <SelectTrigger className="h-8 w-44 text-sm shrink-0">
                                            <SelectValue placeholder="Select…" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="IGNORE">Ignore this column</SelectItem>
                                            {KNOWN_FIELD_OPTIONS.map(o => (
                                                <SelectItem key={o} value={o}>{o}</SelectItem>
                                            ))}
                                            {locations.length > 0 && locations.map(l => (
                                                <SelectItem key={`loc-${l.id}`} value={`__clinic__${l.id}`}>
                                                    📍 {l.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ))}
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setStep('pick')}>Back</Button>
                            <Button onClick={handleSubmitMapping}>Continue</Button>
                        </DialogFooter>
                    </>
                )}

                {step === 'import' && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Import Inventory CSV</DialogTitle>
                            <DialogDescription>Choose how stock quantities are applied.</DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            {errorMsg && (
                                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 shrink-0" />
                                    {errorMsg}
                                </div>
                            )}
                            <RadioGroup value={mode} onValueChange={(v: 'update' | 'overwrite') => setMode(v)}>
                                <div className="flex items-start space-x-2">
                                    <RadioGroupItem value="update" id="update" className="mt-1" />
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="update" className="font-medium">Update (Add to Stock)</Label>
                                        <p className="text-sm text-muted-foreground">Adds quantities to existing stock. Use for restocking.</p>
                                    </div>
                                </div>
                                <div className="flex items-start space-x-2">
                                    <RadioGroupItem value="overwrite" id="overwrite" className="mt-1" />
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="overwrite" className="font-medium">Overwrite (Set Stock)</Label>
                                        <p className="text-sm text-muted-foreground">Sets stock to exactly the CSV values. Adjusts automatically.</p>
                                    </div>
                                </div>
                            </RadioGroup>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setStep(parseResult ? 'mapping' : 'pick')}>Back</Button>
                            <Button onClick={handleImport} disabled={submitting}>
                                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Import
                            </Button>
                        </DialogFooter>
                    </>
                )}

            </DialogContent>
        </Dialog>
    )
}
