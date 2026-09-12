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
// Base foods collapsed to the family that decides what the DISH is. Carbs are deliberately absent:
// rice, potato and pasta are the setting, not the subject — two dishes are not the same meal for
// both being served over rice. Variants map together so "greek yogurt" and "yogurt", or "egg white"
// and "egg", are one protein rather than two.
const PROTEIN_FAMILY: Record<string, string> = {
  "cottage cheese": "cottage cheese", "cream cheese": "cheese", "cheese": "cheese",
  "greek yogurt": "yogurt", "yogurt": "yogurt",
  "egg white": "egg", "egg": "egg",
  "ground beef": "beef", "beef": "beef",
  "chicken salad": "chicken", "chicken": "chicken",
  "turkey": "turkey", "pork": "pork",
  "salmon": "fish", "tuna": "fish", "shrimp": "shellfish",
  "tofu": "tofu", "paneer": "paneer",
  "lentil": "legume", "chickpea": "legume", "bean": "legume",
  "protein powder": "protein powder", "peanut butter": "peanut butter",
}

/** Which protein a dish is built on. Empty when the title names none. */
export function proteinFamilies(name: unknown, ingredients?: unknown): Set<string> {
  const out = new Set<string>()
  for (const base of detectBases(name, ingredients)) {
    const fam = PROTEIN_FAMILY[base]
    if (fam) out.add(fam)
  }
  return out
}

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

  // DIFFERENT PROTEIN, DIFFERENT DISH — checked before the token count, because token overlap
  // cannot see this. "Thai Basil Beef Rice Bowl" and "Thai Peanut Sauce Chicken Rice Bowl" share
  // thai/rice/bowl — 3 of 5, enough to pass the ratio — but every shared word is STRUCTURAL and the
  // thing that decides the meal is beef versus chicken. That false positive was real: it sorted a
  // genuinely new beef dish to the back of a generation, penalising the variety the base ban had
  // just produced. Only applies when BOTH titles name a protein; two dishes that name none fall
  // through to the token rule as before.
  const pa = proteinFamilies(a)
  const pb = proteinFamilies(b)
  if (pa.size > 0 && pb.size > 0) {
    let sharesProtein = false
    for (const f of pa) if (pb.has(f)) { sharesProtein = true; break }
    if (!sharesProtein) return false
  }

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
  // AN IDENTICAL NAME IS NEVER RESCUED. The rescue exists for names that merely READ alike — its
  // own comment says "two SIMILARLY-NAMED dishes" — and it was overruling byte-identical ones:
  // "Protein-Boosted Chocolate Smoothie" was generated 2026-09-05 20:57, entered the anti-repeat
  // window, and was generated again VERBATIM an hour later because its ingredient list had drifted
  // below INGREDIENT_RESCUE_MAX. A reader seeing the same dish name twice does not care that the
  // ingredients moved; to them it is the same meal and the window failed.
  //
  // dishKey sorts its significant tokens, so equal keys mean the same words in any order —
  // "Chicken Rice Bowl" and "Rice Chicken Bowl" are correctly caught here too.
  if (dishKey(a?.name) === dishKey(b?.name)) return true
  const sa = ingredientSignature(a?.ingredients)
  const sb = ingredientSignature(b?.ingredients)
  if (sa.size === 0 || sb.size === 0) return true // no evidence to overrule the name
  return ingredientOverlap(sa, sb) > INGREDIENT_RESCUE_MAX
}

/**
 * Same clustering, but keeping HOW OFTEN each dish appeared.
 *
 * clusterDishes exists for the stored window, where the only question is "which dishes do we
 * remember". The PROMPT wants something different: a bare deduped list tells the model that a
 * cottage cheese bowl was served, and hides that seven of the last ten were. The count is the part
 * that says "stop", and it is free — we are already grouping.
 */
