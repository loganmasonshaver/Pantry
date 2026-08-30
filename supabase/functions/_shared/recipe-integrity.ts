// Integrity checks for an extracted creator recipe, run before it is allowed into trending_meals.
//
// The retention gate next to these compares COUNTS — the model's ingredient count against the
// count parseIngredientBlock pulled out of the video description. That is blind in two directions
// this file closes:
//
//   * Junk counts. A section heading ("Składniki"), a macro line ("Kalorien: 504 kcal") or a
//     boilerplate line ("description tag") echoed into the ingredient list counts as an ingredient,
//     so a model that copies the raw description block passes the count check trivially. Five stored
//     meals had exactly this, all of them stamped source_verified.
//   * Identity. Three ingredients satisfy "three or more" whether or not they are the RIGHT three.
//     A real stored meal, "Blueberry-Lemon High-Protein Pancakes" (source video bp3sXQKLMqg,
//     "Fluffy High-protein Blueberry Pancakes🫐🍋"), kept Eggs, Greek yogurt and Maple syrup —
//     no blueberries, no lemon, no flour — and was stamped verified.
//
// Deliberately NOT done here: inferring drops from macros. Measured against the live pool of 168,
// the ratio of claimed calories to what the ingredients can produce puts known-bad meals at
// 0.98-2.03x, sitting inside the clean distribution (p50 1.07, p75 1.53). A threshold catching
// half of them rejects a third of the feed. The macro table is too approximate and a dropped
// berry too cheap for that signal to separate.

// ── Junk lines ───────────────────────────────────────────────────────────────────────────────
// Text that appears in a description's ingredient block but is not an ingredient. Kept narrow:
// anything matching here is DISCARDED, so a false positive silently shortens a real recipe.
const NON_INGREDIENT_PATTERNS: RegExp[] = [
  /\b\d+\s*(kcal|kj|calories|cals)\b/i,                                  // "504 kcal"
  /\b(protein|carbs?|carbohydrates?|fats?|kalorien|kohlenhydrate?|eiwei(ß|ss)|fett|makro\w*)\s*[:=]/i, // "Protein: 51g", "Kohlenhydrate: 40,6 g"
  // A bare macro header with no number or colon — "kcal/protein/fat/carbs" as its own line.
  /^[\s\W]*(kcal|calories)\s*[\/|,].*(protein|fat|carb)/i,
  /^(zutaten|ingredienti|ingr[ée]dients?|ingredients?|składniki|makroskładniki|przepis|recept\w*)\b/i, // headings, incl. localized
  // No \b here: JS word boundaries are ASCII-only, so \b never matches before "Ł" or after "ś"
  // and the guard silently did nothing on the very rows it was written for.
  /(składniki|makroskładniki|łap\s+przepis|zutaten|przepis)/i,
  /https?:\/\/|www\.|\B@\w+/i,                                            // links and handles
  /\b(description tag|ingredients? label|full recipe|subscribe|follow me|link in bio|shop my|use code)\b/i,
  // Punctuation/numbers only — "no letter in ANY script", not "no ASCII letter".
  // \W is [^A-Za-z0-9_], so Cyrillic, Devanagari, CJK, Greek and Arabic all count as punctuation
  // and the old /^[\s\W\d]*$/ deleted every line of a non-Latin ingredient list. A real Russian
  // source list collapsed from 12 items to 1. Exactly the ASCII-only trap already recorded above
  // for \b — that one was fixed, this one was missed.
  /^[^\p{L}]*$/u,
  // Instruction text. Creators write steps inside the ingredient block ("Season with: salt, black
  // pepper, and garlic powder.", "Cook eggs") and the model carries them through as ingredients.
  // Instruction text. Creators write steps inside the ingredient block and the model carries them
  // through. The verb list deliberately EXCLUDES words that begin real food names — top (Top
  // Ramen), season (Season salt), roll/wrap/slice/spread (all foods) — and requires a following
  // word, so a bare noun is never caught. "Season with:" and "Serve with:" are handled separately
  // because those two are unambiguous as phrases even though the bare verbs are not.
  /^\s*(preheat|combine|stir|whisk|bake|blend|pour|repeat|garnish|transfer|sprinkle|drizzle|chop|fold|layer|place|cook|mix|heat)\b\s+\w/i,
  /^\s*(season|serve|top)\s+(with|the)\b/i,
  // Equipment and packaging. A stored row listed "parchment paper setup" (0g) as an ingredient,
  // and another listed "Butter paper" — the Indian term for greaseproof. This is not cosmetic:
  // the retention gate asks whether the model kept at least as many ingredients as the parser
  // found, so an equipment line buys a free point toward that threshold exactly the way a repeated
  // ingredient does, and it renders in the app as something to go and buy.
  //
  // Narrow by NECESSITY, not caution. Measured over 161 live rows, a broad net caught 9 lines and
  // only 2 were equipment; the other 7 are real food — "rice paper sheet" (in a dish named "Rice
  // Paper Bacon Egg Bagel"), "flour wrap", "Ole Xtreme Wellness High Fiber Wrap", "oil spray",
  // "bagel seasoning". A bare /paper/ or /wrap/ rule would delete every one of them. So each
  // alternative here is anchored to a qualifier that no food carries, and "skewers" is required to
  // be bamboo/wooden/metal because CHICKEN skewers are dinner.
  /\bparchment\b/i,
  /\b(wax(ed)?|baking|greaseproof|butter)\s+paper\b/i,
  /\bpaper\s+towels?\b/i,
  /\b(aluminium|aluminum|tin)\s+foil\b/i,
  /^\s*foil\b/i,
  /\b(bamboo|wooden|metal|steel)\s+skewers?\b/i,
  /\btoothpicks?\b/i,
  /\b(cupcake|muffin|baking)\s+(liners?|cups?)\b/i,
  /\b(cling film|plastic wrap|saran|piping bag|zip-?lock|ziploc)\b/i,
  /\bsetup\s*$/i,
]

