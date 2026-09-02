import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { requirePremium } from '../_shared/premium.ts'
import { checkScanCap, refundScan } from '../_shared/scan-cap.ts'
import { mapLimit } from '../_shared/concurrency.ts'
import { sanitizeList } from '../_shared/sanitize.ts'
import { RECENT_MEMORY, dishKey, matchesRecentDish, clusterDishes, clusterDishCounts, isSameDish, isSameDishDetailed } from '../_shared/dish-key.ts'
import { verifyMacros } from '../_shared/macro-estimate.ts'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Hard per-user daily ceiling on meal generations (LLM call + ~3 FAL images each).
// Bounds API cost no matter what triggers a gen — auto-fire, manual refresh, a
// diet/pref change, or a retry — since the client-side MAX_DAILY_REGENS only gates
// the manual button. 6/day gives headroom for a real premium day (1 auto-gen + up to 3
// manual rerolls + a scan or two) without a false "limit reached"; still a runaway backstop.
const MEAL_GEN_CAP_PER_DAY = 6

const openaiApiKey = Deno.env.get("OPENAI_API_KEY")
const googleAiKey = Deno.env.get("GOOGLE_AI_KEY")
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

  // Cap ingredient lookups at 5 concurrent — combined with the meal-level cap below,
  // total in-flight FatSecret requests stays bounded (~15) instead of N×M all at once.
  const results = await mapLimit(ingredients, 5, (ing: any) => {
    const grams = parseInt(String(ing.grams)) || 100
    return lookupMacros(ing.name, grams)
  })

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
  // Server-side premium gate (dormant until PREMIUM_ENFORCEMENT=on; fails open on errors).
  const denied = await requirePremium(user.id)
  if (denied) return denied

  // Key on the verified user id, not x-forwarded-for — XFF is fully client-controlled,
  // so an attacker could send a unique value per request and land each in a fresh bucket,
  // defeating the limiter on this (expensive) endpoint entirely.
  const { allowed } = rateLimit(`u:${user.id}`, 10, 60000)
  if (!allowed) return rateLimitResponse()

  // Per-user daily cap — atomic check+increment up front; refunded on failure below
  // so a flaky-network retry doesn't burn the user's slot.
  const cap = await checkScanCap(req, 'meal_gen', MEAL_GEN_CAP_PER_DAY)
  if (!cap.allowed) {
    console.log(`[generate-meals] daily cap hit: ${cap.used}/${MEAL_GEN_CAP_PER_DAY}`)
    return new Response(
      // Warm + number-free (matches the scan cap tone) — the cap is a backstop most users never
      // hit, so a rare hit reads as "you've explored a lot," not "you're rate-limited."
      JSON.stringify({ error: `You've generated a lot of meals today — fresh ideas back tomorrow.`, code: 'meal_cap_reached' }),
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
      dietaryRestrictions: rawRestrictions,
      foodDislikes: rawDislikes = [],
      dislikedMeals: rawDislikedMeals = [],
      likedMeals: rawLikedMeals = [],
      cuisinePreferences: rawCuisines = [],
      recentMealNames: rawRecent = [],
      mode = "cookNow",
      staplesExcluded: rawStaplesExcluded = [], // basics the user tapped "I don't keep this" on
    } = await req.json()

    // Sanitize every user-controlled list before it hits the prompt — strips injection
    // newlines/quotes and caps count + length (token-bloat DoS). Downstream code uses
    // these names unchanged.
    const dietaryRestrictions = sanitizeList(rawRestrictions)
    const foodDislikes = sanitizeList(rawDislikes)
    const dislikedMeals = sanitizeList(rawDislikedMeals)
    const likedMeals = sanitizeList(rawLikedMeals)
    const cuisinePreferences = sanitizeList(rawCuisines)
    // The client's AsyncStorage list only covers this device and ~4 generations, so the durable
    // server-side window is the real memory; the client copy is unioned in as redundancy for a
    // first gen where the profile read fails.
    const { data: recentRow } = await db
      .from("profiles")
      .select("recent_meal_names")
      .eq("id", user.id)
      .maybeSingle()
    // C: the same history WITH its ingredients, when we have it. generated_meals only started
    // recording today, so this is empty for existing users and fills in from here — the code below
    // falls back to names for anything it does not cover, so an empty table behaves exactly as
    // before. Read on the same trip as the profile above; it is one indexed query on user_id.
    const { data: recentRows } = await db
      .from("generated_meals")
      .select("name, meal_data")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(RECENT_MEMORY * 2)
    type RecentDish = { name: unknown; ingredients: unknown }
    const recentDetailed: RecentDish[] = (recentRows ?? []).map((r: any) => ({
      name: r?.name,
      ingredients: r?.meal_data?.ingredients,
    }))
    const detailedKeys = new Set(recentDetailed.map((r: RecentDish) => dishKey(r.name)))

    const recentMealNames = Array.from(new Set([
      ...sanitizeList(recentRow?.recent_meal_names ?? [], RECENT_MEMORY),
      ...sanitizeList(rawRecent, RECENT_MEMORY),
    ])).slice(0, RECENT_MEMORY)
    // Fingerprints for the code-level drop below. The prompt line alone was never enough:
    // this endpoint already assumes the primary model ignores constraints under load (see the
    // macro-band enforcement), and meal names got no such backstop until now.

    // Overgenerate-then-rank: ask the LLM for MORE meals than we'll display, filter against
    // tight bands, then return the top N by macro fit. Compensates for LLM non-compliance
    // (Gemini Flash Lite ignores constraints under load) without raising image-gen cost —
    // images only get fetched client-side for the FINAL displayed meals.
    const displayCount = Math.min(mealsPerDay, 3)
    // 5 candidates for 3 slots left only 2 spare, and the repeat filter cannot invent variety —
    // it only reorders what the model produced, sending repeats to the back. With a nearly-full
    // window most candidates get flagged, the freshness sort has nothing to prefer, and it degrades
    // to plain macro ranking. More candidates is the only lever that gives it something to pick.
    // Costs a longer completion on ONE call per generation; nothing extra is imaged, since images
    // are fetched client-side for the final displayCount only.
    const genCount = mode === 'cookNow' ? Math.max(displayCount + 5, 8) : displayCount
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
    // Per-meal FAT ceiling. There's no stored fat goal, so derive a sane daily fat (~30% of
    // kcal) split per meal — stops a single meal (e.g. beef + cheese + creamy dressing +
    // buttered bread) from eating the whole day's fat. Skipped for keto/low-carb/carnivore,
    // where high fat IS the intended fuel. Enforced both in the prompt and by the drop+rank below.
    const highFatDiet = dietaryRestrictions.some((d: string) => /keto|low[- ]?carb|carnivore/i.test(String(d)))
    const fatTarget = Math.round((calorieGoal * 0.30 / 9) / mealsPerDay)
    const fatMax = Math.max(25, Math.ceil(fatTarget * 1.15))
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
    // Handing over 30 exact names taught the model to avoid those STRINGS: it complied literally
    // and returned reworded variants. Measured on a live window, 29 remembered names were only 14
    // distinct dishes — seven names for one cottage cheese bowl. So send the DISHES, and say
    // plainly that a new adjective is not a new dish.
    // With COUNTS. A deduped list says a cottage cheese bowl was served; the count says seven of
    // the last ten were, which is the part that actually reads as "stop". Ordered worst-first so
    // the offenders lead.
    const recentCounts = clusterDishCounts(recentMealNames).sort((a, b) => b.count - a.count)
    const recentDishes = recentCounts.map(c => (c.count > 1 ? `${c.name} (served ${c.count}x)` : c.name))
    const recentMealsLine = recentDishes.length > 0
      ? `\nALREADY SERVED RECENTLY — do not suggest these dishes OR a reworded version of one: ${recentDishes.join(", ")}.` +
        `\nA different adjective is NOT a different dish. "Cottage Cheese and Herb Potato Bowl" and "Cottage Cheese and Fruit Power Bowl" are the SAME dish to the person reading it, and so are "Egg White Scramble with Toast" and "Egg White Scramble with Potatoes". To count as different, change the PRIMARY PROTEIN or the FORM of the dish (bowl vs wrap vs bake vs soup) — not the garnish, not the adjective, not the side.`
      : ""
    const fatLine = highFatDiet ? "" :
      `\n- FAT CEILING (blocking constraint): every meal MUST have ≤ ${fatMax}g fat (aim ~${fatTarget}g). A single meal must NOT eat the whole day's fat budget — a beef + cheese + creamy dressing + buttered bread pileup at 50g+ fat is disqualified. Use leaner cuts, less cheese/oil, or pick a naturally leaner dish to stay under. Protein and carbs matter more than packing in fat.`

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

    // Assumed staples the user has NOT opted out of. Conservative cooking ENABLERS only (fats,
    // seasonings, baking basics) — never meal-defining items (eggs/rice/produce/proteins), which
    // must come from the scanned pantry. KEEP IN SYNC with constants/staples.ts (client copy).
    const excludedStaples: string[] = (Array.isArray(rawStaplesExcluded) ? rawStaplesExcluded : [])
      .map((s: any) => String(s).toLowerCase().trim()).filter(Boolean)
    // Diet-aware auto-exclusion: never assume butter for a vegan/dairy-free user, or flour for a
    // gluten-free one — using restrictions we already have, no opt-out needed. KEEP IN SYNC with
    // dietExcludedStaples() in constants/staples.ts.
    const dietLower = (dietaryRestrictions as string[]).map((x: string) => x.toLowerCase())
    if (dietLower.includes('vegan') || dietLower.includes('dairy-free')) excludedStaples.push('butter')
    if (dietLower.includes('gluten-free')) excludedStaples.push('all-purpose flour')
    const ASSUMED = ['salt', 'black pepper', 'cooking oil', 'olive oil', 'butter', 'all-purpose flour', 'sugar',
      'garlic powder', 'onion powder', 'paprika', 'cumin', 'chili powder', 'oregano', 'basil', 'Italian seasoning', 'cinnamon', 'red pepper flakes']
      .filter(s => !excludedStaples.includes(s.toLowerCase()))
    const excludedClause = excludedStaples.length
      ? ` EXCEPTION — the user has told us they do NOT keep: ${excludedStaples.join(', ')}; treat those as missing if a recipe needs them.`
      : ''

    const ingredientRule = isCookNow
      ? `- HYBRID COOK NOW MODE — generate exactly ${genCount} meals split as follows:
  • ASSUMED BASICS: assume the kitchen always stocks these — you may ALWAYS use them and must NEVER put them in "missing_ingredients": ${ASSUMED.join(', ')}, and water.${excludedClause} Do NOT assume anything a meal is BUILT from — eggs, milk, cheese, yogurt, rice, pasta, bread, fresh produce (onion, garlic, lemon, tomato), or any protein — those must be in the pantry list to be used.
  • The first ${genCount - 1} meals (STRICT): besides the assumed basics above, use ONLY ingredients from the pantry list. Set "missing_ingredients": [] for each. These prove "you can cook tonight with what you have."
  • The last meal (NEAR-STRICT): may be missing at most 1-2 OPTIONAL FINISHING items only — a garnish, a fresh herb, a seasoning, a squeeze of citrus, a drizzle. THE TEST: the user must be able to cook this dish TONIGHT, in full, and have it still be good, without ever leaving the house. If the missing item changes what the dish IS, it is NOT allowed.
    - NEVER missing: the protein, the main carb/base (rice, pasta, bread, potato), the primary fat/dairy, or anything named in or implied by the dish title. A "cheesy" dish with no cheese in the pantry, or a rice bowl with no rice, is FORBIDDEN — that is a different dish the user cannot make, not a stretch.
    - NEVER suggest unusual/expensive items (saffron, truffle oil, specialty cheeses, rare proteins).
- Every ingredient in STRICT meals MUST appear in the pantry list OR be one of the assumed basics above. Matching is case-insensitive, allowing plural/singular and substring matches — pantry "chicken breast" covers meal "chicken".
- QUANTITY REALISM: the pantry list records WHAT the user has, never HOW MUCH. Assume ordinary household amounts and never build a meal that hinges on a large quantity of one non-staple item (a dozen eggs, a whole block of cheese, 400g of a single protein). If a dish only works at that scale, choose a different dish. Portions should serve one person.
- EQUIPMENT: assume ONLY a stove, oven, microwave, and basic blender. A recipe must never REQUIRE an air fryer, instant pot, slow cooker, sous vide, stand mixer, food processor, or grill — the user may not own one. You may mention one as an optional alternative ("or air-fry"), never as the only path.
- SPREAD ACROSS EATING OCCASIONS: these suggestions are generated ONCE and shown all day, so do not make them all the same kind of meal. Across the displayed meals include a mix — something light/fast (breakfast or snack character) and something substantial (lunch/dinner character) — so the set is still useful whether it's 8am or 8pm. Tag each meal with "slot": one of "breakfast", "lunch", "dinner", or "any".
- RESPECT THE CUT/FORM — it dictates the cooking method, and the wrong pairing makes the recipe impossible:
  - Ground meat -> tacos, bolognese, burgers, chili, meatballs. Never "sliced" or "seared whole".
  - Tough/collagen cuts (chuck, brisket, shank, pork shoulder, short rib) need LOW AND SLOW (braise, stew, 2h+). NEVER put one in a fast weeknight dish or claim a prep time it cannot meet.
  - Tender steak cuts (ribeye, sirloin, strip, flank, skirt) -> sear/grill/stir-fry, sliced against the grain. Never braised for hours.
  - Chicken breast -> quick cook, dries out easily; thighs -> forgiving, better braised/roasted/grilled.
  - The same applies to any ingredient whose form drives technique (arborio rice -> risotto, not a side; mozzarella melts, feta crumbles and does not).
  - If the pantry item is generic ("beef", "chicken"), pick the technique that suits the most common form of it and stay consistent with the stated prep time.
- NAME THE SPECIFIC VARIETY, never the generic category. "Pasta", "cheese", "rice", "vinegar", "oil", "bread" are too vague — the right variety changes the dish, the cook time, and the photo (rice noodles suit a Thai dish; penne does not).
  - If the pantry HAS one, name that exact item: pantry "penne" -> the recipe says "penne", not "pasta".
  - If it is genuinely absent, name the variety the dish actually calls for ("rice noodles", "sharp cheddar", "jasmine rice") so the shopping line is actionable — subject to the missing-item rules above.`
      : `- Use ingredients primarily from the pantry list, but you may include 1-3 extra ingredients per meal that the user would need to buy.`

    const prompt = `You are a nutrition-focused meal planner. Generate exactly ${genCount} high-protein meal suggestions.

Above all: every meal must be genuinely DELICIOUS and cohesive — a real dish a person would actually crave and choose to eat, not a random assembly of whatever is on hand. Never force unrelated pantry items together just to use them up; a simpler, tasty meal always beats a cluttered one. Quality of the meal comes before quantity of pantry items used.

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
- MACROS MUST MATCH THE FOOD (verified): the calories/protein/carbs/fat you report are recomputed from your own ingredient list and their gram weights, and a meal whose numbers the ingredients cannot support is DISCARDED. Hitting the protein band by writing a bigger number does not work — change the INGREDIENTS (more of the protein source, or a different one) until the food genuinely reaches the target. If the pantry cannot reach ${proteinMin}g honestly, return a meal that misses the band rather than one that misreports.
- CALORIE DISTRIBUTION (blocking constraint): every meal MUST have ${calorieMin}–${calorieMax} kcal (target ~${calorieTarget} kcal). Daily total ${calorieGoal} ÷ ${mealsPerDay} meals = ${calorieTarget} per meal. Distribute calories EVENLY — meals far outside this band wreck the user's daily macro plan.${fatLine}
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
- THE NAME MUST DESCRIBE WHAT THE STEPS ACTUALLY DO (blocking). Never name a dish after a technique or a form that does not appear in the steps. If no chicken is seared, it is NOT "Pan-Seared Chicken". If nothing is roasted, it is not "Roasted ___". Borrowing a real dish's name for an unrelated plate of components is the SAME violation as inventing a name — worse, because the user expects the dish they were promised. Before finalizing a name, re-read the steps and confirm every word of the title is earned.
- PRE-PREPARED PANTRY ITEMS (chicken salad, hummus, rotisserie chicken, deli meat, tuna salad, leftovers) are ALREADY COOKED AND SEASONED. Use them as-is or as a component — never write steps that cook them from raw, and never name the dish as though you did. A meal built on chicken salad is a "Chicken Salad Plate" or "Chicken Salad Sandwich", never "Pan-Seared Chicken".
- If the honest name for what you have made is unappealing ("Chicken Salad with Potatoes and Greens"), that is a signal the MEAL is wrong, not the name. Pick a different, genuinely cohesive dish instead of dressing up an assembly with a better title.
- REAL, ESTABLISHED DISHES ONLY (mandatory): every meal must be a genuine, widely-recognized dish that real people already make and that is proven to taste good — the kind you'd find on a restaurant menu, a popular recipe site, or in common home cooking (e.g. "Beef Taco Bowl", "Chicken Fried Rice", "Greek Yogurt Parfait", "Cheeseburger & Fries"). Do NOT invent new dishes, novel fusions, or made-up "power bowl / protein bowl" combinations. If the pantry can't authentically make a known dish, pick the CLOSEST established dish and use pantry items ONLY where they genuinely belong in it. Name each meal after the real dish it actually is — never an invented marketing name.
- USE INGREDIENTS IN THEIR CORRECT FORM AND STATE (mandatory): the pantry names each item's specific form — respect it, and match the dish, the cooking steps, and prepTime to that form. Never silently swap to a different form. If the on-hand form doesn't fit a dish, either use it correctly or pick a dish where it IS authentic.
  • CHEESE: sliced/deli cheese → burgers, melts, grilled cheese, patty melts, sandwiches. For bowls, nachos, chili, or pasta, cheese must be SHREDDED and melted into the hot food — NEVER cold slices draped on top. Cottage cheese and cream cheese do NOT melt like cheddar — don't use them as melting cheese.
  • PROTEIN STATE: raw proteins (raw chicken, ground beef, raw shrimp, fish fillets) MUST be cooked in the steps with realistic prep time — never in a no-cook or ≤10-min dish. Ready-to-eat proteins (deli meat, rotisserie chicken, canned tuna/chicken, pre-cooked bacon, hard-boiled eggs) are used as-is — never "seared" or "cooked from raw".
  • BREAD/CARB: plain sliced sandwich bread is NOT a tortilla, bun, pita, or naan — do NOT use it as the carb for tacos, burritos, curries, or bowls. Use it only for toast, sandwiches, or an intentional garlic-toast side (soup/chili). Prefer rice/tortilla/pasta as the carb when the dish is Mexican/Asian/Italian.
  • NON-DAIRY MILK (oat/almond/soy) and egg whites: oat/almond milk is thin and slightly sweet — fine in smoothies, oats, cereal, coffee, NOT a 1:1 dairy swap for savory cream sauces. Egg whites are NOT whole eggs — good for scrambles/omelets/protein, but can't fry sunny-side-up or make a rich custard.
  • CONDIMENTS/DRESSINGS (ranch, salsa, ketchup, BBQ): finishing sauces in SMALL amounts — never a primary base dumped in by the cup (also blows the fat/calorie budget).
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
    "slot": "dinner",
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
          // max_tokens 4000 — 2000 truncated real full-fridge outputs mid-JSON (an unterminated
          // string → JSON.parse throws → the provider gets treated as "failed"). 4000 gives
          // comfortable headroom for up to ~7 meals with ingredient + step arrays; gpt-4o-mini
          // and Gemini both allow far more, so the only cost is a few output tokens when needed.
          body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: prompt }], temperature: 0.8, max_tokens: 4000 }),
        })
        const data = await response.json()
        if (data.error) {
          console.log(`${provider.name} error:`, data.error.message || JSON.stringify(data.error))
          continue
        }
        // Surface truncation explicitly — a 'length' finish means the JSON is cut off and the
        // parse below WILL throw; the log makes that unambiguous instead of a cryptic parse error.
        if (data.choices?.[0]?.finish_reason === "length") {
          console.log(`${provider.name} hit max_tokens (output truncated) — raise max_tokens`)
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
      // 3 meals at a time × 5 ingredients each = ≤15 concurrent FatSecret calls,
      // vs. the old N×M unbounded fan-out that tripped rate limits on dense batches.
      meals = await mapLimit(meals, 3, (m: any) => correctMealMacros(m))
      console.log('Macros corrected')
    }

    // Macro band validation — drop meals (post-FatSecret correction) that violate either
    // band by 40%+. Both protein and calories enforced with 1.40× buffer so near-misses
    // pass but genuine outliers (e.g. 96g protein, 1500 cal bombs) get caught.
    const proteinDropThreshold = proteinMax * 1.40
    const calorieDropThreshold = calorieMax * 1.40
    const fatDropThreshold = fatMax * 1.40 // fat-bomb guard — code-enforced, since the LLM ignores prompt caps under load
    const beforeBands = meals.length
    meals = meals.filter((m: any) =>
      Number(m.protein) <= proteinDropThreshold &&
      Number(m.calories) <= calorieDropThreshold
    )
    // FAT is a FLOORED drop, not a hard one: on a fatty pantry (beef/cheese/dressings) almost every
    // meal exceeds the cap, so hard-dropping collapsed the list to a single meal. Drop fat-bombs
    // ONLY while ≥ displayCount lean meals remain; otherwise keep them and let the ranking below
    // (one-sided fat penalty) surface the leanest displayCount. Prefer lean, never starve the list.
    let droppedByFat = 0
    if (!highFatDiet) {
      const lean = meals.filter((m: any) => Number(m.fat) <= fatDropThreshold)
      if (lean.length >= displayCount) { droppedByFat = meals.length - lean.length; meals = lean }
    }
    const droppedByBands = beforeBands - meals.length
    if (droppedByBands > 0) {
      console.log(`Macro bands: dropped ${droppedByBands}/${beforeBands} (protein > ${Math.round(proteinDropThreshold)}g, calories > ${Math.round(calorieDropThreshold)} kcal${droppedByFat ? `, ${droppedByFat} fat-bombs > ${Math.round(fatDropThreshold)}g` : ''})`)
    }

    // Repeat suppression, code-enforced. Marked rather than hard-dropped: on a thin pantry the
    // model may only be able to build dishes we've already shown, and an empty deck is worse than
    // a familiar one. Marked meals sort last in the ranking below, so a repeat only survives when
    // there aren't enough fresh candidates to fill the deck.
    // Matched by SIMILARITY, not exact fingerprint. The model is handed a do-not-repeat list of
    // exact names, complies literally, and returns a one-word rewording — which produced a totally
    // different dishKey and sailed through. Measured on real data: 18 remembered names, 18 distinct
    // keys, zero repeats detected, while all three meals shown that day had a near-duplicate
    // already in the list. See _shared/dish-key.ts.
    const shownThisBatch: string[] = []
    let repeatCount = 0
    let rescued = 0 // times ingredients overruled a name match — see the log below
    meals = meals.map((m: any) => {
      const name = String(m?.name ?? '')
      // Two kinds of repeat: the same dish as a previous generation, or as an earlier candidate in
      // THIS response — the "No repeated meals" prompt line doesn't reliably prevent the latter.
      // Ingredient-aware where history exists, name-only where it does not. Splitting them matters:
      // running the name check over the WHOLE window as well would re-flag exactly the false
      // positives the ingredient check just rescued, and the rescue would never take effect.
      const nameOnlyRecent = recentMealNames.filter(n => !detailedKeys.has(dishKey(n)))
      const cand = { name, ingredients: m?.ingredients }
      // Split so the RESCUE is observable. INGREDIENT_RESCUE_MAX was picked by reasoning against
      // two hand-built examples, not measured — generated_meals was empty when it was written. It
      // will start making real decisions silently as history accumulates, on a path that costs
      // money, so it logs every time it overrules a name match. Calibrate from these lines later
      // rather than re-guessing.
      const nameMatchedHistory = recentDetailed.some((r: RecentDish) => isSameDish(name, r.name))
      const detailedMatch = recentDetailed.some((r: RecentDish) => isSameDishDetailed(cand, r))
      if (nameMatchedHistory && !detailedMatch) {
        rescued++
        console.log(`Ingredient rescue: "${name}" reads as a repeat by name but its food differs — kept`)
      }
      const isRepeat =
        detailedMatch ||
        matchesRecentDish(name, nameOnlyRecent) ||
        matchesRecentDish(name, shownThisBatch)
      shownThisBatch.push(name)
      if (isRepeat) repeatCount++
      return { ...m, _repeat: isRepeat }
    })
    if (rescued > 0) console.log(`Ingredient rescue fired ${rescued}x this generation`)
    if (repeatCount > 0) {
      console.log(`Repeat filter: ${repeatCount}/${meals.length} candidates matched a recent dish (${meals.length - repeatCount} fresh, need ${displayCount})`)
    }

    // Independent macro check. Every other gate in this function reads the numbers the MODEL
    // reported — the same model that wrote the ingredient list — so a meal whose food only
    // supports 35g of protein could claim 70g and pass the band check untouched. This is the one
    // gate that reads the FOOD instead. It runs BEFORE the ranking on purpose: the fit score
    // rewards claimed-vs-target proximity, so an inflated meal would otherwise outrank an honest
    // one on numbers it never earned. Abstains when ingredient coverage is too low to be sure.
    {
      const beforeCheck = meals.length
      const kept: any[] = []
      for (const m of meals) {
        const v = verifyMacros(m, m?.ingredients)
        console.log(`[macro-check] ${v.ok ? (v.skipped ? 'skip' : 'ok  ') : 'DROP'} "${m?.name}" — ${v.reason}`)
        if (v.ok) kept.push(m)
      }
      // Only apply the drop while enough candidates survive to fill the deck — the same rule the
      // fat filter above uses. Dropping past that point would show the user 2 meals instead of 3,
      // and a batch where 3+ of 5 fail is far more likely to mean a gap in the reference table or
      // a tolerance that is too tight than five simultaneously dishonest meals.
      if (kept.length === beforeCheck) {
        // nothing to do
      } else if (kept.length >= displayCount) {
        console.log(`[macro-check] dropped ${beforeCheck - kept.length}/${beforeCheck}`)
        meals = kept
      } else {
        console.log(`[macro-check] would drop ${beforeCheck - kept.length}/${beforeCheck}, leaving only ${kept.length} for ${displayCount} slots — keeping all; suspect the table or tolerances, not the meals`)
      }
    }

    // Overgenerate-then-rank: we asked the LLM for genCount meals (5+) but only display
    // displayCount (3). Rank survivors by macro fit — sum of normalized squared distance
    // from per-meal targets — and slice to the top displayCount. Lower score = better fit.
    // Runs UNCONDITIONALLY, not only when there is a surplus. Repeats are ordered last here and
    // nowhere else — an earlier version hard-dropped them at the repeat filter instead, which
    // thinned the pool BEFORE the macro and prep-time filters and could leave only 2 meals on
    // screen. Keeping repeats as reserves and letting the slice discard them means a repeat
    // reaches the user only when there genuinely aren't enough fresh survivors to fill the deck.
    {
      const beforeRank = meals.length
      meals = meals
        .map((m: any) => {
          const pDelta = (Number(m.protein) - proteinTarget) / Math.max(proteinTarget, 1)
          const cDelta = (Number(m.calories) - calorieTarget) / Math.max(calorieTarget, 1)
          // One-sided fat penalty: only meals ABOVE the fat target lose points, so leaner meals
          // rank higher without punishing a naturally-lean dish. Off for keto/low-carb.
          const fExcess = highFatDiet ? 0 : Math.max(0, (Number(m.fat) - fatTarget) / Math.max(fatTarget, 1))
          const fitScore = pDelta * pDelta + cDelta * cDelta + fExcess * fExcess
          return { ...m, _fitScore: fitScore }
        })
        // Freshness outranks macro fit: a slightly worse-fitting new dish beats a perfect-fitting
        // repeat, since the repeat is the thing users actually notice and complain about.
        .sort((a: any, b: any) => (a._repeat === b._repeat ? a._fitScore - b._fitScore : (a._repeat ? 1 : -1)))
        .slice(0, displayCount)
        .map((m: any) => { const { _fitScore, ...rest } = m; return rest })
      const shownRepeats = meals.filter((m: any) => m._repeat).length
      console.log(
        `Macro rank: kept top ${Math.min(displayCount, beforeRank)}/${beforeRank} by freshness then target fit` +
        (shownRepeats > 0 ? ` — ${shownRepeats} repeat(s) had to fill the deck (not enough fresh)` : ''),
      )
    }
    // Strip the marker whether or not the ranking above ran — it must never reach the client cache.
    meals = meals.map((m: any) => { const { _repeat, ...rest } = m; return rest })

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

    // If every candidate got filtered out (bad input, impossible macro/prep constraints),
    // refund the slot — the user got nothing usable, so it shouldn't count against their cap.
    if (meals.length === 0) {
      await refundScan(req, 'meal_gen')
      return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } })
    }

    // Persist what we're actually showing so the NEXT generation can exclude it. Only the final
    // displayed meals are recorded — candidates dropped by the bands/ranking were never seen, so
    // they stay eligible. Deduped by fingerprint, not raw string, to keep the window dense with
    // distinct dishes instead of near-identical spellings of one.
    try {
      // Deduped by SAMENESS, not by exact dishKey. The old key check never fired once — measured
      // on a live window, 29 names produced 29 distinct keys while representing ~17 real dishes, so
      // 30 slots were remembering roughly 17 things. clusterDishes collapses the restatements, so
      // the same 30 slots now hold 30 genuinely distinct dishes.
      //
      // This is the answer to "should the window be shorter?" — no. It was never too long, it was
      // half full of the model repeating itself. Shrinking it to 21 names would have remembered 13
      // dishes instead of 14; this remembers close to 30.
      const nextRecent = clusterDishes([
        ...meals.map((m: any) => String(m?.name ?? "").trim()),
        ...recentMealNames,
      ]).slice(0, RECENT_MEMORY)
      // Service-role write to the caller's own verified row; no entitlement data involved.
      // Never allowed to fail the response — the user already paid for this generation.
      await db.from("profiles").update({ recent_meal_names: nextRecent }).eq("id", user.id)
    } catch (e) {
      console.log("recent_meal_names update failed:", (e as Error).message)
    }

    // Generation HISTORY. recent_meal_names above is a rolling 30-name window that forgets by
    // design; this is the permanent record. Written here rather than from the client because the
    // client's copy dies with its cache at local midnight, and because a row the client could write
    // is a row the client could forge. RLS on generated_meals grants SELECT only.
    //
    // Nothing reads this yet — the history page is V2. It is written now because the backfill is
    // impossible: a generation not recorded at the moment it happens is gone for good.
    //
    // Its OWN try/catch on purpose. Sharing the block above would mean a failed anti-repeat write
    // silently stops history from being recorded, and one log line would then be blaming the wrong
    // write. Neither is allowed to fail the response: the user already paid for this generation.
    try {
      await db.from("generated_meals").insert(
        meals.map((m: any) => ({
          user_id: user.id,
          meal_data: m,
          name: String(m?.name ?? "").trim(),
          mode,
        })),
      )
    } catch (e) {
      console.log("generated_meals insert failed:", (e as Error).message)
    }

    // Return meals immediately, images will be fetched by a separate function
    return new Response(JSON.stringify(meals.map((m: any) => ({ ...m, image: null }))), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    await refundScan(req, 'meal_gen') // unexpected failure — refund the slot
    console.error('[generate-meals] error:', (error as Error).message) // detail server-side only
    return new Response(
      JSON.stringify({ error: "Meal generation failed" }), // generic — don't leak internals
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