export function clusterDishCounts(names: readonly unknown[]): Array<{ name: string; count: number }> {
  const out: Array<{ name: string; count: number }> = []
  for (const n of names) {
    const name = String(n ?? "").trim()
    if (!name || !dishKey(name)) continue
    const hit = out.find(o => isSameDish(name, o.name))
    if (hit) hit.count++
    else out.push({ name, count: 1 })
  }
  return out
}

// ── Base-food overuse ────────────────────────────────────────────────────────────────────────
//
// Why this exists, when a do-not-repeat list already does: it does not work. Handed a list headed
// "DO NOT SUGGEST these dishes", the model returned two of them VERBATIM (2026-09-02, measured).
// This endpoint already assumes the model ignores constraints under load — that is why macro bands
// are enforced in code rather than requested — and meal variety had no equivalent backstop.
//
// A name ban is trivially satisfiable by renaming. An INGREDIENT ban is not: "do not use cottage
// cheese today" cannot be complied with by calling it something else. That is the whole idea.
//
// Longest-first matching matters: "cottage cheese" must win over "cheese", "egg white" over "egg",
// "greek yogurt" over "yogurt", or every cottage cheese dish also counts as a cheese dish.
const BASE_FOODS: string[] = [
  "cottage cheese", "greek yogurt", "egg white", "protein powder", "peanut butter",
  "ground beef", "chicken salad", "cream cheese",
  "chicken", "beef", "turkey", "pork", "salmon", "tuna", "shrimp", "tofu", "paneer",
  "yogurt", "egg", "cheese", "lentil", "chickpea", "bean",
  "oats", "rice", "potato", "pasta", "quinoa", "granola",
].sort((a, b) => b.length - a.length)

// Bases a meal can actually be BUILT ON to reach a protein target, as opposed to bases that merely
// contain protein. Cheese, cream cheese and peanut butter are deliberately absent: they carry
// protein but are fat-dominant, and nobody anchors a 40g meal on them — banning one of those costs
// the deck nothing, which is exactly why they belong on the cheap side of this line.
const PROTEIN_BASES = new Set([
  "cottage cheese", "greek yogurt", "egg white", "protein powder", "ground beef", "chicken salad",
  "chicken", "beef", "turkey", "pork", "salmon", "tuna", "shrimp", "tofu", "paneer",
  "yogurt", "egg", "lentil", "chickpea", "bean",
])

/** Base foods a dish is built on, read from its name and (when present) its ingredient list. */
export function detectBases(name: unknown, ingredients?: unknown): Set<string> {
  let hay = ` ${String(name ?? "").toLowerCase()} `
  if (Array.isArray(ingredients)) {
    for (const raw of ingredients) hay += ` ${String((raw as any)?.name ?? raw ?? "").toLowerCase()} `
  }
  hay = hay.replace(/[^a-z\s]/g, " ")
  const found = new Set<string>()
  for (const base of BASE_FOODS) {
    if (!hay.includes(base)) continue
    // Consume the match so a longer base blocks the shorter one inside it.
    hay = hay.split(base).join(" ")
    found.add(base)
  }
  return found
}

/**
 * The base foods leaning on a user's recent feed hard enough to be worth banning for one day.
 *
 * Capped at `topK` deliberately. Banning everything over-used would empty a modest pantry — the
 * user this was built for had roughly six usable protein bases, so removing more than two leaves
 * the model nothing to build on and the generation degrades worse than the repetition did.
 */
