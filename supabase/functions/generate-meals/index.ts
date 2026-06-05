import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { checkScanCap, refundScan } from '../_shared/scan-cap.ts'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Hard per-user daily ceiling on meal generations (LLM call + ~3 FAL images each).
// Bounds API cost no matter what triggers a gen — auto-fire, manual refresh, a
// diet/pref change, or a retry — since the client-side MAX_DAILY_REGENS only gates
// the manual button. 3/day fits a real day (1 auto-gen + 1 refresh + 1 pref change).
const MEAL_GEN_CAP_PER_DAY = 3

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
      // Skip obviously-wrong FatSecret matches — a single ingredient over 900 kcal or 100g
      // protein almost certainly means the search matched the wrong food entry.
      if (macros.cal > 900 || macros.p > 100) continue
      totalCal += macros.cal
      totalP += macros.p
      totalC += macros.c
      totalF += macros.f
      lookedUp++
    }
  }

  // Only override LLM macros if FatSecret resolved ≥50% of ingredients AND the total is
  // within a sane single-serving range. Outside this band → trust the LLM (database
  // mismatch likely worse than estimate). Capped at 1200 here because generate-meals
  // produces single meals, not meal-prep portions.
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

  // Per-user daily cap — atomic check+increment up front; refunded on failure below
  // so a flaky-network retry doesn't burn the user's slot.
  const cap = await checkScanCap(req, 'meal_gen', MEAL_GEN_CAP_PER_DAY)
  if (!cap.allowed) {
    console.log(`[generate-meals] daily cap hit: ${cap.used}/${MEAL_GEN_CAP_PER_DAY}`)
    return new Response(
      JSON.stringify({ error: `Daily meal limit reached (${MEAL_GEN_CAP_PER_DAY}/day). Check back tomorrow.`, code: 'meal_cap_reached' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    )
  }

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
      recentMealNames = [],
      mode = "cookNow",
    } = await req.json()

    // Overgenerate-then-rank: ask the LLM for MORE meals than we'll display, filter against
    // tight bands, then return the top N by macro fit. Compensates for LLM non-compliance
    // (Gemini Flash Lite ignores constraints under load) without raising image-gen cost —
    // images only get fetched client-side for the FINAL displayed meals.
    const displayCount = Math.min(mealsPerDay, 3)
    const genCount = mode === 'cookNow' ? Math.max(displayCount + 2, 5) : displayCount
    // Per-meal protein band: ±15% of daily target divided by mealsPerDay. Upper cap prevents
    // protein dumping (96g in one meal = poor absorption + GI discomfort). Protein goals
    // already factor bodyweight via calculateGoals (lose=1.2g/lb, maintain=1.0, bulk=0.8).
    const proteinTarget = Math.round(proteinGoal / mealsPerDay)
    const proteinMin = Math.max(15, Math.floor(proteinTarget * 0.85))
    const proteinMax = Math.ceil(proteinTarget * 1.15)
    // Per-meal calorie band: ±15% of daily target divided by mealsPerDay. Same ±15% as
    // protein so meals are sized consistently. Filtered at 1.40× buffer below.
    const calorieTarget = Math.round(calorieGoal / mealsPerDay)
    const calorieMin = Math.floor(calorieTarget * 0.85)
    const calorieMax = Math.ceil(calorieTarget * 1.15)
    const restrictions = dietaryRestrictions.filter((d: string) => d !== "None").join(", ") || "none"
    const restrictionsLine = restrictions !== "none"
      ? `\n- STRICT dietary requirements — NEVER violate these under any circumstances: ${restrictions}. Any meal that includes a forbidden ingredient for these restrictions must be discarded entirely.`
      : ""
    const dislikesLine = foodDislikes.length > 0
      ? `\n- HARD EXCLUSIONS — these are allergens, intolerances, or foods the user must never eat. NEVER include them as ingredients, toppings, bases, sauces, or hidden components in any meal. Any meal containing any of these must be discarded entirely: ${foodDislikes.join(", ")}.`
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
    const recentMealsLine = recentMealNames.length > 0
      ? `\nDO NOT SUGGEST these meals — they were shown in recent generations and would feel like a repeat: ${recentMealNames.join(", ")}. Suggest different dishes, even if the same ingredients are involved.`
      : ""

    // Recipe complexity scales with cookingSkill from onboarding.
    // Minimal cooks get short weeknight meals; culinary cooks get real chef-level dishes.
    const complexityBands = (() => {
      switch (cookingSkill) {
        case 'minimal':     return { ingredients: '4-7',  steps: '3-5' }
        case 'moderate':    return { ingredients: '5-10', steps: '4-7' }
        case 'adventurous': return { ingredients: '6-12', steps: '5-9' }
        case 'culinary':    return { ingredients: '7-15', steps: '6-12' }
        default:            return { ingredients: '5-10', steps: '4-7' }
      }
    })()

    const isCookNow = mode === "cookNow"

    // Detect distinct primary protein sources in the pantry. If 3+ are available,
    // enforce that each of the 3 displayed meals uses a different one. With 1-2
    // sources, this constraint is impossible to satisfy — skip it so the LLM can
    // reuse the available protein across meals (e.g. all chicken if that's all you have).
    const PROTEIN_GROUPS: Record<string, string[]> = {
      chicken: ['chicken'],
      beef: ['beef', 'steak', 'sirloin', 'ribeye', 'flank', 'skirt', 'chuck', 'brisket'],
      turkey: ['turkey'],
      pork: ['pork', 'bacon', 'ham', 'prosciutto', 'sausage', 'chorizo'],
      lamb: ['lamb'],
      salmon: ['salmon'],
      tuna: ['tuna'],
      shrimp: ['shrimp'],
      whitefish: ['cod', 'tilapia', 'haddock', 'halibut', 'sea bass'],
      eggs: ['egg'],
      tofu: ['tofu'],
      tempeh: ['tempeh'],
      'cottage cheese': ['cottage cheese'],
      'greek yogurt': ['greek yogurt', 'skyr'],
      lentils: ['lentil'],
      beans: ['black bean', 'kidney bean', 'pinto bean', 'white bean', 'navy bean'],
      chickpeas: ['chickpea', 'garbanzo'],
      'protein powder': ['protein powder', 'whey'],
    }
    const pantryLower = ingredients.map((i: string) => i.toLowerCase()).join(' | ')
    const detectedProteins = Object.entries(PROTEIN_GROUPS)
      .filter(([_, keywords]) => keywords.some(kw => pantryLower.includes(kw)))
      .map(([name]) => name)
    const proteinVarietyRule = (isCookNow && detectedProteins.length >= 3)
      ? `\n- PROTEIN VARIETY (blocking): pantry has ${detectedProteins.length} distinct primary protein sources — ${detectedProteins.join(', ')}. Each of the ${displayCount} displayed meals MUST use a DIFFERENT primary protein. Do not repeat a protein across meals. This prevents redundancy when the user clearly has variety on hand.`
      : ''

    const ingredientRule = isCookNow
      ? `- HYBRID COOK NOW MODE — generate exactly ${genCount} meals split as follows:
  • The first ${genCount - 1} meals (STRICT): use ONLY ingredients from the pantry list. NO ingredient outside the list — not even oil, salt, pepper, butter, or spices unless they're explicitly listed. Set "missing_ingredients": [] for each. These prove "you can cook tonight with what you have."
  • The last meal (STRETCH): may include 1-2 additional COMMON staples not in the pantry (allowed extras: salt, pepper, olive oil, garlic, butter, soy sauce, lemon, rice, pasta, eggs, common dried herbs). NEVER suggest unusual/expensive items (saffron, truffle oil, specialty cheeses, rare proteins). This is "with a quick stop you could make this."
- Every ingredient in STRICT meals MUST appear in the pantry list (case-insensitive, allowing plural/singular and substring matches — pantry "chicken breast" covers meal "chicken").`
      : `- Use ingredients primarily from the pantry list, but you may include 1-3 extra ingredients per meal that the user would need to buy.`

    const prompt = `You are a nutrition-focused meal planner. Generate exactly ${genCount} high-protein meal suggestions.

User profile:
- Daily calorie goal: ${calorieGoal} kcal
- Daily protein goal: ${proteinGoal}g
- Meals per day: ${mealsPerDay}
- Cooking skill: ${cookingSkill === 'minimal' ? 'minimal (beginner-friendly meals only — basic heat application, one pan where possible, think scrambled eggs, pasta with jarred sauce, sheet pan meals, no complex techniques)' : cookingSkill === 'moderate' ? 'moderate (standard home cook — can follow a multi-step recipe, comfortable with a pan and oven)' : cookingSkill === 'adventurous' ? 'adventurous (confident cook — bold and global flavors, complexity is welcome, unfamiliar ingredients encouraged)' : cookingSkill === 'culinary' ? 'culinary (advanced home cook — multi-step techniques, braising, homemade sauces, chef-level complexity expected)' : cookingSkill}
- Max prep time: ${maxPrepMinutes} minutes
- Dietary restrictions: ${restrictions}${restrictionsLine}${dislikesLine}${dislikedMealsLine}${likedMealsLine}${cuisineLine}${recentMealsLine}

Available pantry ingredients (listed oldest first — prioritize using the first items to reduce food waste):
${ingredients.join(", ")}

Rules:
${ingredientRule}${proteinVarietyRule}
- PRIORITIZE ingredients listed first — they've been in the pantry longest and should be used up before newer items
- PROTEIN DISTRIBUTION (blocking constraint): every meal MUST have ${proteinMin}g–${proteinMax}g protein (target ~${proteinTarget}g). Distribute protein EVENLY across meals — never pile into one and starve another. Above max causes poor absorption + GI discomfort.
- CALORIE DISTRIBUTION (blocking constraint): every meal MUST have ${calorieMin}–${calorieMax} kcal (target ~${calorieTarget} kcal). Daily total ${calorieGoal} ÷ ${mealsPerDay} meals = ${calorieTarget} per meal. Distribute calories EVENLY — meals far outside this band wreck the user's daily macro plan.
- Every meal MUST include a strong protein source (chicken, beef, turkey, fish, eggs, tofu, greek yogurt, protein powder, or shrimp). Beans/lentils alone are NOT enough protein — they must be paired with a primary protein source.
- Every meal MUST include a carbohydrate source (rice, pasta, bread, potatoes, oats, quinoa, tortillas, noodles, beans, lentils, or similar) UNLESS the user has a keto or low-carb dietary restriction. A meal with only protein + vegetables is NOT a complete meal.
- HARD CONSTRAINT — prepTime MUST be ≤ ${maxPrepMinutes} minutes. The returned number AND the actual recipe steps must both be achievable in that time or less. prepTime must be the REALISTIC time to make this dish — do NOT default every meal to ${maxPrepMinutes}. A 25-minute pasta is 25 min, a 5-min smoothie is 5 min. Honest times only.
${maxPrepMinutes <= 10 ? `- ⚠️ MAX PREP IS ${maxPrepMinutes} MINUTES — this is extremely tight. You are ONLY allowed to suggest meals from this approved list of genuinely fast formats: protein shake or smoothie, Greek yogurt parfait, overnight oats (pre-made), cottage cheese bowl, scrambled eggs on toast (2-3 min scramble max), microwave rice + canned/pre-cooked protein, wrap or tortilla with pre-cooked filling, tuna or chicken salad on bread or crackers, cold high-protein bowl using pre-cooked or ready-to-eat ingredients. FORBIDDEN formats: any raw meat that must be cooked from scratch (chicken breast, ground beef, shrimp, fish fillets), pasta (boiling alone takes 8-10 min), oven dishes, stir fries with raw protein, soups from scratch, anything with more than 2 cooking steps. If your pantry has pre-cooked or ready-to-eat proteins (rotisserie chicken, canned tuna, canned chicken, hard boiled eggs, deli meat, Greek yogurt, cottage cheese, protein powder), use those.` : ''}
- Complexity must match the time budget:
  - ≤10 min: no-cook assembly, microwave reheats, scrambled eggs + toast, smoothies, yogurt bowls, overnight oats, wraps with pre-cooked fillings, cold plates. NO raw meat cooked from scratch, NO pasta, NO oven.
  - ≤20 min: quick stove-top only — single-pan sear/sauté, scramble, quick stir-fry, quick pasta. NO oven, NO braises.
  - ≤30 min: standard weeknight — one protein + one starch + veg. Sheet-pan, one-pan, stir-fry, pasta. No slow-roasts or braises.
  - ≤90 min: full recipes including roasts, braises, marinated dishes, multi-component dishes.
- Recipe steps must ACTUALLY fit within the prepTime claimed. If a step alone (e.g. boiling pasta) takes longer than the budget, the entire meal is disqualified.
- For each ingredient include both a visual portion size (e.g. "1 palm", "1 fist", "2 tbsp") AND a gram/ml weight (e.g. "120g", "185g", "30ml")
- INGREDIENT COMPLETENESS (blocking): EVERY single item referenced in any step — including oil, butter, salt, pepper, garlic, lemon juice, broth, spices, pasta, rice, sauces, anything — MUST appear in the "ingredients" array with grams/visual. If a step says "add garlic," there MUST be a garlic entry in ingredients. No exceptions. The "missing_ingredients" array is a FILTER LIST of names already present in "ingredients" that aren't in the pantry — it never contains items that aren't also in "ingredients".
- No repeated meals
- KEEP IT COOKABLE — scaled to this user's cooking skill (${cookingSkill}):
  • Ingredients per meal: ${complexityBands.ingredients}. Fewer for simple dishes, more for complex dishes (curries, stews, layered cuisines). Stay in this band — don't push past the cap or undershoot the floor.
  • Steps per meal: ${complexityBands.steps}. Scale to dish complexity within the band.
- ATOMIC STEPS: each step contains ONE primary cooking action so it's easy to follow while actually cooking.
  ✗ BAD: "Heat oil in pan, add chicken, sear 5 minutes" (3 actions crammed into one step)
  ✓ GOOD: "Heat oil in pan." → "Add chicken." → "Sear 5 minutes." (3 separate steps)
  Combine ONLY when actions happen simultaneously without a state change (e.g. "season with salt and pepper" is one step).
- No filler steps ("Set aside" or "Wait" as their own step) — fold those into the adjacent action step.
- ONLY suggest real, practical meals that people actually eat. No bizarre combinations.
- CRITICAL: You do NOT need to use every pantry ingredient. Only include ingredients that make culinary sense for THIS specific meal. It is BETTER to skip a pantry ingredient than to force it into a meal where it doesn't belong.
- CUISINE COHERENCE IS MANDATORY: Every meal must fit ONE identifiable cuisine or style (Italian, Mexican, Asian/Thai/Chinese/Japanese, Mediterranean, American comfort, Middle Eastern, Indian, etc.). Before picking ingredients, decide the cuisine FIRST, then only include pantry items that belong in that cuisine. Do NOT create cuisine mash-ups (e.g. no peanut butter in Italian pasta, no soy sauce in Mediterranean bowls, no curry powder in Tex-Mex).
- NEVER include dessert ingredients (cheesecake mix, cake mix, cookie dough, pudding mix, frosting, brownie mix, pancake mix, ice cream, etc.) in savory main dishes (pasta, rice bowls, stir fries, salads, meat dishes, etc.). Dessert ingredients belong only in dessert meals.
- NEVER include sweet condiments (maple syrup, jam, jelly, honey in excess) in savory meats unless the recipe is explicitly sweet-savory (e.g. teriyaki, honey garlic — and only in small amounts).
- Peanut butter belongs ONLY in: (1) Asian noodle dishes with RICE NOODLES, SOBA, UDON, LO MEIN, (2) satay (grilled meat skewers with dipping sauce), (3) smoothies, (4) desserts. FORBIDDEN with: Italian/Mediterranean pasta, rice bowls (plain rice + protein + veg), plain grilled proteins, salads, or any non-noodle savory dish. When peanut butter IS used, it MUST be transformed into "peanut sauce" with soy sauce, lime, ginger, garlic, and chili — and the meal NAME must say "peanut sauce" (e.g. "Thai Peanut Sauce Soba") NOT "peanut butter" (never "peanut butter chicken" or "peanut butter bowl" — that sounds like school lunch, not a meal).
- If a pantry ingredient doesn't fit your chosen cuisine, SKIP IT. Do not force it into the recipe.
- FLAVOR PRINCIPLE: every meal must hit at least TWO of the four flavor axes — (1) acid (lemon, lime, vinegar, pickled anything), (2) heat (chili, pepper flakes, hot sauce, fresh ginger, black pepper), (3) umami (soy sauce, fish sauce, parmesan, miso, mushrooms, nutritional yeast, tomato paste), (4) aromatic fat (browned butter, garlic in oil, sesame oil, olive oil with herbs). This is how real cooks build flavor — plain salt and pepper alone is not enough. If the pantry has the seasonings, USE them generously.
- NO DIET FOOD: Pantry's user wants macro-aware meals that ALSO taste exciting — not punishment food. Bro-meal-prep clichés (plain grilled chicken + plain steamed broccoli + plain rice, "diet" framing) are FORBIDDEN. Every meal must read as something the user would still want to eat even if they weren't tracking macros.
- Fruits should not be mixed with savory meats (e.g. no "banana beef smoothie" or "kiwi steak bowl")
- Each meal should be a coherent dish — something you'd find at a restaurant or in a cookbook
- APPEAL TEST: Before finalizing each meal, ask: "Would a food photographer be excited to shoot this? Would someone actually order this on DoorDash?" If the answer is no, discard and try a different combination.
- NAMING: Meal names must sound like restaurant menu items. Use culinary terms (e.g. "Lemon Herb", "Miso Glazed", "Chipotle Lime", "Thai Basil", "Pesto", "Teriyaki"). Never name a meal after a crude ingredient list (bad: "Chicken Rice Broccoli Bowl", "Peanut Butter Chicken Bowl"; good: "Thai Basil Chicken Rice Bowl", "Teriyaki Sesame Chicken").
- Smoothies should only contain typical smoothie ingredients (fruits, protein powder, milk, yogurt, greens)

Respond ONLY with a JSON array, no markdown, no explanation. Note how EVERY item mentioned in steps (oil, garlic, broth, salt, pepper) appears in the ingredients array. "missing_ingredients" lists the NAMES of ingredients already in the array that aren't in the pantry:
[
  {
    "id": "1",
    "name": "meal name",
    "prepTime": 25,
    "calories": 500,
    "protein": 45,
    "carbs": 40,
    "fat": 12,
    "ingredients": [
      { "name": "chicken breast", "visual": "1 palm-sized piece", "grams": "120g" },
      { "name": "olive oil", "visual": "1 tbsp", "grams": "15ml" },
      { "name": "garlic", "visual": "2 cloves", "grams": "6g" },
      { "name": "chicken broth", "visual": "1/4 cup", "grams": "60ml" },
      { "name": "salt", "visual": "to taste", "grams": "2g" },
      { "name": "black pepper", "visual": "to taste", "grams": "1g" }
    ],
    "missing_ingredients": [],
    "steps": [
      { "title": "Sear Chicken", "detail": "Heat oil in a skillet over medium-high heat. Season chicken with salt and pepper and cook 6-7 minutes per side until golden." },
      { "title": "Make Sauce", "detail": "Remove chicken. Add garlic, deglaze with broth, and simmer 2 minutes." }
    ]
  }
]`

    // Priority: Google Gemini 3.1 Flash Lite (free, commercial-OK) > OpenAI gpt-4o-mini (paid fallback)
    const providers = [
      googleAiKey && { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: googleAiKey, model: "gemini-3.1-flash-lite", name: "Google" },
      openaiApiKey && { url: "https://api.openai.com/v1/chat/completions", key: openaiApiKey, model: "gpt-4o-mini", name: "OpenAI" },
    ].filter(Boolean) as { url: string; key: string; model: string; name: string }[]

    let meals: any[] | null = null

    for (const provider of providers) {
      try {
        console.log(`Trying ${provider.name} (${provider.model})...`)
        const response = await fetch(provider.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${provider.key}` },
          // temperature 0.8 — enough variety so consecutive generations don't return identical
          // meals, but not so high that the LLM ignores the dense constraint list above.
          // max_tokens 2000 — 5 full meals with ingredient arrays + step arrays fits here;
          // raise if we ever generate >7 meals per call (currently capped at genCount=5).
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
      await refundScan(req, 'meal_gen') // generation failed — don't burn the user's daily slot
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

    // Macro band validation — drop meals (post-FatSecret correction) that violate either
    // band by 40%+. Both protein and calories enforced with 1.40× buffer so near-misses
    // pass but genuine outliers (e.g. 96g protein, 1500 cal bombs) get caught.
    const proteinDropThreshold = proteinMax * 1.40
    const calorieDropThreshold = calorieMax * 1.40
    const beforeBands = meals.length
    meals = meals.filter((m: any) =>
      Number(m.protein) <= proteinDropThreshold &&
      Number(m.calories) <= calorieDropThreshold
    )
    const droppedByBands = beforeBands - meals.length
    if (droppedByBands > 0) {
      console.log(`Macro bands: dropped ${droppedByBands}/${beforeBands} meals exceeding 1.4× caps (protein > ${Math.round(proteinDropThreshold)}g or calories > ${Math.round(calorieDropThreshold)} kcal)`)
    }

    // Overgenerate-then-rank: we asked the LLM for genCount meals (5+) but only display
    // displayCount (3). Rank survivors by macro fit — sum of normalized squared distance
    // from per-meal targets — and slice to the top displayCount. Lower score = better fit.
    if (meals.length > displayCount) {
      const beforeRank = meals.length
      meals = meals
        .map((m: any) => {
          const pDelta = (Number(m.protein) - proteinTarget) / Math.max(proteinTarget, 1)
          const cDelta = (Number(m.calories) - calorieTarget) / Math.max(calorieTarget, 1)
          const fitScore = pDelta * pDelta + cDelta * cDelta
          return { ...m, _fitScore: fitScore }
        })
        .sort((a: any, b: any) => a._fitScore - b._fitScore)
        .slice(0, displayCount)
        .map((m: any) => { const { _fitScore, ...rest } = m; return rest })
      console.log(`Macro rank: kept top ${displayCount}/${beforeRank} meals by per-meal target fit`)
    }

    // Prep-time validation — drop meals whose claimed prepTime exceeds the user's budget.
    // The LLM occasionally returns a 30-min recipe when the user asked for ≤10 min — usually
    // a hallucinated "prepTime: 25" alongside a recipe that actually IS doable in 10. Dropping
    // is cleaner than clamping: clamping would lie to the user about how long it takes.
    const originalCount = meals.length
    meals = meals.filter((m: any) => Number(m.prepTime) <= maxPrepMinutes)
    const droppedCount = originalCount - meals.length
    if (droppedCount > 0) {
      console.log(`Prep-time validation: dropped ${droppedCount}/${originalCount} meals that exceeded maxPrepMinutes=${maxPrepMinutes}`)
    }

    // Return meals immediately, images will be fetched by a separate function
    return new Response(JSON.stringify(meals.map((m: any) => ({ ...m, image: null }))), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    await refundScan(req, 'meal_gen') // unexpected failure — refund the slot
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
