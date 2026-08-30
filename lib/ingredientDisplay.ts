import { isAssumedStaple } from '../constants/staples.ts'

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
    // Requires a SEPARATOR after the number. The old /^\d+[\s\/.-]*/ matched the bare digit, so
    // "2% milk" became "% milk" and "100% whey protein" became "% whey protein".
    .replace(/^\d+(?:[./]\d+)?\s+/, '')  // strip a leading quantity ("4 eggs" -> "eggs", "1/2 cup x" -> "cup x")
    // Unicode fractions only. This character class used to include \d, so it re-stripped the bare
    // digit the rule above deliberately left alone — which is what turned "2% milk" into "% milk".
    .replace(/^\d*[½¼¾⅓⅔]+\s*/, '')   // strip unicode fractions ("½ avocado", "1½ cups")
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
  // Must name garlic, or be the bare word. A plain /\bcloves?\b/ also caught the SPICE — "ground
  // cloves" rendered as "1 ground garlic clove" instead of a couple of grams of a powdered spice.
  { match: /\bgarlic\s+cloves?\b|^\s*cloves?\s*$/i, weight: 3, singular: 'garlic clove', plural: 'garlic cloves' },
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
  { match: /\bchicken\s*breasts?\b/i,   weight: 190, singular: 'chicken breast',   plural: 'chicken breasts' },
  { match: /\bchicken\s*thighs?\b/i,    weight: 110, singular: 'chicken thigh',    plural: 'chicken thighs' },
  { match: /\bpork\s*chops?\b/i,        weight: 175, singular: 'pork chop',        plural: 'pork chops' },
  { match: /\blamb\s*chops?\b/i,        weight: 90,  singular: 'lamb chop',        plural: 'lamb chops' },
  // Generic catchall — runs LAST so the specific ones above take precedence.
  { match: /\bfillets?\b/i,             weight: 150, singular: 'fillet',           plural: 'fillets' },
]

// Units that make a leading number a WEIGHT rather than a count. "2 lbs" of chicken starts with a
// digit but is not two chicken breasts, and reading it as one is a 3x understatement.
const WEIGHT_UNIT_START = /^(lbs?|pounds?|kgs?|kilos?|kilograms?|g|grams?|oz|ounces?|ml|l|liters?|litres?|cups?|tbsps?|tsps?|tablespoons?|teaspoons?|quarts?|pints?)\b/i

// The count the creator actually wrote, when the visual states one ("6 pieces", "7 cloves", "12").
// A range ("4-5") takes the low end. Returns null when the visual is a weight or states no number.
function statedCount(visual: string | undefined): number | null {
  const m = String(visual ?? '').match(/^\s*(\d+(?:\.\d+)?)\s*(.*)$/)
  if (!m || WEIGHT_UNIT_START.test(m[2])) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : null
}

