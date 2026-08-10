import { supabase } from './supabase'

// ── Types ────────────────────────────────────────────────────────────────

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

export type FoodDetail = {
  food_id: string
  food_name: string
  brand_name?: string
  servings: FoodServing[]
}

export type FoodSearchResult = {
  food_id: string
  food_name: string
  brand_name?: string
  food_description: string
  servings?: FoodServing[] // present on v3 search — lets the results list show a real serving
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
  // '__' prefixed ids are the 100g/1g options we synthesize below for the kitchen-scale workflow.
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

// ── API calls via Edge Function ──────────────────────────────────────────

// Routed through an edge function because FatSecret OAuth requires a server-side
// signing step — we can't expose the consumer secret to the client.
async function apiFetch<T>(method: string, params: Record<string, string>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('fatsecret-proxy', {
    body: { method, params },
  })
  if (error) throw error
  return data as T
}

// ── Public API functions ─────────────────────────────────────────────────

// Shared by search and detail so a food's servings are identical in the results list and on the
// detail screen. Two separate normalizers would let the list promise one serving and the detail
// screen open on another.
function normalizeServings(rawServings: any): FoodServing[] {
  if (!rawServings) return []
  // FatSecret returns a bare object (not an array) when a food has exactly one serving.
  const arr = Array.isArray(rawServings) ? rawServings : [rawServings]
  return arr.map((s: any) => {
    // Append gram equivalent to description if available and not already a gram serving
    let desc = s.serving_description ?? ''
    const metricG = parseFloat(s.metric_serving_amount ?? '0')
    if (metricG > 0 && s.metric_serving_unit === 'g' && !/^\d+\s*g$/.test(desc)) {
      desc = `${desc} (${Math.round(metricG)}g)`
    }
    return {
      serving_id: s.serving_id,
      serving_description: desc,
      calories: s.calories,
      protein: s.protein,
      carbohydrate: s.carbohydrate,
      fat: s.fat,
      fiber: s.fiber,
      metric_serving_amount: s.metric_serving_amount,
      metric_serving_unit: s.metric_serving_unit,
      is_default: s.is_default,
    }
  })
}

export async function searchFoods(query: string, page = 0): Promise<FoodSearchResult[]> {
  // v3 carries each food's servings inline. v1 returned only a "Per 100g - ..." string, which is
  // why the results list used to show per-100g macros while the detail screen showed a serving.
  let data: any
  try {
    data = await apiFetch<any>('foods.search.v3', {
      search_expression: query,
      page_number: String(page),
      max_results: '20',
      flag_default_serving: 'true',
    })
  } catch (e) {
    // The proxy rejects any method missing from its allowlist, so an app build that ships ahead of
    // the edge function deploy would break search outright. Fall back to v1 instead: rows lose the
    // household serving (back to the per-100g description) but search keeps working.
    console.log('[fatsecret] v3 search unavailable, falling back to v1:', (e as Error)?.message)
    data = await apiFetch<any>('foods.search', {
      search_expression: query,
      page_number: String(page),
      max_results: '20',
    })
  }

  // v3 nests results under foods_search.results.food; also accept the v1 shape so a response-shape
  // surprise degrades to the old behaviour instead of an empty results list.
  const foods = data?.foods_search?.results?.food ?? data?.foods?.food
  if (!foods) return []
  return (Array.isArray(foods) ? foods : [foods]).map((f: any) => {
    const servings = normalizeServings(f.servings?.serving)
    return {
      food_id: f.food_id,
      food_name: f.food_name,
      brand_name: f.brand_name,
      food_description: f.food_description ?? '',
      servings: servings.length > 0 ? servings : undefined,
    }
  })
}

export async function getFoodById(foodId: string): Promise<FoodDetail> {
  const data = await apiFetch<any>('food.get', {
    food_id: foodId,
  })

  const food = data.food
  const servingsArr: FoodServing[] = normalizeServings(food.servings?.serving)

  // Add synthetic "100g" and "1g" options if metric data is available and no gram serving exists.
  // Users frequently want to log by gram weight (kitchen scale workflow) but FatSecret only
  // returns "1 cup" / "1 slice" / etc. — synthesizing gram servings lets the UI offer a scale-friendly path.
  const hasGramServing = servingsArr.some(s =>
    s.serving_description.match(/^\d+\s*g$/) || s.serving_description === '100 g'
  )
  if (!hasGramServing && servingsArr.length > 0) {
    const ref = servingsArr[0]
    const metricG = parseFloat(ref.metric_serving_amount ?? '0')
    if (metricG > 0 && (ref.metric_serving_unit === 'g' || ref.metric_serving_unit === 'ml')) {
      const scale100 = 100 / metricG // scale nutrients proportionally from this serving size to 100g
      const scale1 = 1 / metricG
      servingsArr.push({
        serving_id: '__100g', // __ prefix distinguishes synthetic IDs from real FatSecret serving IDs
        serving_description: '100 g',
        calories: String(Math.round(parseFloat(ref.calories) * scale100)),
        protein: String(Math.round(parseFloat(ref.protein) * scale100 * 10) / 10),
        carbohydrate: String(Math.round(parseFloat(ref.carbohydrate) * scale100 * 10) / 10),
        fat: String(Math.round(parseFloat(ref.fat) * scale100 * 10) / 10),
        fiber: ref.fiber ? String(Math.round(parseFloat(ref.fiber) * scale100 * 10) / 10) : undefined,
        metric_serving_amount: '100',
        metric_serving_unit: 'g',
      })
      servingsArr.push({
        serving_id: '__1g',
        serving_description: '1 g',
        calories: String(parseFloat(ref.calories) * scale1),
        protein: String(parseFloat(ref.protein) * scale1),
        carbohydrate: String(parseFloat(ref.carbohydrate) * scale1),
        fat: String(parseFloat(ref.fat) * scale1),
        fiber: ref.fiber ? String(parseFloat(ref.fiber) * scale1) : undefined,
        metric_serving_amount: '1',
        metric_serving_unit: 'g',
      })
    }
  }

  return {
    food_id: food.food_id,
    food_name: food.food_name,
    brand_name: food.brand_name,
    servings: servingsArr,
  }
}

// ── Barcode lookup via Open Food Facts (free, no auth) ────────────────────
// Open Food Facts is free/no-auth; FatSecret has no barcode endpoint in the free tier

async function productNameFromBarcode(barcode: string): Promise<string | null> {
  try {
    // Open Food Facts can be slow/unresponsive — without a ceiling a scan would hang
    // the lookup indefinitely. 8s then bail to the normal "not found" path.
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`, { signal: ctrl.signal })
      .finally(() => clearTimeout(timeout))
    if (!res.ok) return null
    const json = await res.json()
    if (json.status !== 1) return null // OpenFoodFacts returns status:0 for unknown barcodes (not a 404)
    const p = json.product
    const brand: string = p.brands?.split(',')[0]?.trim() ?? '' // products may list multiple brands comma-separated; first one is usually the primary
    const name: string = p.product_name_en ?? p.product_name ?? '' // prefer English name; many EU products have only localized names
    if (!name) return null
    return brand ? `${brand} ${name}` : name
  } catch {
    return null
  }
}

// Fraction of the Open Food Facts product words that also appear in the FatSecret match.
// OFF and FatSecret name the same product differently, so a blind results[0] can be a
// totally different food (wrong macros). Require a minimum word overlap before trusting it.
function nameOverlap(a: string, b: string): number {
  const tokenize = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2)
  )
  const ta = tokenize(a), tb = tokenize(b)
  if (ta.size === 0) return 0
  let hits = 0
  for (const w of ta) if (tb.has(w)) hits++
  return hits / ta.size
}

export async function findFoodByBarcode(barcode: string): Promise<FoodDetail | null> {
  try {
    const productName = await productNameFromBarcode(barcode)
    if (!productName) return null
    const results = await searchFoods(productName)
    if (!results.length) return null
    // Reject a mismatched top result (< 40% word overlap) so we don't log a different
    // food's macros — let the user search manually instead of silently being wrong.
    if (nameOverlap(productName, results[0].food_name) < 0.4) return null
    return getFoodById(results[0].food_id)
  } catch {
    return null
  }
}

// ── Macro parser helper ───────────────────────────────────────────────────

export function parseMacros(serving: FoodServing) {
  return {
    calories: Math.round(parseFloat(serving.calories) || 0),
    protein: Math.round(parseFloat(serving.protein) || 0),
    carbs: Math.round(parseFloat(serving.carbohydrate) || 0),
    fat: Math.round(parseFloat(serving.fat) || 0),
  }
}
