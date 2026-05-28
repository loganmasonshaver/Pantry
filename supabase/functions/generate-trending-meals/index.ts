import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const youtubeKey = Deno.env.get("YOUTUBE_API_KEY")
const googleAiKey = Deno.env.get("GOOGLE_AI_KEY")
const openaiApiKey = Deno.env.get("OPENAI_API_KEY")
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const fsKey = Deno.env.get("FATSECRET_KEY") ?? ""
const fsSecret = Deno.env.get("FATSECRET_SECRET") ?? ""
const db = createClient(supabaseUrl, supabaseServiceKey)

const today = () => new Date().toISOString().split('T')[0]

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

async function lookupIngredientMacros(name: string, grams: number): Promise<{ cal: number; p: number; c: number; f: number } | null> {
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

async function correctMealMacros(recipe: any): Promise<any> {
  const ingredients = recipe.ingredients || []
  let totalCal = 0, totalP = 0, totalC = 0, totalF = 0
  let lookedUp = 0

  const results = await Promise.all(ingredients.map((ing: any) => {
    const grams = parseInt(String(ing.grams)) || 100
    return lookupIngredientMacros(ing.name, grams)
  }))

  for (const macros of results) {
    if (macros) {
      // Skip obviously bad lookups (e.g. FatSecret returned wrong food)
      if (macros.cal > 900 || macros.p > 100) continue
      totalCal += macros.cal
      totalP += macros.p
      totalC += macros.c
      totalF += macros.f
      lookedUp++
    }
  }

  // Only override if we successfully looked up at least half the ingredients
  // and the total is within a reasonable single-serving range. Ceiling extended
  // to 2000 kcal so larger meal-prep portions aren't rejected for being big —
  // protein density is the real quality gate, not absolute calories.
  if (lookedUp >= ingredients.length / 2 && totalCal >= 200 && totalCal <= 2000) {
    recipe.calories = Math.round(totalCal)
    recipe.protein = Math.round(totalP)
    recipe.carbs = Math.round(totalC)
    recipe.fat = Math.round(totalF)
  }
  return recipe
}

Deno.serve(async (req: Request) => {
  // Allow service-role-key callers (pg_cron daily job) to bypass user auth and rate limit.
  // pg_cron runs without a user session — service-role JWT is the only token it can attach.
  // Constant-time-ish comparison via === is acceptable here since both are 200+ char tokens
  // and any timing leak would only reveal whether the supplied token matches at byte-N.
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  const authToken = (req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "").trim()
  const isServiceRole = SERVICE_ROLE_KEY !== "" && authToken === SERVICE_ROLE_KEY

  if (!isServiceRole) {
    // Manual auth check — gateway JWT verification is disabled (ES256 incompatibility)
    const user = await verifyUser(req)
    if (!user) return unauthorizedResponse()

    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
    const { allowed } = rateLimit(ip, 3, 60000)
    if (!allowed) return rateLimitResponse()
  }

  const fnStart = Date.now()
  const stageLog = (label: string) => console.log(`[stage] ${label} — t+${Date.now() - fnStart}ms`)

  const url = new URL(req.url)
  const forceRefresh = url.searchParams.get('refresh') === 'true'
  stageLog('start')

  // Return cached only if today's YouTube batch was already generated. Scoping to
  // trend_source='YouTube trending' is critical — without it, a creator posting a recipe
  // today is enough to satisfy the cache check, so the YouTube generator never runs.
  if (!forceRefresh) {
    const { data: existing } = await db.from('trending_meals')
      .select('id')
      .eq('generated_at', today())
      .eq('trend_source', 'YouTube trending')
      .limit(1)
    if (existing && existing.length > 0) {
      // Return the full day's pool (creator + YouTube) so callers see everything.
      const { data: meals } = await db.from('trending_meals').select('*').eq('generated_at', today()).order('id')
      return new Response(JSON.stringify({ cached: true, meals }), { headers: { 'Content-Type': 'application/json' } })
    }
  }

  if (!youtubeKey) {
    return new Response(JSON.stringify({ error: "No YouTube API key" }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    // Step 1: Search YouTube for today's trending high-protein videos across 3 categories:
    // meals, snacks, desserts. Queries are mixed and rotated by day-of-year so the pool stays
    // fresh and includes variety beyond just full meals.
    const mealQueries = [
      'high protein meal prep recipe',
      'healthy high protein dinner',
      'high protein lunch ideas',
      'high protein breakfast recipe',
      'high protein slow cooker meal',
      'high protein air fryer recipe',
      'high protein bowl recipe',
      'high protein wrap recipe',
      'high protein salad recipe',
      'high protein stir fry',
      'high protein pasta recipe',
      'high protein budget meal',
      'high protein sheet pan dinner',
      'anabolic recipe',
    ]
    const snackQueries = [
      'high protein snack recipe',
      'high protein smoothie recipe',
      'high protein cottage cheese recipe',
      'protein balls recipe',
      'greek yogurt snack ideas',
      'high protein pancakes',
      'high protein oats recipe',
    ]
    const dessertQueries = [
      'protein powder dessert recipe',
      'macro friendly dessert',
      'protein ice cream recipe',
      'high protein cheesecake recipe',
      'protein brownies recipe',
      'cottage cheese dessert recipe',
      'healthy protein dessert',
    ]
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000)

    // Mixed-signal candidate pool:
    //   • Per category we run ONE relevance query (7-day window — fresh + on-topic) AND ONE
    //     viewCount query (7-day window — what's actually viral this week, may surface stuff
    //     our hardcoded queries wouldn't otherwise find).
    //   • One extra 30-day viewCount call — "popular this month" tier catches recipes that
    //     built momentum over weeks rather than days.
    //   • One YouTube algorithmic mostPopular call against the Howto & Style category — pure
    //     viral signal independent of our keyword bias, filtered to food titles.
    type QueryConfig = { query: string; order: 'relevance' | 'viewCount'; windowDays: number }
    const buildCategoryConfigs = (arr: string[]): QueryConfig[] => {
      const a = dayOfYear % arr.length
      const b = (a + Math.floor(arr.length / 2)) % arr.length
      if (a === b) return [{ query: arr[a], order: 'relevance', windowDays: 7 }]
      return [
        { query: arr[a], order: 'relevance', windowDays: 7 },
        { query: arr[b], order: 'viewCount', windowDays: 7 },
      ]
    }
    const queryConfigs: QueryConfig[] = [
      ...buildCategoryConfigs(mealQueries),
      ...buildCategoryConfigs(snackQueries),
      ...buildCategoryConfigs(dessertQueries),
      // Popular-this-month tier — rotated meal query, 30-day window, sort by views
      { query: mealQueries[(dayOfYear + 3) % mealQueries.length], order: 'viewCount', windowDays: 30 },
    ]

    // Time-bound dedup history. The previous query had no time bound, so as the
    // catalog grew the cross-day name check would compare against everything ever
    // generated — slow and would eventually false-reject most candidates ("any meal
    // with 'Chicken' as first word" gets rejected). 60 days is enough recency for
    // "feels fresh" while keeping the comparison set bounded.
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0]
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
    const { data: prevMeals } = await db.from('trending_meals')
      .select('name, video_id')
      .neq('generated_at', today())
      .gte('generated_at', sixtyDaysAgo)
    const prevNames = (prevMeals || []).map((m: any) => m.name.toLowerCase())

    // Recently-used video IDs (90-day window — catches the same viral video resurfacing
    // weeks later). Pre-filtered against candidates so we don't waste LLM tokens on dupes.
    const { data: recentVideoRows } = await db.from('trending_meals')
      .select('video_id')
      .gte('generated_at', ninetyDaysAgo)
      .not('video_id', 'is', null)
    const recentVideoIds = new Set((recentVideoRows || []).map((r: any) => r.video_id))

    stageLog(`dedup history loaded: ${prevNames.length} prev names, ${recentVideoIds.size} prev video_ids`)

    const allVideos: { videoId: string; title: string; thumbnail: string; description: string }[] = []
    // Used to filter chart=mostPopular results down to food content (the Howto & Style
    // category includes DIY, beauty, fashion, tech tutorials — we only want recipes).
    const isFoodTitle = (t: string) => /\b(recipe|cook|meal|food|dish|breakfast|lunch|dinner|snack|dessert|bake|grill|fry|roast|smoothie|salad|wrap|bowl|pasta|stir fry|pancake|cheesecake|brownie|cottage cheese|protein|anabolic)\b/i.test(t)
    const isNotRecipeContent = (t: string) => /mukbang|asmr|review|what i ate|day of eating|vlog/i.test(t.toLowerCase())

    for (const config of queryConfigs) {
      const publishedAfter = new Date(Date.now() - config.windowDays * 86400000).toISOString()
      // Step 1a: Search for video IDs with this query/sort/window combo
      const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(config.query)}&type=video&order=${config.order}&maxResults=20&publishedAfter=${publishedAfter}&key=${youtubeKey}`
      const ytRes = await fetch(ytUrl)
      const ytData = await ytRes.json()

      if (ytData.error) {
        console.log(`YouTube search error (${config.query}, ${config.order}, ${config.windowDays}d):`, ytData.error.message)
        continue
      }
      if (!ytData.items) continue

      // Step 1b: Get full descriptions for these videos
      const videoIds = ytData.items.map((item: any) => item.id.videoId).filter(Boolean).join(',')
      if (!videoIds) continue

      const detailUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoIds}&key=${youtubeKey}`
      const detailRes = await fetch(detailUrl)
      const detailData = await detailRes.json()

      if (detailData.items) {
        for (const item of detailData.items) {
          const videoId = item.id
          const title = item.snippet.title
          const description = item.snippet.description || ''
          const thumbnail = item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url
          if (!videoId || !title || !thumbnail) continue
          if (isNotRecipeContent(title)) continue
          allVideos.push({ videoId, title, thumbnail, description: description.substring(0, 500) })
        }
      }
    }

    // YouTube algorithmic trending in Howto & Style (videoCategoryId=26) — what YouTube's own
    // ranker considers viral RIGHT NOW. Independent of our keyword queries.
    try {
      const trendingUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&videoCategoryId=26&regionCode=US&maxResults=25&key=${youtubeKey}`
      const trendingRes = await fetch(trendingUrl)
      const trendingData = await trendingRes.json()
      if (trendingData.items) {
        for (const item of trendingData.items) {
          const videoId = item.id
          const title = item.snippet.title
          const description = item.snippet.description || ''
          const thumbnail = item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url
          if (!videoId || !title || !thumbnail) continue
          if (!isFoodTitle(title) || isNotRecipeContent(title)) continue
          allVideos.push({ videoId, title, thumbnail, description: description.substring(0, 500) })
        }
      }
    } catch (e) {
      console.log('YouTube mostPopular fetch failed:', e)
    }

    if (allVideos.length === 0) {
      return new Response(JSON.stringify({ error: "No YouTube results" }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    // Deduplicate by title similarity, then drop videos we've already used in the last
    // 90 days (catches the same viral video resurfacing weeks later — produces a stealth
    // repeat under a different name otherwise), then cap. With ~150 raw candidates we
    // expect ~50 after dedup, which gives the LLM enough headroom for the dedup history
    // to grow over months without yield collapsing. Capped at 100 — Gemini Flash Lite
    // handles a 100-video selection problem fine, and the bigger pool helps after the
    // density-skip rule (recipes that don't naturally hit 25% get rejected upstream).
    const seen = new Set<string>()
    const uniqueVideos = allVideos.filter(v => {
      if (recentVideoIds.has(v.videoId)) return false
      const key = v.title.toLowerCase().replace(/[^a-z]/g, '').substring(0, 20)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 60)

    console.log(`Found ${uniqueVideos.length} unique YouTube videos (after ${recentVideoIds.size} recent-video-id rejections)`)
    stageLog('youtube fetch + dedup done')

    // Step 2: Send video titles + descriptions to Groq to generate accurate recipes
    const videoList = uniqueVideos.map((v, i) => {
      const desc = v.description ? `\n   Description: ${v.description}` : ''
      return `${i + 1}. "${v.title}"${desc}`
    }).join('\n\n')

    const prompt = `You are a fitness editor curating the most appetizing high-protein recipes from this week's trending YouTube content. Your job is to FAITHFULLY surface recipes the creator already made — not to invent or modify them. Pantry users trust that what they see in the app matches what the YouTuber actually cooked.

Here are ${uniqueVideos.length} trending YouTube recipe videos. Use both the title AND description to understand what each recipe is.

${videoList}

For each video you select, output the recipe AS THE CREATOR PRESENTED IT.

CORE FIDELITY RULES — do not violate these:
- READ macros from the video description first. Most fitness creators list calories/protein/carbs/fat directly. If they listed numbers, USE THEM VERBATIM. Do not recalculate.
- READ ingredients and quantities from the description verbatim. Preserve the creator's portions exactly. Do not scale, round, or substitute.
- NEVER add ingredients (protein powder, cottage cheese, Greek yogurt, egg whites, etc.) to engineer a recipe into a higher protein density. The recipe is what the creator made — period.
- If the description doesn't list explicit macros, calculate ONLY from the ingredients exactly as the creator listed them — don't invent quantities.

DENSITY GATE IS A SKIP RULE, NOT AN ENGINEER RULE:
- The recipe must naturally hit 25% of calories from protein (≈6.25g per 100 kcal). 20% for desserts.
- If a candidate's stated/calculated macros DON'T hit the bar, SKIP IT entirely. Pick a different video. Do not modify the recipe to make it pass.
- Better to return fewer recipes than to serve modified ones that diverge from the source video.

VARIETY IS MANDATORY — TREAT THIS AS A HARD CONSTRAINT, NOT A SUGGESTION:

Step 1 — when picking candidates, label each recipe's PRIMARY PROTEIN SOURCE. Examples of distinct sources: chicken, beef, ground turkey, pork, salmon, tuna, shrimp, eggs, cottage cheese, paneer, tofu, tempeh, greek yogurt, skyr, lentils, beans, chickpeas, protein powder.

Step 2 — group your selections by primary protein source. If ANY group has more than 1 recipe, drop all but the highest-quality one from that group and replace with a recipe using a DIFFERENT protein source from your candidate pool. Repeat until every group has exactly 1 recipe.

Step 3 — your final 15-20 picks must span AT LEAST 6 distinct primary protein sources. If the candidate pool doesn't allow this, return fewer recipes — never duplicate a source to hit 15.

PROTEIN-SOURCE QUOTA — required minimum balance across the final set:
- At least 3 recipes must use a primary ANIMAL protein (chicken / beef / turkey / pork / salmon / tuna / shrimp / eggs as PRIMARY anchor — not just present)
- At least 2 recipes may use a primary DAIRY or PLANT-FORWARD protein (cottage cheese / paneer / greek yogurt / skyr / tofu / tempeh / lentils / chickpeas / protein powder)
- Remaining slots are open

Why: an all-dairy or all-meat slate looks weird and narrow. The user expects a fitness-recipe feed to span obvious categories. If you can't hit the animal-protein quota from the candidate pool, return fewer recipes rather than padding.

ALSO MANDATORY:
- No two recipes may share the same base dish or format (e.g. don't return two oatmeal recipes, two smoothies, two salads, two pancake recipes)
- If multiple candidate videos are too similar, pick at most one and skip the rest
- Recipe names must all be distinct after normalization

PORTION + MACRO DETAILS:
- ALL macros and ingredient quantities must be PER SINGLE SERVING (1 person). If the video makes a batch, divide everything down to one portion CLEANLY (don't change ratios).
- Categorize each recipe by INTENT, not calorie cap:
  - "meal" — a sit-down meal (anywhere from 400 to 1200+ kcal — bigger meal-prep portions are fine for bulkers/athletes)
  - "snack" — a quick bite between meals (typically 150-400 kcal, but can go higher if protein-dense)
  - "dessert" — a sweet treat (typically 150-500 kcal, can go higher)
- Density worked examples (these are SKIP THRESHOLDS, not targets to hit by adding ingredients):
  - 500 kcal meal needs at least 31g protein to qualify (else SKIP)
  - 800 kcal meal needs at least 50g protein (else SKIP)
  - 300 kcal snack needs at least 19g protein (else SKIP)
  - 250 kcal dessert needs at least 13g protein (else SKIP)
- APPEAL TEST: Before finalizing each recipe, ask: "Would a food photographer be excited to shoot this? Would someone actually want to try this after seeing it scroll past?" If the answer is no, discard the candidate and pick a different video from the list.
- NAMING (trending-specific voice): Pantry's user lives on TikTok/Instagram food content — they know what's trending and want names that reflect WHY a dish is having a moment, NOT generic restaurant prose AND NOT YouTube clickbait. The dish's format usually IS the trend (cottage cheese in unexpected places, viral folded sandwich, dense bean salad, etc.) — name it honestly and let the novelty carry the energy.
  ✅ Allowed:
    - Honest format names that capture the trend: "Cottage Cheese Pizza Bowl", "Dense Bean Salad", "Folded Egg Sandwich", "Cottage Cheese Brownie Bake"
    - Light cultural cues: "TikTok-Style Carbonara", "The Internet's Favorite Cottage Cheese Toast", "Viral Salmon Bowl" (one cultural cue max — not every name)
    - Culinary terms when natural: "Miso-Glazed Salmon Rice Bowl", "Thai Basil Chicken Bowl"
  ❌ Forbidden:
    - ALL CAPS or shout words ("INSANE", "ULTIMATE", "CRAZY", "MUST TRY")
    - Multiple exclamation marks, emoji in names, channel-name attribution
    - First-person clickbait: "I tried...", "I made..."
    - Generic uncreative names: "Chicken Rice Broccoli Bowl", "Protein Bowl"
  Imagine a confident top fitness creator's caption — current, credible, not shouty. That's the bar.
- If the video isn't clearly a recipe or food, skip it.
- "visual" = intuitive kitchen portion (e.g. "1 palm-sized piece", "1 fist-sized scoop", "a small handful", "1/2 cup"). NEVER use grams in visual.
- "grams" = exact weight in grams (e.g. "150g", "200g"). ALWAYS use grams only.
- INGREDIENT COMPLETENESS (blocking): EVERY item referenced in any step — including oil, butter, salt, pepper, garlic, lemon juice, broth, spices, pasta, rice, sauces, anything — MUST appear in the "ingredients" array with grams and visual. If a step says "add garlic", garlic MUST be in ingredients. No exceptions.

ATOMIC STEPS: each step contains ONE primary cooking action so users can glance-do-advance while cooking.
  ✗ BAD: "Heat oil in pan, add chicken, sear 5 minutes" (3 actions crammed into one step)
  ✓ GOOD: "Heat oil in pan." → "Add chicken." → "Sear 5 minutes." (3 separate steps)
  Combine ONLY when actions happen simultaneously without a state change (e.g. "Season with salt and pepper" is one step).
  Scale step count to dish complexity — simple recipes 4-6 steps, complex 7-12 steps. Don't pad.
  This applies to the FORMAT of the steps, not the content — still respect the creator's recipe faithfully. Just break their consolidated instructions into individual actions.

OUTPUT TARGET: Aim for 15-20 recipes total. We expect a meaningful number to be skipped due to the density gate, name dedup, or low appeal — outputting 15-20 candidates gives downstream filters enough to land at our 6-meal display target. Don't pad with weak picks just to hit 20; quality > quantity. But err on the higher side when in doubt.

Respond ONLY with a JSON array, no markdown. Note how EVERY item mentioned in steps (oil, garlic, salt, pepper) appears in the ingredients array:
[
  {
    "video_index": 1,
    "name": "The actual dish name (cleaned up)",
    "category": "meal",
    "calories": 550,
    "protein": 45,
    "carbs": 40,
    "fat": 18,
    "prepTime": 25,
    "ingredients": [
      { "name": "chicken breast", "visual": "1 palm-sized piece", "grams": "150g" },
      { "name": "olive oil", "visual": "1 tbsp", "grams": "15ml" },
      { "name": "garlic", "visual": "2 cloves", "grams": "6g" },
      { "name": "salt", "visual": "to taste", "grams": "2g" },
      { "name": "black pepper", "visual": "to taste", "grams": "1g" }
    ],
    "steps": [
      { "title": "Heat Oil", "detail": "Warm olive oil in a skillet over medium-high heat." },
      { "title": "Season Chicken", "detail": "Pat chicken dry and season with salt and pepper." },
      { "title": "Sear", "detail": "Sear chicken 6-7 minutes per side until golden." },
      { "title": "Add Garlic", "detail": "Add minced garlic to the pan and cook 1 minute." }
    ]
  }
]`

    // Gemini-only. Logan's call: previous OpenAI fallback was producing visibly worse
    // recipes (ignored brand-voice rules, ignored variety constraints, kept slipping
    // "High Protein" / "Recipe" patterns into names that the prompt explicitly forbids).
    // Whenever Gemini yielded a small batch we'd fall through to OpenAI which would win
    // on count and clobber Gemini's better picks. Gemini 3.1 Flash Lite is free and
    // reliable enough that a single-provider setup is fine; if it fails outright we'll
    // see 0 yield that day and the cron retries naturally tomorrow.
    const providers = [
      googleAiKey && { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: googleAiKey, model: "gemini-3.1-flash-lite", name: "Google" },
    ].filter(Boolean) as { url: string; key: string; model: string; name: string }[]

    let recipes: any[] | null = null

    for (const provider of providers) {
      stageLog(`LLM call start: ${provider.name}`)
      try {
        // 90s hard timeout. Without this the fetch hangs indefinitely if the provider
        // stalls — and on Free-tier edge functions a hanging Gemini call would silently
        // burn through the entire ~150s wall budget without returning any logs. 90s
        // gives Gemini room to handle the larger prompt with variety rules + 60-video
        // candidate pool while still leaving 60s for FatSecret + image generation.
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 90000)
        const res = await fetch(provider.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${provider.key}` },
          // max_tokens 6000 — 20-recipe output with full ingredient arrays + step arrays
          // pushes 4-5k tokens easily. Lower caps were silently truncating mid-JSON,
          // producing parse errors that masked as "0 recipes generated".
          body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 6000 }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId))
        const data = await res.json()
        stageLog(`LLM call done: ${provider.name}, response ${JSON.stringify(data).length} bytes`)
        if (data.error) { stageLog(`LLM error: ${data.error?.message}`); continue }
        const text = data.choices?.[0]?.message?.content || "[]"
        const clean = text.replace(/```json|```/g, "").trim()
        const parsed = JSON.parse(clean)
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Within-batch name dedup — Groq sometimes ignores the variety prompt
          // and returns two recipes for the same dish (e.g. two oatmeal bowls)
          const normalize = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
          const seenNames = new Set<string>()
          const seenWordSets: Set<string>[] = [] // for same-day Jaccard dedup
          const STOPWORDS = new Set(['high', 'protein', 'recipe', 'easy', 'quick', 'best', 'the', 'a', 'an', 'with', 'and', 'of', 'for', 'low', 'macro', 'friendly', 'healthy'])
          const wordsOf = (s: string) => new Set(
            s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOPWORDS.has(w))
          )
          // Sanitize + collect scoring inputs. ONLY hard-reject things that are
          // genuinely invalid (missing name / no macros / exact duplicate in same
          // batch). Everything else — low density, similar to prev day, similar
          // to earlier in this batch — becomes a SCORE input used by the MMR
          // selection further down. This stops the historical whack-a-mole where
          // a single over-aggressive filter could collapse the candidate pool.
          const precomputeJaccard = (words: Set<string>, vsName: string): number => {
            const pw = wordsOf(vsName)
            if (pw.size === 0 || words.size === 0) return 0
            let overlap = 0
            words.forEach(w => { if (pw.has(w)) overlap++ })
            const union = new Set([...words, ...pw]).size
            return union > 0 ? overlap / union : 0
          }
          const sanitized = parsed.filter((r: any) => {
            const name = (r.name ?? '').trim()
            if (!name) return false
            const protein = Number(r.protein) || 0
            const calories = Number(r.calories) || 0
            if (calories <= 0 || protein <= 0) return false
            const key = normalize(name)
            if (!key || seenNames.has(key)) return false
            const candWords = wordsOf(name)
            // Precompute scoring inputs once so the MMR selection downstream doesn't
            // re-walk the prevNames array for every candidate.
            r._densityRatio = (protein * 4) / calories
            r._maxJaccardPrev = prevNames.reduce(
              (max: number, prev: string) => Math.max(max, precomputeJaccard(candWords, prev)),
              0,
            )
            r._maxJaccardToday = seenWordSets.reduce(
              (max: number, prev: Set<string>) => {
                if (prev.size === 0) return max
                let overlap = 0
                candWords.forEach(w => { if (prev.has(w)) overlap++ })
                const union = new Set([...candWords, ...prev]).size
                const j = union > 0 ? overlap / union : 0
                return Math.max(max, j)
              },
              0,
            )
            seenNames.add(key)
            seenWordSets.push(candWords)
            return true
          }).slice(0, 30)
          if (!recipes || sanitized.length > recipes.length) recipes = sanitized
          if (recipes.length >= 12) break // pool large enough for MMR to pick 6 with strong variety
        }
      } catch (e) {
        stageLog(`LLM call threw: ${(e as Error).message}`)
        continue
      }
    }

    stageLog(`LLM yielded ${recipes?.length ?? 0} recipes`)

    if (!recipes || recipes.length === 0) {
      return new Response(JSON.stringify({ error: "Failed to generate recipes from video titles" }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Step 2.5: Post-LLM cleanup — enforce variety + clean names deterministically.
    // The LLM keeps treating brand-voice + variety rules as soft suggestions despite
    // explicit hard-constraint phrasing. Code is cheaper than another prompt iteration.

    // Identify the primary protein source from the recipe name + first ingredient.
    // Order matters — more specific terms first so "chicken thigh" matches "chicken"
    // not "thigh", and "ground beef" matches "beef" cleanly.
    const PROTEIN_KEYWORDS = [
      'chicken', 'turkey', 'beef', 'pork', 'lamb', 'bacon', 'ham',
      'salmon', 'tuna', 'shrimp', 'crab', 'lobster', 'cod', 'tilapia', 'fish',
      'cottage cheese', 'paneer', 'greek yogurt', 'skyr', 'feta', 'ricotta', 'mozzarella',
      'tofu', 'tempeh', 'seitan',
      'lentil', 'chickpea', 'black bean', 'kidney bean', 'edamame', 'soy',
      'protein powder', 'whey',
      'egg', // last resort — many dishes have eggs but not as primary
    ]
    function detectPrimaryProtein(recipe: any): string {
      const haystack = `${recipe.name ?? ''} ${(recipe.ingredients || []).slice(0, 3).map((i: any) => i.name ?? '').join(' ')}`.toLowerCase()
      for (const kw of PROTEIN_KEYWORDS) {
        if (haystack.includes(kw)) return kw
      }
      return 'other'
    }

    // Strip brand-voice fluff that the LLM keeps slipping back in. Order matters —
    // strip the more specific patterns first.
    function cleanName(raw: string): string {
      return raw
        .replace(/^\s*high[\s-]?protein[,:\s-]+/i, '')   // "High Protein " / "High-Protein "
        .replace(/^\s*\d+g?\s+protein[,:\s-]+/i, '')     // "40g Protein " / "30 protein"
        .replace(/^\s*the\s+/i, '')                       // "The Best..."
        .replace(/^\s*best\s+/i, '')                      // "Best..."
        .replace(/^\s*easy\s+/i, '')                      // "Easy..."
        .replace(/^\s*quick\s+/i, '')                     // "Quick..."
        .replace(/^\s*healthy\s+/i, '')                   // "Healthy..."
        .replace(/^\s*low[\s-]?carb[,:\s-]+/i, '')        // "Low Carb..." (not always wrong, but often noisy)
        .replace(/[,:\s-]+recipe\s*\.?\s*$/i, '')         // trailing " Recipe"
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, c => c.toUpperCase()) // capitalize first letter after stripping
    }

    // Apply name cleanup (text normalization only, no filtering)
    for (const r of recipes) {
      const cleaned = cleanName(r.name ?? '')
      if (cleaned && cleaned !== r.name) r.name = cleaned
    }

    // FatSecret macro lookup — for scoring only, never for rejection. Stash both
    // LLM-claimed and FS-computed protein so the MMR selection can demote (not
    // delete) candidates whose macros disagree wildly. After the stash we restore
    // LLM values so display shows the creator's portion (FS tends to under-count
    // on the same dish due to different cuts / fat %).
    if (fsKey && fsSecret) {
      console.log('Running FatSecret lookup (scoring input only, no rejections)...')
      await Promise.all(recipes.map(async (r: any) => {
        const llmCalories = Number(r.calories) || 0
        const llmProtein = Number(r.protein) || 0
        const llmCarbs = Number(r.carbs) || 0
        const llmFat = Number(r.fat) || 0
        try {
          await correctMealMacros(r) // mutates r.calories/protein/carbs/fat with FatSecret values
        } catch { /* lookup failure → leave LLM values intact; scored as agreement = neutral */ }
        const fsProtein = Number(r.protein) || 0
        r._llmProtein = llmProtein
        r._fsProtein = fsProtein
        // Restore LLM/creator values for display.
        r.calories = llmCalories
        r.protein = llmProtein
        r.carbs = llmCarbs
        r.fat = llmFat
      }))
      console.log(`FatSecret lookup complete for ${recipes.length} candidates`)
    }

    // Score-based MMR selection — the structural fix that replaces 4 separate
    // kill-filters (density gate, jaccard dedup, variety dedup, FS sanity check)
    // with a single composite ranking. Each candidate gets a base score from
    // density + name-uniqueness + macro-agreement; then we greedy-pick the top 6
    // with a per-pick penalty for same-protein duplicates. Result: always 6
    // outputs when the candidate pool has 6+, with the LEAST-bad candidates
    // surfaced even when the pool is weak.
    function densityScore(ratio: number, category: string): number {
      // Score 1.0 at category-appropriate target ratio; scales linearly below.
      const target = category === 'dessert' ? 0.22 : category === 'snack' ? 0.25 : 0.30
      return Math.min(Math.max(ratio, 0) / target, 1.0)
    }
    function nameUniquenessScore(maxJaccard: number): number {
      // 0 jaccard (unique) → 1.0, 0.5 → 0.5, 1.0 (exact dupe) → 0.0
      return Math.max(0, 1.0 - maxJaccard)
    }
    function macroAgreementScore(llmP: number, fsP: number): number {
      // No comparison possible → neutral 1.0 (don't penalize)
      if (llmP <= 0 || fsP <= 0) return 1.0
      const diff = Math.abs(fsP - llmP) / llmP
      return Math.max(0, 1.0 - diff)
    }
    function baseScore(r: any): number {
      const dens = densityScore(r._densityRatio || 0, r.category)
      const maxJac = Math.max(r._maxJaccardPrev || 0, r._maxJaccardToday || 0)
      const uniq = nameUniquenessScore(maxJac)
      const macro = macroAgreementScore(r._llmProtein || 0, r._fsProtein || 0)
      // Weights chosen so density dominates (it's the core value prop), uniqueness
      // is meaningful, and macro agreement breaks ties without killing recipes.
      return dens * 0.45 + uniq * 0.30 + macro * 0.25
    }

    const PICK_TARGET = 6
    const VARIETY_PENALTY = 0.20 // each prior same-protein pick subtracts this from candidate's effective score
    const selected: any[] = []
    const proteinCounts = new Map<string, number>()
    const pool = [...recipes]
    while (selected.length < PICK_TARGET && pool.length > 0) {
      let bestIdx = -1
      let bestEffective = -Infinity
      for (let i = 0; i < pool.length; i++) {
        const r = pool[i]
        const protein = detectPrimaryProtein(r)
        const count = proteinCounts.get(protein) || 0
        const effective = baseScore(r) - count * VARIETY_PENALTY
        if (effective > bestEffective) {
          bestEffective = effective
          bestIdx = i
        }
      }
      if (bestIdx === -1) break
      const picked = pool.splice(bestIdx, 1)[0]
      selected.push(picked)
      const pickedProtein = detectPrimaryProtein(picked)
      proteinCounts.set(pickedProtein, (proteinCounts.get(pickedProtein) || 0) + 1)
    }
    recipes = selected
    stageLog(`MMR selection: ${recipes.length} picked (proteins: ${[...proteinCounts.keys()].join(', ')})`)

    // HARD MINIMUM GATE: only triggers if the candidate pool itself was under 6
    // (LLM yielded too few names). With MMR replacing the kill-filters, this
    // should be vanishingly rare — keeps the safety net in place for that case.
    const MIN_TRENDING_MEALS = 6
    if (recipes.length < MIN_TRENDING_MEALS) {
      console.log(`[abort] candidate pool was ${recipes.length}, below min of ${MIN_TRENDING_MEALS} — keeping previous run's trending meals intact`)
      return new Response(JSON.stringify({
        skipped: true,
        reason: 'min_threshold_not_met',
        survivors: recipes.length,
        min: MIN_TRENDING_MEALS,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    // Step 4: Match recipes back to YouTube thumbnails + persist video_id so future
    // cron runs can dedup against this video for the next 90 days.
    const meals = recipes.map((r: any) => {
      const videoIdx = (r.video_index || 1) - 1
      const video = uniqueVideos[videoIdx] || uniqueVideos[0]
      // Normalize category — LLM should output 'meal' / 'snack' / 'dessert', but guard against typos/missing
      const rawCat = (r.category || '').toLowerCase().trim()
      const category = rawCat === 'snack' ? 'snack' : rawCat === 'dessert' ? 'dessert' : 'meal'
      return {
        name: r.name,
        category,
        calories: r.calories,
        protein: r.protein,
        carbs: r.carbs,
        fat: r.fat,
        prep_time: r.prepTime,
        image: video?.thumbnail || null,
        video_id: video?.videoId || null,
        trend_source: 'YouTube trending',
        ingredients: r.ingredients,
        steps: r.steps,
        generated_at: today(),
      }
    })

    // Keep the last 3 days of trending meals as fallback if today generates few survivors.
    // Previously we wiped every run which left zero-meal days when filters rejected recipes.
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0]
    await db.from('trending_meals').delete().lt('generated_at', threeDaysAgo).eq('trend_source', 'YouTube trending')
    // Remove existing YouTube-source rows for today (in case of re-run) before inserting new
    // ones. Scoped to YouTube source so creator recipes posted today aren't wiped.
    await db.from('trending_meals').delete().eq('generated_at', today()).eq('trend_source', 'YouTube trending')
    const { error } = await db.from('trending_meals').insert(meals)
    stageLog(`db insert done — error: ${error?.message ?? 'none'}`)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    // Generate Flux images via the shared two-stage pipeline (Gemini visual description
    // → Flux render). Parallelized — was sequential, but each image takes 20-60s and 6
    // serially blew past the edge function timeout. Promise.all means the slowest single
    // image determines total time (~30s) rather than 6× ~30s. generate-meal-image has its
    // own internal rate limit so concurrent calls are safe.
    console.log('Stage: image generation (parallel)')
    const imgStart = Date.now()
    const { data: inserted } = await db.from('trending_meals').select('id, name, ingredients').eq('generated_at', today())
    if (inserted) {
      await Promise.all(inserted.map(async (meal) => {
        try {
          const ingredientNames = (meal.ingredients || []).map((i: any) => i.name)
          const imgRes = await fetch(`${supabaseUrl}/functions/v1/generate-meal-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mealName: meal.name, ingredients: ingredientNames }),
          })
          const imgData = await imgRes.json()
          if (imgData.image) {
            await db.from('trending_meals').update({ image: imgData.image }).eq('id', meal.id)
            console.log(`Image OK: ${meal.name}`)
          } else {
            console.log(`No image returned for ${meal.name}`)
          }
        } catch (e) {
          console.log(`Image gen failed for ${meal.name}:`, e)
        }
      }))
    }
    console.log(`Stage: image generation done in ${Date.now() - imgStart}ms`)

    // Re-fetch from DB so the response includes AI-generated image URLs (not YouTube thumbnails)
    const { data: finalMeals } = await db.from('trending_meals').select('*').eq('generated_at', today()).order('id')
    console.log(`Success: ${meals.length} trending meals from YouTube + Groq`)
    return new Response(JSON.stringify({ generated: true, count: meals.length, meals: finalMeals ?? meals }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
