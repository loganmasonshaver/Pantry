import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'

const openaiApiKey = Deno.env.get("OPENAI_API_KEY")
const fsKey = Deno.env.get("FATSECRET_KEY") ?? ""
const fsSecret = Deno.env.get("FATSECRET_SECRET") ?? ""

// ── FatSecret OAuth 1.0 helpers ──
const FS_URL = "https://platform.fatsecret.com/rest/server.api"

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A")
}

async function fsSignedUrl(params: Record<string, string>): Promise<string> {
  const all: Record<string, string> = {
    oauth_consumer_key: fsKey, oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0", format: "json", ...params,
  }
  const paramStr = Object.keys(all).sort().map(k => `${percentEncode(k)}=${percentEncode(all[k])}`).join("&")
  const base = ["GET", percentEncode(FS_URL), percentEncode(paramStr)].join("&")
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${percentEncode(fsSecret)}&`),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"])
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base))
  all["oauth_signature"] = btoa(String.fromCharCode(...new Uint8Array(sig)))
  const qs = Object.keys(all).sort().map(k => `${percentEncode(k)}=${percentEncode(all[k])}`).join("&")
  return `${FS_URL}?${qs}`
}

async function lookupMacros(foodName: string, grams: number): Promise<{ cal: number; p: number; c: number; f: number } | null> {
  try {
    const searchUrl = await fsSignedUrl({ method: "foods.search", search_expression: foodName, max_results: "1" })
    const searchRes = await fetch(searchUrl)
    const searchData = await searchRes.json()
    const food = searchData?.foods?.food
    const item = Array.isArray(food) ? food[0] : food
    if (!item?.food_id) return null

    const detailUrl = await fsSignedUrl({ method: "food.get.v4", food_id: String(item.food_id) })
    const detailRes = await fetch(detailUrl)
    const detailData = await detailRes.json()
    const servings = detailData?.food?.servings?.serving
    const serving = Array.isArray(servings)
      ? servings.find((s: any) => s.metric_serving_unit === 'g' && Number(s.metric_serving_amount) === 100) || servings[0]
      : servings
    if (!serving) return null

    const metricAmount = Number(serving.metric_serving_amount) || 100
    const scale = grams / metricAmount
    return {
      cal: Math.round(Number(serving.calories) * scale),
      p: Math.round(Number(serving.protein) * scale * 10) / 10,
      c: Math.round(Number(serving.carbohydrate) * scale * 10) / 10,
      f: Math.round(Number(serving.fat) * scale * 10) / 10,
    }
  } catch { return null }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    })
  }

  // Manual auth check — gateway JWT verification is disabled (ES256 incompatibility)
  const user = await verifyUser(req)
  if (!user) return unauthorizedResponse()

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 15, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const { mode, description, base64 } = await req.json()

    // Step 1: GPT-4o identifies food items + estimates weight in grams
    let messages: any[]

    if (mode === "photo" && base64) {
      messages = [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "high" },
            },
            {
              type: "text",
              text: `Analyze this food photo. Identify every distinct food item visible and estimate the weight of each in grams based on visual portion size.

Return ONLY a JSON object:
{
  "name": "Short meal name (e.g. Grilled Chicken & Rice)",
  "items": [
    { "food": "grilled chicken breast", "grams": 150 },
    { "food": "white rice", "grams": 200 },
    { "food": "steamed broccoli", "grams": 80 }
  ]
}

Rules:
- Be specific about the food (e.g. "grilled chicken breast" not just "chicken")
- CRITICAL: Most people overestimate portions. Estimate CONSERVATIVELY:
  - A palm-sized piece of meat is ~100-120g, NOT 150-200g
  - A fist-sized portion of rice/pasta is ~130-150g cooked, NOT 200g+
  - A side of vegetables is typically 60-80g, not 100g+
  - A typical restaurant plate looks like more food than it is
  - When in doubt, estimate LOW — users can adjust up
- A standard dinner plate is 10-11 inches. Food rarely covers more than 60% of it
- Include sauces, oils, toppings as separate items if visible
- Cooking oil: unless visibly pooling, estimate 5-10ml max (not tablespoons)
- No explanation, just JSON.`,
            },
          ],
        },
      ]
    } else {
      messages = [
        {
          role: "user",
          content: `Analyze this meal: "${description}". Identify every food component and estimate the weight of each in grams.

Return ONLY a JSON object:
{
  "name": "Short meal name (e.g. Scrambled Eggs & Toast)",
  "items": [
    { "food": "scrambled eggs", "grams": 120 },
    { "food": "white toast", "grams": 60 },
    { "food": "butter", "grams": 10 }
  ]
}

Rules:
- Be specific about the food type
- Estimate CONSERVATIVE single-serving portions — most people overestimate what they eat
- A palm of meat ~100-120g, a fist of carbs ~130-150g, a side of veg ~60-80g
- Include cooking oils (5-10ml unless specified), sauces, toppings as separate items
- No explanation, just JSON.`,
        },
      ]
    }

    const model = mode === "photo" ? "gpt-4o" : "gpt-4o-mini"

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({ model, max_tokens: 500, messages }),
    })

    const data = await response.json()
    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message || JSON.stringify(data.error) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      })
    }

    const text = data.choices?.[0]?.message?.content?.trim() ?? "{}"
    const clean = text.replace(/^```(?:json)?/, "").replace(/```$/, "").trim()
    const parsed = JSON.parse(clean)

    const mealName = parsed.name || "Meal"
    const items = parsed.items || []

    // Step 2: Cross-reference each item with FatSecret for verified macros
    let totalCal = 0, totalPro = 0, totalCarbs = 0, totalFat = 0
    let fsLookups = 0

    if (fsKey && fsSecret && items.length > 0) {
      for (const item of items) {
        const macros = await lookupMacros(item.food, item.grams || 100)
        if (macros && macros.cal > 0 && macros.cal < 1500) {
          totalCal += macros.cal
          totalPro += macros.p
          totalCarbs += macros.c
          totalFat += macros.f
          fsLookups++
        }
      }
    }

    // Step 3: If FatSecret got at least half the items, use verified data
    // Otherwise fall back to a single GPT estimate
    if (fsLookups >= items.length / 2 && totalCal >= 50) {
      console.log(`FatSecret verified ${fsLookups}/${items.length} items for "${mealName}"`)
      return new Response(JSON.stringify({
        name: mealName,
        calories: Math.round(totalCal),
        protein: Math.round(totalPro),
        carbs: Math.round(totalCarbs),
        fat: Math.round(totalFat),
      }), { headers: { "Content-Type": "application/json" } })
    }

    // Fallback: ask GPT to estimate macros directly
    console.log(`FatSecret fallback — only verified ${fsLookups}/${items.length} items, using GPT estimate`)
    const fallbackMessages = [
      {
        role: "user",
        content: `Based on this meal breakdown, estimate the total macros:
Meal: ${mealName}
Items: ${items.map((i: any) => `${i.food} (${i.grams}g)`).join(', ')}

Return ONLY: { "name": string, "calories": number, "protein": number, "carbs": number, "fat": number }
Calculate macros by adding up each ingredient at the listed gram weight. Be accurate. No explanation.`,
      },
    ]

    const fallbackRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
      body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 200, messages: fallbackMessages }),
    })
    const fallbackData = await fallbackRes.json()
    const fallbackText = fallbackData.choices?.[0]?.message?.content?.trim() ?? "{}"
    const fallbackClean = fallbackText.replace(/^```(?:json)?/, "").replace(/```$/, "").trim()
    const result = JSON.parse(fallbackClean)
    result.name = result.name || mealName

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
