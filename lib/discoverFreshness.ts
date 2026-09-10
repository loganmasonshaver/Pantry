// Is this Discover recipe new enough to mark with the "NEW TODAY" border?
//
// A ROLLING 24 HOURS from when the row was created — deliberately not "generated_at equals today's
// UTC date", which is what the old "Today's picks" shelf keyed on. The UTC date flips at 7pm US
// Central, but the pipeline does not run until 3am, so for eight hours every evening "today" had no
// meals in it and the shelf vanished — across exactly the dinner-planning window. A recipe added at
// 3am stays marked until 3am the next day, straight through the evening.
//
// Kept pure and separate from discoverFeed.ts, which imports AsyncStorage and a Supabase client and
// cannot run under a plain node test.

export const NEW_WINDOW_HOURS = 24

export function isNewToday(createdAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!createdAt) return false
  const t = Date.parse(createdAt)
  // Unparseable is "not new", never "new": a false badge claims something untrue about a recipe,
  // a missing one only fails to point something out.
  if (!Number.isFinite(t)) return false
  const ageMs = nowMs - t
  // A timestamp in the future is clock skew or bad data, not a recipe that is extra-new.
  if (ageMs < 0) return false
  return ageMs <= NEW_WINDOW_HOURS * 3_600_000
}

// NEW TODAY FIRST inside a shelf, so a new recipe is never behind "Show more". Logan found new
// recipes hidden that way: the border marks them, but a shelf shows 6 before paging, and a new
// recipe ranked 9th was invisible until tapped for.
//
// A STABLE partition — both halves keep the order claim() gave them — applied AFTER claim(), so it
// changes only where a recipe sits within its shelf, never which shelf owns it. The cost is that a
// batch heavy in one form (four ice creams on 2026-09-10) now leads that shelf together; keeping
// claim()'s spread order within the new group means nothing is clustered beyond the batch itself.
export function newTodayFirst<T extends { created_at?: string | null }>(meals: readonly T[], nowMs: number = Date.now()): T[] {
  const fresh = meals.filter(m => isNewToday(m.created_at, nowMs))
  if (fresh.length === 0 || fresh.length === meals.length) return [...meals]
  return [...fresh, ...meals.filter(m => !isNewToday(m.created_at, nowMs))]
}

export function countNewToday(meals: readonly { created_at?: string | null }[], nowMs: number = Date.now()): number {
  return meals.reduce((n, m) => n + (isNewToday(m.created_at, nowMs) ? 1 : 0), 0)
}
