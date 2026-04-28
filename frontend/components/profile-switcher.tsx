"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Monitor, Stethoscope, Shield } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useAuth, UserRole } from "@/lib/auth_context"
import { useRouter } from "next/navigation"

const roles: { value: UserRole; label: string; icon: React.ElementType }[] = [
    {
        value: "frontdesk",
        label: "Front Desk",
        icon: Monitor,
    },
    {
        value: "doctor",
        label: "Doctor",
        icon: Stethoscope,
    },
    {
        value: "admin",
        label: "Admin",
        icon: Shield,
    },
]

export function ProfileSwitcher() {
    const [open, setOpen] = React.useState(false)
    const { role, setRole } = useAuth()
    const router = useRouter()

    const currentRole = roles.find((r) => r.value === role) || roles[0]

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
                            <currentRole.icon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="grid flex-1 text-left text-sm leading-tight">
                            <span className="truncate font-semibold">{currentRole.label}</span>
                            <span className="truncate text-xs text-muted-foreground">Switch Profile</span>
                        </div>
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0" align="start">
                <Command>
                    {/* <CommandInput placeholder="Search profile..." /> */}
                    <CommandList>
                        <CommandEmpty>No profile found.</CommandEmpty>
                        <CommandGroup>
                            {roles.map((framework) => (
                                <CommandItem
                                    key={framework.value}
                                    value={framework.value}
                                    onSelect={(currentValue) => {
                                        const newRole = currentValue as UserRole
                                        setRole(newRole)
                                        setOpen(false)

                                        // Redirect to default dashboard for the role
                                        if (newRole === 'doctor') {
                                            router.push('/doctor')
                                        } else {
                                            router.push('/')
                                        }
                                    }}
                                    className="cursor-pointer"
                                >
                                    <framework.icon
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            role === framework.value ? "opacity-100 text-primary" : "opacity-40"
                                        )}
                                    />
                                    <span>{framework.label}</span>
                                    <Check
                                        className={cn(
                                            "ml-auto h-4 w-4",
                                            role === framework.value ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
