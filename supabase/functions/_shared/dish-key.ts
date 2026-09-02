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

/**
 * Collapse a list of names into ONE REPRESENTATIVE PER DISTINCT DISH, newest first.
 *
 * The write-side window used to dedupe on exact dishKey equality, which never fired: measured on a
 * live 30-name window, 29 names produced 29 distinct keys and clustered into just 14 real dishes.
 * Half the remembered window was the model restating itself — seven names for one cottage cheese
 * bowl, five for one yogurt bowl.
 *
 * That is why shortening the window is the wrong instinct. It was never too long; it was half
 * empty. Deduping by SAMENESS rather than by key roughly doubles what the same 30 slots remember.
 */
export function clusterDishes(names: readonly unknown[]): string[] {
  const reps: string[] = []
  for (const n of names) {
    const name = String(n ?? "").trim()
    if (!name || !dishKey(name)) continue
    if (reps.some(r => isSameDish(name, r))) continue
    reps.push(name)
  }
  return reps
}

// Ingredients that say nothing about which dish this is. Everything cooks with these.
const PANTRY_NOISE = new Set([
  "salt", "pepper", "black pepper", "water", "oil", "olive oil", "cooking spray", "butter",
  "garlic", "onion", "sugar", "flour", "ice", "vanilla", "vanilla extract", "cinnamon",
  "baking powder", "baking soda", "lemon juice", "spices", "seasoning",
])

/** Core ingredient names, lowercased and stripped of the things every dish contains. */
export function ingredientSignature(ingredients: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(ingredients)) return out
  for (const raw of ingredients) {
    const n = String((raw as any)?.name ?? raw ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").trim()
    if (!n || PANTRY_NOISE.has(n)) continue
    // Keep the head noun only: "high-protein greek yogurt" and "greek yogurt" are one ingredient.
    const head = n.split(/\s+/).filter(w => w.length > 2).slice(-2).join(" ")
    if (head) out.add(head)
  }
  return out
}

/**
 * Fraction of the SMALLER signature that both dishes share. 0 when either is empty, so a meal with
 * no usable ingredient list can never be judged by this.
 */
export function ingredientOverlap(a: Set<string>, b: Set<string>): number {
  const smaller = Math.min(a.size, b.size)
  if (smaller === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / smaller
}

// Below this, two similarly-named dishes are made of different food and are NOT the same meal.
// Calibrated conservatively: it only ever RESCUES a name match, never creates one.
const INGREDIENT_RESCUE_MAX = 0.4

/**
 * Name-based sameness, with ingredients allowed to overrule a false positive.
 *
 * Names alone provably cannot separate the last class of error: "Savory Cottage Cheese and Egg
 * Breakfast Bowl" and "Cottage Cheese and Pineapple Protein Bowl" share exactly 3 of 5 tokens —
 * identical to every TRUE positive — so no threshold on names keeps one and drops the other. The
 * food is the only thing that distinguishes them, and generated_meals now stores it.
 *
 * Deliberately one-directional: ingredients can only turn a name-match OFF, never on. Turning it on
 * would need a calibrated threshold, and there is not yet enough recorded history to calibrate one
 * honestly. With no ingredients on either side this returns exactly what isSameDish returns, so a
 * caller with no history behaves as it did before.
 */
export function isSameDishDetailed(
  a: { name?: unknown; ingredients?: unknown },
  b: { name?: unknown; ingredients?: unknown },
): boolean {
  if (!isSameDish(a?.name, b?.name)) return false
  const sa = ingredientSignature(a?.ingredients)
  const sb = ingredientSignature(b?.ingredients)
  if (sa.size === 0 || sb.size === 0) return true // no evidence to overrule the name
  return ingredientOverlap(sa, sb) > INGREDIENT_RESCUE_MAX
}
