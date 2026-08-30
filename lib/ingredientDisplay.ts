// Ingredient display helpers for the recipe screen.
//
// Extracted from app/meal/[id].tsx so they can be unit-tested. Every function here is pure
// string/number work over model-written ingredient data, and none of it had a test until two real
// bugs turned up in one afternoon: "7 liquid whites eggs" — a count unit invented for a liquid,
// which made accurate macros look inflated — and "3 garlic garlic cloves". Both lived in
// getWholeUnitDisplay; the rest had never been exercised at all.


// Modifier words that should follow the food noun, not precede it. AI
// occasionally inverts the phrase ("juice lemon" instead of "lemon juice")
// — this set drives the swap below.
const POST_MODIFIERS = new Set([
  'juice', 'zest', 'powder', 'paste', 'sauce', 'extract', 'puree', 'oil',
])

export function cleanIngredientName(name: string): string {
  const cleaned = name
    .replace(/\s*\*\s*$/, '')          // strip trailing asterisk
    .replace(/^\d+[\s/.-]*/g, '')       // strip leading numbers ("4 eggs" → "eggs")
    .replace(/^[\d½¼¾⅓⅔]+\s*/g, '')   // strip unicode fractions
    .trim()

  // Swap inverted modifier phrases: "juice lemon" → "lemon juice",
  // "zest orange" → "orange zest", "extract vanilla" → "vanilla extract".
  // Only acts on 2-word phrases where word[0] is a known post-modifier.
  const parts = cleaned.split(/\s+/)
  if (parts.length === 2 && POST_MODIFIERS.has(parts[0].toLowerCase())) {
    return `${parts[1]} ${parts[0]}`
  }
  return cleaned
}

export function isNeedToBuy(name: string): boolean {
  return name.trim().endsWith('*')
}

// Strip cooking adjectives for better matching
const COOKING_ADJECTIVES = ['grilled', 'baked', 'fried', 'roasted', 'steamed', 'sauteed', 'sautéed', 'boiled', 'raw', 'fresh', 'dried', 'diced', 'chopped', 'sliced', 'minced', 'shredded', 'cooked', 'uncooked', 'whole', 'boneless', 'skinless']

// Foods that should display as a whole-unit COUNT rather than grams.
// Recipe scaling produces awkward weights ("233g eggs" = 4.66 eggs) — this
// converts them back to natural cooking units. Weights from USDA averages.
// Regex matches the food noun (singular/plural) so adjectives in the source
// name ("large eggs", "ripe avocado") survive and can be rendered alongside.
const WHOLE_UNIT_FOODS: Array<{ match: RegExp; weight: number; singular: string; plural: string }> = [
  { match: /\beggs?\b/i,            weight: 50,  singular: 'egg',         plural: 'eggs' },
  { match: /\bbananas?\b/i,         weight: 120, singular: 'banana',      plural: 'bananas' },
  { match: /\bapples?\b/i,          weight: 180, singular: 'apple',       plural: 'apples' },
  { match: /\blemons?\b/i,          weight: 60,  singular: 'lemon',       plural: 'lemons' },
  { match: /\blimes?\b/i,           weight: 67,  singular: 'lime',        plural: 'limes' },
  { match: /\bavocados?\b/i,        weight: 200, singular: 'avocado',     plural: 'avocados' },
  { match: /\bcloves?\b/i,          weight: 5,   singular: 'garlic clove', plural: 'garlic cloves' },
  { match: /\btortillas?\b/i,       weight: 60,  singular: 'tortilla',    plural: 'tortillas' },
  // Protein fillets — typical home portion is one fillet/breast/chop. Without
  // these entries the AI's visual (e.g. "1 small fillet") gets rendered next
  // to the name ("salmon fillet"), producing "1 small fillet salmon fillet".
  // Order: more-specific patterns first (so "salmon fillet" wins over "salmon").
  { match: /\bsalmon\s*fillets?\b/i,    weight: 150, singular: 'salmon fillet',    plural: 'salmon fillets' },
  { match: /\bcod\s*fillets?\b/i,       weight: 140, singular: 'cod fillet',       plural: 'cod fillets' },
  { match: /\btilapia\s*fillets?\b/i,   weight: 120, singular: 'tilapia fillet',   plural: 'tilapia fillets' },
  { match: /\bhalibut\s*fillets?\b/i,   weight: 150, singular: 'halibut fillet',   plural: 'halibut fillets' },
  { match: /\btrout\s*fillets?\b/i,     weight: 140, singular: 'trout fillet',     plural: 'trout fillets' },
  { match: /\bchicken\s*breasts?\b/i,   weight: 170, singular: 'chicken breast',   plural: 'chicken breasts' },
  { match: /\bchicken\s*thighs?\b/i,    weight: 110, singular: 'chicken thigh',    plural: 'chicken thighs' },
  { match: /\bpork\s*chops?\b/i,        weight: 175, singular: 'pork chop',        plural: 'pork chops' },
  { match: /\blamb\s*chops?\b/i,        weight: 90,  singular: 'lamb chop',        plural: 'lamb chops' },
  // Generic catchall — runs LAST so the specific ones above take precedence.
  { match: /\bfillets?\b/i,             weight: 150, singular: 'fillet',           plural: 'fillets' },
]

