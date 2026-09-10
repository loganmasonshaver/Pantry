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

// NEW TODAY recipes ALTERNATE with older ones through a shelf — older, new, older, new — so each
// is on the first page without the batch stacking at the top.
//
// Two of Logan's reports pull opposite ways, and this satisfies both. First: new recipes were
// hidden behind "Show more" (a shelf shows 6; a new recipe ranked 9th was invisible). The fix for
// that led every shelf with its new recipes, which produced the second: "all the new today meals
// are at the top of each section rather than mixed in like before" — a batch of four ice creams
// led a shelf together. Alternating keeps every new recipe within reach (newTodayReach tells the
// page how far to open) while the shelf still reads as a mix.
//
// Both halves keep claim()'s order, and it runs AFTER claim(), so it moves recipes within their
// shelf and never changes which shelf owns them. An older recipe leads, so no shelf opens on "new".
export function interleaveNewToday<T extends { created_at?: string | null }>(meals: readonly T[], nowMs: number = Date.now()): T[] {
  const fresh = meals.filter(m => isNewToday(m.created_at, nowMs))
  const old = meals.filter(m => !isNewToday(m.created_at, nowMs))
  if (fresh.length === 0 || old.length === 0) return [...meals]
  const out: T[] = []
  for (let i = 0; i < Math.max(fresh.length, old.length); i++) {
    if (i < old.length) out.push(old[i])
    if (i < fresh.length) out.push(fresh[i])
  }
  return out
}

// How far into a shelf the LAST new recipe sits. The first page opens at least this far, so no
// NEW TODAY recipe is ever behind "Show more".
export function newTodayReach(meals: readonly { created_at?: string | null }[], nowMs: number = Date.now()): number {
  for (let k = meals.length - 1; k >= 0; k--) if (isNewToday(meals[k].created_at, nowMs)) return k + 1
  return 0
}
