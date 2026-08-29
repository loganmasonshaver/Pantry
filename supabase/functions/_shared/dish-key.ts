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
// The all-but-one rule is calibrated from that data. Pairs sharing all-but-one were the same dish
// every time; pairs sharing two fewer were genuinely different meals that happened to share a base
// ingredient ("Cottage Cheese and Veggie Power Plate" vs "Cottage Cheese and Egg Savory Plate").
// Loosening it further collapses real variety and starves the candidate pool.
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
  // shared word, which all-but-one alone would allow at two tokens.
  return shared >= Math.max(2, smaller - 1)
}

/** True when `name` is the same dish as anything already shown. */
export function matchesRecentDish(name: unknown, recent: readonly unknown[]): boolean {
  return recent.some(r => isSameDish(name, r))
}
