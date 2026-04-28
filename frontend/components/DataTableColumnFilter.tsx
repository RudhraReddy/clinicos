"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Filter } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

interface DataTableColumnFilterProps {
    title: string
    options: string[]
    selectedValues: Set<string>
    onChange: (values: Set<string>) => void
}

export function DataTableColumnFilter({
    title,
    options,
    selectedValues,
    onChange,
}: DataTableColumnFilterProps) {
    const [open, setOpen] = React.useState(false) // Start closed

    // Filter options to show distinct values
    const uniqueOptions = Array.from(new Set(options)).filter(Boolean).sort()

    const isFiltered = selectedValues.size > 0

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
                >
                    <span>{title}</span>
                    {isFiltered && (
                        <Badge variant="secondary" className="ml-2 rounded-sm px-1 font-normal lg:hidden">
                            {selectedValues.size}
                        </Badge>
                    )}
                    <Filter className={cn("ml-2 h-3.5 w-3.5", isFiltered ? "text-primary fill-primary/20" : "text-muted-foreground")} />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="start">
                <Command>
                    <CommandInput placeholder={`Filter ${title}...`} />
                    <CommandList>
                        <CommandEmpty>No results found.</CommandEmpty>
                        <CommandGroup>
                            {uniqueOptions.map((option) => {
                                const isSelected = selectedValues.has(option)
                                return (
                                    <CommandItem
                                        key={option}
                                        onSelect={() => {
                                            const newSet = new Set(selectedValues)
                                            if (isSelected) {
                                                newSet.delete(option)
                                            } else {
                                                newSet.add(option)
                                            }
                                            onChange(newSet)
                                        }}
                                    >
                                        <div
                                            className={cn(
                                                "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                isSelected
                                                    ? "bg-primary text-primary-foreground"
                                                    : "opacity-50 [&_svg]:invisible"
                                            )}
                                        >
                                            <Check className={cn("h-4 w-4")} />
                                        </div>
                                        <span>{option}</span>
                                    </CommandItem>
                                )
                            })}
                        </CommandGroup>
                        {isFiltered && (
                            <>
                                <CommandSeparator />
                                <CommandGroup>
                                    <CommandItem
                                        onSelect={() => onChange(new Set())}
                                        className="justify-center text-center"
                                    >
                                        Clear filters
                                    </CommandItem>
                                </CommandGroup>
                            </>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
