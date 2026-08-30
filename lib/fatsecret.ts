import { supabase } from './supabase'

// ── Types ────────────────────────────────────────────────────────────────

// FoodServing, pickDefaultServing and parseMacros live in a supabase-free module so they can be
// unit-tested; re-exported here so every caller keeps importing from '@/lib/fatsecret'.
export { pickDefaultServing, parseMacros } from './fatsecretServing'
export type { FoodServing } from './fatsecretServing'
import type { FoodServing } from './fatsecretServing'

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
