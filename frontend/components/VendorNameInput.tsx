"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type Vendor = { vendor_name: string; gst_number: string }

interface VendorNameInputProps {
    value: string
    onChange: (value: string) => void
    // Called when a past vendor is picked from the dropdown (not on free typing).
    onSelectVendor?: (vendor: Vendor) => void
}

// Free-text vendor box with type-ahead suggestions from past invoices.
// Nothing is auto-filled while typing — a new vendor can always be entered;
// a suggestion only fills in when it's explicitly picked.
export function VendorNameInput({ value, onChange, onSelectVendor }: VendorNameInputProps) {
    const [vendors, setVendors] = useState<Vendor[]>([])
    const [open, setOpen] = useState(false)
    const [highlight, setHighlight] = useState(-1)
    const wrapperRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        api.getVendors().then(setVendors).catch(() => setVendors([]))
    }, [])

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const query = value.trim().toLowerCase()
    const suggestions = useMemo(() => {
        if (!query) return []
        return vendors
            .filter(v => v.vendor_name.toLowerCase().includes(query))
            // Names starting with the query first, then other substring hits.
            .sort((a, b) => {
                const as = a.vendor_name.toLowerCase().startsWith(query) ? 0 : 1
                const bs = b.vendor_name.toLowerCase().startsWith(query) ? 0 : 1
                return as - bs
            })
            .slice(0, 8)
    }, [vendors, query])

    // Hide the dropdown when the only suggestion is exactly what's typed.
    const exactOnly = suggestions.length === 1 && suggestions[0].vendor_name.toLowerCase() === query
    const showDropdown = open && suggestions.length > 0 && !exactOnly

    const pick = (vendor: Vendor) => {
        onChange(vendor.vendor_name)
        onSelectVendor?.(vendor)
        setOpen(false)
        setHighlight(-1)
    }

    return (
        <div className="relative" ref={wrapperRef}>
            <Input
                value={value}
                onChange={e => { onChange(e.target.value); setOpen(true); setHighlight(-1) }}
                onFocus={() => setOpen(true)}
                onKeyDown={e => {
                    if (!showDropdown) return
                    if (e.key === "ArrowDown") {
                        e.preventDefault()
                        setHighlight(h => Math.min(h + 1, suggestions.length - 1))
                    } else if (e.key === "ArrowUp") {
                        e.preventDefault()
                        setHighlight(h => Math.max(h - 1, -1))
                    } else if (e.key === "Enter" && highlight >= 0) {
                        e.preventDefault()
                        pick(suggestions[highlight])
                    } else if (e.key === "Escape") {
                        setOpen(false)
                    }
                }}
                autoComplete="off"
            />
            {showDropdown && (
                <div className="absolute z-20 top-full left-0 mt-1 w-full min-w-[14rem] bg-popover border rounded-md shadow-md max-h-56 overflow-y-auto">
                    {suggestions.map((v, i) => (
                        <button
                            key={v.vendor_name}
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => pick(v)}
                            onMouseEnter={() => setHighlight(i)}
                            className={cn(
                                "w-full flex flex-col items-start px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors",
                                highlight === i && "bg-accent"
                            )}
                        >
                            <span className="font-medium truncate w-full">{v.vendor_name}</span>
                            {v.gst_number && (
                                <span className="text-[11px] text-muted-foreground font-mono">GST: {v.gst_number}</span>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
