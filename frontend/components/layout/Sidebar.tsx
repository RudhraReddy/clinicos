"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Users, Package, CreditCard, Stethoscope, Image as ImageIcon, BarChart2, LogOut, Shield, ClipboardList, History, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuth } from "@/lib/auth_context"
import { GlobalSettingsDialog } from "@/components/GlobalSettingsDialog"
import { StaffLocationSwitcher } from "@/components/staff-location-switcher"

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
    { title: "Billing", href: "/billing", icon: CreditCard },
    { title: "Gallery", href: "/gallery", icon: ImageIcon },
    { title: "Status", href: "/status", icon: BarChart2 },
]

const adminNavItems = [
    { title: "Dashboard", href: "/", icon: LayoutDashboard },
    { title: "Doctor View", href: "/doctor", icon: Stethoscope },
    { title: "Patients", href: "/patients", icon: Users },
    { title: "Visits", href: "/visits", icon: ClipboardList },
    { title: "Inventory", href: "/inventory", icon: Package },
    { title: "Invoice History", href: "/inventory/history", icon: History },
    { title: "Add Invoice", href: "/inventory/invoice_edit?manual=true", icon: FileText },
    { title: "Billing", href: "/billing", icon: CreditCard },
    { title: "Gallery", href: "/gallery", icon: ImageIcon },
    { title: "Status", href: "/status", icon: BarChart2 },
    { title: "Admin", href: "/admin", icon: Shield },
]

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> { }

export function Sidebar({ className }: SidebarProps) {
    const pathname = usePathname()
    const { role, logout, user } = useAuth()

    const filteredNavItems = role === 'admin' ? adminNavItems : role === 'doctor' ? doctorNavItems : staffNavItems

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
                {role === 'doctor' && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-2 text-center uppercase tracking-wider font-semibold">View</p>
                        <StaffLocationSwitcher />
                    </div>
                )}
                <div>
                    <p className="text-xs text-muted-foreground mb-2 text-center uppercase tracking-wider font-semibold">Preferences</p>
                    <div className="flex justify-center items-center gap-2">
                        <ThemeToggle />
                        <GlobalSettingsDialog />
                    </div>
                </div>
                <div>
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground hover:text-destructive"
                        onClick={logout}
                    >
                        <LogOut className="mr-2 h-4 w-4" />
                        {user?.username ?? 'Logout'}
                    </Button>
                </div>
                <div className="border-t border-muted/30">
                    <p className="text-[10px] text-muted-foreground/60 tracking-wider">
                        SYSTEM VERSION: v2.2.2
                    </p>
                </div>
            </div>
        </div>
    )
}
