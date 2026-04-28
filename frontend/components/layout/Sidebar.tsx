"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Users, Package, CreditCard, Stethoscope, Image as ImageIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuth } from "@/lib/auth_context"
import { ProfileSwitcher } from "@/components/profile-switcher"

const navItems = [
    {
        title: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
    },
    {
        title: "Patients",
        href: "/patients",
        icon: Users,
    },
    {
        title: "Inventory",
        href: "/inventory",
        icon: Package,
    },
    {
        title: "Gallery",
        href: "/gallery",
        icon: ImageIcon,
    },
    {
        title: "Billing",
        href: "/billing",
        icon: CreditCard,
    },
    {
        title: "Prescriptions",
        href: "/prescriptions",
        icon: Stethoscope,
    },
]

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> { }

export function Sidebar({ className }: SidebarProps) {
    const pathname = usePathname()
    const { role } = useAuth()

    // Define Role Accessibility
    // Frontdesk/Admin: All
    // Doctor: Dashboard (Special Doctor View) + Patients (Maybe?) + Settings?
    // Let's filter navItems based on role.

    const filteredNavItems = navItems.filter(item => {
        if (role === 'doctor') {
            // Doctors usually only need Patient list or Appointments
            // We'll create a special "Doctor Dashboard" link later, but for now:
            if (item.href === '/') return true; // Their dashboard
            if (item.href === '/patients') return true;
            if (item.href === '/doctor/dashboard') return true; // We might move dashboard here
            if (item.href === '/prescriptions') return true;
            return false;
        }
        return true; // Frontdesk/Admin see all
    })

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
                                variant={pathname === item.href ? "secondary" : "ghost"}
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
                    <p className="text-xs text-muted-foreground mb-2 text-center uppercase tracking-wider font-semibold">Theme</p>
                    <div className="flex justify-center">
                        <ThemeToggle />
                    </div>
                </div>
            </div>
        </div>
    )
}