// Thresholds calibrated against a real 29-meal history, not chosen for roundness. Cottage cheese
// and potato each sat at 27-29% of the last 15 meals there — with roughly six usable bases in that
// pantry an even spread is ~17%, so 27% is over-represented by more than half again. A 30% cut
// (the obvious round number) missed both by a point and would have banned nothing at all.
//
// The window is 15 SERVED MEALS, about five generations. Ten was too short to show the pattern:
// counts were 2-3 and indistinguishable from noise.
export function overusedBases(
  dishes: ReadonlyArray<{ name?: unknown; ingredients?: unknown }>,
  { window = 15, topK = 2, minCount = 3, minShare = 0.25, maxProteinBans = 1, carbBases = [], minCarbsLeft = 2 }:
    { window?: number; topK?: number; minCount?: number; minShare?: number; maxProteinBans?: number
      /** savory carb bases this pantry actually holds, e.g. ["rice", "potato"] */
      carbBases?: readonly string[]; minCarbsLeft?: number } = {},
): string[] {
  const recent = dishes.slice(0, window)
  if (recent.length === 0) return []
  const counts = new Map<string, number>()
  for (const d of recent) {
    for (const base of detectBases(d?.name, d?.ingredients)) {
      counts.set(base, (counts.get(base) ?? 0) + 1)
    }
  }
  const ranked = [...counts.entries()]
    .filter(([, n]) => n >= minCount && n / recent.length >= minShare)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([base]) => base)

  // AT MOST ONE PROTEIN BASE PER RUN, and this number is measured, not chosen.
  //
  // topK=2 was sized for "roughly six usable protein bases" but nothing stopped BOTH bans landing
  // on protein, and in practice they did: across five consecutive live runs the ban was
  // granola+chicken, protein-powder+cottage-cheese, greek-yogurt+potato, greek-yogurt+protein-
  // powder, egg+greek-yogurt. Four of the five took two protein sources off the shelf before the
  // model saw the pantry, and greek yogurt alone was banned in three.
  //
  // That is a feedback loop rather than a variety win. A narrow pantry makes the same bases recur
  // BECAUSE it is narrow; the guard reads the recurrence as fatigue and removes them; the model
  // then has less to build on, returns weaker and more repetitive candidates, and the next run
  // bans again. Run 27 is the counter-example and the reason for the rule: it is the only one of
  // the five that took a CARB as its second ban (greek yogurt + potato), and the only one that
  // reached the ranker with seven candidates instead of three — with every meal at or above the
  // protein target.
  //
  // So the budget is spent on the axis the user has plenty of. Ban order still follows overuse, so
  // the most-repeated food is still the first to go; a SECOND protein is simply skipped in favour
  // of the next non-protein offender, and if there is none, fewer bans is the correct answer.
  // CARBS GET THE SAME PROTECTION, for the same reason and by the same measured argument.
  //
  // A base ban tells the model to build on something else, which requires something else to exist.
  // Logan's pantry holds two savory carbs — rice and potato — so banning potato left exactly one, and
  // every savory dish was built on rice: three of three shown meals in run 48, two of three in run 51,
  // including rice "alongside" an egg scramble and rice as the filling of a "wrap". When the ban took
  // rice as well, the only carbs the prompt could offer were granola and protein cereal, and the model
  // put granola beside a savory omelet.
  //
  // So a carb is banned only while `minCarbsLeft` savory carbs would remain. With three or more the
  // ban still fires; with two it never does, which is correct — alternating everything between two
  // bases is not variety, it is the same two bases with one of them switched off.
  const out: string[] = []
  let proteinBans = 0
  let carbBans = 0
  for (const base of ranked) {
    if (out.length >= topK) break
    const isProtein = PROTEIN_BASES.has(base)
    if (isProtein && proteinBans >= maxProteinBans) continue
    const isCarb = !isProtein && carbBases.includes(base)
    if (isCarb && carbBases.length - carbBans - 1 < minCarbsLeft) continue
    if (isProtein) proteinBans++
    if (isCarb) carbBans++
    out.push(base)
  }
  return out
}

