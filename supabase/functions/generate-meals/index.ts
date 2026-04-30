import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const openaiApiKey = Deno.env.get("OPENAI_API_KEY")
const googleAiKey = Deno.env.get("GOOGLE_AI_KEY")
const groqApiKey = Deno.env.get("GROQ_API_KEY")
const replicateToken = Deno.env.get("REPLICATE_API_TOKEN")
const fsKey = Deno.env.get("FATSECRET_KEY") ?? ""
const fsSecret = Deno.env.get("FATSECRET_SECRET") ?? ""
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const db = createClient(supabaseUrl, supabaseServiceKey)

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

async function lookupMacros(name: string, grams: number): Promise<{ cal: number; p: number; c: number; f: number } | null> {
  try {
    const searchUrl = await fsSignedUrl({ method: "foods.search", search_expression: name, max_results: "1" })
    const searchRes = await fetch(searchUrl)
    const searchData = await searchRes.json()
    const food = searchData?.foods?.food
    const item = Array.isArray(food) ? food[0] : food
    if (!item?.food_id) return null

    const detailUrl = await fsSignedUrl({ method: "food.get.v4", food_id: String(item.food_id) })
    const detailRes = await fetch(detailUrl)
    const detailData = await detailRes.json()
    const servings = detailData?.food?.servings?.serving
    const serving = Array.isArray(servings) ? servings.find((s: any) => s.metric_serving_unit === 'g' && Number(s.metric_serving_amount) === 100) || servings[0] : servings
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

async function correctMealMacros(meal: any): Promise<any> {
  const ingredients = meal.ingredients || []
  let totalCal = 0, totalP = 0, totalC = 0, totalF = 0
  let lookedUp = 0

  const results = await Promise.all(ingredients.map((ing: any) => {
    const grams = parseInt(String(ing.grams)) || 100
    return lookupMacros(ing.name, grams)
  }))

  for (const macros of results) {
    if (macros) {
      if (macros.cal > 900 || macros.p > 100) continue
      totalCal += macros.cal
      totalP += macros.p
      totalC += macros.c
      totalF += macros.f
      lookedUp++
    }
  }

  if (lookedUp >= ingredients.length / 2 && totalCal >= 200 && totalCal <= 1200) {
    meal.calories = Math.round(totalCal)
    meal.protein = Math.round(totalP)
    meal.carbs = Math.round(totalC)
    meal.fat = Math.round(totalF)
  }
  return meal
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
  const { allowed } = rateLimit(ip, 10, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const {
      ingredients,
      calorieGoal,
      proteinGoal,
      mealsPerDay,
      cookingSkill,
      maxPrepMinutes,
      dietaryRestrictions,
      foodDislikes = [],
      dislikedMeals = [],
      likedMeals = [],
      cuisinePreferences = [],
      mode = "cookNow",
    } = await req.json()

    const count = Math.min(mealsPerDay, 3)
    // Per-meal protein floor scales with the user's actual daily target (which is already
    // bodyweight + goal based via calculateGoals: lose=1.2g/lb, maintain=1.0, bulk=0.8).
    // 85% of the average meal protein gives meals room to vary ±15% while still hitting daily.
    const perMealProteinMin = Math.max(15, Math.floor((proteinGoal / mealsPerDay) * 0.85))
    const restrictions = dietaryRestrictions.filter((d: string) => d !== "None").join(", ") || "none"
    const restrictionsLine = restrictions !== "none"
      ? `\n- STRICT dietary requirements — NEVER violate these under any circumstances: ${restrictions}. Any meal that includes a forbidden ingredient for these restrictions must be discarded entirely.`
      : ""
    const dislikesLine = foodDislikes.length > 0
      ? `\nThe user dislikes these ingredients — never include them: ${foodDislikes.join(", ")}.`
      : ""
    const dislikedMealsLine = dislikedMeals.length > 0
      ? `\nThe user rated these meals poorly — do NOT suggest them or anything similar: ${dislikedMeals.join(", ")}.`
      : ""
    const likedMealsLine = likedMeals.length > 0
      ? `\nThe user loved these meals — suggest meals with a similar style or ingredients: ${likedMeals.join(", ")}.`
      : ""
    const cuisineLine = cuisinePreferences.length > 0
      ? `\nThe user enjoys these cuisine styles — strongly prioritize them: ${cuisinePreferences.join(", ")}.`
      : ""

    const isCookNow = mode === "cookNow"

    const ingredientRule = isCookNow
      ? `- STRICTLY use ONLY ingredients from the pantry list below. Do NOT include ANY ingredient not on this list — not even cooking basics like oil, salt, pepper, butter, or spices unless they are explicitly listed. The user wants to cook right now with ONLY what they have. If an ingredient is not in the list, do not use it. Every single ingredient in the recipe MUST appear in the pantry list.`
      : `- Use ingredients primarily from the pantry list, but you may include 1-3 extra ingredients per meal that the user would need to buy. Mark any non-pantry ingredient by appending " *" to its name (e.g. "salmon fillet *").`

    const prompt = `You are a nutrition-focused meal planner. Generate exactly ${count} high-protein meal suggestions.

User profile:
- Daily calorie goal: ${calorieGoal} kcal
- Daily protein goal: ${proteinGoal}g
- Meals per day: ${mealsPerDay}
- Cooking skill: ${cookingSkill}
- Max prep time: ${maxPrepMinutes} minutes
- Dietary restrictions: ${restrictions}${restrictionsLine}${dislikesLine}${dislikedMealsLine}${likedMealsLine}${cuisineLine}

Available pantry ingredients (listed oldest first — prioritize using the first items to reduce food waste):
${ingredients.join(", ")}

Rules:
${ingredientRule}
- PRIORITIZE ingredients listed first — they've been in the pantry longest and should be used up before newer items
- Each meal MUST have at least ${perMealProteinMin}g protein (scaled to this user's daily target and meal count). Every meal MUST include a strong protein source (chicken, beef, turkey, fish, eggs, tofu, greek yogurt, protein powder, or shrimp). Beans/lentils alone are NOT enough protein — they must be paired with a primary protein source
- Every meal MUST include a carbohydrate source (rice, pasta, bread, potatoes, oats, quinoa, tortillas, noodles, beans, lentils, or similar) UNLESS the user has a keto or low-carb dietary restriction. A meal with only protein + vegetables is NOT a complete meal.
- Calories per meal should be around ${Math.round(calorieGoal / mealsPerDay)} kcal
- HARD CONSTRAINT — prepTime MUST be ≤ ${maxPrepMinutes} minutes. The returned number AND the actual recipe steps must both be achievable in that time or less.
- Complexity must match the time budget:
  - ≤10 min: no-cook assembly, microwave reheats, scrambled eggs + toast, smoothies, yogurt bowls, overnight oats, wraps, cold plates. Single pan max. NO oven, NO multi-step sauces, NO braises, NO searing proteins over 6 min.
  - ≤20 min: quick stove-top — single-pan sear/sauté, scramble, quick stir-fry, quick pasta. NO oven, NO braises, NO slow-cook.
  - ≤30 min: standard weeknight — one protein + one starch + veg. Sheet-pan, one-pan, stir-fry, pasta. No slow-roasts or braises.
  - ≤90 min: full recipes including roasts, braises, marinated dishes, multi-component dishes, slow cooks.
- Recipe steps must reflect this budget. Do NOT describe a 30-minute cook for a claimed 10-minute meal. If you claim a short prepTime, the steps must ACTUALLY be doable in that time.
- For each ingredient include both a visual portion size (e.g. "1 palm", "1 fist", "2 tbsp") AND a gram/ml weight (e.g. "120g", "185g", "30ml")
- No repeated meals
- ONLY suggest real, practical meals that people actually eat. No bizarre combinations.
- CRITICAL: You do NOT need to use every pantry ingredient. Only include ingredients that make culinary sense for THIS specific meal. It is BETTER to skip a pantry ingredient than to force it into a meal where it doesn't belong.
- CUISINE COHERENCE IS MANDATORY: Every meal must fit ONE identifiable cuisine or style (Italian, Mexican, Asian/Thai/Chinese/Japanese, Mediterranean, American comfort, Middle Eastern, Indian, etc.). Before picking ingredients, decide the cuisine FIRST, then only include pantry items that belong in that cuisine. Do NOT create cuisine mash-ups (e.g. no peanut butter in Italian pasta, no soy sauce in Mediterranean bowls, no curry powder in Tex-Mex).
- NEVER include dessert ingredients (cheesecake mix, cake mix, cookie dough, pudding mix, frosting, brownie mix, pancake mix, ice cream, etc.) in savory main dishes (pasta, rice bowls, stir fries, salads, meat dishes, etc.). Dessert ingredients belong only in dessert meals.
- NEVER include sweet condiments (maple syrup, jam, jelly, honey in excess) in savory meats unless the recipe is explicitly sweet-savory (e.g. teriyaki, honey garlic — and only in small amounts).
- Peanut butter belongs ONLY in: (1) Asian noodle dishes with RICE NOODLES, SOBA, UDON, LO MEIN, (2) satay (grilled meat skewers with dipping sauce), (3) smoothies, (4) desserts. FORBIDDEN with: Italian/Mediterranean pasta, rice bowls (plain rice + protein + veg), plain grilled proteins, salads, or any non-noodle savory dish. When peanut butter IS used, it MUST be transformed into "peanut sauce" with soy sauce, lime, ginger, garlic, and chili — and the meal NAME must say "peanut sauce" (e.g. "Thai Peanut Sauce Soba") NOT "peanut butter" (never "peanut butter chicken" or "peanut butter bowl" — that sounds like school lunch, not a meal).
- If a pantry ingredient doesn't fit your chosen cuisine, SKIP IT. Do not force it into the recipe.
- Make every meal DELICIOUS — use seasonings, sauces, and condiments from the pantry list to maximize flavor. Plain unseasoned food is not acceptable. If the pantry has seasonings/sauces, use them generously. Think restaurant-quality flavor, not bland diet food.
- Fruits should not be mixed with savory meats (e.g. no "banana beef smoothie" or "kiwi steak bowl")
- Each meal should be a coherent dish — something you'd find at a restaurant or in a cookbook
- APPEAL TEST: Before finalizing each meal, ask: "Would a food photographer be excited to shoot this? Would someone actually order this on DoorDash?" If the answer is no, discard and try a different combination.
- NAMING: Meal names must sound like restaurant menu items. Use culinary terms (e.g. "Lemon Herb", "Miso Glazed", "Chipotle Lime", "Thai Basil", "Pesto", "Teriyaki"). Never name a meal after a crude ingredient list (bad: "Chicken Rice Broccoli Bowl", "Peanut Butter Chicken Bowl"; good: "Thai Basil Chicken Rice Bowl", "Teriyaki Sesame Chicken").
- Smoothies should only contain typical smoothie ingredients (fruits, protein powder, milk, yogurt, greens)

Respond ONLY with a JSON array, no markdown, no explanation:
[
  {
    "id": "1",
    "name": "meal name",
    "prepTime": ${maxPrepMinutes},
    "calories": 500,
    "protein": 45,
    "carbs": 40,
    "fat": 12,
    "ingredients": [
      { "name": "chicken breast", "visual": "1 palm-sized piece", "grams": "120g" }
    ],
    "steps": [
      { "title": "Sear Chicken", "detail": "Heat oil in a skillet over medium-high heat. Season chicken and cook 6-7 minutes per side until golden." },
      { "title": "Make Sauce", "detail": "Remove chicken. Add garlic, deglaze with broth, and simmer 2 minutes." }
    ]
  }
]`

    // Priority: Groq (free) > Google (free) > OpenAI (paid)
    const providers = [
      groqApiKey && { url: "https://api.groq.com/openai/v1/chat/completions", key: groqApiKey, model: "llama-3.3-70b-versatile", name: "Groq" },
      googleAiKey && { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: googleAiKey, model: "gemini-2.0-flash", name: "Google" },
      openaiApiKey && { url: "https://api.openai.com/v1/chat/completions", key: openaiApiKey, model: "gpt-4o-mini", name: "OpenAI" },
    ].filter(Boolean) as { url: string; key: string; model: string; name: string }[]

    let meals: any[] | null = null

    for (const provider of providers) {
      try {
        console.log(`Trying ${provider.name} (${provider.model})...`)
        const response = await fetch(provider.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${provider.key}` },
          body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: prompt }], temperature: 0.8, max_tokens: 2000 }),
        })
        const data = await response.json()
        if (data.error) {
          console.log(`${provider.name} error:`, data.error.message || JSON.stringify(data.error))
          continue
        }
        const text = data.choices?.[0]?.message?.content || "[]"
        const clean = text.replace(/```json|```/g, "").trim()
        meals = JSON.parse(clean)
        if (Array.isArray(meals) && meals.length > 0) {
          console.log(`${provider.name} success: ${meals.length} meals generated`)
          break
        }
        console.log(`${provider.name} returned empty, trying next...`)
        meals = null
      } catch (e) {
        console.log(`${provider.name} failed:`, (e as Error).message)
        continue
      }
    }

    if (!meals || meals.length === 0) {
      return new Response(JSON.stringify({ error: "All providers failed to generate meals" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      })
    }

    // Correct macros using FatSecret nutrition data
    if (fsKey && fsSecret) {
      console.log('Correcting macros via FatSecret...')
      meals = await Promise.all(meals.map((m: any) => correctMealMacros(m)))
      console.log('Macros corrected')
    }

    // Prep-time validation — drop meals the LLM claimed fit the budget but didn't.
    // If we lose too many (<50% survive), keep them but clamp the displayed prepTime so
    // the user-facing number is honest to their cap. The LLM lied about the number but
    // the meal itself may still be usable; clamping prevents user confusion.
    const originalCount = meals.length
    const compliant = meals.filter((m: any) => Number(m.prepTime) <= maxPrepMinutes)
    const droppedCount = originalCount - compliant.length
    if (droppedCount > 0) {
      console.log(`Prep-time validation: ${droppedCount}/${originalCount} meals exceeded maxPrepMinutes=${maxPrepMinutes}`)
    }
    if (compliant.length >= Math.ceil(originalCount / 2)) {
      // At least half compliant — use only compliant meals
      meals = compliant
    } else {
      // Too many non-compliant — clamp the prepTime field to avoid misleading the user
      meals = meals.map((m: any) => ({
        ...m,
        prepTime: Math.min(Number(m.prepTime) || maxPrepMinutes, maxPrepMinutes),
      }))
      console.log('Too few compliant — clamped prepTime on all meals instead of dropping')
    }

    // Return meals immediately, images will be fetched by a separate function
    return new Response(JSON.stringify(meals.map((m: any) => ({ ...m, image: null }))), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
