// Dish-FORM diversity for the Discover feed.
//
// Deliberately dependency-free and in lib/ rather than inline in app/(tabs)/discover.tsx, so it can
// be unit-tested without booting React Native. The screen's other diversity helper
// (ingredientSignature) lives inline and is untested, and that is exactly how this bug survived:
// the guard that was supposed to stop repeats could not be exercised against the real pool.

// Words describing how a dish is MADE or sold, not what it looks like on a plate. Stripped so the
// dish form is the last word left standing.
const ARCHETYPE_NOISE = new Set([
  'protein', 'high', 'low', 'fat', 'free', 'no', 'bake', 'baked', 'air', 'fryer', 'easy', 'quick',
  'simple', 'style', 'homemade', 'healthy', 'best', 'classic', 'fresh', 'the', 'a', 'an', 'of',
  'with', 'and', 'in', 'on', 'over', 'topped', 'served', 'microwave', 'oven', 'minute', 'min',
  'recipe', 'double', 'loaded',
])

export type ArchetypeMeal = { id: string; name?: string | null }

// The dish FORM — the noun a photograph of this meal would actually show.
//
// A SEPARATE signal from ingredient overlap, not a tuning of it, because the two disagree exactly
// where it matters. "Yogurt Chocolate Cheesecake" (hung curd, egg, honey, cocoa) and "Double
// Chocolate Protein Cheesecake" (cream cheese, cottage cheese, whey, Splenda, cocoa) are genuinely
// different recipes sharing only egg and cocoa, so ingredient overlap scores them ~0.25 — far under
// the 0.5 shelf threshold — and both were admitted to one shelf. On screen they are two slices of
// chocolate cheesecake on a white plate.
//
// The perverse part: the more differently two versions of a dish are MADE, the lower their
// ingredient overlap, so the ingredient signal gets WEAKER precisely as the visual repeat stays
// identical. No threshold on it can fix that, which is why form is measured on its own.
export function dishArchetype(meal: ArchetypeMeal): string {
  const words = String(meal?.name ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w && !ARCHETYPE_NOISE.has(w))
  const last = words[words.length - 1]
  if (!last) return ''
  // Same crude singularisation dishKey uses, so "Brownies" and "Brownie" collide. ss/us/is are
  // excluded because they are overwhelmingly singular in food words (couscous, hummus).
  return last.length > 3 && last.endsWith('s') && !/(ss|us|is)$/.test(last) ? last.slice(0, -1) : last
}

// Two of a form on one shelf reads as range; six reads as a thin catalog padded out. The live pool
// carried 6 cheesecakes, 6 brownies, 5 cakes and 4 mousses on the sweet-treat shelf alone.
export const ARCHETYPE_PER_SHELF = 2

// Reordering, NEVER dropping.
//
// "Everything else" is where a meal lands when no shelf claimed it, so skipping one here would take
// it off the page entirely rather than move it — the one thing the first-shelf-wins design is
// careful not to do. Round-robin across forms, biggest bucket first, so the form with the most
// entries gets the widest spacing available.
export function spreadByArchetype<T extends ArchetypeMeal>(meals: T[]): T[] {
  const buckets = new Map<string, T[]>()
  for (const m of meals) {
    // A meal with no readable form gets its own bucket keyed by id, so unrelated meals are never
    // grouped together by an empty string and then spaced apart as if they matched.
    const key = dishArchetype(m) || `#${m.id}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(m)
    else buckets.set(key, [m])
  }
  // Greedy: always take the largest remaining bucket that is NOT the form just emitted.
  //
  // A plain round-robin looks correct and is not. It spaces the early passes fine, then the small
  // buckets run dry and whatever is left dumps consecutively — measured over the live 128-meal pool
  // it turned a worst-case run of 2 into a run of 4, i.e. it made the exact problem it was meant to
  // fix WORSE at the tail. Picking the largest-remaining each step keeps the big forms draining
  // throughout instead of surviving to the end.
  //
  // When one form holds more than half of what is left, some adjacency is arithmetically forced;
  // the fallback below emits it rather than looping forever.
  // The last TWO emitted forms are excluded, not just one. Discover renders these as a TWO-COLUMN
  // grid, so index i is on screen next to i-1 (same row) AND i-2 (directly above). Blocking only
  // i-1 produces a perfect alternation — brownie, cheesecake, brownie, cheesecake — which is a
  // clean row order and a solid COLUMN of brownies down the left-hand side. That is the same defect
  // the user reported, rotated 90 degrees.
  const out: T[] = []
  let prev1 = ''
  let prev2 = ''
  for (;;) {
    let pick = ''
    let best = 0
    for (const [key, queue] of buckets) {
      if (queue.length === 0 || key === prev1 || key === prev2) continue
      if (queue.length > best) { best = queue.length; pick = key }
    }
    // Relax to the row neighbour only, then to anything: with few forms left, some repeat is
    // arithmetically forced and emitting it beats looping forever.
    if (!pick) {
      for (const [key, queue] of buckets) {
        if (queue.length === 0 || key === prev1) continue
        if (queue.length > best) { best = queue.length; pick = key }
      }
    }
    if (!pick) {
      for (const [key, queue] of buckets) { if (queue.length) { pick = key; break } }
      if (!pick) break
    }
    out.push(buckets.get(pick)!.shift() as T)
    prev2 = prev1
    prev1 = pick
  }
  return out
}
