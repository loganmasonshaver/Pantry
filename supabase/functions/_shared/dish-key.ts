// Repeat detection for meal generation.
//
// Lives here rather than inline in generate-meals so it can be unit-tested without booting the
// edge runtime — the exact-string matching it replaces shipped untested and let a reworded repeat
// ("Fried Rice with Chicken" the day after "Chicken Fried Rice") slip straight through.

// How many past meal names we remember per user. 30 ≈ 10 generations, so a heavy day (1 auto-fire
// + 3 rerolls = 12 names) can no longer flush the entire window and resurrect yesterday's dinner.
export const RECENT_MEMORY = 30

// Words that change a title's wording but not the dish. Deliberately short — over-stripping would
// collapse genuinely different meals (a "bowl" and a "salad" are not the same dinner).
const TITLE_NOISE = new Set([
  "with", "and", "the", "a", "an", "of", "in", "on", "over", "topped", "served",
  "style", "homemade", "easy", "quick", "simple", "fresh", "classic", "your",
])

// Order-insensitive dish fingerprint: "Chicken Fried Rice" and "Fried Rice with Chicken" are the
// same meal to a user, but exact-string matching treats them as different. Sorting the significant
// tokens catches the reworded repeat, which is the form repeats usually take.
export function dishKey(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w && !TITLE_NOISE.has(w))
    // Crude singularization so "Beef Tacos" and "Beef Taco" collide. The ss/us/is endings are
    // excluded because they're overwhelmingly singular in food words — couscous, hummus,
    // asparagus, swiss — and chopping them invites a false collision with an unrelated word.
    .map(w => (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w))
    .sort()
    .join(" ")
}

// Significant tokens of a name, as a set. Same normalisation dishKey uses, minus the sort/join.
function dishTokens(name: unknown): Set<string> {
  const k = dishKey(name)
  return new Set(k ? k.split(" ").filter(Boolean) : [])
}

// Two titles describe the same dish when the SHORTER one's significant words nearly all appear in
// the longer one — allowing a single miss.
//
// WHY THIS EXISTS, and why dishKey alone was not enough: dishKey sorts tokens, so it catches a
// REORDERING ("Chicken Fried Rice" vs "Fried Rice with Chicken"). The failure mode in production
// is different — the model is handed a do-not-repeat list of exact names, complies literally, and
// returns a trivially reworded variant. Adding or dropping ONE word yields a completely different
// sorted key, so the repeat check never fired. Measured against 30 real remembered names for one
// user, all 18 distinct keys hid pairs like:
//   "Thai Peanut Sauce Chicken Rice Bowl"  vs  "Thai Peanut Sauce Rice Bowl"      (5/5 shared)
//   "Egg White and Vegetable Scramble with Toast" vs "...with Potatoes"           (4/5 shared)
//   "Mediterranean Greek Yogurt and Granola Bowl" vs "Greek Yogurt and Granola Power Bowl"
//
// SUPERSEDED 2026-09-02 — the all-but-one rule was measurably too strict, and the sentence that
// used to sit here ("pairs sharing two fewer were genuinely different meals") was a judgement call
// the user has since overruled with his own eyes.
//
// Re-measured against a LIVE 30-name window: 29 remembered names produced 29 DISTINCT dishKeys, so
// the fast path never fired once, and all-but-one caught only 13 of 406 pairs. Everything the user
// flagged as an obvious repeat sat exactly one notch below the threshold at `smaller - 2`:
//   "Chicken Salad and Roasted Potato Plate"      vs "Herb-Roasted Chicken Salad with Potatoes"  3/5
//   "Vanilla Berry Protein Yogurt Bowl"           vs "Greek Yogurt Protein Power Bowl"           3/5
//   "Creamy Cottage Cheese and Spinach Scramble"  vs "Savory Cottage Cheese and Egg Scramble"    3/5
// That is the same failure the all-but-one rule was written to fix, one rewording further along:
// the model is handed exact names to avoid, and now varies them by TWO words instead of one.
//
// A RATIO replaces the fixed allowance, because the old rule got stricter as titles got shorter —
// a 5-token pair had to share 4, a 7-token pair only 6, which is backwards. Sharing 60% of the
// shorter title is the same standard at every length. On the live window this catches 31 pairs of
// 406, and every one of the 18 newly caught pairs is a duplicate to the eye. Checked against the
// generosity ceiling too: 0.5 catches 37, and those extra 6 start joining genuinely different
// dishes, so 0.6 is the edge rather than an arbitrary pick.
//
// This does NOT manufacture variety — it only stops trivially reworded repeats. If the candidate
// pool is genuinely thin the ranking keeps repeats as reserves rather than returning nothing, so
// over-filtering degrades gracefully. Worth knowing the user's pantry held 55 in-stock items when
// this was measured: the sameness was the model's, not the pantry's.
export function isSameDish(a: unknown, b: unknown): boolean {
  const ka = dishKey(a)
  const kb = dishKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true // fast path: exact fingerprint, i.e. a pure reordering

  const A = dishTokens(a)
  const B = dishTokens(b)
  const smaller = Math.min(A.size, B.size)
  let shared = 0
  for (const t of A) if (B.has(t)) shared++
  // Floor of 2 keeps very short titles ("Chocolate Protein Smoothie") from matching on a single
  // shared word, which the ratio alone would allow at two or three tokens.
  return shared >= Math.max(2, Math.ceil(smaller * 0.6))
}

/** True when `name` is the same dish as anything already shown. */
export function matchesRecentDish(name: unknown, recent: readonly unknown[]): boolean {
  return recent.some(r => isSameDish(name, r))
}
