"use client"

import * as React from "react"
import { Filter } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

interface DataTableRangeFilterProps {
    title: string
    min: number
    max: number
    selectedRange: [number, number] | null
    onChange: (range: [number, number] | null) => void
}

export function DataTableRangeFilter({
    title,
    min,
    max,
    selectedRange,
    onChange,
}: DataTableRangeFilterProps) {
    const [open, setOpen] = React.useState(false)
    // Local state for smooth sliding before committing
    const [localRange, setLocalRange] = React.useState<[number, number]>([min, max])

    React.useEffect(() => {
        if (open) {
            setLocalRange(selectedRange || [min, max])
        }
    }, [open, selectedRange, min, max])

    const isFiltered = selectedRange !== null

    // Ensure min < max
    const safeMin = Math.floor(min)
    const safeMax = Math.ceil(max)
    const rangeSpan = safeMax - safeMin

    // If data is uniform (min == max), handle gracefully
    const isDisabled = rangeSpan <= 0

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "-ml-3 h-8 data-[state=open]:bg-accent text-xs font-semibold",
                        isFiltered && "bg-accent/50 text-accent-foreground"
                    )}
                    disabled={isDisabled}
                >
                    <span>{title}</span>
                    {isFiltered && (
                        <Badge variant="secondary" className="ml-2 rounded-sm px-1 font-normal lg:hidden">
                            Range
                        </Badge>
                    )}
                    <Filter className={cn("ml-2 h-3.5 w-3.5", isFiltered ? "text-primary fill-primary/20" : "text-muted-foreground")} />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[250px] p-4" align="start">
                <div className="space-y-4">
                    <h4 className="font-medium leading-none">{title} Range</h4>

                    <div className="flex items-center justify-between text-sm">
                        <span>{localRange[0]}</span>
                        <span>{localRange[1]}</span>
                    </div>

                    <Slider
                        min={safeMin}
                        max={safeMax}
                        step={rangeSpan > 100 ? 1 : 0.1}
                        value={localRange}
                        onValueChange={(value) => setLocalRange(value as [number, number])}
                        onValueCommit={(value) => onChange(value as [number, number])}
                        className={cn("w-full")}
                        minStepsBetweenThumbs={1}
                    />

                    {isFiltered && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full h-8"
                            onClick={() => {
                                onChange(null)
                                setOpen(false)
                            }}
                        >
                            Reset Filter
                        </Button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