// Returns { count, name } when the ingredient is a whole-unit food (so the
// render can show "5" + "large eggs" without doubling up the noun), or null
// to fall back to the standard portion + ing.name pair.
export function getWholeUnitDisplay(name: string, gramsStr: string | undefined): { count: string; name: string } | null {
  if (!gramsStr) return null
  const grams = parseFloat(String(gramsStr).replace(/[^0-9.]/g, '')) || 0
  if (grams <= 0) return null

  // Special case: bread. Unit ("slice") differs from food ("bread") so the
  // standard "{adj} {noun}" format produces awkward word order. Render as
  // "3 slices of whole grain bread" instead.
  if (/\bbread\b/i.test(name)) {
    const c = Math.max(1, Math.round(grams / 30))
    const adj = name.replace(/\bbread\b/i, '').trim().replace(/\s+/g, ' ')
    const unit = c === 1 ? 'slice' : 'slices'
    return {
      count: String(c),
      name: adj ? `${unit} of ${adj} bread` : `${unit} of bread`,
    }
  }

  // Processed forms are bought and used by weight/volume even though the name still contains a
  // whole-unit noun. "liquid egg whites" is not seven eggs, and dividing its grams by 50 invents
  // a count that is simply wrong.
  if (/\b(liquid|carton|substitute|powdered|beaten)\b/i.test(name)) return null

  const match = WHOLE_UNIT_FOODS.find(w => w.match.test(name))
  if (!match) return null
  // Only rebuild as "{adj} {noun}" when the matched noun ENDS the name. Pulling it out of the
  // middle reorders the phrase — stripping "egg" from "liquid egg whites" leaves "liquid whites",
  // which then had "eggs" appended and shipped as "7 liquid whites eggs".
  if (!new RegExp(`${match.match.source}\\s*$`, 'i').test(name.trim())) return null
  const c = Math.max(1, Math.round(grams / match.weight))
  const noun = c === 1 ? match.singular : match.plural
  // Strip the matched noun (e.g., "eggs") from the original name to get the
  // adjective ("large"). If the noun match consumed the whole name, just show
  // the noun by itself ("3 garlic cloves" with name="cloves" → name has no adj).
  const adj = name.replace(match.match, '').trim().replace(/\s+/g, ' ')
  // The label can already carry the adjective — "cloves" maps to "garlic cloves", so a name of
  // "garlic cloves" leaves adj="garlic" and rendered "3 garlic garlic cloves".
  const showAdj = adj && !noun.toLowerCase().includes(adj.toLowerCase())
  return {
    count: String(c),
    name: showAdj ? `${adj} ${noun}` : noun,
  }
}

// Round grams to nearest 5 once we're above 20g. 44g→45g, 58g→60g — keeps
// the displayed number psychologically "clean" without distorting recipe
// accuracy on small doses (spices, supplements, etc. stay exact).
export function roundDisplayGrams(grams: number): number {
  if (grams >= 20) return Math.round(grams / 5) * 5
  return Math.round(grams)
}

