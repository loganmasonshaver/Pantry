// How long since a pantry item was added or last confirmed, and when that is long enough to ask.
// Pure, so the Pantry tab's stale nudge is testable without a device.

export const STALE_AFTER_DAYS = 21

const DAY = 86_400_000

export function daysSince(sinceIso: string | null | undefined, now = Date.now()): number {
  if (!sinceIso) return 0
  const t = Date.parse(sinceIso)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now - t) / DAY))
}

// "2d", "1w", "5w", "3mo" — the grey number beside a row. Under a day reads as "today".
export function ageLabel(sinceIso: string | null | undefined, now = Date.now()): string {
  const d = daysSince(sinceIso, now)
  if (d < 1) return 'today'
  if (d < 7) return `${d}d`
  if (d < 60) return `${Math.floor(d / 7)}w`
  return `${Math.floor(d / 30)}mo`
}

// Untouched for three weeks and still marked in stock: worth a question, not a deletion.
export function isStale(sinceIso: string | null | undefined, inStock: boolean, now = Date.now()): boolean {
  return inStock && daysSince(sinceIso, now) >= STALE_AFTER_DAYS
}
