import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Visit } from "@/lib/api"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function getTodayIST(): string {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
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
