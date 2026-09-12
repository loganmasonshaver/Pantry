import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { isCompleteMeal, isZeroCalorie, pantryCarbs, carbRequired, savoryClash } from '../_shared/meal-completeness.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { requirePremium } from '../_shared/premium.ts'
import { checkScanCap, refundScan } from '../_shared/scan-cap.ts'
import { mapLimit } from '../_shared/concurrency.ts'
import { sanitizeList } from '../_shared/sanitize.ts'
import { flavourMismatches, flavourOpportunities } from '../_shared/flavour-match.ts'
import { RECENT_MEMORY, dishKey, matchesRecentDish, clusterDishCounts, isSameDish, isSameDishDetailed, overusedBases, dishArchetype, overusedArchetypes, capByDistinctDishes } from '../_shared/dish-key.ts'
import { verifyMacros, estimateMacros, MACRO_TOLERANCE } from '../_shared/macro-estimate.ts'
import { scaleToTarget } from '../_shared/scale-recipe.ts'
import { selectDeck } from '../_shared/rank-deck.ts'
import { flavourAxes } from '../_shared/flavour-axes.ts'
import { stepIssues } from '../_shared/step-checks.ts'
import { findMissing } from '../_shared/pantry-check.ts'
import { nameFormGaps, nameIngredientGaps, ghostIngredients, unusedIngredients } from '../_shared/recipe-integrity.ts'
import { MEAL_GEN_CAP_PER_DAY } from '../_shared/caps.ts'
import { servingsForPortion, toPerServing } from '../_shared/servings.ts'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Hard per-user daily ceiling on meal generations (LLM call + ~3 FAL images each).
// Bounds API cost no matter what triggers a gen — auto-fire, manual refresh, a
// diet/pref change, or a retry — since the client-side MAX_DAILY_REGENS only gates
// the manual button. 6/day gives headroom for a real premium day (1 auto-gen + up to 3
// manual rerolls + a scan or two) without a false "limit reached"; still a runaway backstop.


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

async function lookupMacros(name: string, grams: number): Promise<{ cal: number; p: number; c: number; f: number; matched: string; per100: number } | null> {
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
      // Diagnostics only. foods.search with max_results=1 takes FatSecret's top hit for a plain
      // string, which is not necessarily the generic raw food — "red potatoes" can match a dressed
      // or prepared entry, and that would inflate every recipe containing it. The matched name and
      // its density are the only way to tell that apart from the model simply writing too much
      // food, and neither is recoverable after the fact: generated_meals stores the corrected
      // total, never the per-ingredient lookups that produced it.
      matched: String(item.food_name ?? '?'),
      per100: metricAmount > 0 ? Math.round(Number(serving.calories) * 100 / metricAmount) : 0,
    }
  } catch { return null }
}

