"use client"

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ReviewOffsetUnit } from "@/lib/utils"

interface ReviewOffsetInputProps {
    amount: string
    unit: ReviewOffsetUnit
    onChange: (amount: string, unit: ReviewOffsetUnit) => void
    onEnter?: () => void
}

// "[ 30 ] [ Days ▾ ]" — a review date as an offset from today. The resulting
// date is computed by reviewDateFromOffset() (lib/utils): day +1, week +7,
// month +30.
export function ReviewOffsetInput({ amount, unit, onChange, onEnter }: ReviewOffsetInputProps) {
    return (
        <div className="flex items-center gap-2">
            <Input
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 3), unit)}
                onKeyDown={(e) => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter() } }}
                placeholder="30"
                aria-label="Review in how many"
                className="w-20 h-9"
            />
            <Select value={unit} onValueChange={(v) => onChange(amount, v as ReviewOffsetUnit)}>
                <SelectTrigger className="w-28 h-9" aria-label="Unit">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="days">Days</SelectItem>
                    <SelectItem value="weeks">Weeks</SelectItem>
                    <SelectItem value="months">Months</SelectItem>
                </SelectContent>
            </Select>
        </div>
    )
}
