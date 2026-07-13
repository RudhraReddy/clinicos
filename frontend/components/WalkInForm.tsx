"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, UserPlus, CheckCircle2, XCircle } from "lucide-react"
import { api, type Patient } from "@/lib/api"
import { getTodayIST } from "@/lib/utils"
import { toast } from "sonner"

type FormState = 'idle' | 'searching' | 'found' | 'not_found' | 'new_patient'

interface WalkInFormProps {
    onSuccess: () => void
}

function getCurrentTimeStr() {
    const now = new Date()
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
}

const emptyVisit = () => ({
    reason: '',
    visit_date: getTodayIST(),
    visit_time: getCurrentTimeStr(),
    visiting_fee: '',
    payment_status: 'unpaid',
})

const emptyNewPatient = () => ({
    name: '',
    age: '',
    sex: '',
    address: '',
})

export function WalkInForm({ onSuccess }: WalkInFormProps) {
    const [phone, setPhone] = useState('')
    const [formState, setFormState] = useState<FormState>('idle')
    const [matchedPatient, setMatchedPatient] = useState<Patient | null>(null)
    const [matchCount, setMatchCount] = useState(0)
    const [referencePatientId, setReferencePatientId] = useState<string | null>(null)
    const [newPatient, setNewPatient] = useState(emptyNewPatient())
    const [visit, setVisit] = useState(emptyVisit())
    const [submitting, setSubmitting] = useState(false)

    // Phone search — debounced 300ms, fires when ≥ 4 digits
    useEffect(() => {
        if (phone.length < 4) {
            setFormState('idle')
            setMatchedPatient(null)
            setMatchCount(0)
            return
        }

        setFormState('searching')
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/patients?phone_number=${encodeURIComponent(phone)}`)
                if (!res.ok) throw new Error('Search failed')
                const data: Patient[] = await res.json()
                if (data.length > 0) {
                    setMatchedPatient(data[0])
                    setMatchCount(data.length)
                    setFormState('found')
                } else {
                    setMatchedPatient(null)
                    setMatchCount(0)
                    setFormState('not_found')
                }
            } catch {
                setMatchedPatient(null)
                setFormState('not_found')
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [phone])

    const handleCreateNewPatient = () => {
        setReferencePatientId(matchedPatient?.patient_id ?? null)
        setNewPatient(emptyNewPatient())
        setFormState('new_patient')
    }

    const resetForm = () => {
        setPhone('')
        setFormState('idle')
        setMatchedPatient(null)
        setMatchCount(0)
        setReferencePatientId(null)
        setNewPatient(emptyNewPatient())
        setVisit(emptyVisit())
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)

        try {
            let patientId: string

            if (formState === 'found' && matchedPatient) {
                patientId = matchedPatient.patient_id
            } else {
                // not_found or new_patient — create patient first
                const created = await api.createPatient({
                    name: newPatient.name,
                    phone_number: phone,
                    age: newPatient.age ? parseInt(newPatient.age) : undefined,
                    sex: newPatient.sex || undefined,
                    address: newPatient.address || undefined,
                    reference_patient_id: referencePatientId || undefined,
                    dob: null,
                }) as { patient_id: string }
                patientId = created.patient_id
            }

            await api.createVisit({
                patient_id: patientId,
                visit_date: visit.visit_date,
                visit_time: visit.visit_time || undefined,
                status: 'scheduled',
                reason: visit.reason || undefined,
                visiting_fee: visit.visiting_fee ? parseFloat(visit.visiting_fee) : 0,
                amount_paid: 0,
                payment_status: visit.payment_status,
            })

            toast.success(
                formState === 'found'
                    ? `Appointment booked for ${matchedPatient!.name}`
                    : 'Patient created and appointment booked'
            )
            resetForm()
            onSuccess()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save')
        } finally {
            setSubmitting(false)
        }
    }

    const showVisitFields = formState !== 'idle'

    return (
        <Card className="flex flex-col h-full overflow-hidden">
            <CardHeader className="pb-3 pt-5 px-5 shrink-0">
                <CardTitle className="text-lg">Walk-in / Book Appointment</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto px-5 pb-5">
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Phone input */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Phone Number</label>
                        <div className="relative">
                            <Input
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                placeholder="Enter phone number to search..."
                                className="pr-8"
                                autoComplete="off"
                                readOnly={formState === 'new_patient'}
                            />
                            {formState === 'searching' && (
                                <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                        </div>
                    </div>

                    {/* Found state — patient card */}
                    {formState === 'found' && matchedPatient && (
                        <div className="space-y-2">
                            <div className="flex items-start gap-2 p-3 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
                                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm leading-none">{matchedPatient.name}</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {[matchedPatient.age ? `${matchedPatient.age}y` : null, matchedPatient.sex].filter(Boolean).join(' · ')}
                                    </p>
                                    {matchCount > 1 && (
                                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                            {matchCount} patients share this number
                                        </p>
                                    )}
                                </div>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={handleCreateNewPatient}
                            >
                                <UserPlus className="mr-2 h-3.5 w-3.5" />
                                Create New Patient with this number
                            </Button>
                        </div>
                    )}

                    {/* Not found — new patient fields */}
                    {formState === 'not_found' && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 p-2 rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30">
                                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                                <p className="text-xs text-red-700 dark:text-red-400 font-medium">Patient not found — enter details to register</p>
                            </div>
                            {renderNewPatientFields()}
                        </div>
                    )}

                    {/* New patient mode */}
                    {formState === 'new_patient' && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 p-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
                                <UserPlus className="h-4 w-4 text-blue-500 shrink-0" />
                                <p className="text-xs text-blue-700 dark:text-blue-400 font-medium">
                                    New patient — referred by {matchedPatient?.name}
                                </p>
                            </div>
                            {renderNewPatientFields()}
                        </div>
                    )}

                    {/* Visit fields */}
                    {showVisitFields && (
                        <div className="space-y-3 pt-2 border-t">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Appointment Details</p>
                            <div>
                                <label className="text-sm font-medium">Reason</label>
                                <Input
                                    value={visit.reason}
                                    onChange={e => setVisit(v => ({ ...v, reason: e.target.value }))}
                                    placeholder="Reason for visit (optional)"
                                    className="mt-1"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-sm font-medium">Date</label>
                                    <Input
                                        type="date"
                                        value={visit.visit_date}
                                        onChange={e => setVisit(v => ({ ...v, visit_date: e.target.value }))}
                                        className="mt-1"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Time</label>
                                    <Input
                                        type="time"
                                        value={visit.visit_time}
                                        onChange={e => setVisit(v => ({ ...v, visit_time: e.target.value }))}
                                        className="mt-1"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-sm font-medium">Fee (&#8377;)</label>
                                    <Input
                                        type="number"
                                        min="0"
                                        value={visit.visiting_fee}
                                        onChange={e => setVisit(v => ({ ...v, visiting_fee: e.target.value }))}
                                        placeholder="0"
                                        className="mt-1"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Payment</label>
                                    <Select
                                        value={visit.payment_status}
                                        onValueChange={val => setVisit(v => ({ ...v, payment_status: val }))}
                                    >
                                        <SelectTrigger className="mt-1">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="unpaid">Unpaid</SelectItem>
                                            <SelectItem value="partial">Partial</SelectItem>
                                            <SelectItem value="full">Paid</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <Button type="submit" className="w-full" disabled={submitting}>
                                {submitting ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                                ) : formState === 'found' ? (
                                    'Book Appointment'
                                ) : (
                                    'Create Patient & Book'
                                )}
                            </Button>
                        </div>
                    )}

                    {/* Idle placeholder */}
                    {formState === 'idle' && (
                        <p className="text-sm text-muted-foreground text-center py-6">
                            Enter the patient&apos;s phone number above to begin
                        </p>
                    )}
                </form>
            </CardContent>
        </Card>
    )

    function renderNewPatientFields() {
        return (
            <>
                <div>
                    <label className="text-sm font-medium">Full Name <span className="text-destructive">*</span></label>
                    <Input
                        value={newPatient.name}
                        onChange={e => setNewPatient(p => ({ ...p, name: e.target.value }))}
                        placeholder="Patient name"
                        required
                        className="mt-1"
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-sm font-medium">Age</label>
                        <Input
                            type="number"
                            min="0"
                            max="120"
                            value={newPatient.age}
                            onChange={e => setNewPatient(p => ({ ...p, age: e.target.value }))}
                            placeholder="e.g. 30"
                            className="mt-1"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium">Sex</label>
                        <Select
                            value={newPatient.sex}
                            onValueChange={val => setNewPatient(p => ({ ...p, sex: val }))}
                        >
                            <SelectTrigger className="mt-1">
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
                <div>
                    <label className="text-sm font-medium">Address</label>
                    <Input
                        value={newPatient.address}
                        onChange={e => setNewPatient(p => ({ ...p, address: e.target.value }))}
                        placeholder="Address (optional)"
                        className="mt-1"
                    />
                </div>
            </>
        )
    }
}
