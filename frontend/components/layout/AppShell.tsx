"use client"

import { Menu } from "lucide-react"
import { Sidebar } from "./Sidebar"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet"
import { useState } from "react"
import { usePathname } from "next/navigation"
import { useEffect } from "react"

export default function AppShell({
    children,
}: {
    children: React.ReactNode
}) {
    const [open, setOpen] = useState(false)
    const pathname = usePathname()

    // Close mobile sidebar on route change
    useEffect(() => {
        setOpen(false)
    }, [pathname])

    const noShell = pathname.startsWith('/login') || pathname.startsWith('/create-account')
    if (noShell) return <>{children}</>

    return (
        <div className="flex min-h-screen flex-col md:flex-row">
            {/* Desktop Sidebar */}
            <aside className="hidden w-[265px] flex-col md:flex">
                <Sidebar className="fixed w-[265px]" />
            </aside>

            {/* Mobile Header & Nav */}
            <div className="md:hidden sticky top-0 z-40 border-b bg-white dark:bg-slate-950 px-4 py-3 flex items-center justify-between">
                <span className="font-bold text-lg text-primary">ClinicOS</span>
                <Sheet open={open} onOpenChange={setOpen}>
                    <SheetTrigger asChild>
                        <Button variant="ghost" size="icon">
                            <Menu className="h-5 w-5" />
                            <span className="sr-only">Toggle Menu</span>
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="p-0 w-72">
                        <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                        <Sidebar className="border-none" />
                    </SheetContent>
                </Sheet>
            </div>

            {/* Main Content */}
            <main className="flex-1 min-w-0 overflow-x-hidden p-8 bg-gray-50/50 dark:bg-background min-h-screen">
                <div className="w-full">
                    {children}
                </div>
            </main>
        </div>
    )
}