// Format a half-step number as a Unicode fraction. 1 → "1", 1.5 → "1½",
// 0.5 → "½". Unicode fractions read like printed cookbook copy and take
// less horizontal space than "1 1/2" (which looks like a typo at small sizes).
export function formatHalf(n: number): string {
  // Snap to the nearest HALF first. The original floored and only special-cased an exact half, so
  // 3.83 scoops rendered as "3" — nearly a full scoop understated on a protein dose — and any
  // value under 1 that was not ~0.5 fell through to `whole || Math.round(n)` and printed "0".
  if (!Number.isFinite(n) || n <= 0) return '0'
  // Floor at a half: a real quantity must never round away to nothing.
  const snapped = Math.max(0.5, Math.round(n * 2) / 2)
  const whole = Math.floor(snapped)
  const hasHalf = snapped - whole === 0.5
  if (hasHalf) return whole === 0 ? '½' : `${whole}½`
  return String(whole)
}

// Whey/casein/plant protein universally scooped, not measured in tbsp or
// weighed at home. One scoop ≈ 30g across major brands (5-10% variance is
// fine — close-enough for the user's mental model).
export function gramsToProteinScoops(grams: number): string {
  const scoops = grams / 30
  if (scoops <= 0.4)  return '¼ scoop'
  if (scoops <= 0.6)  return '½ scoop'
  if (scoops <= 0.85) return '¾ scoop'
  if (scoops <= 1.25) return '1 scoop'
  if (scoops <= 1.75) return '1½ scoops'
  if (scoops <= 2.25) return '2 scoops'
  if (scoops <= 2.75) return '2½ scoops'
  return `${formatHalf(scoops)} scoops`
}

// Seeds (chia, flax, hemp, sesame) are sprinkled, not weighed. Chia is
// ~4g/tsp, finer/lighter seeds ~3g/tsp. Numbers from common baking refs.
export function gramsToSeedsSpoons(name: string, grams: number): string {
  const gPerTsp = /\bchia\b/i.test(name) ? 4 : 3
  const tsp = grams / gPerTsp
  if (tsp <= 0.37) return '¼ tsp'
  if (tsp <= 0.62) return '½ tsp'
  if (tsp <= 0.87) return '¾ tsp'
  if (tsp <= 1.25) return '1 tsp'
  if (tsp <= 1.75) return '1½ tsp'
  if (tsp <= 2.5)  return '2 tsp'
  if (tsp <= 3.5)  return '1 tbsp'
  if (tsp <= 5)    return '1½ tbsp'
  if (tsp <= 7)    return '2 tbsp'
  return `${formatHalf(tsp / 3)} tbsp`
}

// Approximate g/tsp for powdered spices (paprika, cumin, etc.). Salt is denser
// (~6g/tsp) and gets a special case. Good enough for cooking; not lab-grade.
export function gramsToSpiceTsp(name: string, grams: number): string {
  const gPerTsp = /\bsalt\b/i.test(name) ? 6 : 2
  const tsp = grams / gPerTsp
  if (tsp <= 0.18) return '⅛ tsp'
  if (tsp <= 0.37) return '¼ tsp'
  if (tsp <= 0.62) return '½ tsp'
  if (tsp <= 0.87) return '¾ tsp'
  if (tsp <= 1.25) return '1 tsp'
  if (tsp <= 1.75) return '1½ tsp'
  if (tsp <= 2.5)  return '2 tsp'
  if (tsp <= 3.5)  return '1 tbsp'
  return `${formatHalf(tsp / 3)} tbsp`
}

