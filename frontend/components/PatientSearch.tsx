"use client"

import { useState, useEffect, useRef } from "react"
import { Search, X, Loader2, Check } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { api, type Patient, API_BASE_URL } from "@/lib/api"

interface PatientSearchProps {
    onSelect: (patient: Patient | null) => void
    selectedPatient?: Patient | null
}

export function PatientSearch({ onSelect, selectedPatient }: PatientSearchProps) {
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<Patient[]>([])
    const [loading, setLoading] = useState(false)
    const [open, setOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    // Handle clicks outside to close dropdown
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    // Sync input with selected patient if present
    useEffect(() => {
        if (selectedPatient) {
            setQuery(selectedPatient.name)
        } else {
            setQuery("")
        }
    }, [selectedPatient])

    // Search Effect
    useEffect(() => {
        // Only search if user is typing and no patient is currently "locked in" (selected)
        // Or if user is modifying the name?
        // Logic: if selectedPatient is set, we don't search. 
        // If user changes query, we assume they want to search again.

        if (selectedPatient && query === selectedPatient.name) return

        const timer = setTimeout(async () => {
            if (query.length < 1) {
                setResults([])
                return
            }

            setLoading(true)
            setOpen(true)
            try {
                const res = await fetch(`${API_BASE_URL}/api/patients?q=${encodeURIComponent(query)}`)
                const data = await res.json()
                setResults(data)
            } catch (e) {
                console.error(e)
            } finally {
                setLoading(false)
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [query, selectedPatient])

    const handleSelect = (patient: Patient) => {
        onSelect(patient)
        setQuery(patient.name)
        setOpen(false)
    }

    const handleClear = () => {
        onSelect(null)
        setQuery("")
        setResults([])
        setOpen(false)
    }

    return (
        <div className="relative w-full" ref={containerRef}>
            <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search patient by name or phone..."
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value)
                        if (selectedPatient) onSelect(null) // Clear selection if typing
                    }}
                    onFocus={() => {
                        if (results.length > 0) setOpen(true)
                    }}
                    className={cn(
                        "pl-9 pr-9 h-10 transition-all duration-200",
                        open ? "rounded-b-none border-b-0 ring-0 focus-visible:ring-0" : ""
                    )}
                />
                {query && (
                    <button
                        onClick={handleClear}
                        className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            {open && (
                <div className="absolute z-50 w-full bg-popover border border-t-0 rounded-b-md shadow-md max-h-[300px] overflow-y-auto animate-in fade-in-0 zoom-in-95 duration-100">
                    {loading && (
                        <div className="p-4 flex items-center justify-center text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Searching...
                        </div>
                    )}

                    {!loading && results.length === 0 && (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                            No patients found.
                        </div>
                    )}

                    {!loading && results.map((patient) => (
                        <div
                            key={patient.patient_id}
                            onClick={() => handleSelect(patient)}
                            className="flex items-center justify-between p-3 hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors border-b last:border-0"
                        >
                            <div>
                                <div className="font-medium">{patient.name}</div>
                                <div className="text-xs text-muted-foreground">
                                    {patient.phone_number}
                                </div>
                            </div>
                            {selectedPatient?.patient_id === patient.patient_id && (
                                <Check className="h-4 w-4 text-primary" />
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
