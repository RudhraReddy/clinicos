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
import { Loader2, Plus } from "lucide-react"
import { api, Patient, API_BASE_URL } from "@/lib/api"
import { Textarea } from "@/components/ui/textarea"

interface AddPatientDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess?: () => void
    trigger?: React.ReactNode
}

export function AddPatientDialog({ open, onOpenChange, onSuccess, trigger }: AddPatientDialogProps) {
    const [submitting, setSubmitting] = useState(false)
    const [formData, setFormData] = useState({
        name: "",
        phone_number: "",
        age: "",
        sex: "",
        address: "",
    })

    // Suggestion Logic
    const [suggestions, setSuggestions] = useState<Patient[]>([])
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [loadingSuggestions, setLoadingSuggestions] = useState(false)

    useEffect(() => {
        const searchPatients = async () => {
            if (formData.phone_number.length >= 4) {
                setLoadingSuggestions(true)
                try {
                    // We modify getPatients to accept a query to filter
                    // If the API supports it. Based on routes.py analysis, 
                    // GET /api/patients?q=... or ?phone_number=... works.
                    // Using query for broader search or phone specific? 
                    // Route has: if phone: filter(contains phone). Perfect.
                    // console.log(`Searching patients with phone: ${formData.phone_number}`)
                    const res = await fetch(`${API_BASE_URL || ''}/api/patients?phone_number=${encodeURIComponent(formData.phone_number)}`)
                    if (res.ok) {
                        const data = await res.json()
                        setSuggestions(data)
                        setShowSuggestions(true)
                    } else {
                        console.error("Suggestion fetch failed", res.status, res.statusText)
                    }
                } catch (e) {
                    console.error("Suggestion fetch error", e)
                } finally {
                    setLoadingSuggestions(false)
                }
            } else {
                setSuggestions([])
                setShowSuggestions(false)
            }
        }

        // Debounce slightly
        const timer = setTimeout(searchPatients, 300)
        return () => clearTimeout(timer)
    }, [formData.phone_number])

    const handlePreFill = (patient: Patient) => {
        // "add them as family" -> Pre-fill shared details
        setFormData(prev => ({
            ...prev,
            // Keep the phone number we matched (or the one from patient if slightly different?)
            // Usually we keep what we typed if we found partial, but here we want to associate.
            phone_number: patient.phone_number,
            address: patient.address || prev.address,
            // Clear personal details
            name: "",
            age: "",
            sex: ""
        }))
        setShowSuggestions(false)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)

        try {
            await api.createPatient({
                name: formData.name,
                phone_number: formData.phone_number,
                age: formData.age ? parseInt(formData.age) : undefined,
                sex: formData.sex,
                address: formData.address || undefined,
                dob: null // Explicitly null
            })

            // Reset form
            setFormData({
                name: "",
                phone_number: "",
                age: "",
                sex: "",
                address: "",
            })

            // Close dialog and notify success
            onOpenChange(false)
            onSuccess?.()
        } catch (err) {
            alert(`Failed to create patient: ${err instanceof Error ? err.message : "Unknown error"}`)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
            <DialogContent className="sm:max-w-[500px] overflow-visible"> {/* overflow-visible for bubble */}
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Add New Patient</DialogTitle>
                        <DialogDescription>
                            Create a new patient record.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        {/* Swapped Sequence: Phone First */}
                        <div className="space-y-2 relative">
                            <label htmlFor="phone" className="text-sm font-medium">
                                Phone Number *
                            </label>
                            <Input
                                id="phone"
                                value={formData.phone_number}
                                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                                placeholder="555-0123"
                                required
                                autoComplete="off"
                            />

                            {/* Suggestions Bubble - Left Side (Restored) */}
                            {showSuggestions && suggestions.length > 0 && (
                                <div className="absolute right-[102%] top-0 mr-2 w-64 bg-popover text-popover-foreground rounded-md border shadow-md p-2 z-50 animate-in fade-in zoom-in-95 slide-in-from-right-2 block">
                                    <div className="text-xs font-semibold text-muted-foreground mb-2 px-2">
                                        Found {suggestions.length} matches
                                    </div>
                                    <div className="max-h-[300px] overflow-auto space-y-1">
                                        {suggestions.map(p => (
                                            <div key={p.patient_id} className="flex items-center justify-start gap-2 p-2 hover:bg-accent rounded-sm group cursor-pointer" onClick={() => handlePreFill(p)}>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-primary"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handlePreFill(p)
                                                    }}
                                                    title="Add as family (Copy details)"
                                                >
                                                    <Plus className="h-4 w-4" />
                                                </Button>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-medium">{p.name}</span>
                                                    <span className="text-xs text-muted-foreground">{p.phone_number}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Status Indicator */}
                            {loadingSuggestions && <div className="text-xs text-muted-foreground mt-1">Searching...</div>}
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="name" className="text-sm font-medium">
                                Full Name *
                            </label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="John Doe"
                                required
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor="age" className="text-sm font-medium">
                                    Age
                                </label>
                                <Input
                                    id="age"
                                    type="number"
                                    min="0"
                                    max="120"
                                    value={formData.age}
                                    onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                                    placeholder="e.g. 30"
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="sex" className="text-sm font-medium">
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
                            <label htmlFor="address" className="text-sm font-medium">
                                Address
                            </label>
                            <Textarea
                                id="address"
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                placeholder="Full address"
                                className="min-h-[60px]"
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
                                "Save Patient"
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