// ── Dish FORM ───────────────────────────────────────────────────────────────────────────────────
// The noun a photograph of the dish would show. A DELIBERATE DUPLICATE of lib/dishArchetype.ts,
// which is the client copy used for Discover shelf spreading — the two runtimes cannot share a
// module (the client never imports from supabase/functions, and doing so would couple a device
// build to the edge runtime's files). Keep the two in step; the noise list below is the only part
// that differs, because Discover's names come from creators and these come from the model.
//
// This exists here because name similarity provably cannot catch a rewording that keeps only the
// form: "Bulgarian Yogurt and Fruit Smoothie" shares exactly one token with "Tropical Protein
// Smoothie", so isSameDish returns false — while it was the EIGHTH smoothie in 14 generations.
// Form is the signal that survives an aggressive rename, and it was already in the codebase,
// wired only into Discover.
const ARCHETYPE_NOISE = new Set([
  "protein", "high", "low", "fat", "free", "no", "baked", "air", "fryer", "easy", "quick",
  "simple", "style", "homemade", "healthy", "best", "classic", "fresh", "the", "a", "an", "of",
  "with", "and", "in", "on", "over", "topped", "served", "microwave", "oven", "minute", "min",
  "recipe", "double", "loaded", "savory", "creamy",
])
// "bake" is NOT noise here, though the client copy lists it. As a TRAILING noun it is the form
// itself — "Savory Cottage Cheese and Potato Bake" is a bake, and stripping the word left
// "potato", which is an ingredient, not a shape. "baked" stays noise because it is an adjective:
// "Baked Protein Oats" is correctly an oat dish. Caught by a test, not by reading.

export function dishArchetype(name: unknown): string {
  const words = String(name ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter(w => w && !ARCHETYPE_NOISE.has(w))
  const last = words[words.length - 1]
  if (!last) return ""
  // Same crude singularisation dishKey uses, so "Bowls" and "Bowl" collide.
  return last.length > 3 && last.endsWith("s") && !/(ss|us|is)$/.test(last) ? last.slice(0, -1) : last
}

/**
 * Dish FORMS leaning on the recent feed hard enough to be worth banning for one generation.
 *
 * Same shape and thresholds as overusedBases above, on purpose: those were calibrated against a
 * real 29-meal history rather than chosen for roundness, and forms behave like bases — a modest
 * pantry supports only a handful, so banning more than topK leaves the model nothing to build.
 */
export function overusedArchetypes(
  dishes: ReadonlyArray<{ name?: unknown }>,
  { window = 15, topK = 2, minCount = 3, minShare = 0.25 }:
    { window?: number; topK?: number; minCount?: number; minShare?: number } = {},
): string[] {
  const recent = dishes.slice(0, window)
  if (recent.length === 0) return []
  const counts = new Map<string, number>()
  for (const d of recent) {
    const a = dishArchetype(d?.name)
    if (a) counts.set(a, (counts.get(a) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount && n / recent.length >= minShare)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topK)
    .map(([a]) => a)
}

/**
 * Trim a name history to `maxDistinct` DISHES while keeping every name that was actually served.
 *
 * Replaces clusterDishes() for the stored window, and the difference is the whole point.
 * clusterDishes keeps one name per dish, so the stored window is already collapsed — and
 * clusterDishCounts, which the prompt uses to say "(served 7x)", then reads it back and can only
 * ever report 1. Measured on a live window: 26 names, 26 dishes, zero counts above one, while the
 * same meals AS SERVED contained a smoothie eight times. The escalation that would have told the
 * model to stop was structurally unreachable.
 *
 * Worse, collapsing EVICTS: the newest name wins and its older twin is deleted, so a repeat erases
 * the evidence of the thing it repeated.
 *
 * Counting distinct dishes rather than names keeps both properties — the window still remembers
 * `maxDistinct` different dishes, and the counts survive. maxLength bounds the array so one
 * runaway dish cannot grow it without limit.
 */
export function capByDistinctDishes(
  names: readonly unknown[],
  maxDistinct: number = RECENT_MEMORY,
  maxLength: number = RECENT_MEMORY * 2,
): string[] {
  const kept: string[] = []
  const representatives: string[] = []
  for (const raw of names) {
    const name = String(raw ?? "").trim()
    if (!name) continue
    const isKnown = representatives.some(r => isSameDish(r, name))
    if (!isKnown) {
      if (representatives.length >= maxDistinct) break
      representatives.push(name)
    }
    kept.push(name)
    if (kept.length >= maxLength) break
  }
  return kept
}