/** True when a line is plainly not a food item — a heading, a macro summary, a link, boilerplate. */
export function isNonIngredientLine(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return true
  return NON_INGREDIENT_PATTERNS.some(re => re.test(t))
}

/** Ingredient entries with the junk removed. Accepts objects or bare strings. */
export function realIngredients<T>(ingredients: T[] | undefined): T[] {
  return (ingredients || []).filter(i => {
    const name = typeof i === 'string' ? i : String((i as any)?.name ?? '')
    return !isNonIngredientLine(name)
  })
}

// ── Name / ingredient coherence ──────────────────────────────────────────────────────────────
// A dish named for a food that appears nowhere in its ingredients is missing a defining component.
// This is the direct evidence of a drop, and unlike the macro route it needs no estimation.

// Singularise so blueberry/blueberries, potato/potatoes, oat/oats collapse to one token. Bespoke
// rather than a stemmer: it must never merge two different foods, so it only strips plurals.
function singular(w: string): string {
  const s = w.toLowerCase()
  if (s.endsWith('ies') && s.length > 4) return s.slice(0, -3) + 'y'   // blueberries -> blueberry
  // -oes is its own rule: without it "potatoes" stemmed to "potatoe" and three stored meals
  // reported a missing potato while listing potatoes.
  if (s.endsWith('oes') && s.length > 4) return s.slice(0, -2)         // potatoes -> potato
  if (/(?:s|x|z|ch|sh)es$/.test(s) && s.length > 4) return s.slice(0, -2) // dishes -> dish
  if (s.endsWith('ss')) return s                                        // glass stays glass
  if (s.endsWith('s') && s.length > 3) return s.slice(0, -1)           // oats -> oat, dates -> date
  return s
}

const tokens = (t: string): Set<string> =>
  new Set((t ?? '').toLowerCase().match(/[a-zÀ-ɏ]+/g)?.map(singular) ?? [])

// Foods distinctive enough that naming a dish after one is a promise about its contents. Excludes
// preparation words (baked, crispy), vessels (bowl, wrap) and vague ones (berry, veggie).
const DEFINING_FOODS = [
  'blueberry', 'strawberry', 'raspberry', 'blackberry', 'cranberry', 'banana', 'mango', 'pineapple',
  'apple', 'peach', 'cherry', 'lemon', 'lime', 'orange', 'avocado', 'pumpkin', 'zucchini',
  'spinach', 'broccoli', 'mushroom', 'carrot', 'tomato', 'cucumber', 'potato', 'corn',
  'chicken', 'beef', 'steak', 'pork', 'bacon', 'sausage', 'turkey', 'lamb', 'salmon', 'tuna',
  'shrimp', 'cod', 'tofu', 'tempeh', 'chickpea', 'lentil',
  'feta', 'mozzarella', 'cheddar', 'parmesan', 'ricotta', 'halloumi',
  'oat', 'rice', 'quinoa', 'pasta', 'noodle', 'tortilla', 'couscous',
  'chocolate', 'peanut', 'almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'coconut',
  'honey', 'maple', 'cinnamon', 'vanilla', 'matcha', 'coffee', 'espresso', 'caramel',
  'pesto', 'salsa', 'hummus', 'ranch', 'oreo', 'biscoff', 'nutella', 'date', 'fig', 'raisin',
]

