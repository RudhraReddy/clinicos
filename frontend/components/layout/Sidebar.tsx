"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Users, Package, CreditCard, Stethoscope, Image as ImageIcon, BarChart2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuth } from "@/lib/auth_context"
import { ProfileSwitcher } from "@/components/profile-switcher"
import { GlobalSettingsDialog } from "@/components/GlobalSettingsDialog"

const staffNavItems = [
    { title: "Dashboard", href: "/", icon: LayoutDashboard },
    { title: "Patients", href: "/patients", icon: Users },
    { title: "Inventory", href: "/inventory", icon: Package },
    { title: "Billing", href: "/billing", icon: CreditCard },
]

const doctorNavItems = [
    { title: "Dashboard", href: "/doctor", icon: LayoutDashboard },
    { title: "Patients", href: "/patients", icon: Users },
    { title: "Inventory", href: "/inventory", icon: Package },
    { title: "Gallery", href: "/gallery", icon: ImageIcon },
    { title: "Status", href: "/status", icon: BarChart2 },
]

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> { }

export function Sidebar({ className }: SidebarProps) {
    const pathname = usePathname()
    const { role } = useAuth()

    const filteredNavItems = role === 'doctor' ? doctorNavItems : staffNavItems

    return (
        <div className={cn("pb-0 min-h-screen border-r bg-white dark:bg-[#181818] flex flex-col justify-between", className)}>
            <div className="space-y-4 py-4 flex-1">
                <div className="px-6 py-2">
                    <div className="flex items-center gap-2 font-bold text-xl text-primary">
                        <Stethoscope className="size-6" />
                        <span>ClinicOS</span>
                    </div>
                </div>
                <div className="px-3 py-2">
                    <div className="space-y-1">
                        {filteredNavItems.map((item) => (
                            <Button
                                key={item.href}
                                variant={pathname === item.href || (item.href === '/doctor' && pathname === '/doctor') ? "secondary" : "ghost"}
                                className={cn(
                                    "w-full justify-start",
                                    pathname === item.href && "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
                                )}
                                asChild
                            >
                                <Link href={item.href}>
                                    <item.icon className="mr-2 h-4 w-4" />
                                    {item.title}
                                </Link>
                            </Button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-auto px-4 py-4 border-t bg-muted/20 space-y-4">
                <div>
                    <p className="text-xs text-muted-foreground mb-2 text-center uppercase tracking-wider font-semibold">Profile</p>
                    <ProfileSwitcher />
                </div>
                <div>
                    <p className="text-xs text-muted-foreground mb-2 text-center uppercase tracking-wider font-semibold">Preferences</p>
                    <div className="flex justify-center items-center gap-2">
                        <ThemeToggle />
                        <GlobalSettingsDialog />
                    </div>
                </div>
            </div>
        </div>
    )
}
