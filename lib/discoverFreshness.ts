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

// NEW TODAY recipes land at RANDOM spots within the first page of their shelf — Logan's call
// after three patterns each looked like a pattern: new-first stacked a batch at the top, plain
// alternation lined them all down the right column of the 2-column grid, and a checkerboard he
// rejected on sight. "Just make it random."
//
// Two things are deliberately NOT random. The seed is the DAY (plus which recipes are new), so the
// layout holds still all day — reshuffling on every open is the "page rearranges under me" bug this
// screen was rebuilt to avoid. And every new recipe stays inside the first page window (6 cards,
// wider if a shelf has more than 3 new ones), because the first complaint was new recipes hidden
// behind "Show more". Both halves keep claim()'s order, and it runs after claim(), so shelf
// ownership never changes.
const FIRST_PAGE = 6 // discover.tsx GRID_PAGE
// FNV-1a plus murmur3's final mix. The slot is the LAST character of each seed, and a plain
// h*31+c hash barely moves on a last-character change — it put the new recipes in one contiguous
// block (slots 0-2 or 3-5) every day, i.e. stacked again. The finaliser spreads it to every bit.
const hash = (str: string) => {
  let h = 2166136261
  for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619) }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16
  return h >>> 0
}
export function interleaveNewToday<T extends { id?: string; created_at?: string | null }>(meals: readonly T[], nowMs: number = Date.now()): T[] {
  const fresh = meals.filter(m => isNewToday(m.created_at, nowMs))
  const old = meals.filter(m => !isNewToday(m.created_at, nowMs))
  if (fresh.length === 0 || old.length === 0) return [...meals]
  const window = Math.min(meals.length, Math.max(FIRST_PAGE, fresh.length * 2))
  const seed = `${new Date(nowMs).toDateString()}|${fresh.map(m => m.id ?? '').join(',')}`
  // A seeded permutation of the window's slots; the first fresh.length of them hold the new recipes.
  const slots = Array.from({ length: window }, (_, k) => k)
    .sort((x, y) => hash(`${seed}|${x}`) - hash(`${seed}|${y}`))
    .slice(0, fresh.length)
  const freshAt = new Set(slots)
  const out: T[] = []
  let i = 0, j = 0
  for (let slot = 0; slot < meals.length; slot++) out.push(freshAt.has(slot) && j < fresh.length ? fresh[j++] : (i < old.length ? old[i++] : fresh[j++]))
  return out
}

// How far into a shelf the LAST new recipe sits. The first page opens at least this far, so no
// NEW TODAY recipe is ever behind "Show more".
export function newTodayReach(meals: readonly { created_at?: string | null }[], nowMs: number = Date.now()): number {
  for (let k = meals.length - 1; k >= 0; k--) if (isNewToday(meals[k].created_at, nowMs)) return k + 1
  return 0
}
