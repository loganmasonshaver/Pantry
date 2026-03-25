import { supabase } from './supabase'

// ── Types ────────────────────────────────────────────────────────────────

export type FoodServing = {
  serving_id: string
  serving_description: string
  calories: string
  protein: string
  carbohydrate: string
  fat: string
  metric_serving_amount?: string
  metric_serving_unit?: string
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
}

// ── API calls via Edge Function ──────────────────────────────────────────

async function apiFetch<T>(method: string, params: Record<string, string>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('fatsecret-proxy', {
    body: { method, params },
  })
  if (error) throw error
  return data as T
}

// ── Public API functions ─────────────────────────────────────────────────

export async function searchFoods(query: string, page = 0): Promise<FoodSearchResult[]> {
  const data = await apiFetch<any>('foods.search', {
    search_expression: query,
    page_number: String(page),
    max_results: '20',
  })

  const foods = data?.foods?.food
  if (!foods) return []
  return (Array.isArray(foods) ? foods : [foods]).map((f: any) => ({
    food_id: f.food_id,
    food_name: f.food_name,
    brand_name: f.brand_name,
    food_description: f.food_description ?? '',
  }))
}

export async function getFoodById(foodId: string): Promise<FoodDetail> {
  const data = await apiFetch<any>('food.get', {
    food_id: foodId,
  })

  const food = data.food
  const rawServings = food.servings?.serving
  const servingsArr: FoodServing[] = rawServings
    ? (Array.isArray(rawServings) ? rawServings : [rawServings]).map((s: any) => ({
        serving_id: s.serving_id,
        serving_description: s.serving_description,
        calories: s.calories,
        protein: s.protein,
        carbohydrate: s.carbohydrate,
        fat: s.fat,
        metric_serving_amount: s.metric_serving_amount,
        metric_serving_unit: s.metric_serving_unit,
      }))
    : []

  return {
    food_id: food.food_id,
    food_name: food.food_name,
    brand_name: food.brand_name,
    servings: servingsArr,
  }
}

// ── Barcode lookup via Open Food Facts (free, no auth) ────────────────────

async function productNameFromBarcode(barcode: string): Promise<string | null> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`)
    if (!res.ok) return null
    const json = await res.json()
    if (json.status !== 1) return null
    const p = json.product
    const brand: string = p.brands?.split(',')[0]?.trim() ?? ''
    const name: string = p.product_name_en ?? p.product_name ?? ''
    if (!name) return null
    return brand ? `${brand} ${name}` : name
  } catch {
    return null
  }
}

export async function findFoodByBarcode(barcode: string): Promise<FoodDetail | null> {
  try {
    const productName = await productNameFromBarcode(barcode)
    if (!productName) return null
    const results = await searchFoods(productName)
    if (!results.length) return null
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
