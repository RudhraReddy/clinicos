"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { api, type Vendor, type VendorFields } from "@/lib/api"

export function apiErrorMessage(err: unknown, fallback: string) {
    let message = err instanceof Error ? err.message : fallback
    try { message = JSON.parse(message).error || message } catch { /* not JSON */ }
    return message
}

const EMPTY: VendorFields = { name: "", dl_number: "", gst_number: "", contact: "", notes: "" }

// Add a new vendor (no `vendor`) or edit an existing one.
export function VendorFormDialog({
    open, onOpenChange, vendor, onSaved,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    vendor?: Vendor | null
    onSaved: (v: Vendor) => void
}) {
    const [form, setForm] = useState<VendorFields>(EMPTY)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (open) {
            setForm(vendor ? {
                name: vendor.name, dl_number: vendor.dl_number, gst_number: vendor.gst_number,
                contact: vendor.contact, notes: vendor.notes,
            } : EMPTY)
        }
    }, [open, vendor])

    const set = (k: keyof VendorFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm(prev => ({ ...prev, [k]: e.target.value }))

    const save = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!form.name.trim()) return
        setSaving(true)
        try {
            const saved = vendor ? await api.updateVendor(vendor.id, form) : await api.createVendor(form)
            toast.success(vendor ? "Vendor updated" : `Added ${saved.name}`)
            onSaved(saved)
            onOpenChange(false)
        } catch (err) {
            toast.error(apiErrorMessage(err, "Could not save vendor"))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <form onSubmit={save} className="space-y-4">
                    <DialogHeader>
                        <DialogTitle>{vendor ? "Edit vendor" : "Add vendor"}</DialogTitle>
                        <DialogDescription>
                            {vendor
                                ? "Changing the name here doesn't change the vendor name printed on past invoices."
                                : "Invoices entered with this vendor name are linked to it automatically."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label htmlFor="vendor-name">Vendor name *</Label>
                        <Input id="vendor-name" value={form.name} onChange={set("name")} maxLength={100} autoFocus required />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="vendor-dl">DL number</Label>
                            <Input id="vendor-dl" value={form.dl_number} onChange={set("dl_number")} maxLength={100} />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="vendor-gst">GST number</Label>
                            <Input id="vendor-gst" value={form.gst_number} onChange={set("gst_number")} maxLength={50} />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="vendor-contact">Contact</Label>
                        <Input id="vendor-contact" value={form.contact} onChange={set("contact")} maxLength={200}
                               placeholder="Phone, person, email…" />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="vendor-notes">Notes</Label>
                        <Textarea id="vendor-notes" value={form.notes} onChange={set("notes")} rows={3} />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button type="submit" disabled={saving || !form.name.trim()}>
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {vendor ? "Save" : "Add vendor"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