// Words a creator legitimately uses for the same thing. Without these the check reports drops that
// are really synonyms — "cocoa powder" for chocolate, "curd"/"skyr" for yogurt, "fettuccine" for
// pasta. Each entry here is a false positive observed in the live pool.
//
// EVERY entry must be a word that names the food SPECIFICALLY. A synonym is matched as a bare
// token against the whole ingredient list, so a generic word here silently disables the gate for
// that food: 'ground' let a "Beef Chili" made with ground TURKEY satisfy its beef promise, and
// 'strip' would have been satisfied by bacon strips.
//
// Measured before cutting, so this is subtraction with evidence rather than tidying: across 161
// live rows only FIVE names were rescued by a synonym at all — cocoa/cacao/choc for chocolate,
// fettuccine for pasta, and beef for steak. Every generic below was doing no work whatsoever,
// so removing them costs nothing measurable and closes the hole.
//
// Also removed as redundant rather than dangerous: 'rolled' (a "rolled oat" line already contains
// oat), and the multi-word forms one might reach for — "ground beef" and "beef mince" both contain
// 'beef', so they are satisfied by the food itself and never need a synonym.
//
// maple/honey both mapped to 'syrup', and ranch to 'dressing'. Those are not synonyms, they are
// categories: corn syrup is not honey and caesar dressing is not ranch. A dish named for one of
// them is promising that one.
const SYNONYMS: Record<string, string[]> = {
  chocolate: ['cocoa', 'cacao', 'choc', 'chocolat'],
  pasta: ['fettuccine', 'spaghetti', 'penne', 'macaroni', 'linguine', 'rigatoni', 'bowtie', 'farfalle', 'orzo', 'lasagna'],
  noodle: ['ramen', 'udon', 'soba', 'fettuccine', 'spaghetti'],
  oat: ['oatmeal', 'porridge', 'haferflocken'],
  coffee: ['espresso', 'mocha', 'flexpresso'],
  espresso: ['coffee', 'mocha'],
  steak: ['sirloin', 'ribeye', 'flank', 'beef'],
  beef: ['steak', 'sirloin', 'ribeye', 'chuck', 'brisket'],
  chicken: ['poultry'],
  peanut: ['pb'],
  corn: ['mais', 'sweetcorn'],
  blueberry: ['borówki', 'borówka'],
  date: ['medjool'],
}

/**
 * Foods promised by the dish name that appear nowhere in its ingredients.
 * Empty array means the name is supported by the list.
 */
// Meats and fish, where the difference between the FOOD and a FLAVOURING made from it is the whole
// point of the dish. "Marry Me Chicken Pasta" shipped on 2026-08-30 with no chicken in it: the only
// chicken token in the list was `chicken broth`, which satisfied the name and closed the gap. Its
// macros came from the creator's chicken version, so the row claimed 61g protein per serving
// against ~21g the ingredients can actually produce — a ~3x overclaim, which is exactly the harm a
// dropped defining ingredient does.
//
// Restricted to meat DELIBERATELY. The same reasoning does not hold for flavour-led foods: a
// "Chocolate Protein Shake" built on chocolate protein powder genuinely is a chocolate dish, and a
// vanilla extract genuinely makes something vanilla. Broth is the exception because a stock made
// from an animal is not that animal — you cannot eat it as the protein.
const MEAT_LIKE = new Set([
  'chicken', 'beef', 'steak', 'pork', 'bacon', 'sausage', 'turkey', 'lamb',
  'salmon', 'tuna', 'shrimp', 'cod',
])

// Forms in which a meat appears as seasoning rather than as the meat itself.
// Rendered fats and gelling agents belong here for the same reason broth does: beef tallow is not
// beef. "Garlic Butter Steak Sweet Potato" is in the live pool with no steak in it — the only meat
// reference is `beef tallow`, which reached the name through the steak->beef synonym. Bare "fat"
// is deliberately absent: "low fat beef mince" is real beef and must not read as a derivative.
const MEAT_DERIVATIVE = /\b(broth|stock|bouillon|consomm[eé]|seasoning|spice|rub|powder|flavou?r(?:ing|ed)?|extract|essence|base|granules?|cubes?|tallow|lard|dripping|suet|gelatin[e]?|collagen)\b/i

