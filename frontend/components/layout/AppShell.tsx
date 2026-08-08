"use client"

import { Menu } from "lucide-react"
import { Sidebar } from "./Sidebar"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet"
import { useState, useEffect, createContext, useContext } from "react"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const MenuContext = createContext<{ openMenu: () => void } | null>(null)

/** Lets a page render its own inline menu-toggle button instead of the fixed fallback. */
export function useMenu() {
    const ctx = useContext(MenuContext)
    if (!ctx) throw new Error("useMenu must be used within AppShell")
    return ctx
}

export default function AppShell({
    children,
}: {
    children: React.ReactNode
}) {
    const [open, setOpen] = useState(false)
    const pathname = usePathname()

    useEffect(() => {
        setOpen(false)
    }, [pathname])

    const noShell = pathname.startsWith('/login') || pathname.startsWith('/create-account')
    if (noShell) return <>{children}</>

    // Pages that render their own inline trigger via useMenu() instead of the fixed fallback below
    const INLINE_TRIGGER_ROUTES = [
        '/', '/patients', '/inventory', '/billing', '/doctor',
        '/inventory/invoice_edit', '/gallery', '/status', '/admin', '/daily-summary',
    ]
    const hasInlineTrigger = INLINE_TRIGGER_ROUTES.includes(pathname) || pathname.startsWith('/inventory/history/')

    return (
        <MenuContext.Provider value={{ openMenu: () => setOpen(true) }}>
            <div className="min-h-screen">
                <Sheet open={open} onOpenChange={setOpen}>
                    {!hasInlineTrigger && (
                        <SheetTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="fixed top-4 left-4 z-40 h-8 w-8 text-foreground hover:bg-accent"
                            >
                                <Menu className="h-6 w-6" />
                                <span className="sr-only">Toggle Menu</span>
                            </Button>
                        </SheetTrigger>
                    )}
                    <SheetContent side="left" className="p-0 w-72">
                        <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                        <Sidebar className="border-none" />
                    </SheetContent>
                </Sheet>

                {/* Main content — pages with their own inline trigger need less top clearance */}
                <main className={cn(
                    "min-w-0 min-h-screen overflow-x-hidden px-4 pb-4 md:px-8 md:pb-8 bg-gray-50/50 dark:bg-background",
                    hasInlineTrigger ? "pt-8 md:pt-10" : "pt-16 md:pt-16"
                )}>
                    <div className="w-full">
                        {children}
                    </div>
                </main>
            </div>
        </MenuContext.Provider>
    )
}
