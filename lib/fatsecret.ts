import CryptoJS from 'crypto-js'

const BASE_URL = 'https://platform.fatsecret.com/rest/server.api'
const CONSUMER_KEY = process.env.EXPO_PUBLIC_FATSECRET_KEY ?? ''
const CONSUMER_SECRET = process.env.EXPO_PUBLIC_FATSECRET_SECRET ?? ''

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
  food_description: string // e.g. "Per 100g - Calories: 52kcal | Fat: 0.17g | Carbs: 13.81g | Protein: 0.26g"
}

// ── OAuth 1.0 HMAC-SHA1 signing ──────────────────────────────────────────

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

function generateNonce(): string {
  return Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2)
}

function buildSignedUrl(method: 'GET', params: Record<string, string>): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    format: 'json',
    ...params,
  }

  // Sort all params alphabetically and percent-encode keys + values
  const sortedKeys = Object.keys(oauthParams).sort()
  const paramString = sortedKeys
    .map(k => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join('&')

  // Build signature base string
  const signatureBase = [
    method,
    percentEncode(BASE_URL),
    percentEncode(paramString),
  ].join('&')

  // Sign with HMAC-SHA1 — signing key is consumerSecret& (empty token secret)
  const signingKey = `${percentEncode(CONSUMER_SECRET)}&`
  const signature = CryptoJS.HmacSHA1(signatureBase, signingKey)
  const signatureB64 = CryptoJS.enc.Base64.stringify(signature)

  oauthParams['oauth_signature'] = signatureB64

  // Build final URL
  const queryString = Object.keys(oauthParams)
    .sort()
    .map(k => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join('&')

  return `${BASE_URL}?${queryString}`
}

async function apiFetch<T>(params: Record<string, string>): Promise<T> {
  const url = buildSignedUrl('GET', params)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FatSecret API error: ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(json.error.message ?? 'FatSecret error')
  return json as T
}

// ── Public API functions ─────────────────────────────────────────────────

export async function searchFoods(query: string, page = 0): Promise<FoodSearchResult[]> {
  const data = await apiFetch<any>({
    method: 'foods.search',
    search_expression: query,
    page_number: String(page),
    max_results: '20',
  })

  const foods = data?.foods?.food
  if (!foods) return []
  // API returns object (single result) or array
  return (Array.isArray(foods) ? foods : [foods]).map((f: any) => ({
    food_id: f.food_id,
    food_name: f.food_name,
    brand_name: f.brand_name,
    food_description: f.food_description ?? '',
  }))
}

export async function getFoodById(foodId: string): Promise<FoodDetail> {
  const data = await apiFetch<any>({
    method: 'food.get',
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
// food.find_id_for_barcode is a FatSecret Premier paid method.
// Instead: resolve product name from Open Food Facts, then search FatSecret.

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
