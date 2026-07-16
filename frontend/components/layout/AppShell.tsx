"use client"

import { Menu, Stethoscope } from "lucide-react"
import { Sidebar } from "./Sidebar"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet"
import { useState, useEffect } from "react"
import { usePathname } from "next/navigation"

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

    return (
        <div className="flex min-h-screen flex-col">
            {/* Top bar */}
            <header className="sticky top-0 z-40 border-b bg-white dark:bg-[#181818] px-4 h-13 flex items-center gap-3">
                <Sheet open={open} onOpenChange={setOpen}>
                    <SheetTrigger asChild>
                        <Button variant="ghost" size="icon" className="shrink-0">
                            <Menu className="h-5 w-5" />
                            <span className="sr-only">Toggle Menu</span>
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="p-0 w-72">
                        <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                        <Sidebar className="border-none" />
                    </SheetContent>
                </Sheet>
                <div className="flex items-center gap-2 font-bold text-lg text-primary">
                    <Stethoscope className="h-5 w-5" />
                    <span>ClinicOS</span>
                </div>
            </header>

            {/* Main content — full width */}
            <main className="flex-1 min-w-0 overflow-x-hidden p-4 md:p-8 bg-gray-50/50 dark:bg-background">
                <div className="w-full">
                    {children}
                </div>
            </main>
        </div>
    )
}
