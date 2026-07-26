"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, UserPlus, AlertCircle, Users, Check } from "lucide-react"
import { api, type Patient, type Visit } from "@/lib/api"
import { getTodayIST, cn } from "@/lib/utils"
import { toast } from "sonner"

type FormState = 'idle' | 'searching' | 'found' | 'not_found' | 'new_patient'

interface WalkInFormProps {
    onSuccess: () => void
}

function getCurrentTimeStr() {
    const now = new Date()
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
}

function VisitFee({ visit }: { visit: Visit }) {
    const fee = visit.visiting_fee ?? 0
    const paid = visit.amount_paid ?? 0

    if (visit.payment_status === 'full') {
        return <span className="font-semibold tabular-nums">₹{fee}</span>
    }
    if (visit.payment_status === 'partial') {
        return <span className="font-semibold tabular-nums">₹{paid}/₹{fee}</span>
    }
    return <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">₹{fee}</span>
}

const emptyVisit = () => ({
    reason: '',
    visit_date: getTodayIST(),
    visit_time: getCurrentTimeStr(),
    visiting_fee: '',
    payment_status: 'unpaid',
})

export function WalkInForm({ onSuccess }: WalkInFormProps) {
    const [phone, setPhone] = useState('')
    const [formState, setFormState] = useState<FormState>('idle')
    const [matchedPatient, setMatchedPatient] = useState<Patient | null>(null)
    const [matches, setMatches] = useState<Patient[]>([])
    const [pickerOpen, setPickerOpen] = useState(false)
    const phoneFieldRef = useRef<HTMLDivElement>(null)
    const [referencePatientId, setReferencePatientId] = useState<string | null>(null)
    const [name, setName] = useState('')
    const [age, setAge] = useState('')
    const [sex, setSex] = useState('')
    const [address, setAddress] = useState('')
    const [visit, setVisit] = useState(emptyVisit())
    const [submitting, setSubmitting] = useState(false)
    const [patientVisits, setPatientVisits] = useState<Visit[]>([])

    const selectPatient = (patient: Patient) => {
        setMatchedPatient(patient)
        setName(patient.name)
        setAge(patient.age?.toString() ?? '')
        setSex(patient.sex ?? '')
        api.getVisits(patient.patient_id)
            .then(vs => setPatientVisits(vs.filter(v => v.status !== 'deleted')))
            .catch(() => setPatientVisits([]))
    }

    const handleSelectMatch = (patientId: string) => {
        const patient = matches.find(m => m.patient_id === patientId)
        if (patient) selectPatient(patient)
        setPickerOpen(false)
    }

    // Close the match picker on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (phoneFieldRef.current && !phoneFieldRef.current.contains(event.target as Node)) {
                setPickerOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    useEffect(() => {
        if (phone.length < 4) {
            if (formState !== 'idle') {
                setFormState('idle')
                setMatchedPatient(null)
                setMatches([])
                setPickerOpen(false)
                setName('')
                setAge('')
                setSex('')
                setPatientVisits([])
            }
            return
        }

        setFormState('searching')
        const timer = setTimeout(async () => {
            try {
                const data = await api.getPatientsByPhone(phone)
                if (data.length > 0) {
                    setMatches(data)
                    setFormState('found')
                    setPickerOpen(data.length > 1)
                    selectPatient(data[0])
                } else {
                    setMatchedPatient(null)
                    setMatches([])
                    setPickerOpen(false)
                    setFormState('not_found')
                    setName('')
                    setAge('')
                    setSex('')
                    setPatientVisits([])
                }
            } catch {
                setMatchedPatient(null)
                setMatches([])
                setPickerOpen(false)
                setFormState('not_found')
                setPatientVisits([])
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [phone]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleCreateNewPatient = () => {
        setReferencePatientId(matchedPatient?.patient_id ?? null)
        setName('')
        setAge('')
        setSex('')
        setAddress('')
        setFormState('new_patient')
    }

    const resetForm = () => {
        setPhone('')
        setFormState('idle')
        setMatchedPatient(null)
        setMatches([])
        setPickerOpen(false)
        setReferencePatientId(null)
        setName('')
        setAge('')
        setSex('')
        setAddress('')
        setVisit(emptyVisit())
        setPatientVisits([])
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (formState === 'idle' || formState === 'searching') return
        setSubmitting(true)

        try {
            let patientId: string

            if (formState === 'found' && matchedPatient) {
                patientId = matchedPatient.patient_id
            } else {
                const created = await api.createPatient({
                    name,
                    phone_number: phone,
                    age: age ? parseInt(age) : undefined,
                    sex: sex || undefined,
                    address: address || undefined,
                    reference_patient_id: referencePatientId || undefined,
                    dob: null,
                }) as { patient_id: string }
                patientId = created.patient_id
            }

            await api.createVisit({
                patient_id: patientId,
                visit_date: visit.visit_date,
                visit_time: visit.visit_time || undefined,
                status: 'in_progress',
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

    const patientLocked = formState === 'found'
    const patientBlank = formState === 'idle' || formState === 'searching'
    const isNewPatientMode = formState === 'not_found' || formState === 'new_patient'
    const canSubmit = !submitting && (
        formState === 'found' ||
        ((formState === 'not_found' || formState === 'new_patient') && name.trim() !== '')
    )

    return (
        <Card className="flex flex-col h-full overflow-hidden">
            <CardHeader className="pb-2 pt-4 px-5 shrink-0">
                <CardTitle className="text-base">Walk-in / Book Appointment</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden px-5 pb-4 flex flex-col">
                <form onSubmit={handleSubmit} className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden">

                    {/* LEFT: Past Visits */}
                    <div className="md:w-2/5 shrink-0 flex flex-col border rounded-md overflow-hidden">
                        <div className="px-3 py-1.5 bg-muted/40 border-b flex items-center justify-between shrink-0">
                            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Past Visits</span>
                            {formState === 'found' && patientVisits.length > 0 && (
                                <span className="text-[11px] text-muted-foreground">{patientVisits.length}</span>
                            )}
                        </div>
                        <div className="flex-1 overflow-y-auto min-h-0">
                            {formState !== 'found' ? (
                                <p className="text-xs text-muted-foreground text-center py-6 px-3">
                                    Search a phone number to view past visits
                                </p>
                            ) : patientVisits.length === 0 ? (
                                <p className="text-xs text-muted-foreground text-center py-6">No past visits</p>
                            ) : (
                                <div className="divide-y divide-border/50">
                                    {patientVisits.map(v => (
                                        <div key={v.visit_id} className="flex items-start justify-between px-3 py-2 text-xs gap-2">
                                            <div className="min-w-0">
                                                <p className="text-muted-foreground font-mono">{v.visit_date}</p>
                                                <p className="truncate text-foreground/80">{v.reason || '—'}</p>
                                            </div>
                                            <div className="flex flex-col items-end gap-1 shrink-0">
                                                <VisitFee visit={v} />
                                                <span className={cn(
                                                    "px-1.5 py-0.5 rounded text-[10px] font-medium",
                                                    v.status === 'done' ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                                        : v.status === 'cancelled' ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                                            : "bg-secondary text-muted-foreground"
                                                )}>{v.status}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT: Patient + Appointment details */}
                    <div className="flex-1 flex flex-col gap-3 overflow-y-auto min-h-0">

                    {/* Phone */}
                    <div>
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phone</label>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs font-medium ${formState !== 'not_found' ? 'invisible' : ''}`}>
                                <AlertCircle className="h-3 w-3 shrink-0" />
                                Patient not found
                            </span>
                        </div>
                        <div className="relative mt-1" ref={phoneFieldRef}>
                            <Input
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                onFocus={() => { if (matches.length > 1) setPickerOpen(true) }}
                                placeholder="Search by phone number..."
                                className="pr-8"
                                autoComplete="off"
                                readOnly={formState === 'new_patient'}
                            />
                            {formState === 'searching' && (
                                <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            {formState === 'found' && (
                                <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-background" />
                            )}

                            {pickerOpen && matches.length > 1 && formState === 'found' && (
                                <div className="absolute z-20 top-full left-0 mt-1 w-full bg-popover border rounded-md shadow-md max-h-56 overflow-y-auto">
                                    <div className="px-3 py-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 border-b flex items-center gap-1.5">
                                        <Users className="h-3 w-3 shrink-0" />
                                        {matches.length} patients share this number
                                    </div>
                                    {matches.map(m => (
                                        <button
                                            key={m.patient_id}
                                            type="button"
                                            onClick={() => handleSelectMatch(m.patient_id)}
                                            className={cn(
                                                "w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-accent transition-colors",
                                                matchedPatient?.patient_id === m.patient_id && "bg-accent/60"
                                            )}
                                        >
                                            <span className="truncate">
                                                <span className="font-medium">{m.name}</span>
                                                <span className="text-muted-foreground"> · {m.age ?? '—'}y · {m.sex ?? '—'}</span>
                                            </span>
                                            {matchedPatient?.patient_id === m.patient_id && (
                                                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Patient fields — always visible */}
                    <div className="grid grid-cols-[1fr_72px_96px] gap-2">
                        <div>
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Name{isNewPatientMode && <span className="text-destructive ml-0.5">*</span>}
                            </label>
                            <Input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Patient name"
                                readOnly={patientLocked}
                                disabled={patientBlank}
                                className={`mt-1 ${patientLocked ? 'bg-muted/60' : ''}`}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Age</label>
                            <Input
                                type="number"
                                min="0"
                                max="120"
                                value={age}
                                onChange={e => setAge(e.target.value)}
                                placeholder="—"
                                readOnly={patientLocked}
                                disabled={patientBlank}
                                className={`mt-1 ${patientLocked ? 'bg-muted/60' : ''}`}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sex</label>
                            {patientLocked || patientBlank ? (
                                <Input
                                    value={sex}
                                    readOnly
                                    disabled={patientBlank}
                                    placeholder="—"
                                    className={`mt-1 ${patientLocked ? 'bg-muted/60' : ''}`}
                                />
                            ) : (
                                <Select value={sex} onValueChange={setSex}>
                                    <SelectTrigger className="mt-1">
                                        <SelectValue placeholder="—" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Male">Male</SelectItem>
                                        <SelectItem value="Female">Female</SelectItem>
                                        <SelectItem value="Other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    </div>

                    {/* Address — always visible */}
                    <Input
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                        placeholder="Address (optional)"
                        readOnly={patientLocked}
                        disabled={patientBlank}
                        className={patientLocked ? 'bg-muted/60' : ''}
                    />

                    {/* Action row for found state */}
                    {formState === 'found' && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCreateNewPatient}
                        >
                            <UserPlus className="mr-2 h-3.5 w-3.5" />
                            Create New Patient with this number
                        </Button>
                    )}
                    {formState === 'new_patient' && (
                        <p className="text-xs text-blue-600 dark:text-blue-400">
                            ↳ Referred by {matchedPatient?.name}
                        </p>
                    )}

                    {/* Appointment */}
                    <div className="border-t pt-2.5">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Appointment</label>
                        <div className="flex flex-col gap-2 mt-2">
                            <Input
                                value={visit.reason}
                                onChange={e => setVisit(v => ({ ...v, reason: e.target.value }))}
                                placeholder="Reason for visit (optional)"
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <Input
                                    type="date"
                                    value={visit.visit_date}
                                    onChange={e => setVisit(v => ({ ...v, visit_date: e.target.value }))}
                                    required
                                />
                                <Input
                                    type="time"
                                    value={visit.visit_time}
                                    onChange={e => setVisit(v => ({ ...v, visit_time: e.target.value }))}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <Input
                                    type="number"
                                    min="0"
                                    value={visit.visiting_fee}
                                    onChange={e => setVisit(v => ({ ...v, visiting_fee: e.target.value }))}
                                    placeholder="Fee (₹)"
                                />
                                <Select
                                    value={visit.payment_status}
                                    onValueChange={val => setVisit(v => ({ ...v, payment_status: val }))}
                                >
                                    <SelectTrigger>
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
                    </div>

                    <Button type="submit" className="w-full" disabled={!canSubmit}>
                        {submitting ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                        ) : formState === 'found' ? (
                            'Book Appointment'
                        ) : (
                            'Create Patient & Book'
                        )}
                    </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    )
}
