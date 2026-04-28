"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

export function ThemeToggle() {
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return null
    }

    return (
        <div className="flex items-center justify-center p-1 bg-secondary/50 rounded-full border border-border w-fit mx-auto">
            <button
                onClick={() => setTheme("light")}
                className={cn(
                    "p-2 rounded-full transition-all duration-300 hover:text-primary",
                    theme === "light"
                        ? "bg-background text-primary shadow-sm"
                        : "text-muted-foreground hover:bg-transparent"
                )}
                aria-label="Light Mode"
            >
                <Sun className="h-4 w-4" />
            </button>
            <button
                onClick={() => setTheme("dark")}
                className={cn(
                    "p-2 rounded-full transition-all duration-300 hover:text-primary",
                    theme === "dark"
                        ? "bg-background text-primary shadow-sm"
                        : "text-muted-foreground hover:bg-transparent"
                )}
                aria-label="Dark Mode"
            >
                <Moon className="h-4 w-4" />
            </button>
        </div>
    )
}
