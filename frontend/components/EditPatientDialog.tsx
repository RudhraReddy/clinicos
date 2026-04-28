"use client"

import { useState, useEffect } from "react"
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Loader2 } from "lucide-react"
import { api, Patient } from "@/lib/api"
import { Textarea } from "@/components/ui/textarea"

interface EditPatientDialogProps {
    patient: Patient
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess?: () => void
    trigger?: React.ReactNode
}

export function EditPatientDialog({ patient, open, onOpenChange, onSuccess, trigger }: EditPatientDialogProps) {
    const [submitting, setSubmitting] = useState(false)
    const [formData, setFormData] = useState({
        name: "",
        phone_number: "",
        age: "",
        sex: "",
        address: "",
        reference: "",
    })

    useEffect(() => {
        if (open && patient) {
            setFormData({
                name: patient.name || "",
                phone_number: patient.phone_number || "",
                age: patient.age ? patient.age.toString() : "",
                sex: patient.sex || "",
                address: patient.address || "",
                reference: patient.reference || "",
            })
        }
    }, [open, patient])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)

        try {
            await api.updatePatient(patient.patient_id, {
                name: formData.name,
                phone_number: formData.phone_number,
                age: formData.age ? parseInt(formData.age) : undefined,
                sex: formData.sex,
                address: formData.address || undefined,
                reference: formData.reference || undefined,
            })

            onOpenChange(false)
            onSuccess?.()
        } catch (err) {
            alert(`Failed to update patient: ${err instanceof Error ? err.message : "Unknown error"}`)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
            <DialogContent className="sm:max-w-[500px]">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Edit Patient</DialogTitle>
                        <DialogDescription>
                            Update patient details for {patient.name} ({patient.patient_id}).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                            <label htmlFor="edit-name" className="text-sm font-medium">
                                Full Name *
                            </label>
                            <Input
                                id="edit-name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="John Doe"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="edit-phone" className="text-sm font-medium">
                                Phone Number *
                            </label>
                            <Input
                                id="edit-phone"
                                value={formData.phone_number}
                                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                                placeholder="555-0123"
                                required
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor="edit-age" className="text-sm font-medium">
                                    Age
                                </label>
                                <Input
                                    id="edit-age"
                                    type="number"
                                    min="0"
                                    max="120"
                                    value={formData.age}
                                    onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                                    placeholder="e.g. 30"
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="edit-sex" className="text-sm font-medium">
                                    Sex
                                </label>
                                <Select
                                    value={formData.sex}
                                    onValueChange={(val) => setFormData({ ...formData, sex: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Male">Male</SelectItem>
                                        <SelectItem value="Female">Female</SelectItem>
                                        <SelectItem value="Other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="edit-address" className="text-sm font-medium">
                                Address
                            </label>
                            <Textarea
                                id="edit-address"
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                placeholder="Full address"
                                className="min-h-[60px]"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="edit-reference" className="text-sm font-medium">
                                Reference
                            </label>
                            <Input
                                id="edit-reference"
                                value={formData.reference}
                                onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                                placeholder="How did you hear about us?"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={submitting}>
                            {submitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                "Save Changes"
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
