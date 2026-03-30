import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const openaiApiKey = Deno.env.get("OPENAI_API_KEY")
const replicateToken = Deno.env.get("REPLICATE_API_TOKEN")
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const db = createClient(supabaseUrl, supabaseServiceKey)

// In-memory cache for image URLs (persists across warm function invocations)
const imageCache = new Map<string, string>()

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

async function fetchMealImage(mealName: string): Promise<string | null> {
  if (!replicateToken) return null

  const cacheKey = normalizeKey(mealName)

  // Check in-memory cache
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey)!

  // Check DB cache
  const { data: cached } = await db.from('image_cache').select('image_url').eq('meal_key', cacheKey).single()
  if (cached?.image_url) {
    imageCache.set(cacheKey, cached.image_url)
    return cached.image_url
  }

  try {
    // Create prediction with synchronous mode (waits for result)
    const res = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicateToken}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt: `Professional food photography of ${mealName}, overhead shot on a dark plate, restaurant quality, warm lighting, appetizing, 4k`,
          num_outputs: 1,
          aspect_ratio: "16:9",
          output_format: "webp",
          output_quality: 80,
        },
      }),
    })
    const result = await res.json()
    const imageUrl = result.output?.[0] ?? null
    if (imageUrl) {
      imageCache.set(cacheKey, imageUrl)
      // Save to DB cache (fire and forget)
      db.from('image_cache').upsert({ meal_key: cacheKey, image_url: imageUrl }).then(() => {})
    }
    return imageUrl
  } catch {
    return null
  }
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
      mode = "cookNow",
    } = await req.json()

    const count = Math.min(mealsPerDay, 3)
    const restrictions = dietaryRestrictions.filter((d: string) => d !== "None").join(", ") || "none"
    const dislikesLine = foodDislikes.length > 0
      ? `\nThe user dislikes these ingredients — never include them: ${foodDislikes.join(", ")}.`
      : ""
    const dislikedMealsLine = dislikedMeals.length > 0
      ? `\nThe user rated these meals poorly — do NOT suggest them or anything similar: ${dislikedMeals.join(", ")}.`
      : ""
    const likedMealsLine = likedMeals.length > 0
      ? `\nThe user loved these meals — suggest meals with a similar style or ingredients: ${likedMeals.join(", ")}.`
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
- Dietary restrictions: ${restrictions}${dislikesLine}${dislikedMealsLine}${likedMealsLine}

Available pantry ingredients (listed oldest first — prioritize using the first items to reduce food waste):
${ingredients.join(", ")}

Rules:
${ingredientRule}
- PRIORITIZE ingredients listed first — they've been in the pantry longest and should be used up before newer items
- Each meal should be high protein (at least ${Math.round(proteinGoal / mealsPerDay)}g protein)
- Calories per meal should be around ${Math.round(calorieGoal / mealsPerDay)} kcal
- Keep prep time under ${maxPrepMinutes} minutes
- For each ingredient include both a visual portion size (e.g. "1 palm", "1 fist", "2 tbsp") AND a gram/ml weight (e.g. "120g", "185g", "30ml")
- No repeated meals
- ONLY suggest real, practical meals that people actually eat. No bizarre combinations.
- Make every meal DELICIOUS — use seasonings, sauces, and condiments from the pantry list to maximize flavor. Plain unseasoned food is not acceptable. If the pantry has seasonings/sauces, use them generously. Think restaurant-quality flavor, not bland diet food.
- Fruits should not be mixed with savory meats (e.g. no "banana beef smoothie" or "kiwi steak bowl")
- Each meal should be a coherent dish — something you'd find at a restaurant or in a cookbook
- Smoothies should only contain typical smoothie ingredients (fruits, protein powder, milk, yogurt, greens)

Respond ONLY with a JSON array, no markdown, no explanation:
[
  {
    "id": "1",
    "name": "meal name",
    "prepTime": 15,
    "calories": 500,
    "protein": 45,
    "carbs": 40,
    "fat": 12,
    "ingredients": [
      { "name": "chicken breast", "visual": "1 palm-sized piece", "grams": "120g" }
    ],
    "steps": [
      "Step 1 instruction",
      "Step 2 instruction"
    ]
  }
]`

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        max_tokens: 2000,
      }),
    })

    const data = await response.json()
    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message || JSON.stringify(data.error) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      })
    }
    const text = data.choices?.[0]?.message?.content || "[]"
    const clean = text.replace(/```json|```/g, "").trim()
    const meals = JSON.parse(clean)

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
