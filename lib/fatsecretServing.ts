// Pure serving-selection and macro math, split out of lib/fatsecret.ts so it can be unit-tested.
// fatsecret.ts imports the Supabase client at module scope, which drags React Native in and makes
// the whole module unloadable under plain `node --test`. Nothing here touches the network.
// fatsecret.ts re-exports everything below, so callers keep importing from '@/lib/fatsecret'.

export type FoodServing = {
  serving_id: string
  serving_description: string
  calories: string
  protein: string
  carbohydrate: string
  fat: string
  fiber?: string
  metric_serving_amount?: string
  metric_serving_unit?: string
  is_default?: string // "1" on the serving FatSecret considers default (v3 + flag_default_serving)
}

// ── Default serving selection ────────────────────────────────────────────
//
// Why we don't just trust FatSecret's own default: for generic foods it IS the metric entry.
// Searching "milk" returns food_description "Per 100g - ... Protein: 3.4g", so is_default points at
// 100 g and the app was showing 3g of protein for a glass of milk. Nobody measures milk in grams.
// MyFitnessPal overrides the same upstream default with a household measure; so do we. is_default
// is kept only as a tiebreaker between household servings.

// "100 g", "250ml", "1 g" — a pure metric quantity with no household unit attached.
const METRIC_ONLY_RE = /^\s*\d+(\.\d+)?\s*(g|gram|grams|ml|milliliter|milliliters)\s*(\(|$)/i

// Ordered by how a person would naturally describe a portion. Index = priority, lower wins, so a
// food offering both "1 cup" and "1 fl oz" lands on the cup — which is what MFP shows for milk.
const UNIT_PRIORITY: RegExp[] = [
  /\bcups?\b/i,
  /\b(container|bottle|can|jar|pouch|package|packet|carton)\b/i,
  /\b(breast|fillet|thigh|patty|link|egg|slices?|pieces?|bars?|cookie|muffin|roll|bun|wrap|tortilla|square|stick|clove)\b/i,
  /\b(small|medium|large|whole|half|item|unit|serving|bowl|plate|glass)\b/i,
  /\bfl\.?\s?oz\b|\bfluid ounce/i,
  /\boz\b|\bounces?\b/i,
  /\btbsp\b|\btablespoons?\b/i,
  /\btsp\b|\bteaspoons?\b/i,
]

const householdRank = (desc: string): number => {
  const i = UNIT_PRIORITY.findIndex(re => re.test(desc))
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/**
 * Pick the serving a person would expect to be selected by default.
 * Household measures beat metric ones; a single natural unit ("1 cup") beats a fraction
 * ("0.25 cup"); synthetic gram options are never the default (they stay selectable).
 */
export function pickDefaultServing(servings: FoodServing[] | undefined): FoodServing | null {
  if (!servings || servings.length === 0) return null
  // '__' prefixed ids are the 100g/1g options fatsecret.ts synthesizes for the kitchen-scale flow.
  const real = servings.filter(s => !s.serving_id?.startsWith('__'))
  const pool = real.length > 0 ? real : servings

  const household = pool.filter(s =>
    !METRIC_ONLY_RE.test(s.serving_description) && householdRank(s.serving_description) !== Number.MAX_SAFE_INTEGER
  )
  if (household.length === 0) {
    // Nothing household-shaped exists (some branded items only carry a gram serving) — the metric
    // entry is genuinely the only option, so FatSecret's own default is the best signal left.
    return pool.find(s => s.is_default === '1') ?? pool[0]
  }

  // "1 cup" over "0.25 cup" — a whole unit is what someone actually pours.
  const singles = household.filter(s => /^\s*1\s+\D/.test(s.serving_description))
  const tier = singles.length > 0 ? singles : household
  const best = [...tier].sort((a, b) => householdRank(a.serving_description) - householdRank(b.serving_description))
  const topRank = householdRank(best[0].serving_description)
  const tied = best.filter(s => householdRank(s.serving_description) === topRank)
  return tied.find(s => s.is_default === '1') ?? tied[0]
}

// Returns EXACT per-serving values — deliberately unrounded. Callers multiply by a quantity and
// round only at the end. Rounding here first destroyed small servings: the synthetic "1 g" option
// carries ~0.31 g protein/g, which rounded to 0, so logging 150 g of chicken by kitchen scale saved
// 0 g protein. Round at the point of DISPLAY, never before scaling.
export function parseMacros(serving: FoodServing) {
  return {
    calories: parseFloat(serving.calories) || 0,
    protein: parseFloat(serving.protein) || 0,
    carbs: parseFloat(serving.carbohydrate) || 0,
    fat: parseFloat(serving.fat) || 0,
  }
}
