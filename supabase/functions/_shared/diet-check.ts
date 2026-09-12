// Does a generated meal break a restriction the user declared?
//
// This is the one rule in the pipeline where the cost of being wrong is not a bad dinner. The sweep
// across pantries the generator was never tuned on (2026-09-12) served soy sauce and sourdough to a
// gluten-free profile, feta and butter to a dairy-free one, and pecans TWICE to a nut-free one — 6
// violations in 102 meals. Restrictions were prompt-only, and a prompt is a request.
//
// So it is checked in code and the drop is NEVER floored. Every other gate in generate-meals gives
// way rather than show a short deck; this one does not. An empty screen is a bad session. An
// allergen is a hospital visit, and "we asked the model nicely" is not a defence.
//
// The app can produce exactly these: diet style Pescatarian / Vegetarian / Vegan (profiles.diet_type)
// and allergies Dairy-free / Gluten-free / Nut-free / Shellfish-free (profiles.dietary_restrictions).
// Synonyms are normalised so a hand-typed "no dairy" still binds.

type Rule = { forbidden: RegExp; allowed?: RegExp }

// Plant milks, vegan cheese and nut/seed butters are not dairy. Checked BEFORE the forbidden
// pattern, per ingredient line, so "oat milk" and "peanut butter" survive a dairy-free diet.
const DAIRY_OK = /\b(oat|almond|soy|soya|coconut|cashew|hemp|pea|rice|plant|non[- ]?dairy|dairy[- ]?free|vegan|peanut|sun(flower)?|seed|apple|cocoa|shea|granola|nut)\b/i
const DAIRY = /\b(milk|cream|creamer|butter|cheese|cheddar|mozzarella|parmesan|parmigiano|feta|ricotta|halloumi|mascarpone|brie|gouda|yogurt|yoghurt|ghee|whey|casein|custard|ice cream|half[- ]and[- ]half)\b/i

// Naturally gluten-free grains and the labelled versions. Oats are NOT forbidden — they are
// naturally gluten-free (celiac.org); the risk is cross-contamination, which a pantry label solves
// and a recipe generator cannot. Soy sauce IS forbidden: standard soy sauce is brewed with wheat,
// which is the exact trap this sweep caught. Tamari is the allowed swap.
const GLUTEN_OK = /\b(gluten[- ]?free|\bgf\b|tamari|coconut aminos|rice (noodles?|paper|flour|cakes?)|corn (tortillas?|flour)|almond flour|coconut flour|chickpea (flour|pasta)|buckwheat|quinoa|polenta|grits)\b/i
const GLUTEN = /\b(wheat|flour|bread|breadcrumbs|panko|croutons?|toast|sourdough|bagels?|baguette|brioche|croissant|pasta|spaghetti|penne|macaroni|fusilli|rigatoni|linguine|orzo|lasagne?a|noodles?|udon|ramen|couscous|barley|rye|bulgur|farro|semolina|seitan|crackers?|pita|naan|tortillas?|pretzels?|beer|malt|soy sauce|hoisin|teriyaki)\b/i

// \bnut\b never matches nutmeg, butternut, coconut or nutritional yeast — all one word.
const NUTS = /\b(almonds?|cashews?|pecans?|walnuts?|pistachios?|hazelnuts?|macadamias?|brazil nuts?|pine nuts?|peanuts?|nuts?|nut butter|peanut butter|almond butter|marzipan|praline|nutella|tahini)\b/i
const SHELLFISH = /\b(shrimps?|prawns?|crab|lobster|crayfish|scallops?|clams?|mussels?|oysters?|squid|calamari|octopus|krill|oyster sauce)\b/i
const MEAT = /\b(chicken|beef|pork|bacon|ham|prosciutto|salami|pepperoni|chorizo|turkey|lamb|veal|duck|steak|mince|sausages?|gelatin[e]?|lard|tallow|suet|bone broth|chicken (stock|broth|salad)|beef (stock|broth))\b/i
const FISH = /\b(salmon|tuna|cod|tilapia|halibut|haddock|sardines?|anchov(y|ies)|mackerel|trout|fish|fish sauce)\b/i
const EGG = /\b(eggs?|egg whites?|egg yolks?|mayonnaise|mayo|meringue|aioli)\b/i
const HONEY = /\b(honey)\b/i

const RULES: Record<string, Rule> = {
  'dairy-free': { forbidden: DAIRY, allowed: DAIRY_OK },
  'gluten-free': { forbidden: GLUTEN, allowed: GLUTEN_OK },
  'nut-free': { forbidden: NUTS },
  'shellfish-free': { forbidden: SHELLFISH },
  pescatarian: { forbidden: MEAT },
  vegetarian: { forbidden: new RegExp(`${MEAT.source}|${FISH.source}|${SHELLFISH.source}`, 'i') },
  vegan: {
    forbidden: new RegExp(`${MEAT.source}|${FISH.source}|${SHELLFISH.source}|${DAIRY.source}|${EGG.source}|${HONEY.source}`, 'i'),
    allowed: DAIRY_OK,
  },
}

/** "Dairy Free", "no dairy", "Vegetarian " → the key this module knows. Unknown labels bind nothing. */
export function normaliseRestriction(raw: unknown): string | null {
  const s = String(raw ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
  if (!s || s === 'none' || s === 'classic') return null
  const norm = s.replace(/^no /, '').replace(/\s/g, '-').replace(/-+/g, '-')
  const direct = norm.endsWith('-free') ? norm : `${norm}-free`
  if (RULES[norm]) return norm                  // vegetarian, vegan, pescatarian
  if (RULES[direct]) return direct              // dairy / "no dairy" / dairy-free
  return null
}

export type DietViolation = { restriction: string; ingredients: string[] }

/**
 * Every declared restriction this meal breaks, with the ingredient lines that break it.
 * Reads the INGREDIENTS: the prompt already requires every item named in a step to appear there,
 * and the ghost-ingredient gate enforces it, so the list is the whole recipe.
 */
export function dietViolations(
  meal: { ingredients?: unknown } | null | undefined,
  restrictions: readonly unknown[] = [],
): DietViolation[] {
  const lines = (Array.isArray(meal?.ingredients) ? meal!.ingredients as unknown[] : [])
    .map(i => String((i as any)?.name ?? i ?? '').trim())
    .filter(Boolean)
  if (lines.length === 0) return []
  const out: DietViolation[] = []
  const seen = new Set<string>()
  for (const raw of restrictions) {
    const key = normaliseRestriction(raw)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const rule = RULES[key]
    const bad = lines.filter(l => rule.forbidden.test(l) && !(rule.allowed?.test(l) ?? false))
    if (bad.length) out.push({ restriction: key, ingredients: bad })
  }
  return out
}