// Works entirely in BATCH space: the ingredient list describes the whole recipe, so every total
// here is the whole recipe. `servings` only widens the sanity windows — the per-serving divide
// happens once, later, in toPerServing(). Doing it here instead would put a division in front of
// verifyMacros, which compares a claim against these same batch ingredients.
async function correctMealMacros(meal: any, servings = 1): Promise<any> {
  const ingredients = meal.ingredients || []
  let totalCal = 0, totalP = 0, totalC = 0, totalF = 0
  let lookedUp = 0

  // Cap ingredient lookups at 5 concurrent — combined with the meal-level cap below,
  // total in-flight FatSecret requests stays bounded (~15) instead of N×M all at once.
  const results = await mapLimit(ingredients, 5, (ing: any) => {
    // Water and ice are 0 kcal and never looked up: FatSecret's top hit for "Ice Cubes" was a
    // 217 kcal/100g entry, which turned a 565 kcal shake into 782. Counted as RESOLVED, so the
    // >=50% coverage gate below still sees them as known food.
    if (isZeroCalorie(ing?.name)) return Promise.resolve({ cal: 0, p: 0, c: 0, f: 0, matched: 'zero-calorie', per100: 0 })
    const grams = parseInt(String(ing.grams)) || 100
    return lookupMacros(ing.name, grams)
  })

  const trace: string[] = []
  for (const macros of results) {
    if (macros) {
      trace.push(`${macros.matched}@${macros.per100}/100g=${macros.cal}`)
      // Skip obviously-wrong FatSecret matches — a single ingredient over 900 kcal or 100g
      // protein almost certainly means the search matched the wrong food entry.
      // Scaled by servings: a 2-serving batch genuinely doubles every gram weight, and an
      // unscaled guard would start discarding real food — which understates the total, which
      // silently under-logs the user. The guard must move with the portion it is judging.
      if (macros.cal > 900 * servings || macros.p > 100 * servings) continue
      totalCal += macros.cal
      totalP += macros.p
      totalC += macros.c
      totalF += macros.f
      lookedUp++
    }
  }

  // Only override LLM macros if FatSecret resolved ≥50% of ingredients AND the total is
  // within a sane range. Outside this band → trust the LLM (database mismatch likely worse
  // than estimate). The 200–1200 window is PER SERVING, so it scales with the batch.
  let source = 'fatsecret'
  let applied = lookedUp >= ingredients.length / 2 && totalCal >= 200 * servings && totalCal <= 1200 * servings

  // FALLBACK. FatSecret is not an enhancement here — without it the whole feature goes dark, and
  // that was invisible until the model-vs-corrected numbers became readable. Measured on a live
  // generation the model reported 1420/1450/1500 kcal against an 840 batch target; the calorie
  // drop fires at batchCalorieMax * 1.40 = 1352, so ALL THREE would have been discarded and the
  // user would have got an empty deck and a refund. Two missing env vars or one API outage does
  // that to every generation, silently.
  //
  // estimateMacros is the same local reference table verifyMacros already trusts to DROP meals,
  // and on real recipes it landed within 20-30% of FatSecret. Using it to correct is strictly
  // better than shipping the model's own numbers, which are the thing every gate here exists to
  // distrust. Coverage gate is MACRO_TOLERANCE.minCoverage, the same bar verifyMacros uses.
  if (!applied) {
    const est = estimateMacros(ingredients)
    if (est.coverage >= MACRO_TOLERANCE.minCoverage && est.kcal >= 200 * servings && est.kcal <= 1200 * servings) {
      totalCal = est.kcal; totalP = est.protein; totalC = est.carbs; totalF = est.fat
      applied = true
      source = 'local-table'
    }
  }
  // Which source won is invisible downstream — the model's own number and FatSecret's sum both
  // end up in the same field. They disagree by 20-30% on real recipes, in an inconsistent
  // direction, so without this there is no way to tell an inflated lookup from a model that
  // simply wrote too much food.
  //
  // Written to a TABLE, not just console. Edge function logs are only reachable through the
  // dashboard — there is no `supabase functions logs` in this CLI and no management token on this
  // machine — so a console-only diagnostic is one nobody can actually read back. pipeline_runs is
  // already the sink for this kind of thing.
  meal._fsTrace = { name: meal.name, model: meal.calories, fs: Math.round(totalCal),
                    resolved: `${lookedUp}/${ingredients.length}`, applied, source, items: trace }
  // Read by the band filter: a meal whose macros were never corrected carries the MODEL's numbers,
  // which run 1.7-1.8x target, and dropping it on those is punishing it for our own missing data.
  meal._macrosCorrected = applied
  console.log(`[macros] "${meal.name}" model=${meal.calories} corrected=${Math.round(totalCal)} via ${applied ? source : 'nothing'} (${lookedUp}/${ingredients.length} via FatSecret) | ${trace.join(' · ')}`)
  if (applied) {
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

    // TWO views of the same window, and conflating them is what silently disabled the served-count
    // escalation. `recentServed` is the raw sequence WITH duplicates — it is the only thing
    // clusterDishCounts can derive a count from, and it reads the full stored length because the
    // window now holds every name served rather than one per dish. `recentMealNames` stays
    // deduped and capped for the matching paths, where duplicates only cost comparisons.
    const recentServed = sanitizeList(recentRow?.recent_meal_names ?? [], RECENT_MEMORY * 2)
    const recentMealNames = Array.from(new Set([
      ...recentServed,
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
    // Raised 8 -> 10. Measured on the 02:09 generation: at least 2 of the top 3 were flagged
    // repeats, and since repeats sort last that means AT MOST 1 of the 8 candidates was fresh. The
    // ranking cannot pick variety that was never generated, and this file's own comment already
    // named more candidates as the only lever. Not raised further because max_tokens has to move
    // with it (see below) and because 48 meals from this pantry produced only 26 distinct dishes —
    // past a point the candidates repeat each other and the extra tokens buy nothing.
    const genCount = mode === 'cookNow' ? Math.max(displayCount + 7, 10) : displayCount
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
    // MULTI-SERVING RECIPES. calorieTarget is per EATING OCCASION and is correct — someone on 6
    // meals/day really does eat ~460 kcal at a time. What is wrong is asking them to COOK a
    // 460 kcal recipe: eating occasions are not cooking occasions. So keep the portion honest and
    // make the RECIPE bigger by giving it more servings, exactly as trending recipes do.
    // The lever is recipe size, not day coverage — 3 recipes were never meant to feed a whole day.
    // Measured against every live profile, this yields servings > 1 for exactly one plausible user
    // (6 meals @ 2761 kcal → 460/serving → 2). Everyone at 3-5 meals/day gets servings === 1, for
    // which every scale below is ×1 and this whole feature is a no-op. That is the safety property.
    const servings = servingsForPortion(calorieTarget)
    // BATCH bands. The model is asked for the whole recipe, and every gate that reads the
    // ingredient list (FatSecret correction, the drops below, verifyMacros) compares against the
    // whole recipe too. toPerServing() divides once, after all of them.
    const batchCalorieTarget = calorieTarget * servings
    const batchCalorieMin = calorieMin * servings
    const batchCalorieMax = calorieMax * servings
    const batchProteinTarget = proteinTarget * servings
    const batchProteinMin = proteinMin * servings
    const batchProteinMax = proteinMax * servings
    // Per-meal FAT ceiling. There's no stored fat goal, so derive a sane daily fat (~30% of
    // kcal) split per meal — stops a single meal (e.g. beef + cheese + creamy dressing +
    // buttered bread) from eating the whole day's fat. Skipped for keto/low-carb/carnivore,
    // where high fat IS the intended fuel. Enforced both in the prompt and by the drop+rank below.
    const highFatDiet = dietaryRestrictions.some((d: string) => /keto|low[- ]?carb|carnivore/i.test(String(d)))
    const fatTarget = Math.round((calorieGoal * 0.30 / 9) / mealsPerDay)
    const fatMax = Math.max(25, Math.ceil(fatTarget * 1.15))
    const batchFatMax = fatMax * servings
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
    // Counted from recentServed, NOT recentMealNames: the latter is Set-deduped, so a dish served
    // five times appeared once and every count came out 1. Falls back to the deduped list for a
    // user whose window predates the raw-name write.
    const recentCounts = clusterDishCounts(recentServed.length > 0 ? recentServed : recentMealNames)
      .sort((a, b) => b.count - a.count)
    const recentDishes = recentCounts.map(c => (c.count > 1 ? `${c.name} (served ${c.count}x)` : c.name))
    const recentMealsLine = recentDishes.length > 0
      ? `\nALREADY SERVED RECENTLY — do not suggest these dishes OR a reworded version of one: ${recentDishes.join(", ")}.` +
        `\nA different adjective is NOT a different dish. "Cottage Cheese and Herb Potato Bowl" and "Cottage Cheese and Fruit Power Bowl" are the SAME dish to the person reading it, and so are "Egg White Scramble with Toast" and "Egg White Scramble with Potatoes". To count as different, change the PRIMARY PROTEIN or the FORM of the dish (bowl vs wrap vs bake vs soup) — not the garnish, not the adjective, not the side.`
      : ""
    // BAN THE FOOD, NOT THE NAME.
    //
    // The do-not-suggest list demonstrably does not hold: handed one, the model returned two of its
    // entries VERBATIM (measured 2026-09-02). A name ban is satisfiable by renaming, which is
    // exactly what it had been doing. An ingredient ban is not — "do not use cottage cheese" cannot
    // be complied with by calling it something else. Same reasoning that already puts the macro
    // bands in code rather than in a request.
    //
    // Counted over the RAW served history, never the stored window: that window is now deduped by
    // dish, so every dish appears once and the overuse signal is gone by construction. Prefers
    // generated_meals (true per-meal history, with ingredients) once it is deep enough, and falls
    // back to the client's raw name list until it is.
    const overuseHistory = recentDetailed.length >= 15
      ? recentDetailed
      : (Array.isArray(rawRecent) ? rawRecent : []).map((n: unknown) => ({ name: n }))
    const bannedBases = overusedBases(overuseHistory)
    if (bannedBases.length > 0) console.log(`Base ban: ${bannedBases.join(", ")} (from ${overuseHistory.length} recent meals)`)
    // FORM ban, mirroring the base ban above and sharing its calibrated thresholds. Bases stop the
    // model reaching for the same FOOD; this stops it reaching for the same SHAPE. Both are needed:
    // a smoothie built on yogurt instead of protein powder defeats the base ban while still being
    // the eighth smoothie in fourteen generations.
    const bannedForms = overusedArchetypes(overuseHistory)
    if (bannedForms.length > 0) console.log(`Form ban: ${bannedForms.join(", ")} (from ${overuseHistory.length} recent meals)`)
    const bannedFormsLine = bannedForms.length === 0 ? "" :
      `\n- DISH FORM BAN (blocking constraint): this user has been served ${bannedForms.map(f => `a ${f}`).join(" and ")} over and over — it is the single thing they complain about. Do NOT return ANY meal that is ${bannedForms.map(f => `a ${f}`).join(" or ")}, however it is flavoured, based or named. A different fruit in the blender is the SAME dish to them. Return a different FORM entirely.`

    // Name the carbs this pantry HAS. The carb rule alone sent the model to bread, pasta and noodles
    // the user did not own — 4 of 8 candidates in run 46 died not-cookable — so the deck was filled
    // with the incomplete dishes the rule exists to prevent. Banned bases are left out of the list.
    const ownCarbs = pantryCarbs(ingredients as string[])
      .filter((c: string) => !bannedBases.some((b: string) => c.toLowerCase().includes(String(b).toLowerCase())))
    const carbSourcesLine = !(mode === 'cookNow') || !carbRequired(dietaryRestrictions) ? '' : ownCarbs.length > 0
      ? `\n- CARBS THIS PANTRY ACTUALLY HAS: ${ownCarbs.join(', ')}. In the STRICT meals the carb MUST be one of these. Bread, pasta, noodles or tortillas the pantry does not list make the meal NOT cookable, and it is thrown away.\n- EGG DISHES NEED NO CARB: an omelet, frittata, scramble or shakshuka is a complete meal as it is. Do NOT bolt cereal, granola or a side of rice onto one to satisfy the carb rule — a sweet cereal beside a savory egg dish is the worst version of this and is rejected.`
      : `\n- This pantry holds NO carb base. Make each meal as complete as the pantry allows — never invent a carb it does not have.`
    const bannedBasesLine = bannedBases.length === 0 ? "" :
      `\n- BASE INGREDIENT BAN (blocking constraint): ${bannedBases.map(b => b.toUpperCase()).join(" and ")} ${bannedBases.length > 1 ? "have" : "has"} carried roughly a third of this user's recent meals and they are sick of ${bannedBases.length > 1 ? "them" : "it"}. Do NOT build ANY of today's meals on ${bannedBases.join(" or ")} — not as the protein, not as the base, not as the headline ingredient. A trace amount as a garnish is fine. Use a DIFFERENT base from their pantry. This is a rule about the FOOD, not the title: renaming the dish does not satisfy it.`

    // Only emitted when the recipe is genuinely a batch. Two things have to be said explicitly:
    // the numbers describe the WHOLE recipe (the model's instinct is to report a plate), and the
    // dish has to survive being portioned — a 2-serving smoothie is fine cold, 2 servings of
    // scrambled eggs on toast is a cold second plate. Nothing else in the pipeline can judge that.
    const servingsRule = servings > 1 ? `
- THIS IS A BATCH RECIPE — every recipe MUST make ${servings} servings. The user eats ${mealsPerDay} times a day, so one portion is only ~${calorieTarget} kcal — too small to be worth cooking on its own. They cook once and portion it.
  • Ingredient quantities describe the WHOLE recipe (all ${servings} servings), and the calories/protein/carbs/fat you report are the TOTAL for the whole recipe. Do NOT report one portion's numbers.
  • prepTime is the time to cook the WHOLE recipe. Cooking ${servings} portions of a sheet-pan dish is not ${servings}× the time — be realistic, not multiplicative.
  • ONLY suggest dishes that genuinely keep and reheat (or are eaten cold): bakes, stews, chilis, curries, sheet-pan dinners, grain and rice bowls, pasta bakes, soups, overnight oats, cold salads, smoothies portioned into the fridge. NEVER a dish that is only good the moment it leaves the pan — fried eggs, anything on toast, crisp-skinned fish, grilled cheese, tacos assembled to order.
  • COOKING TIMES ON PORTION-SENSITIVE STEPS: the user can choose to cook fewer servings than the full ${servings}, so for any step whose time genuinely changes with HOW MUCH IS IN THE PAN OR OVEN, give a RANGE and say plainly what the range depends on — e.g. "Bake 25-35 minutes, until the top is golden — nearer 25 for a single serving, nearer 35 for the full ${servings}."
    ✓ Steps that ARE portion-sensitive: baking, roasting, braising, simmering to reduce, boiling a large volume, anything where a bigger mass takes longer to heat through.
    ✗ Steps that are NOT: searing to a colour, per-side cooking times, boiling pasta, blending, whisking, chopping, resting, seasoning. These take the same time at any quantity — do NOT put a range on them. A pointless range ("blend 30-45 seconds depending on servings") makes the whole recipe read as guesswork.
    Give a doneness cue ("until the top is golden", "until a knife comes out clean") alongside the range wherever one exists — that is what the cook actually judges by.
    prepTime stays a SINGLE number for the FULL ${servings}-serving recipe. Never widen it to the top of a range.` : ""

    const fatLine = highFatDiet ? "" :
      `\n- FAT CEILING (blocking constraint): every recipe MUST have ≤ ${batchFatMax}g fat total (aim ~${fatTarget * servings}g). A single meal must NOT eat the whole day's fat budget — a beef + cheese + creamy dressing + buttered bread pileup at 50g+ fat is disqualified. Use leaner cuts, less cheese/oil, or pick a naturally leaner dish to stay under. Protein and carbs matter more than packing in fat.`

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
    // FORM variety, mirroring the protein rule above — and modelled on it because the data says
    // that rule WORKS. Across 48 served meals the proteins are genuinely spread (egg 14, yogurt 13,
    // protein powder 11, cheese 11, chicken 11), while the FORMS collapse: bowl 12, smoothie 7,
    // potato-dish 5. Nothing was ever asking for shape variety, so the model varied the only
    // dimension it was told to. Naming the recent forms explicitly is what the protein rule does.
    const recentForms = [...new Set(recentMealNames.slice(0, 9).map(n => dishArchetype(n)).filter(Boolean))]
    const formVarietyRule = !isCookNow ? '' :
      `\n- DISH FORM VARIETY (blocking): the ${displayCount} meals you return must be ${displayCount} DIFFERENT forms — a bowl, a skillet, a wrap, a soup, a bake, a salad, a scramble, a plate are different forms; two bowls with different toppings are the same form.${recentForms.length > 0 ? ` These were served in the last few days, so avoid them: ${recentForms.join(', ')}.` : ''} Form is what the user SEES: three bowls in a row reads as the same meal three times however differently they are seasoned.`

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
      'garlic powder', 'onion powder', 'paprika', 'cumin', 'chili powder', 'oregano', 'basil', 'Italian seasoning', 'cinnamon', 'red pepper flakes',
      // "ice cubes", never bare "ice" — isInPantry matches on substrings, so 'ice' would make
      // rice and juice permanently in-stock and they would silently stop showing as missing.
      // The head-noun rule still matches a recipe line that just says "ice".
      'ice cubes']
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
${ingredientRule}${proteinVarietyRule}${formVarietyRule}${servingsRule}
- PRIORITIZE ingredients listed first — they've been in the pantry longest and should be used up before newer items
- PROTEIN DISTRIBUTION (blocking constraint): every recipe MUST have ${batchProteinMin}g–${batchProteinMax}g protein in TOTAL (target ~${batchProteinTarget}g). Distribute protein EVENLY across the ${genCount} recipes — never pile into one and starve another. A single SERVING above ${proteinMax}g causes poor absorption + GI discomfort.
- MACROS MUST MATCH THE FOOD (verified): the calories/protein/carbs/fat you report are recomputed from your own ingredient list and their gram weights, and a meal whose numbers the ingredients cannot support is DISCARDED. Hitting the protein band by writing a bigger number does not work — change the INGREDIENTS (more of the protein source, or a different one) until the food genuinely reaches the target. If the pantry cannot reach ${proteinMin}g honestly, return a meal that misses the band rather than one that misreports.
- CALORIE DISTRIBUTION (blocking constraint): every recipe MUST have ${batchCalorieMin}–${batchCalorieMax} kcal in TOTAL (target ~${batchCalorieTarget} kcal). Daily total ${calorieGoal} ÷ ${mealsPerDay} eating occasions = ${calorieTarget} kcal per portion${servings > 1 ? `, and each recipe makes ${servings} portions` : ''}. Distribute calories EVENLY — recipes far outside this band wreck the user's daily macro plan.${fatLine}${bannedBasesLine}${bannedFormsLine}
- Every meal MUST include a strong protein source (chicken, beef, turkey, fish, eggs, tofu, greek yogurt, protein powder, or shrimp). Beans/lentils alone are NOT enough protein — they must be paired with a primary protein source.
- PROTEIN POWDER belongs ONLY in shakes, smoothies, oats/porridge, yogurt bowls, pancakes, baking and desserts — NEVER in a savory dish (a soup, stir-fry, skillet, pasta or curry, or anything with meat, fish, garlic, onion or broth). It does not thicken; in hot milk it clumps and tastes of sweet dairy. To raise protein in a savory meal use MORE OF THE REAL PROTEIN (140g chicken, not 70g plus a scoop). The same goes for sweet-flavoured products — vanilla or chocolate yogurt, flavoured milk or creamer. Savory dishes containing them are checked in code and ranked below every other meal.
- Every meal MUST include a carbohydrate source (rice, pasta, bread, potatoes, oats, quinoa, tortillas, noodles, beans, lentils, or similar) UNLESS the user has a keto or low-carb dietary restriction. A meal with only protein + vegetables is NOT a complete meal.${carbSourcesLine}
- When the protein and vegetables already fill the calorie target, SHRINK THE PROTEIN PORTION to make room for the carb — never drop the carb to fit. 125g chicken with 150g cooked rice is a complete ~520 kcal plate at ~44g protein; 150g chicken with cauliflower and no starch is a side dish. Meals without a carb are checked in code and ranked below complete ones, so dropping it only loses the meal.
- HARD CONSTRAINT — prepTime + cookTime MUST be ≤ ${maxPrepMinutes} minutes TOGETHER. That sum is the time from starting to eating, which is what the user actually budgeted. prepTime is HANDS-ON minutes the cook is working; cookTime is UNATTENDED minutes the cook must still be there for — an oven bake, a simmer, a roast, anything where the food is cooking and they are waiting on it. Both are REALISTIC times — do NOT default every meal to ${maxPrepMinutes}. A 25-minute pasta is 25 min, a 5-min smoothie is 5 min. Honest times only.
- restTime is SEPARATE and UNLIMITED, and it is NOT the same thing as cookTime: it is DETACHABLE time where the cook walks away entirely and comes back later or tomorrow — chilling, soaking, marinating, rising, setting. It does NOT count toward ${maxPrepMinutes}, so NEVER shorten a soak or a marinade to fit the budget. Overnight oats need 480 minutes, not 15. If a dish genuinely needs to sit overnight, say so: "restTime": 480. Use 0 when the dish is ready as soon as the work is done. A 20-minute bake is cookTime, NEVER restTime — the cook is standing in the kitchen. Ask which it is: could they leave the house? Then it is rest. Must they wait by the oven? Then it is cook, and it counts against the budget.
- NEVER claim a rest that does not do the job. Rolled oats do not soften in 15 minutes, gelatin does not set in 5, and dough does not rise in 10. If the honest rest makes the dish impractical, choose a different dish — do not shrink the number.
${maxPrepMinutes <= 10 ? `- ⚠️ MAX PREP IS ${maxPrepMinutes} MINUTES — this is extremely tight. You are ONLY allowed to suggest meals from this approved list of genuinely fast formats: protein shake or smoothie, Greek yogurt parfait, overnight oats (pre-made), cottage cheese bowl, scrambled eggs on toast (2-3 min scramble max), microwave rice + canned/pre-cooked protein, wrap or tortilla with pre-cooked filling, tuna or chicken salad on bread or crackers, cold high-protein bowl using pre-cooked or ready-to-eat ingredients. FORBIDDEN formats: any raw meat that must be cooked from scratch (chicken breast, ground beef, shrimp, fish fillets), pasta (boiling alone takes 8-10 min), oven dishes, stir fries with raw protein, soups from scratch, anything with more than 2 cooking steps. If your pantry has pre-cooked or ready-to-eat proteins (rotisserie chicken, canned tuna, canned chicken, hard boiled eggs, deli meat, Greek yogurt, cottage cheese, protein powder), use those.` : ''}
- Complexity must match the time budget:
  - ≤10 min: no-cook assembly, microwave reheats, scrambled eggs + toast, smoothies, yogurt bowls, overnight oats, wraps with pre-cooked fillings, cold plates. NO raw meat cooked from scratch, NO pasta, NO oven.
  - ≤20 min: quick stove-top only — single-pan sear/sauté, scramble, quick stir-fry, quick pasta. NO oven, NO braises.
  - ≤30 min: standard weeknight — one protein + one starch + veg. Sheet-pan, one-pan, stir-fry, pasta. No slow-roasts or braises.
  - ≤90 min: full recipes including roasts, braises, marinated dishes, multi-component dishes.
- The ACTIVE steps must fit within the prepTime claimed, and any unattended cooking within cookTime. If prepTime + cookTime is over the budget the entire meal is disqualified — moving oven minutes into restTime to squeeze under it is the failure this rule exists to stop. Only DETACHABLE waiting (soaking, chilling, marinating overnight) is exempt, and it never disqualifies a dish.
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
- EVERY COOKING STEP CARRIES A TIME, AND A PROTEIN STEP ALSO CARRIES A DONENESS CUE (blocking). "Sear until cooked through" cannot be followed and, on chicken, is not safe. Write "Sear 6-7 minutes per side, until golden and no longer pink in the centre". The times you write must add up to the prepTime and cookTime you claim.
- IF THE DISH USES THE OVEN, THE FIRST STEP PREHEATS IT (blocking). Never write "transfer to a preheated oven" without a step that preheats it — a cold oven is ten minutes the user did not plan for, and those minutes count inside cookTime.
- PRE-COOKED PANTRY FOOD COMES OUT OF THE FRIDGE COLD (blocking). "Cooked Rice", cooked pasta and any leftovers are cold. If the dish serves them warm, a step must reheat them ("Microwave the rice 60-90 seconds until steaming") — never "serve over warm rice" with nothing that warmed it.
- ONLY suggest real, practical meals that people actually eat. No bizarre combinations.
- THE NAME MUST DESCRIBE WHAT THE STEPS ACTUALLY DO (blocking). Never name a dish after a technique or a form that does not appear in the steps. If no chicken is seared, it is NOT "Pan-Seared Chicken". If nothing is roasted, it is not "Roasted ___". Borrowing a real dish's name for an unrelated plate of components is the SAME violation as inventing a name — worse, because the user expects the dish they were promised. Before finalizing a name, re-read the steps and confirm every word of the title is earned.
- PRE-PREPARED PANTRY ITEMS (chicken salad, hummus, rotisserie chicken, deli meat, tuna salad, leftovers) are ALREADY COOKED AND SEASONED. Use them as-is or as a component — never write steps that cook them from raw, and never name the dish as though you did. A meal built on chicken salad is a "Chicken Salad Plate" or "Chicken Salad Sandwich", never "Pan-Seared Chicken".
- If the honest name for what you have made is unappealing ("Chicken Salad with Potatoes and Greens"), that is a signal the MEAL is wrong, not the name. Pick a different, genuinely cohesive dish instead of dressing up an assembly with a better title.
- REAL, ESTABLISHED DISHES ONLY (mandatory): every meal must be a genuine, widely-recognized dish that real people already make and that is proven to taste good — the kind you'd find on a restaurant menu, a popular recipe site, or in common home cooking (e.g. "Beef Taco Bowl", "Chicken Fried Rice", "Greek Yogurt Parfait", "Cheeseburger & Fries"). Do NOT invent new dishes, novel fusions, or made-up "power bowl / protein bowl" combinations. If the pantry can't authentically make a known dish, pick the CLOSEST established dish and use pantry items ONLY where they genuinely belong in it. Name each meal after the real dish it actually is — never an invented marketing name.
- FLAVOURED PANTRY ITEMS ARE A FLAVOUR DECISION, NOT A NEUTRAL INGREDIENT. When the pantry lists both a flavoured and a plain version of the same thing — "Chocolate Protein Powder" alongside "Protein Powder", "Vanilla Greek Yogurt" alongside "Greek Yogurt" — use the PLAIN one, unless the dish is genuinely built on that flavour and its NAME says so. The macros are identical either way, which is exactly why this gets missed: chocolate protein powder in a pineapple bake costs nothing nutritionally and makes the dish taste wrong. If you want the flavour, commit to it in the dish name.
- USE INGREDIENTS IN THEIR CORRECT FORM AND STATE (mandatory): the pantry names each item's specific form — respect it, and match the dish, the cooking steps, and prepTime to that form. Never silently swap to a different form. If the on-hand form doesn't fit a dish, either use it correctly or pick a dish where it IS authentic.
  • CHEESE: sliced/deli cheese → burgers, melts, grilled cheese, patty melts, sandwiches. For bowls, nachos, chili, or pasta, cheese must be SHREDDED and melted into the hot food — NEVER cold slices draped on top. Cottage cheese and cream cheese do NOT melt like cheddar — don't use them as melting cheese.
  • PROTEIN STATE: raw proteins (raw chicken, ground beef, raw shrimp, fish fillets) MUST be cooked in the steps with realistic prep time — never in a no-cook or ≤10-min dish. Ready-to-eat proteins (deli meat, rotisserie chicken, canned tuna/chicken, pre-cooked bacon, hard-boiled eggs) are used as-is — never "seared" or "cooked from raw".
  • BREAD/CARB: plain sliced sandwich bread is NOT a tortilla, bun, pita, or naan — do NOT use it as the carb for tacos, burritos, curries, or bowls. Use it only for toast, sandwiches, or an intentional garlic-toast side (soup/chili). Prefer rice/tortilla/pasta as the carb when the dish is Mexican/Asian/Italian.
  • NON-DAIRY MILK (oat/almond/soy) and egg whites: oat/almond milk is thin and slightly sweet — fine in smoothies, oats, cereal, coffee, NOT a 1:1 dairy swap for savory cream sauces. Egg whites are NOT whole eggs — good for scrambles/omelets/protein, but can't fry sunny-side-up or make a rich custard.
  • CONDIMENTS/DRESSINGS (ranch, salsa, ketchup, BBQ): finishing sauces in SMALL amounts — never a primary base dumped in by the cup (also blows the fat/calorie budget).
  • NAME THE PREPARED FORM, NOT THE PANTRY ITEM (blocking). When a pantry item has to be transformed before anyone can eat it, the ingredient NAME must be what actually goes into the dish: coffee beans → "brewed coffee" or "espresso"; dry pasta cooked in the steps → "cooked pasta"; uncooked rice → "cooked rice"; whole spices you grind → "ground <spice>". The ingredient name is BOTH the line the cook reads AND the description the dish photo is generated from, so writing "coffee beans" for a shot of espresso puts a pile of whole roasted beans on top of the finished oatmeal. If a step says "brewed coffee", the ingredient must say brewed coffee too.
  • NAME THE DISH AFTER WHAT THE PANTRY ACTUALLY SAYS (blocking). Do not upgrade a generic pantry item into a specific one in the title. If the pantry says "leafy greens", the dish is not a "Spinach Frittata" — it is a "Greens Frittata". If it says "yogurt", do not title it "Greek Yogurt". Naming a food the user does not own is the same broken promise as omitting one, and it is the single most common one: six of the last fifty-one meals claimed spinach while using generic leafy greens.
  • UNITS MUST MATCH THE STATE (blocking): a solid is measured in grams, a liquid in ml. An ingredient carrying a volume unit IS a liquid and must be named as one — "30ml coffee beans" is not a thing. If you find yourself writing ml beside a solid, the name is wrong, not the unit.
- CRITICAL: You do NOT need to use every pantry ingredient. Only include ingredients that make culinary sense for THIS specific meal. It is BETTER to skip a pantry ingredient than to force it into a meal where it doesn't belong.
- CUISINE COHERENCE IS MANDATORY: Every meal must fit ONE identifiable cuisine or style (Italian, Mexican, Asian/Thai/Chinese/Japanese, Mediterranean, American comfort, Middle Eastern, Indian, etc.). Before picking ingredients, decide the cuisine FIRST, then only include pantry items that belong in that cuisine. Do NOT create cuisine mash-ups (e.g. no peanut butter in Italian pasta, no soy sauce in Mediterranean bowls, no curry powder in Tex-Mex).
- NEVER include dessert ingredients (cheesecake mix, cake mix, cookie dough, pudding mix, frosting, brownie mix, pancake mix, ice cream, etc.) in savory main dishes (pasta, rice bowls, stir fries, salads, meat dishes, etc.). Dessert ingredients belong only in dessert meals.
- NEVER include sweet condiments (maple syrup, jam, jelly, honey in excess) in savory meats unless the recipe is explicitly sweet-savory (e.g. teriyaki, honey garlic — and only in small amounts).
- Peanut butter belongs ONLY in: (1) Asian noodle dishes with RICE NOODLES, SOBA, UDON, LO MEIN, (2) satay (grilled meat skewers with dipping sauce), (3) smoothies, (4) desserts. FORBIDDEN with: Italian/Mediterranean pasta, rice bowls (plain rice + protein + veg), plain grilled proteins, salads, or any non-noodle savory dish. When peanut butter IS used, it MUST be transformed into "peanut sauce" with soy sauce, lime, ginger, garlic, and chili — and the meal NAME must say "peanut sauce" (e.g. "Thai Peanut Sauce Soba") NOT "peanut butter" (never "peanut butter chicken" or "peanut butter bowl" — that sounds like school lunch, not a meal).
- If a pantry ingredient doesn't fit your chosen cuisine, SKIP IT. Do not force it into the recipe.
- FLAVOR PRINCIPLE: every meal must hit at least TWO of the four flavor axes — (1) acid (lemon, lime, vinegar, pickled anything), (2) heat (chili, pepper flakes, hot sauce, fresh ginger, black pepper), (3) umami (soy sauce, fish sauce, parmesan, miso, mushrooms, nutritional yeast, tomato paste), (4) aromatic fat (browned butter, garlic in oil, sesame oil, olive oil with herbs). This is how real cooks build flavor — plain salt and pepper alone is not enough. If the pantry has the seasonings, USE them generously.
- SEASON IT, AND WRITE THE SEASONING DOWN (blocking). Salt, black pepper and the assumed spices are FREE: they are never counted as missing and listing them can never make a meal uncookable, so there is no reason to leave them out. Every savory dish must be seasoned in the STEPS ("season with salt and pepper", "taste and adjust") AND carry those items in the ingredients array with a quantity ("salt", "to taste", "2g"). Half the meals generated for this user so far mention neither salt nor pepper anywhere — a dish that arrives unseasoned reads as unfinished, whatever its macros say.
- A METHOD MUST BE ABLE TO PRODUCE THE TEXTURE IT PROMISES (blocking). Never write a step whose stated result the ingredients cannot physically reach. COTTAGE CHEESE, RICOTTA AND FETA ARE CURDS — they do not melt, emulsify or disappear into a sauce or a mash. Stirring cold curds into hot potato gives a lumpy, weeping mash, not a smooth one. If a dish needs cottage cheese to be smooth, the steps MUST blend or puree it FIRST, as its own step, and the ingredient must be named for that form ("blended cottage cheese"). The same applies anywhere: do not write "melt" beside a cheese that does not melt, "whip" beside something that will not hold air, or "until smooth" beside anything that stays grainy. If you are not willing to add the step that gets there, pick a different dish.
- A PROTEIN INGREDIENT USED IN AN ABSURD QUANTITY IS DIET FOOD WEARING A RECIPE'S CLOTHES (blocking). Ingredient amounts must be what the DISH calls for, never what the macro target calls for. 225g of cottage cheese against 300g of potato is not a lightened mash — it is cottage cheese with some potato in it, and a real recipe uses roughly a third of that. If a dish cannot reach the protein target at culinary-normal amounts, CHANGE THE DISH — pick one genuinely built on a protein — instead of overloading one ingredient until the numbers work. Ask before finalising: would a recipe writer publish this quantity? If not, it is wrong however good the macros look.
- COOK WITH FAT. A mash, a sauce, a saute, scrambled eggs, roasted vegetables — these need butter or oil, and butter, olive oil and cooking oil are all assumed to be in the kitchen. A mash with zero added fat is dry and pasty however much dairy is stirred through it. Leaving fat out to protect a macro number is the same failure as overloading protein to hit one.
- NO DIET FOOD: Pantry's user wants macro-aware meals that ALSO taste exciting — not punishment food. Bro-meal-prep clichés (plain grilled chicken + plain steamed broccoli + plain rice, "diet" framing) are FORBIDDEN. Every meal must read as something the user would still want to eat even if they weren't tracking macros.
- Fruits should not be mixed with savory meats (e.g. no "banana beef smoothie" or "kiwi steak bowl")
- Each meal should be a coherent dish — something you'd find at a restaurant or in a cookbook
- APPEAL TEST: Before finalizing each meal, ask: "Would a food photographer be excited to shoot this? Would someone actually order this on DoorDash?" If the answer is no, discard and try a different combination.
- NAMING: Meal names must sound like restaurant menu items. Use culinary terms (e.g. "Lemon Herb", "Miso Glazed", "Chipotle Lime", "Thai Basil", "Pesto", "Teriyaki"). Never name a meal after a crude ingredient list (bad: "Chicken Rice Broccoli Bowl", "Peanut Butter Chicken Bowl"; good: "Thai Basil Chicken Rice Bowl", "Teriyaki Sesame Chicken").
- Smoothies should only contain typical smoothie ingredients (fruits, protein powder, milk, yogurt, greens)

Respond ONLY with a JSON array, no markdown, no explanation.${servings > 1 ? ` REMINDER: quantities and macros below are for the WHOLE ${servings}-serving recipe, not one portion — do not include a "servings" field, it is set for you.` : ''} Note how EVERY item mentioned in steps (oil, garlic, broth, salt, pepper) appears in the ingredients array. "missing_ingredients" lists the NAMES of ingredients already in the array that aren't in the pantry:
[
  {
    "id": "1",
    "name": "meal name",
    "slot": "dinner",
    "prepTime": 25,
    "cookTime": 0,
    "restTime": 0,
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
          // max_tokens 6000 — 2000 truncated real full-fridge outputs mid-JSON (an unterminated
          // string → JSON.parse throws → the provider gets treated as "failed"), and 4000 was sized
          // for "up to ~7 meals with ingredient + step arrays". genCount is now 10, so 4000 would
          // truncate for exactly the reason that comment warns about — raising the candidate count
          // without this is how the whole generation silently fails. gpt-4o-mini and Gemini both
          // allow far more, so the only cost is a few output tokens when they are needed.
          body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: prompt }], temperature: 0.8, max_tokens: 6000 }),
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

    // Declared here, immediately after the model returns, because the phantom-ingredient strip
    // below writes to it and runs BEFORE the macro correction. Sitting further down produced
    // TS2448/TS2454 — a temporal dead zone, which in this file is a ReferenceError on every
    // generation. Same trap generate-meal-image hit with `db`; the baseline delta caught it again.
    const funnel: Record<string, unknown> = {
      genCountAsked: genCount, modelReturned: meals.length,
      displayCount, servings, calorieTarget, batchCalorieTarget,
      bannedBases, bannedForms, maxPrepMinutes,
      pantryItems: ingredients.length, windowNames: recentServed.length, pantryCarbsOffered: ownCarbs,
    }

    // STRIP PHANTOM FOOD, before anything sums the ingredient list. An ingredient no step ever
    // refers to is not merely untidy: macros are computed by SUMMING these lines, so the 42g of
    // all-purpose flour that "Beef Bolognese Pasta" listed and never used — standing in for the
    // pasta it did not have — is 153 real calories on the user's card. Measured across 48 real
    // generations there were 537 kcal of food nobody is ever told to cook.
    //
    // Fats and seasonings are exempt inside unusedIngredients: "Heat a pan over medium heat"
    // implies the oil beside it, and stripping that would UNDERSTATE the macros to satisfy a
    // wording nit. Only substantive ingredients over 15g are removed.
    {
      let strippedTotal = 0
      meals = meals.map((m: any) => {
        const unused = unusedIngredients(m?.steps, m?.ingredients)
        if (unused.length === 0) return m
        strippedTotal += unused.length
        console.log(`[phantom] "${m?.name}" lists ${unused.map((u: any) => `${u.grams} ${u.name}`).join(', ')} and never uses ${unused.length > 1 ? 'them' : 'it'} — removed`)
        const drop = new Set(unused)
        return { ...m, ingredients: (m.ingredients ?? []).filter((i: any) => !drop.has(i)) }
      })
      funnel.phantomIngredients = strippedTotal
    }

    // Correct macros using FatSecret nutrition data
    if (fsKey && fsSecret) {
      console.log('Correcting macros via FatSecret...')
      // 3 meals at a time × 5 ingredients each = ≤15 concurrent FatSecret calls,
      // vs. the old N×M unbounded fan-out that tripped rate limits on dense batches.
      meals = await mapLimit(meals, 3, (m: any) => correctMealMacros(m, servings))
      console.log('Macros corrected')
    }

    // Macro band validation — drop meals (post-FatSecret correction) that violate either
    // band by 40%+. Both protein and calories enforced with 1.40× buffer so near-misses
    // pass but genuine outliers (e.g. 96g protein, 1500 cal bombs) get caught.
    // Batch-scale, because macros are still batch-scale here — toPerServing() runs after
    // verifyMacros, which needs the claim and the ingredient list in the same units.
    const proteinDropThreshold = batchProteinMax * 1.40
    const calorieDropThreshold = batchCalorieMax * 1.40
    const fatDropThreshold = batchFatMax * 1.40 // fat-bomb guard — code-enforced, since the LLM ignores prompt caps under load
    // SIZE THE FOOD TO THE TARGET. Runs after the correction (so it works from grounded numbers,
    // not the model's, which are 1.7-1.8x) and BEFORE every gate that judges calories.
    //
    // This is the fix for over-shoot that a filter cannot be. The ranking already sorts by macro
    // fit and slices the best 3 of 10, so a meal arriving at 1.4x target IS the closest the model
    // produced — a harder drop starves the deck instead of improving it. Changing the quantities
    // is the only lever left.
    //
    // Counted ingredients are never touched, so "0.5 large eggs" cannot be produced. See
    // _shared/scale-recipe.ts; the rule is structural, not a rounding step afterwards. Shrinking
    // cuts rice, nuts, butter and cheese before the protein, which the old uniform cut did not.
    let scaledToTargetCount = 0
    {
      meals = meals.map((m: any) => {
        const res = scaleToTarget(m?.ingredients, Number(m?.calories), batchCalorieTarget)
        if (res.macroFactor === 1) return m
        scaledToTargetCount++
        console.log(`[scale] "${m?.name}" ${res.reason}`)
        // Per-macro factors: dense food is cut first, so protein falls less than calories do.
        return {
          ...m,
          ingredients: res.ingredients,
          calories: Math.round(Number(m.calories) * res.factors.kcal),
          protein: Math.round(Number(m.protein) * res.factors.protein),
          carbs: Math.round(Number(m.carbs) * res.factors.carbs),
          fat: Math.round(Number(m.fat) * res.factors.fat),
        }
      })
      if (scaledToTargetCount > 0) console.log(`Scaled ${scaledToTargetCount}/${meals.length} meals toward ${batchCalorieTarget} kcal`)
      funnel.scaledToTarget = scaledToTargetCount
    }

    const beforeBands = meals.length
    const inBand = meals.filter((m: any) =>
      Number(m.protein) <= proteinDropThreshold &&
      Number(m.calories) <= calorieDropThreshold
    )
    // The drop is hard while enough meals survive it, and floored when they do not — because a
    // meal whose macros could not be corrected is carrying the MODEL's numbers, and those run
    // 1.7-1.8x target. Dropping it on that basis punishes the meal for OUR missing data and empties
    // the deck. That is not hypothetical: on a live generation the model reported 1420/1450/1500
    // against an 840 batch target, all three above the 1352 drop line, so a FatSecret outage would
    // have returned nothing at all. A corrected meal over the line IS a genuine calorie bomb and
    // still goes.
    if (inBand.length >= displayCount) {
      meals = inBand
    } else {
      const uncorrected = meals.filter((m: any) => !inBand.includes(m) && m._macrosCorrected === false)
      if (uncorrected.length > 0) {
        console.log(`Macro bands: keeping ${uncorrected.length} meal(s) whose macros could not be corrected — the model's own numbers are not grounds to drop them`)
      }
      meals = [...inBand, ...uncorrected]
    }
    let droppedByFat = 0 // set by the fat drop, which runs AFTER the repeat marking below
    // UNDER-SIZED meals. There was no lower bound at all: the calorie drop above is one-sided, so a
    // 378 kcal "meal" against a 525 kcal slot shipped untouched. Mirroring the upper drop would not
    // have caught it — calorieMin / 1.40 is 0.61x target, and that meal was 0.72x. Measured across
    // every meal ever generated, NOTHING falls under 0.70x, so a mirrored bound is inert by
    // construction. 0.75x is the line where a dish stops being a meal for its slot, and it catches
    // the two real cases in the history (a 378 kcal smoothie and a 381 kcal frittata).
    //
    // FLOORED, like the fat drop directly above and the macro-check below. A hard drop here could
    // starve the deck on a thin pantry, where small dishes may be all the model can build — and an
    // under-sized meal is a far milder failure than an empty screen. Floored also means this can
    // never reduce the deck below displayCount, which is why it needs no simulation to be safe.
    const calorieDropLow = batchCalorieTarget * 0.75
    let droppedBySmall = 0
    const bigEnough = meals.filter((m: any) => Number(m.calories) >= calorieDropLow)
    if (bigEnough.length >= displayCount) { droppedBySmall = meals.length - bigEnough.length; meals = bigEnough }
    funnel.afterBands = meals.length
    funnel.droppedByBands = beforeBands - meals.length
    funnel.droppedBySmall = droppedBySmall
    const droppedByBands = beforeBands - meals.length
    if (droppedByBands > 0) {
      console.log(`Macro bands: dropped ${droppedByBands}/${beforeBands} (protein > ${Math.round(proteinDropThreshold)}g, calories > ${Math.round(calorieDropThreshold)} kcal${droppedBySmall ? `, ${droppedBySmall} under ${Math.round(calorieDropLow)} kcal` : ''})`)
    }

    // COOKABILITY. "Cook Now" promises a dish you can make tonight, and the model's own
    // missing_ingredients cannot be trusted with that promise: on real output it declared 1g of
    // parsley and stayed silent about 50g of tortilla for a wrap, with no tortilla in the pantry.
    // Declaring the thing that did not matter and hiding the thing that did.
    //
    // Structural vs garnish is the whole point. Dropping every meal with any unlisted ingredient
    // would throw away good dinners over a herb; keeping every one of them serves a wrap with no
    // wrap. So a missing STRUCTURAL item disqualifies, a missing garnish does not — and either way
    // missing_ingredients is overwritten with the truth, which is what the "Better with:" line on
    // the Pantry card reads.
    {
      const beforeCookable = meals.length
      const structuralGaps: string[] = []
      meals = meals.map((m: any) => {
        const miss = findMissing(m?.ingredients, ingredients, ASSUMED)
        if (miss.structural.length > 0) structuralGaps.push(...miss.structural)
        return { ...m, missing_ingredients: [...miss.structural, ...miss.garnish], _notCookable: miss.structural.length > 0 }
      })
      // The NAMES that disqualified a meal, not merely how many. This gate is the single largest
      // source of candidate loss in Cook Now — four of ten on run 26 — and the count alone cannot
      // separate the two causes, which need opposite fixes: the model reaching for food that is
      // genuinely absent, versus the matcher failing to recognise food that is present. A plural
      // mismatch that made "diced onion" missing against a shelf holding "Yellow Onions" was found
      // exactly this way, by hand, and should not have needed a session to find.
      funnel.notCookableMissing = structuralGaps
      if (isCookNow) {
        const cookable = meals.filter((m: any) => !m._notCookable)
        // Floored like every other drop here: a deck of two is worse than a deck with one dish that
        // needs a shopping trip, and on a thin pantry the model may have nothing better to offer.
        if (cookable.length >= displayCount) {
          const dropped = meals.length - cookable.length
          if (dropped > 0) console.log(`Cookability: dropped ${dropped}/${beforeCookable} needing a structural ingredient the pantry lacks`)
          meals = cookable
        } else if (meals.some((m: any) => m._notCookable)) {
          console.log(`Cookability: ${meals.filter((m: any) => m._notCookable).length} meal(s) need a missing structural ingredient, but only ${cookable.length} fully-cookable candidates remain — keeping them rather than showing a short deck`)
        }
      }
      // Counts the meals this gate REJECTED, not the ones still carrying the flag. Reading it after
      // the filter reported 0 while three candidates had just been dropped — a counter that is
      // always zero on success is worse than no counter, because it reads as "nothing happened".
      funnel.notCookable = beforeCookable - meals.length
      funnel.notCookableKept = meals.filter((m: any) => m._notCookable).length
      funnel.afterCookable = meals.length
    }

    // CAN YOU ACTUALLY FOLLOW THE STEPS? A recipe that says "Cook pasta according to package
    // directions" and lists no pasta is unfollowable, whatever else is right about it. The prompt
    // carries this as a blocking rule already — "EVERY single item referenced in any step MUST
    // appear in the ingredients array" — and 3 of 48 real generations broke it anyway.
    //
    // Complementary to the name check below rather than overlapping: this reads the STEPS, that
    // reads the TITLE. "Beef Bolognese Pasta" fails both; a dish whose steps say "toast" while its
    // title says nothing about bread fails only this one.
    {
      const beforeGhosts = meals.length
      const followable = meals.filter((m: any) => {
        const ghosts = ghostIngredients(m?.steps, m?.ingredients, ASSUMED)
        if (ghosts.length > 0) console.log(`[ghost] "${m?.name}" tells you to cook ${ghosts.join(', ')} and lists none`)
        return ghosts.length === 0
      })
      if (followable.length >= displayCount && followable.length < beforeGhosts) {
        console.log(`Ghost ingredients: dropped ${beforeGhosts - followable.length}/${beforeGhosts} whose steps need something they do not list`)
        meals = followable
      }
      funnel.ghostIngredients = beforeGhosts - followable.length
    }

    // DOES THE DISH CONTAIN WHAT ITS NAME PROMISES? The inverse of the cookability check above,
    // and invisible to it: there, an ingredient was in the recipe but not the pantry; here the
    // ingredient is missing from the RECIPE ITSELF while everything listed is on hand.
    //
    // "Protein Powder and Coffee Overnight Oats" was generated from a pantry with no rolled oats.
    // The model substituted granola, kept the name, and left step 3 saying "to allow oats to
    // soften" — a dish whose entire method is soaking something it does not contain.
    //
    // nameIngredientGaps already existed for the trending pipeline (it caught "Marry Me Chicken
    // Pasta" with no chicken) and simply was never wired in here.
    {
      const beforeGaps = meals.length
      const gapDetail: string[] = []
      const honest = meals.filter((m: any) => {
        // Foods AND forms: "Egg and Cheese Breakfast Wrap" promised a wrap, listed none, and shipped.
        const gaps = [...nameIngredientGaps(String(m?.name ?? ''), m?.ingredients), ...nameFormGaps(String(m?.name ?? ''), m?.ingredients)]
        if (gaps.length > 0) {
          gapDetail.push(`${String(m?.name ?? '')} -> ${gaps.join(', ')}`)
          console.log(`[name-gap] "${m?.name}" promises ${gaps.join(', ')} and lists none`)
        }
        return gaps.length === 0
      })
      // WHICH dish promised WHAT, not just how many. This gate has taken exactly 2 of 10 on two
      // consecutive runs and the count cannot say whether the model keeps misnaming dishes (the
      // gate working, and the drops correct) or the fixed food lexicon over-fires on a phrasing it
      // does not cover (a good dinner lost). Those need opposite responses. The cookability gate
      // sat at 4 of 10 for the same reason until its names were recorded, and the answer turned
      // out to be a plural bug nobody could see from a number.
      funnel.nameGapDetail = gapDetail
      // Floored, like every other drop in this file. A false positive here costs a good dinner,
      // and the food lexicon behind it is a fixed list that will not cover every phrasing.
      if (honest.length >= displayCount && honest.length < beforeGaps) {
        console.log(`Name gaps: dropped ${beforeGaps - honest.length}/${beforeGaps} whose title promised a food they do not contain`)
        meals = honest
      }
      funnel.nameGaps = beforeGaps - honest.length
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
      // FORM repeat. Name similarity provably cannot catch a rewording that keeps only the shape:
      // "Bulgarian Yogurt and Fruit Smoothie" shares ONE token with "Tropical Protein Smoothie",
      // so every name-based check returns false — and it was the eighth smoothie in fourteen
      // generations. Restricted to the BANNED forms rather than any recent form, because the
      // window legitimately holds six "bowl" dishes and marking all of them would sort most of the
      // deck to the back. overusedArchetypes applies the same measured thresholds as the base ban.
      const formRepeat = bannedForms.includes(dishArchetype(name))
      const isRepeat =
        detailedMatch ||
        formRepeat ||
        matchesRecentDish(name, nameOnlyRecent) ||
        matchesRecentDish(name, shownThisBatch)
      shownThisBatch.push(name)
      if (isRepeat) repeatCount++
      return { ...m, _repeat: isRepeat }
    })
    funnel.flaggedRepeat = repeatCount
    funnel.fresh = meals.length - repeatCount
    funnel.ingredientRescues = rescued
    if (rescued > 0) console.log(`Ingredient rescue fired ${rescued}x this generation`)

    // DISLIKE BAN — enforced in code, not asked for in the prompt.
    //
    // A thumbs-down used to be one sentence in the prompt ("do NOT suggest these or anything
    // similar"). That is a request, and this model's answer to a list of names it must avoid is
    // measurably a REWORDED version of one — the entire reason isSameDish and matchesRecentDish
    // exist. So the dish the user rejected could come back under a new adjective.
    //
    // A HARD drop, like the prep-time gate and for the same reason: "never show me this again" is
    // the user's constraint, not a preference the ranking may trade away. The client only sends the
    // dislikes whose REASON is about the dish — a wrong photo or a broken recipe leaves it in.
    const beforeDislike = meals.length
    meals = meals.filter((m: any) => !matchesRecentDish(m.name, dislikedMeals))
    funnel.droppedByDislike = beforeDislike - meals.length
    if (beforeDislike - meals.length > 0) {
      console.log(`Dislike ban: dropped ${beforeDislike - meals.length}/${beforeDislike} meals the user has rejected`)
    }

    // FLAVOUR COHERENCE — MEASURED, NOT ENFORCED (yet).
    //
    // Counting before gating, on purpose. The failure is real — a cottage cheese and PINEAPPLE bake
    // built on chocolate protein powder while plain powder sat in the same pantry — but nobody
    // knows whether it happens once in fifty generations or once in five, and this pipeline already
    // drops ~25% of candidates through six gates. A seventh gate for an unmeasured problem is how
    // the deck starves. The technique-lie check was measured at 1 in 51 and correctly NOT gated;
    // this gets the same treatment until the funnel says otherwise.
    //
    // Recorded WHERE IT IS MEASURED. Two counters in this file have already lied by being read
    // after their own filter, and both were caught by reading the funnel rather than the code.
    {
      const hits = meals.flatMap((m: any) => flavourMismatches(m?.name, m?.ingredients, ingredients))
      funnel.flavourMismatches = hits.length
      // The denominator. A zero above means nothing unless the check was actually exercised — no
      // dish reaching for a flavourable staple looks identical to a rule that worked perfectly.
      funnel.flavourOpportunities = meals.reduce(
        (n: number, m: any) => n + flavourOpportunities(m?.ingredients, ingredients), 0)
      if (hits.length > 0) {
        funnel.flavourMismatchDetail = hits.map(h => `${h.ingredient} -> ${h.plainAlternative}`)
        console.log(`Flavour mismatch: ${hits.map(h => `"${h.ingredient}" where "${h.plainAlternative}" was on the shelf`).join('; ')}`)
      }
    }

    // FAT DROP — moved here, AFTER the repeat marking, and it is not a cosmetic reorder.
    // Measured on the first funnel row: 10 candidates in, the fat filter took FOUR, and of the six
    // survivors exactly ONE was fresh. Running before the repeat marking made it blind to the only
    // thing it could trade against, so it was choosing lean-and-repeated over fatty-and-fresh —
    // the exact opposite of the ranking's own priority, which sorts freshness ABOVE macro fit
    // because "the repeat is the thing users actually notice and complain about".
    //
    // Still floored on count, and now also on freshness: a fat-bomb is dropped only when doing so
    // costs no fresh candidate. Nothing is lost by keeping a fatty fresh dish — the ranking's
    // one-sided fat penalty already sorts it below a lean one, so it only reaches the user when
    // there was nothing leaner to show.
    if (!highFatDiet) {
      const lean = meals.filter((m: any) => Number(m.fat) <= fatDropThreshold)
      const freshAll = meals.filter((m: any) => !m._repeat).length
      const freshLean = lean.filter((m: any) => !m._repeat).length
      if (lean.length >= displayCount && freshLean === freshAll) {
        droppedByFat = meals.length - lean.length
        meals = lean
      } else if (lean.length >= displayCount) {
        console.log(`Fat drop skipped: it would cost ${freshAll - freshLean} of ${freshAll} fresh candidate(s) — a repeat is the more visible failure`)
      }
    }
    if (droppedByFat > 0) console.log(`Fat drop: ${droppedByFat} fat-bomb(s) over ${Math.round(fatDropThreshold)}g removed`)
    // Recorded HERE, not with the other band counters — the drop now happens after them, and
    // reading it earlier would have logged a permanent zero.
    funnel.droppedByFat = droppedByFat
    funnel.afterFat = meals.length
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

    // Prep-time validation — drop meals whose claimed prepTime exceeds the user's budget.
    // The LLM occasionally returns a 30-min recipe when the user asked for ≤10 min — usually
    // a hallucinated "prepTime: 25" alongside a recipe that actually IS doable in 10. Dropping
    // is cleaner than clamping: clamping would lie to the user about how long it takes.
    //
    // RUNS BEFORE THE RANK/SLICE. It used to run after, which made it the one filter that could
    // ONLY shrink the deck: the slice had already thrown away the reserves, so a single dropped
    // meal meant the user saw 2 instead of 3 while perfectly valid candidates had been discarded
    // moments earlier. 15% of every meal ever shown sits exactly ON the 30-minute ceiling, so the
    // model runs right at the limit and one hallucinated "35" was all it took. Ordering it with
    // the other validity filters lets the ranking backfill from candidates that DO fit the budget.
    // Left as a HARD drop, not floored: "I have 30 minutes" is the user's constraint, not a
    // preference, and a 45-minute recipe is not a milder failure than a shorter deck.
    funnel.afterMacroCheck = meals.length
    const beforePrep = meals.length
    // Measures prepTime + cookTime, not prepTime alone. Splitting rest out of prep gave the model
    // a bucket the budget could not see, and it used it: a 10-min prep with a 20-min bake filed as
    // "restTime" passed a 15-minute budget and cost the user half an hour. Rest stays exempt — a
    // soak you walk away from is not time spent — but oven time is time spent.
    // Recorded BEFORE the filter, so the funnel holds the meals this gate rejected as well as the
    // ones it kept. `droppedByPrepTime` alone cannot tell "oven time is now counted" (the fix
    // working) from "the budget is now too tight" (over-filtering) — that needs the raw numbers.
    // It also surfaces the misfile this gate was built for: rest between 20 and 90 minutes on a
    // dish that bakes is oven time still wearing rest's clothes, and rest is exempt from the budget.
    funnel.timesSeen = meals.map((m: any) => ({
      name: String(m?.name ?? ''),
      prep: Number(m?.prepTime || 0),
      cook: Number(m?.cookTime || 0),
      rest: Number(m?.restTime || 0),
    }))
    funnel.maxPrepMinutes = maxPrepMinutes
    meals = meals.filter((m: any) => Number(m.prepTime || 0) + Number(m.cookTime || 0) <= maxPrepMinutes)
    if (beforePrep - meals.length > 0) {
      console.log(`Prep-time validation: dropped ${beforePrep - meals.length}/${beforePrep} meals whose prep+cook exceeded maxPrepMinutes=${maxPrepMinutes}`)
    }

    funnel.afterPrepTime = meals.length
    funnel.droppedByPrepTime = beforePrep - meals.length

    // ── BATCH → PER SERVING. The single divide. ──────────────────────────────────────────────
    // Everything ABOVE this line reads the ingredient list, which is always the full recipe: the
    // FatSecret correction overwrites macros with the ingredient sum, and verifyMacros drops a meal
    // whose claim is under 0.65× that same sum. Handing either of those a per-serving number
    // against a batch ingredient list is what would corrupt the macros — the FatSecret path would
    // silently stamp the batch total back on, and verifyMacros would read a 2-serving meal as
    // understating calories by half and drop it. Everything BELOW wants one portion: the fit
    // ranking scores against per-occasion targets, and the client logs meal.calories verbatim.
    meals = meals.map((m: any) => toPerServing(m, servings))
    if (servings > 1) console.log(`Servings: ${servings} per recipe — macros divided to per-serving, ingredients left at batch scale`)

    // Overgenerate-then-rank: we asked the LLM for genCount meals (5+) but only display
    // displayCount (3). Rank survivors by macro fit — sum of normalized squared distance
    // from per-meal targets — and slice to the top displayCount. Lower score = better fit.
    // Runs UNCONDITIONALLY, not only when there is a surplus. Repeats are ordered below fresh
    // dishes of the same tier here and nowhere else — an earlier version hard-dropped them at the repeat filter instead, which
    // thinned the pool BEFORE the macro and prep-time filters and could leave only 2 meals on
    // screen. Keeping repeats as reserves and letting the slice discard them means a repeat
    // reaches the user only when there aren't enough fresh survivors of the same tier.
    {
      const beforeRank = meals.length
      // PROTEIN has authority in exactly two places: the tier (under 75% of target ranks below
      // every dish that meets it) and scaleToTarget, which cuts calorie-dense food before protein.
      // Fit only orders dishes within a tier. These three numbers are what make a shown meal far
      // under target explainable — it means nothing in its tier did better.
      funnel.proteinTarget = proteinTarget
      funnel.proteinCandidates = meals.map((m: any) => Number(m?.protein) || 0)
      const scored = meals
        .map((m: any) => {
          // Complete = has a carb base (or is a drink, or the user is keto/low-carb). See
          // _shared/meal-completeness.ts for why the prompt's rule needed enforcing.
          const complete = isCompleteMeal(m, dietaryRestrictions)
          // PROTEIN FLOOR, soft: under 75% of target ranks below meals that meet it, alongside
          // completeness — Pan-Fried Eggs with Potatoes shipped at 24g against 40g, and the
          // completeness ordering alone would favour exactly that kind of dish.
          const proteinOk = proteinTarget <= 0 || Number(m.protein) >= 0.75 * proteinTarget
          // Protein powder or a sweet-flavoured product in a savory dish — see savoryClash.
          const clash = savoryClash(m)
          const pDelta = (Number(m.protein) - proteinTarget) / Math.max(proteinTarget, 1)
          const cDelta = (Number(m.calories) - calorieTarget) / Math.max(calorieTarget, 1)
          // One-sided fat penalty: only meals ABOVE the fat target lose points, so leaner meals
          // rank higher without punishing a naturally-lean dish. Off for keto/low-carb.
          const fExcess = highFatDiet ? 0 : Math.max(0, (Number(m.fat) - fatTarget) / Math.max(fatTarget, 1))
          const fitScore = pDelta * pDelta + cDelta * cDelta + fExcess * fExcess
          return { ...m, _fitScore: fitScore, _complete: complete, _tier: (complete ? 0 : 1) + (proteinOk ? 0 : 1), _clash: clash }
        })

      // EVERY INPUT THE SORT BELOW USES, recorded before it runs. proteinCandidates alone could not
      // explain run 32, which showed 33/43/33 out of a field holding 48, 46 and 44 — those numbers
      // prove a better option existed and say nothing about WHY it lost. fitScore weighs calories
      // and fat alongside protein, and `repeat` outranks the score entirely, so the choice is only
      // auditable with all four in the row.
      funnel.rankCandidates = scored.map((m: any) => ({
        name: String(m?.name ?? ''),
        p: Number(m?.protein) || 0,
        c: Number(m?.calories) || 0,
        f: Number(m?.fat) || 0,
        repeat: !!m?._repeat,
        slot: String(m?.slot ?? ''),
        complete: !!m?._complete,
        tier: Number(m?._tier) || 0,
        clash: !!m?._clash,
        fit: Math.round((Number(m?._fitScore) || 0) * 1000) / 1000,
      }))
      funnel.incomplete = scored.filter((m: any) => !m._complete).map((m: any) => String(m?.name ?? ''))

      // clash -> tier -> fresh -> fit, then at least one lunch/dinner and one lighter meal. See
      // _shared/rank-deck.ts for the run that moved tier ahead of freshness.
      // Tier = 0 when complete AND over the protein floor, 1 when one of the two, 2 when neither.
      const { deck, promoted } = selectDeck(scored, displayCount)
      funnel.slotPromoted = promoted
      meals = deck.map((m: any) => { const { _fitScore, _complete, _tier, _clash, ...rest } = m; return rest })
      funnel.proteinShown = meals.map((m: any) => Number(m?.protein) || 0)
      funnel.incompleteShown = meals.filter((m: any) => !isCompleteMeal(m, dietaryRestrictions)).length
      funnel.belowProteinFloorShown = meals.filter((m: any) => proteinTarget > 0 && Number(m?.protein) < 0.75 * proteinTarget).length
      funnel.savoryClash = scored.filter((m: any) => m._clash).map((m: any) => String(m?.name ?? ''))
      funnel.savoryClashShown = meals.filter((m: any) => savoryClash(m)).length
      // MEASURED, NOT RANKED: the prompt asks for 2 of 4 flavour axes and nothing checks it. See
      // _shared/flavour-axes.ts; rank on it only once these show how often candidates fall short.
      funnel.flavourAxes = scored.map((m: any) => ({ name: String(m?.name ?? ''), axes: flavourAxes(m) }))
      funnel.flavourAxesShown = meals.map((m: any) => flavourAxes(m).length)
      // Followability, also measured not gated — see _shared/step-checks.ts for tonight's baselines.
      funnel.stepIssuesShown = meals.map((m: any) => { const i = stepIssues(m); return { name: String(m?.name ?? ''), ...i } })
      const shownRepeats = meals.filter((m: any) => m._repeat).length
      // The price of tier-first: a repeat now beats a fresh dish under the protein floor. Recorded so
      // that price is watched rather than guessed at.
      funnel.repeatsShown = shownRepeats
      console.log(
        `Macro rank: kept top ${Math.min(displayCount, beforeRank)}/${beforeRank} by tier, freshness, then target fit${promoted.length ? `; slot coverage pulled in ${promoted.join(', ')}` : ''}` +
        (shownRepeats > 0 ? ` — ${shownRepeats} repeat(s) shown` : ''),
      )
    }
    // Strip the markers whether or not the ranking above ran — they must never reach the client
    // cache, and _macrosCorrected must not reach generated_meals either, since that history is read
    // back as recentDetailed on every later generation.
    meals = meals.map((m: any) => { const { _repeat, _macrosCorrected, _notCookable, ...rest } = m; return rest })

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
      // Capped by DISTINCT DISHES, keeping every name actually served. This used to call
      // clusterDishes, which keeps one name per dish — and that quietly disabled the strongest
      // anti-repeat signal in the prompt. clusterDishCounts reads this window back to tell the
      // model "(served 7x)", but a pre-collapsed window can only ever report 1. Measured live: 26
      // names, 26 dishes, zero counts above one, while the same meals AS SERVED contained a
      // smoothie eight times.
      //
      // Collapsing also EVICTED: the newest name won and its older twin was deleted, so each
      // repeat erased the evidence of the thing it repeated. "Tropical Protein Smoothie"
      // disappeared from the window the moment a fourth smoothie was generated.
      //
      // Counting dishes rather than names keeps both — still RECENT_MEMORY distinct dishes
      // remembered, and the counts survive to reach the prompt.
      const nextRecent = capByDistinctDishes([
        ...meals.map((m: any) => String(m?.name ?? "").trim()),
        ...recentMealNames,
      ], RECENT_MEMORY)
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
          // Strip the diagnostic — meal_data is the permanent record of the MEAL, and this history
          // is read back as `recentDetailed` on every later generation.
          meal_data: (({ _fsTrace, ...rest }: any) => rest)(m),
          name: String(m?.name ?? "").trim(),
          mode,
        })),
      )
    } catch (e) {
      console.log("generated_meals insert failed:", (e as Error).message)
    }

    // Diagnostics. Own try/catch and never allowed to fail the response — this is instrumentation,
    // and the user already paid for the generation.
    try {
      const traces = meals.map((m: any) => m?._fsTrace).filter(Boolean)
      funnel.shown = meals.length
      funnel.formsShown = meals.map((m: any) => dishArchetype(m?.name))
      funnel.namesShown = meals.map((m: any) => String(m?.name ?? ''))
      funnel.macroSources = traces.map((t: any) => t.applied ? t.source : 'uncorrected')
      await db.from("pipeline_runs").insert({
        provider: 'generate-meals-funnel', dry_run: true, stored: meals.length,
        funnel: { user: user.id, mode, ...funnel, macros: traces },
      })
    } catch (e) {
      console.log("funnel insert failed:", (e as Error).message)
    }

    // Return meals immediately, images will be fetched by a separate function. _fsTrace is
    // diagnostics and must never reach the client cache.
    return new Response(JSON.stringify(meals.map((m: any) => { const { _fsTrace, ...rest } = m; return { ...rest, image: null } })), {
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
