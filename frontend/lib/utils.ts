import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Visit } from "@/lib/api"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function getTodayIST(): string {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// How long ago a visit happened, relative to today (IST). Counts in days up
// to 90 days old, then switches to whole months (e.g. "8d", "90d", "3mo").
export function getVisitAge(visitDate: string | null | undefined): string | null {
    if (!visitDate) return null
    const today = new Date(`${getTodayIST()}T00:00:00`)
    const then = new Date(`${visitDate}T00:00:00`)
    if (isNaN(then.getTime())) return null
    const days = Math.round((today.getTime() - then.getTime()) / (1000 * 60 * 60 * 24))
    if (days < 0) return null
    if (days <= 90) return `${days}d`
    return `${Math.floor(days / 30)}mo`
}

// A visit fee stored as exactly 0 is a deliberate free appointment, not a
// missing value — display it distinctly rather than a blank "—" or "₹0"
// that reads as unset data.
export function formatVisitFee(fee: number | null | undefined): string {
    if (fee == null) return '—'
    if (fee === 0) return 'FREE'
    return `₹${fee}`
}

// Not-done visits stay sorted by time; done visits sink below them, most
// recently completed first, so a just-finished appointment appears right
// under the pending list instead of staying in its original time slot.
export function orderTodayVisits<T extends Pick<Visit, 'status' | 'visit_time' | 'created_at' | 'updated_at'>>(visits: T[]): T[] {
    const pending = visits.filter(v => v.status !== 'done')
    const done = visits.filter(v => v.status === 'done')

    pending.sort((a, b) => {
        const timeA = a.visit_time || "23:59"
        const timeB = b.visit_time || "23:59"
        return timeA === timeB
            ? (a.created_at || "").localeCompare(b.created_at || "")
            : timeA.localeCompare(timeB)
    })
    done.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))

    return [...pending, ...done]
}