// Returns { count, name } when the ingredient is a whole-unit food (so the
// render can show "5" + "large eggs" without doubling up the noun), or null
// to fall back to the standard portion + ing.name pair.
export function getWholeUnitDisplay(name: string, gramsStr: string | undefined, visual?: string): { count: string; name: string } | null {
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
  // Grouped: an alternation in the row's pattern would otherwise let `$` bind to only the last
  // branch, silently disabling this guard.
  if (!new RegExp(`(?:${match.match.source})\\s*$`, 'i').test(name.trim())) return null
  // The creator's OWN count beats grams/weight whenever they stated one. The weights above are
  // population averages and the real food varies enormously — chicken breasts across the live pool
  // run 142-300g each — so deriving the count from grams contradicted the creator on 10 of the 79
  // live rows that state one: "6 pieces" of chicken (900g) rendered as "5", and "7 cloves" of
  // garlic (20g) as "4". `visual` is the closer of the two fields to what the creator wrote;
  // `grams` is the model's estimate derived FROM it.
  const stated = statedCount(visual)
  // Below ~40% of one unit this is not a whole-unit quantity at all — Math.max(1, ...) turned 5g
  // of egg into "1 egg", a 10x overstatement. Fall through to grams instead. Only guards the
  // DERIVED path: a stated count is the creator's own number and needs no sanity band.
  if (stated === null && grams < match.weight * 0.4) return null
  const c = stated ?? Math.max(1, Math.round(grams / match.weight))
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

// Like formatHalf but on quarter steps. Halves are too coarse for volume measures — a cup snapped
// to the nearest half is off by up to 60 ml, which is a visible amount of milk. Used for scaling
// template "visual" quantities, where ¼/¾ cup are real amounts the source recipes already use.
export function formatQuarter(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  // Floor at a quarter for the same reason formatHalf floors at a half: a real quantity must
  // never round away to nothing.
  const snapped = Math.max(0.25, Math.round(n * 4) / 4)
  const whole = Math.floor(snapped)
  const frac = snapped - whole
  const glyph = frac === 0.25 ? '\u00BC' : frac === 0.5 ? '\u00BD' : frac === 0.75 ? '\u00BE' : ''
  if (!glyph) return String(whole)
  return whole === 0 ? glyph : `${whole}${glyph}`
}

// Scale the leading quantity of a template `visual` string: "1 cup" x1.68 -> "1\u00BE cup".
//
// Templates ship a base ~500 kcal recipe as a (visual, grams) PAIR describing the same amount, and
// the two scaling sites multiply grams by the user's calorie ratio. Scaling only grams silently
// broke that pairing, and getMeasuredDisplay's tier 1 prefers `visual` verbatim for liquids and
// seasonings — so a 840 kcal pudding listed its coconut milk as the base "1 cup" while the card
// claimed the scaled macros. Eyeball counts ("2 medium") went stale the same way.
//
// Only a LEADING numeric quantity is scaled. Qualitative visuals ("a drizzle", "pinch", "half an
// avocado") carry no number to scale and are returned untouched — they stay qualitative, which is
// correct, and the grams tiers drive Measured mode for those rows.
export function scaleVisual(visual: string | undefined, scale: number): string | undefined {
  if (!visual) return visual
  if (!Number.isFinite(scale) || scale <= 0 || scale === 1) return visual
  // Fraction alternative MUST come first: matching \d+ first would eat the "1" of "1/2" and leave
  // "/2 tsp" behind.
  const m = visual.match(/^\s*(\d+\/\d+|\d+(?:\.\d+)?)(\s*[-\u2013]\s*(\d+\/\d+|\d+(?:\.\d+)?))?/)
  if (!m) return visual
  const toNum = (t: string) => {
    if (!t.includes('/')) return parseFloat(t)
    const [a, b] = t.split('/').map(Number)
    return b ? a / b : NaN
  }
  const lo = toNum(m[1])
  if (!Number.isFinite(lo) || lo <= 0) return visual
  const rest = visual.slice(m[0].length)
  if (m[3] !== undefined) {
    // Ranges ("3-4 slices") scale at both ends so the span stays proportional.
    const hi = toNum(m[3])
    if (!Number.isFinite(hi) || hi <= 0) return visual
    return `${formatQuarter(lo * scale)}-${formatQuarter(hi * scale)}${rest}`
  }
  return `${formatQuarter(lo * scale)}${rest}`
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
// The non-spice senses of "pepper". Plural "peppers" is the vegetable in every live row
// ("chargrilled peppers"); the spice stays singular ("red pepper flakes", "black pepper").
const NON_SPICE_PEPPER = /\b(bell|sweet|banana|poblano|serrano|habanero|shishito|cubanelle|mini|chargrilled|roasted)\s+peppers?\b|\bpepper\s*jack\b|\bpeppers\b/gi

// Recipes are written in fractions, not decimals. A creator's own visual reaches us as typed —
// "0.75 tsp", "1.5 cups", "6.75 cups" — and rendering that verbatim asks a cook to measure three
// quarters of a teaspoon as a decimal. The gram converters above already emit ¼/½/¾, so a raw
// visual was the only place decimals survived, which is why it looked inconsistent within one list.
//
// Only the fractions a kitchen actually has are converted. "1.4 oz" has no clean fraction and is
// left exactly as written rather than rounded into a lie.
const COOKING_FRACTION: Record<string, string> = {
  '125': '⅛', '25': '¼', '33': '⅓', '333': '⅓', '5': '½', '66': '⅔', '667': '⅔', '75': '¾',
}

export function toCookingFraction(s: string): string {
  return s.replace(/\b(\d+)\.(\d+)\b/g, (match, whole: string, frac: string) => {
    const glyph = COOKING_FRACTION[frac]
    if (!glyph) return match
    return whole === '0' ? glyph : `${whole}${glyph}`
  })
}

export function getMeasuredDisplay(name: string, gramsStr: string | undefined, visualStr: string | undefined): string {
  const n = name.toLowerCase()
  const isLiquid = /\b(oil|vinegar|sauce|dressing|honey|syrup|extract|juice|milk|broth|stock|wine|tahini|mayo|mustard|cream)\b/.test(n)
  // "pepper" names three unrelated foods: the spice, the vegetable and a cheese. Only the spice
  // belongs in the seasoning branch — routing the others through it converted 150g of bell pepper
  // into "25 tbsp" and 120g of pepper jack into "20 tbsp". Same substring trap already recorded
  // for "cloves" (the garlic bulb vs the spice) in WHOLE_UNIT_FOODS.
  //
  // Stripped rather than negated, so a name that ALSO carries a real spice still qualifies:
  // "salt & pepper" keeps salt. Pepperoni needs no rule — \b does not match inside it.
  const nSpice = n.replace(NON_SPICE_PEPPER, ' ')
  const isSeasoning = /\b(salt|pepper|paprika|cumin|cinnamon|turmeric|oregano|thyme|basil|rosemary|parsley|cilantro|dill|chili|spice|powder|seasoning|flakes?|herbs?|sweetener|stevia|sugar)\b/.test(nSpice)
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
  // Packets are a real measurement and the ACTIONABLE one: a creator writing "1 packet ranch
  // seasoning" is naming what you buy. Converting that to "5 tbsp" was arithmetically fine and
  // useless — nobody spoons out a seasoning packet. Six live rows read that way.
  if ((isLiquid || isSeasoning) && visualStr &&
      /(tbsp|tablespoons?|tsp|teaspoons?|cups?|ml|oz|ounces?|packets?|packs?|sachets?|sticks?|cans?|jars?|bottles?)/i.test(visualStr)) {
    return toCookingFraction(visualStr)
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

  return toCookingFraction(gramsStr || visualStr || '')
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
  // "small/medium/large X" — already descriptive, UNLESS it still names a measuring tool. This
  // guard used to fire on the leading article alone, so "a cup of rice" and "a tablespoon of oil"
  // returned unchanged and Eyeball mode — whose entire purpose is needing no tools — told the user
  // to fetch a cup.
  const namesATool = /\b(tbsp|tablespoons?|tsp|teaspoons?|cups?|ml|milliliters?|oz|ounces?|lbs?|pounds?|grams?)\b/i.test(v)
  if (!namesATool && /^(a|an|small|medium|large|big|tiny)\b/i.test(v)) return v

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

// One compiled alternation instead of 21 RegExp constructions per call. This function sits in the
// inner loop of every missing-ingredient count, and building the regexes there cost ~3 SECONDS on a
// full Discover pass (600 meals x 8 ingredients x 200 pantry entries) — a synchronous freeze on the
// render path. Behaviour is unchanged: \b anchors mean a shorter adjective can't match inside a
// longer one ("cooked" never fires inside "uncooked"), so alternation order doesn't matter.
const ADJECTIVE_RE = new RegExp(`\\b(${COOKING_ADJECTIVES.join('|')})\\b`, 'g')

export function stripAdjectives(name: string): string {
  return name.toLowerCase().replace(ADJECTIVE_RE, '').replace(/\s+/g, ' ').trim()
}

// Check if an item is already covered by existing names
export function isAlreadyInList(itemName: string, existingNames: Set<string>): boolean {
  const lower = cleanIngredientName(itemName).toLowerCase()
  const stripped = stripAdjectives(lower)
  // Exact match only, before and after adjective stripping. The old substring checks matched any
  // shared fragment, so "rice vinegar" counted as already-owned when the pantry held "rice",
  // "coconut oil" when it held "oil", and "chicken broth" when it held "chicken" — each silently
  // dropping a genuinely missing item from the grocery list.
  //
  // Erring the other way is the safe direction: an extra line on the list is a minor annoyance,
  // a missing one means standing in the kitchen unable to cook.
  for (const existing of existingNames) {
    if (lower === existing || stripped === existing) return true
    if (stripAdjectives(existing) === stripped) return true
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

// The single answer to "how many ingredients does this person still need?", shared by the recipe
// screen's YOU'LL NEED list and Discover's "Missing N" badge.
//
// It exists because those two disagreed on screen. Discover ran its own substring matcher —
// exactly the logic isAlreadyInList was written to REPLACE, and whose bug is described in the
// comment there: a pantry holding "yogurt" swallowed "high-protein Greek yogurt", so a card read
// "Have it all" over a recipe whose detail screen listed something to buy. Discover also had no
// concept of assumed staples, so it counted salt and oil as missing when the recipe screen did
// not. The two errors point in opposite directions, which made the badge not merely wrong but
// unpredictably wrong.
//
// Anything that shows a missing-ingredient count MUST come through here.
export function countMissingIngredients(
  ingredients: any[] | undefined,
  pantryNames: Set<string>,
  excludedStaples: Set<string> = new Set(),
): number {
  const names = (ingredients || [])
    .map(i => String(i?.name ?? i ?? '').trim())
    .filter(Boolean)
  if (names.length === 0) return 0

  // isAlreadyInList re-strips every pantry entry for every ingredient it's asked about, which is
  // O(ingredients x pantry) regex work. The stripped forms depend only on the pantry, so build
  // them once here and match by lookup. Same three conditions that function tests, in the same
  // order — see the note above it for why exact-match rather than substring.
  const strippedPantry = new Set<string>()
  for (const p of pantryNames) strippedPantry.add(stripAdjectives(p))

  return names.filter(raw => {
    // Clean ONCE and use it for both checks. isAlreadyInList cleans internally but isAssumedStaple
    // does not, so passing a raw model name like "1 tsp salt" matched the pantry path and missed
    // the staple path — the exact screen-to-screen divergence this function exists to prevent.
    const name = cleanIngredientName(raw)
    const lower = name.toLowerCase()
    const stripped = stripAdjectives(lower)
    if (pantryNames.has(lower) || pantryNames.has(stripped) || strippedPantry.has(stripped)) return false
    if (isAssumedStaple(name, excludedStaples)) return false
    return true
  }).length
}
