"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Users } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useAuth } from "@/lib/auth_context"

export function StaffLocationSwitcher() {
    const [open, setOpen] = React.useState(false)
    const { assignedStaff, activeStaffFilter, setActiveStaffFilter } = useAuth()

    const currentLabel = React.useMemo(() => {
        if (activeStaffFilter === 'all') return 'All Staff'
        const found = assignedStaff.find((s) => s.user_id === activeStaffFilter)
        if (!found) return 'All Staff'
        return `${found.username} — ${found.location_label || 'No location'}`
    }, [activeStaffFilter, assignedStaff])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between h-auto py-2 px-3"
                >
                    <div className="flex items-center gap-2 text-left">
                        <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-primary/10">
                            <Users className="h-4 w-4 text-primary" />
                        </div>
                        <div className="grid flex-1 text-left text-sm leading-tight">
                            <span className="truncate font-semibold">{currentLabel}</span>
                            <span className="truncate text-xs text-muted-foreground">Switch View</span>
                        </div>
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[240px] p-0" align="start" side="top" sideOffset={8}>
                <Command>
                    <CommandList>
                        <CommandEmpty>No staff found.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem
                                value="all"
                                onSelect={() => {
                                    setActiveStaffFilter('all')
                                    setOpen(false)
                                }}
                                className="cursor-pointer"
                            >
                                <Users className={cn("mr-2 h-4 w-4", activeStaffFilter === 'all' ? "opacity-100 text-primary" : "opacity-40")} />
                                <span>All Staff</span>
                                <Check
                                    className={cn("ml-auto h-4 w-4", activeStaffFilter === 'all' ? "opacity-100" : "opacity-0")}
                                />
                            </CommandItem>
                            {assignedStaff.length === 0 ? (
                                <CommandItem disabled className="cursor-default text-muted-foreground">
                                    No staff assigned
                                </CommandItem>
                            ) : (
                                assignedStaff.map((staff) => (
                                    <CommandItem
                                        key={staff.user_id}
                                        value={staff.user_id}
                                        onSelect={(value) => {
                                            setActiveStaffFilter(value)
                                            setOpen(false)
                                        }}
                                        className="cursor-pointer"
                                    >
                                        <span className="mr-2 h-4 w-4 flex items-center justify-center opacity-40 text-xs font-bold">
                                            {staff.username.charAt(0).toUpperCase()}
                                        </span>
                                        <span className="truncate">{staff.username} — {staff.location_label || 'No location'}</span>
                                        <Check
                                            className={cn("ml-auto h-4 w-4 shrink-0", activeStaffFilter === staff.user_id ? "opacity-100" : "opacity-0")}
                                        />
                                    </CommandItem>
                                ))
                            )}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
