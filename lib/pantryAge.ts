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

// Bucket an age into the unit that reads naturally: days under a week, weeks under two months,
// months after. Under a day is "today". Shared by both label forms so they never disagree.
function ageParts(d: number): { n: number; unit: 'day' | 'week' | 'month' } | null {
  if (d < 1) return null
  if (d < 7) return { n: d, unit: 'day' }
  if (d < 60) return { n: Math.floor(d / 7), unit: 'week' }
  return { n: Math.floor(d / 30), unit: 'month' }
}

// "2d", "1w", "5w", "3mo" — the compact form, for anywhere a column is narrow.
export function ageLabel(sinceIso: string | null | undefined, now = Date.now()): string {
  const p = ageParts(daysSince(sinceIso, now))
  if (!p) return 'today'
  return `${p.n}${p.unit === 'month' ? 'mo' : p.unit[0]}`
}

// "2 days ago", "1 week ago", "7 weeks ago" — the review sheet, where the age is what the
// user weighs before Keep / Used up, so it gets the room to read as a sentence.
export function ageLabelLong(sinceIso: string | null | undefined, now = Date.now()): string {
  const p = ageParts(daysSince(sinceIso, now))
  if (!p) return 'today'
  return `${p.n} ${p.unit}${p.n === 1 ? '' : 's'} ago`
}

// Three weeks with no evidence and still marked in stock: worth a question, not a deletion.
// "Evidence" is any write that touches the row — a scan or receipt that sees it again, a grocery
// check-off, a tap. Callers scope this to perishables (isPerishable) — see there for why.
export function isStale(sinceIso: string | null | undefined, inStock: boolean, now = Date.now()): boolean {
  return inStock && daysSince(sinceIso, now) >= STALE_AFTER_DAYS
}

// Aisles where three weeks without evidence plausibly means "gone". Everything else is a staple
// that gets used and rebought without the app hearing of it — "untouched" says nothing about a
// jar of cumin — so those are never asked about. Frozen keeps for months and is out too.
export const PERISHABLE_CATEGORIES = ['Produce', 'Meat & Fish', 'Dairy & Eggs', 'Bakery'] as const
export function isPerishable(category: string): boolean {
  return (PERISHABLE_CATEGORIES as readonly string[]).includes(category)
}