// For Measured mode: oils, sauces, seasonings, spices etc. are universally
// measured in tbsp/tsp/cups, not grams. Resolution order:
//   1. Protein powder → scoops (always override; AI tends to spit out tbsp here)
//   2. Seeds (chia/flax/hemp) → tsp/tbsp from grams
//   3. Liquid or seasoning visual that already has a real unit → use visual
//   4. Seasoning without a usable visual → convert grams to tsp
//   5. Plain grams — rounded to nearest 5 above 20g for "psychologically clean" numbers
export function getMeasuredDisplay(name: string, gramsStr: string | undefined, visualStr: string | undefined): string {
  const n = name.toLowerCase()
  const isLiquid = /\b(oil|vinegar|sauce|dressing|honey|syrup|extract|juice|milk|broth|stock|wine|tahini|mayo|mustard|cream)\b/.test(n)
  const isSeasoning = /\b(salt|pepper|paprika|cumin|cinnamon|turmeric|oregano|thyme|basil|rosemary|parsley|cilantro|dill|chili|spice|powder|seasoning|flakes?|herbs?|sweetener|stevia|sugar)\b/.test(n)
  const isProteinPowder = /\b(whey|casein|protein\s*powder|plant\s*protein)\b/i.test(n)
  const isSeeds = /\b(chia|flax|hemp|sesame)\b/i.test(n) && /\bseeds?\b/i.test(n)

  // Whey/casein/protein powder → scoops, always. Most users never measure
  // protein in tbsp or grams — the scoop comes with the tub.
  if (isProteinPowder) {
    if (gramsStr) {
      const grams = parseFloat(String(gramsStr).replace(/[^0-9.]/g, '')) || 0
      if (grams > 0) return gramsToProteinScoops(grams)
    }
    // If AI gave "X tbsp" without grams, approximate: ~3 tbsp ≈ 1 scoop (~10g/tbsp dry).
    if (visualStr) {
      const tbspMatch = visualStr.match(/(\d+(?:\.\d+)?)\s*tbsp/i)
      if (tbspMatch) return gramsToProteinScoops(parseFloat(tbspMatch[1]) * 10)
    }
  }

  // Seeds (chia, flax, hemp, sesame) → tsp/tbsp. Sprinkled, not weighed.
  if (isSeeds && gramsStr) {
    const grams = parseFloat(String(gramsStr).replace(/[^0-9.]/g, '')) || 0
    if (grams > 0) return gramsToSeedsSpoons(name, grams)
  }

  // Tier 1: prefer template visual if it has a real measurement unit
  // (NOT "pinch"/"dash" — those are descriptors that belong in Eyeball).
  if ((isLiquid || isSeasoning) && visualStr && /(tbsp|tablespoons?|tsp|teaspoons?|cups?|ml|oz|ounces?)/i.test(visualStr)) {
    return visualStr
  }

  // Tier 2: seasoning fell through tier 1 (template likely has "a pinch" or
  // similar). Compute a tsp/tbsp from grams so Measured stays measurement-y.
  if (isSeasoning && gramsStr) {
    const grams = parseFloat(String(gramsStr).replace(/[^0-9.]/g, '')) || 0
    if (grams > 0) return gramsToSpiceTsp(name, grams)
  }

  // Tier 3: plain grams — round to nearest 5 above 20g (44→45, 58→60) so the
  // displayed number reads "clean." Strict ###g format only; anything more
  // exotic falls through to the raw visual/grams string unchanged.
  if (gramsStr && /^\d+(\.\d+)?\s*g$/i.test(gramsStr)) {
    const grams = parseFloat(gramsStr) || 0
    if (grams > 0) return `${roundDisplayGrams(grams)}g`
  }

  return gramsStr || visualStr || ''
}