export function nameIngredientGaps(name: string, ingredients: any[] | undefined): string[] {
  const nameTokens = tokens(name)
  if (nameTokens.size === 0) return []
  const lines = realIngredients(ingredients)
    .map(i => (typeof i === 'string' ? i : String((i as any)?.name ?? '')))
  const ingTokens = tokens(lines.join(' '))
  if (ingTokens.size === 0) return [] // nothing to judge against; the count gate handles empties

  // The same token set with flavouring lines removed, used only for MEAT_LIKE foods.
  // When the DISH NAME itself says broth or stock ("Chicken Broth Ramen", "Beef Stock Pho"), the
  // creator is naming the flavouring on purpose and the plain set is the right one to judge by —
  // otherwise this would invent a gap in the one case where a broth genuinely is the dish.
  const substantive = MEAT_DERIVATIVE.test(name)
    ? ingTokens
    : tokens(lines.filter(l => !MEAT_DERIVATIVE.test(l)).join(' '))

  const gaps: string[] = []
  for (const food of DEFINING_FOODS) {
    const stem = singular(food)
    if (!nameTokens.has(stem)) continue
    const pool = MEAT_LIKE.has(stem) ? substantive : ingTokens
    if (pool.has(stem)) continue
    if ((SYNONYMS[food] ?? []).some(alt => pool.has(singular(alt)))) continue
    gaps.push(food)
  }
  return gaps
}

/**
 * The list used for the retention COUNT: junk removed and duplicates collapsed.
 *
 * Duplicates are not merely untidy here, they are mechanically load-bearing. The gate asks whether
 * the model kept at least as many ingredients as the parser found, so listing "olive oil spray" or
 * "garlic powder" twice buys a free point toward that threshold. Seven meals in the live pool carry
 * a repeated ingredient.
 *
 * Only the count is deduplicated. What gets STORED keeps its duplicates, because "1 egg for the
 * batter, 1 egg for the wash" is a real thing a recipe says and collapsing it would change the
 * quantities a cook follows.
 */
