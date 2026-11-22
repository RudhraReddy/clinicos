import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Visit } from "@/lib/api"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function getTodayIST(): string {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// Units (tablets) per stored inventory quantity: stock and MRP are stored per
// pack and shown/billed per tablet. The ONE place this rule lives on the
// frontend -- keep in sync with Backend_db/utils.py pack_multiplier.
//   "10's pack" / "strip of 10" / "15 tabs" -> 10 / 10 / 15
//   "10ml", "10 mg", "5 g", "100ml" -> 1 (a measured item is one unit)
//   anything else (no number, "1", "box") -> 1
// "AxB" forms like "1x10" are deliberately not supported (-> 1); a bare
// number is normalised to "N's pack" on entry instead (normalizePackSize).
const MEASURE_RE = /\d\s*(ml|mg|mcg|gm|g|kg|l|ltr|iu)\b/
export function packMultiplier(packSize?: string | null): number {
    const pack = (packSize || "").toLowerCase()
    if (MEASURE_RE.test(pack)) return 1
    if (pack.includes("s")) {
        const m = pack.match(/(\d+)/)
        if (m) {
            const num = parseInt(m[1], 10)
            if (num > 1) return num
        }
    }
    return 1
}

// "30 (3 packs × ₹30)" for a batch portion -- MRP is per stored unit (pack),
// so for multi-unit packs show the pack maths rather than "30 × ₹30".
export function batchQtyLabel(qty: number, mrp: number, mult: number): string {
    const count = Math.round(qty * mult)
    if (mult <= 1) return `${count} × ₹${mrp}`
    const packs = Math.round(qty * 100) / 100
    return `${count} (${packs} pack${packs === 1 ? "" : "s"} × ₹${mrp})`
}

// Review-date offsets: a day is +1, a week is +7, a month is a flat +30 days
// (clinic convention, not calendar months).
export type ReviewOffsetUnit = "days" | "weeks" | "months"
export const REVIEW_OFFSET_DAYS: Record<ReviewOffsetUnit, number> = { days: 1, weeks: 7, months: 30 }

// today-in-IST + amount × unit, as YYYY-MM-DD. null unless amount is a
// positive whole number.
export function reviewDateFromOffset(amount: string | number, unit: ReviewOffsetUnit): string | null {
    const n = Number(amount)
    if (String(amount).trim() === "" || !Number.isInteger(n) || n < 1) return null
    const d = new Date(`${getTodayIST()}T00:00:00`)
    d.setDate(d.getDate() + n * REVIEW_OFFSET_DAYS[unit])
    const pad = (x: number) => String(x).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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

// Stock transfers move ITEMS only for now: no ₹ value is saved or "moved"
// between clinics; qty × MRP is shown purely as an on-screen estimate. Set
// true to bring back the value-tracking UI (−₹X / +₹X summary, "Transfer ₹X")
// -- keep in sync with TRANSFER_VALUE_ENABLED in Backend_db/routes/transfers.py.
export const TRANSFER_VALUE_ENABLED = false

// A pack size that is just a whole number means "strip/pack of N": "10" ->
// "10's pack" (also "10.0"). Anything with text or units ("10ml", "10 mg",
// "strip of 10") is left as typed. Applied when the field loses focus; the
// backend applies the same rule (Backend_db/utils.py normalize_pack_size),
// which also covers CSV imports.
export function normalizePackSize(value: string): string {
    const m = value.trim().match(/^(\d+)(?:\.0+)?$/)
    return m ? `${parseInt(m[1], 10)}'s pack` : value
}