// Eyeball mode: convert measurement-unit visuals (1 tbsp, 1/2 cup) into
// no-tool descriptors based on what the ingredient is. Eggs/avocado/etc.
// are handled by getWholeUnitDisplay above; this covers everything else.
// Imperfect — a runtime heuristic, not human-curated copy — but enough that
// "Eyeball" mode doesn't tell users to pull out a measuring spoon.
export function toEyeball(visualStr: string | undefined, ingredientName: string): string {
  if (!visualStr) return ''
  const v = visualStr.trim()
  const n = ingredientName.toLowerCase()

  // Already no-tool — counts of slices, cloves, pieces, etc.
  if (/^\d+(\.\d+)?\s*(slices?|cloves?|pieces?|sticks?|stalks?|sprigs?|leaves?|cubes?|wedges?)/i.test(v)) return v
  // "small/medium/large X" — already descriptive
  if (/^(a|an|small|medium|large|big|tiny)\b/i.test(v)) return v

  // tablespoons
  if (/\btbsp\b|\btablespoons?\b/i.test(v)) {
    if (/oil|honey|syrup|sauce|dressing|vinegar|juice|milk|cream/.test(n)) return 'a drizzle'
    if (/salt|pepper|cinnamon|paprika|cumin|turmeric|spice|seasoning/.test(n)) return 'a pinch'
    if (/butter|jam|tahini|hummus|pesto|mayo|mustard|peanut butter/.test(n)) return 'a dollop'
    if (/seeds|nuts|chia|flax/.test(n)) return 'a sprinkle'
    if (/sugar|sweetener|maple/.test(n)) return 'a small drizzle'
    return 'a small spoonful'
  }

  // teaspoons
  if (/\btsp\b|\bteaspoons?\b/i.test(v)) {
    if (/salt|pepper|cinnamon|paprika|cumin|turmeric|spice|seasoning|powder/.test(n)) return 'a pinch'
    if (/extract|vanilla/.test(n)) return 'a tiny splash'
    if (/oil|honey|syrup|sauce/.test(n)) return 'a small drizzle'
    return 'a tiny spoonful'
  }

  // cups
  if (/\bcups?\b|\bcup\b/i.test(v)) {
    if (/spinach|kale|lettuce|arugula|greens|herbs?|cilantro|parsley|basil/.test(n)) return 'a couple of handfuls'
    if (/rice|quinoa|pasta|noodle|grain|oats?|couscous/.test(n)) return 'a fist-sized portion'
    if (/yogurt|cottage cheese/.test(n)) return 'a generous scoop'
    if (/berries|fruit|grapes/.test(n)) return 'a big handful'
    if (/milk|broth|water|stock|juice/.test(n)) return 'a small glass'
    if (/cheese|nuts/.test(n)) return 'a handful'
    if (/beans|chickpeas|lentils/.test(n)) return 'a cupped handful'
    return 'a cupped handful'
  }

  // ounces (occasional in templates)
  if (/\boz\b|\bounces?\b/i.test(v)) {
    if (/chicken|beef|turkey|pork|salmon|tuna|cod|fish|tofu|tempeh/.test(n)) return 'palm-sized piece'
    return 'a small handful'
  }

  // raw grams — convert to body-part metaphor by ingredient type
  const grams = parseFloat(v) || 0
  if (grams > 0 && /^\d+(\.\d+)?\s*g\b/i.test(v)) {
    if (/chicken|beef|turkey|pork|salmon|tuna|cod|fish|tofu|tempeh|lamb|shrimp|scallop/.test(n)) {
      return grams < 150 ? 'small palm-sized piece' : grams > 220 ? 'large palm-sized piece' : 'palm-sized piece'
    }
    if (/rice|quinoa|pasta|noodle|grain|oats?|couscous/.test(n)) return 'a fist-sized portion'
    if (/spinach|kale|lettuce|arugula|greens|herbs?/.test(n)) return grams < 50 ? 'a small handful' : 'a couple of handfuls'
    if (/cheese|nuts|seeds/.test(n)) return 'a small handful'
    if (/berries|fruit/.test(n)) return 'a handful'
    if (/oil|butter|honey|syrup/.test(n)) return 'a drizzle'
  }

  // Fallback: leave as-is. Better than producing nonsense.
  return v
}

export function stripAdjectives(name: string): string {
  let result = name.toLowerCase()
  for (const adj of COOKING_ADJECTIVES) {
    result = result.replace(new RegExp(`\\b${adj}\\b`, 'g'), '').trim()
  }
  return result.replace(/\s+/g, ' ').trim()
}

// Check if an item is already covered by existing names
export function isAlreadyInList(itemName: string, existingNames: Set<string>): boolean {
  const lower = cleanIngredientName(itemName).toLowerCase()
  const stripped = stripAdjectives(lower)
  for (const existing of existingNames) {
    if (lower === existing || stripped === existing) return true
    if (lower.includes(existing) || existing.includes(lower)) return true
    if (stripped.includes(existing) || existing.includes(stripped)) return true
  }
  return false
}

// Strips creator-pasted leading numbers ("1.", "01)", "Step 1:") so they don't double up with the rendered step badge.
export function stripStepNumber(text: string): string {
  return text
    .replace(/^step\s*\d+\s*[:.)]?\s*/i, '')
    .replace(/^\d+\s*[.):\-]+\s*/, '')
    .trim()
}