export function countedIngredients(ingredients: any[] | undefined): any[] {
  const seen = new Set<string>()
  const out: any[] = []
  for (const i of realIngredients(ingredients)) {
    const key = String((typeof i === 'string' ? i : i?.name) ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(i)
  }
  return out
}

// ── Fractional discrete items ────────────────────────────────────────────────────────────────
//
// A recipe asking for half an egg was not written that way; it was SCALED, and scaling a batch to
// match per-serving macros is the failure that produced a stored cheesecake calling for
// "0.5 large eggs" and "0.25 scoop".
//
// Lives here, exported and tested, because the version that lived inside the pipeline was DEAD for
// 19 days and nothing noticed. Its source contained a literal backspace byte (0x08) inside a
// String.raw template — `String.raw`s?\x08`` — so the compiled regex demanded a backspace
// character after the item name and could never match anything. Invisible in an editor, invisible
// in review, and invisible in a diff. An untested gate is indistinguishable from no gate.
//
// DECIMALS ONLY, and that is measured rather than assumed. The failure mode is ARITHMETIC — a model
// dividing a batch emits 0.5 and 0.25 — while a human writing a recipe uses "1/2" and "½". Over the
// 161-row live pool the fraction-accepting version would have rejected three recipes, all of them
// legitimate ("1/2 can corn", "1/2 packet jello powder", "1/4 sliced onion"), and caught nothing
// real. The decimal version rejects none of them and still catches "0.5 large eggs".
//
// The item list already excludes onion, clove and scoop: a quarter onion and half a scoop are
// things people genuinely measure, and including them cost 10+ false positives in an earlier audit.
const INDIVISIBLE_ITEM = "(egg|slice|can|bar|tortilla|bun|packet|container|bottle|patty|link|cookie|muffin|fillet|breast|thigh)"
// A decimal followed by a UNIT is a weight, not a scaled count: "1.5 lb chicken breast" is how
// anyone writes one and a half pounds of chicken, and it was the only false positive left over the
// live pool. "0.5 large eggs" has no unit, which is exactly what makes it a scaling artefact.
const MEASURE_UNIT = String.raw`(?:lbs?|pounds?|kgs?|kilos?|kilograms?|g|grams?|oz|ounces?|ml|l|liters?|litres?|cups?|tbsps?|tsps?|tablespoons?|teaspoons?|quarts?|pints?)\b`
const FRACTIONAL_INDIVISIBLE = new RegExp(
  String.raw`(?<![\d/.])(?:0?\.\d+|\d+\.\d+)\s*(?!` + MEASURE_UNIT + String.raw`)(?:[a-z-]+\s+){0,2}` + INDIVISIBLE_ITEM + String.raw`s?`,
  'i',
)

/** The offending text when a recipe asks for a fractional count of a discrete item, else null. */
export function hasFractionalIndivisible(ingredients: any[] | undefined): string | null {
  for (const ing of ingredients ?? []) {
    if (typeof ing === 'string') {
      if (FRACTIONAL_INDIVISIBLE.test(ing)) return ing.trim()
      continue
    }
    const visual = String(ing?.visual ?? '')
    const grams = String(ing?.grams ?? '')
    const name = String(ing?.name ?? '')
    // Each field pairing is tested SEPARATELY rather than concatenating all three. The stored
    // cheesecake this gate exists for is {visual:"0.5 large", grams:"25g", name:"eggs"}, and
    // "0.5 large 25g eggs" does not match: the pattern allows two adjective words between the
    // number and the item, and "25g" is neither an adjective nor the item. So the one-string form
    // missed the very example it was written for, on top of being inert. Pairing visual with name
    // reads it as "0.5 large eggs", which is what the creator's line actually says.
    for (const text of [`${visual} ${name}`, `${grams} ${name}`, `${visual} ${grams} ${name}`]) {
      if (FRACTIONAL_INDIVISIBLE.test(text)) return text.trim()
    }
  }
  return null
}

// ── Untranslated output ──────────────────────────────────────────────────────────────────────
//
// English recipe writing is built out of modifiers, units and connectives that appear whatever the
// cuisine: "soaked chana dal", "boiled Kala chana", "dry red chillies". A list carried through in
// its source language has none of them: "serek wiejski wysokobiałkowy", "Haferflocken",
// "pechuga de pollo".
//
// Two detectors were measured against the live pool and REJECTED before landing on this one:
//   * Food-table coverage (does macro-estimate recognise the ingredients). It does not separate:
//     the lowest scorers are English-language INDIAN recipes — "Lauki Galouti Kebab" scored 0.00,
//     the same as a Polish list — because the table is Western-biased. It would have deleted a
//     whole cuisine.
//   * Marker words alone. Every foreign fixture scored 0.00, but so did one genuine English meal
//     whose ingredients are all brand nouns ("Quest Salted Caramel Milkshake, Xanthan Gum, Monk
//     Fruit Sweetener, Honey"). One false positive in 159 is too many when the penalty is deleting
//     real food.
//
// So this check is never used on its own. The caller runs it ONLY when YouTube's own
// defaultAudioLanguage says the source is not English — an authoritative signal the pipeline was
// already fetching and discarding. Two independent signals must agree before anything is dropped.
const ENGLISH_MARKERS = new Set((
  'fresh dried chopped sliced diced minced ground grated shredded crushed whole halved cubed ' +
  'roasted boiled cooked raw baked frozen canned drained rinsed soaked toasted melted softened beaten ' +
  'large small medium extra light heavy low high full reduced fat free sugar plain unsweetened sweetened ' +
  'powder powdered seeds seed leaves leaf sauce oil water milk juice syrup butter cheese cream yogurt yoghurt ' +
  'flour protein whey bread rice pasta noodles chicken beef pork egg eggs salt pepper spray stock broth paste ' +
  'of with and or for to taste optional plus about into cut skinless boneless nonfat non slices pinch clove cloves ' +
  'tbsp tsp cup cups oz lb kg ml teaspoon tablespoon ounce pound gram grams'
).split(' '))

/**
 * True when an ingredient list shows no sign of having been written in English.
 *
 * Only meaningful for a source already known to be non-English — on its own it misfires on
 * brand-only lists. See the note above.
 */
export function looksUntranslated(ingredients: any[] | undefined): boolean {
  const names = realIngredients(ingredients)
    .map(i => String((typeof i === 'string' ? i : i?.name) ?? '').trim())
    .filter(Boolean)
  if (names.length === 0) return false // nothing to judge; other gates handle empties
  return !names.some(n =>
    (n.toLowerCase().match(/[a-z]+/g) ?? []).some(t => ENGLISH_MARKERS.has(t))
  )
}

/** True when YouTube reports a source language that is not English. Absent metadata is NOT foreign. */
export function isNonEnglishSource(lang: string | null | undefined): boolean {
  const l = String(lang ?? '').trim().toLowerCase()
  if (!l) return false            // most videos omit it — absence is not evidence
  return !l.startsWith('en')      // en, en-US, en-GB all pass
}
