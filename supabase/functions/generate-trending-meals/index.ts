import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { parseCookSettings, parseIngredientBlock, parseIngredientSections, parseMethodBlock, parseUnquantifiedExtras, truncatedAgainstSource } from '../_shared/ingredient-parse.ts'
import { sectionHeadingIngredient, countedIngredients, realIngredients, massBearingIngredients, nameIngredientGaps, looksUntranslated, isNonEnglishSource, hasFractionalIndivisible, recoverMergedIngredients } from '../_shared/recipe-integrity.ts'
import { classifyDietTags } from '../_shared/diet-tags.ts'
import { truncateSafe } from '../_shared/sanitize.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { mapLimit } from '../_shared/concurrency.ts'
// Internal macro coherence. Distinct from verifyMacros, which this pipeline never called:
// that one needs weighable ingredients and abstains often, this one is arithmetic on the four
// numbers the model already returned and cannot abstain.
import { COMPUTED_AGREEMENT_BAND, computePerServingMacros, macroIncoherence } from '../_shared/macro-estimate.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const youtubeKey = Deno.env.get("YOUTUBE_API_KEY")
const googleAiKey = Deno.env.get("GOOGLE_AI_KEY")
const openaiApiKey = Deno.env.get("OPENAI_API_KEY")
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const fsKey = Deno.env.get("FATSECRET_KEY") ?? ""
const fsSecret = Deno.env.get("FATSECRET_SECRET") ?? ""
const db = createClient(supabaseUrl, supabaseServiceKey)

// YouTube Data API calls run sequentially in this cron; a single hung request would
// stall the whole run and risk the function being force-killed past the edge limit.
// A 15s per-call ceiling lets one bad hop be skipped instead of dragging everything down.
async function fetchWithTimeout(url: string, ms = 15000): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

const today = () => new Date().toISOString().split('T')[0]

// How long a YouTube-sourced meal stays in the table AND on screen. Must match
// isYouTubeRecipeVisible in app/(tabs)/discover.tsx — if they drift, either the feed hides rows
// that exist or the pipeline deletes rows the feed wanted. 30 days is a deliberate step up from 7:
// it roughly quadruples the browsable pool at no cost (rows are tiny, images are globally cached)
// while staying bounded enough to watch near-duplicate accumulation before going further.
const RETENTION_DAYS = 30

// Jaccard word-overlap above which a candidate counts as a near-duplicate of something already in
// the table and is REJECTED outright, not merely down-ranked. Only exact normalized-name matches
// were rejected before; uniqueness was otherwise a soft score, which is fine at 7-day retention and
// not fine at 30+ — "Chicken Rice Bowl" from four different creators would all survive.
// 0.7 rejects "Chicken Rice Bowl" vs "Grilled Chicken Rice Bowl" (0.75) and keeps
// "Chicken Rice Bowl" vs "Beef Rice Bowl" (0.5), which is a genuinely different dish.
const NEAR_DUP_JACCARD = 0.7

// The same test, run on INGREDIENTS instead of the name.
//
// Name-Jaccard is structurally blind to one class of duplicate: the same dish under a brand name
// and a descriptive name. "Reese's Yogurt Cups" vs "Peanut Butter Yogurt Cups" shares only
// {yogurt, cups} — 0.40, comfortably accepted — while the recipes are character-for-character the
// same four ingredients. Both shipped, both got their own image generated, and they landed
// adjacent in the same Discover shelf. Fitness recipe content is full of brand-named dishes, so
// this is a recurring shape rather than a one-off.
//
// 0.85 is measured, not guessed. Swept every one of the 9,730 pairs in the live 140-meal pool:
// the most similar LEGITIMATE pair scores 0.60 ("Chocolate Peanut Butter Yogurt Clusters" vs
// "Peanut Butter Yogurt Cups" — genuinely different dishes), and the real duplicate scored 1.00.
// 0.85 sits in a 0.25-wide empty band between them, so it rejects nothing the pool actually wants.
//
// Deliberately far higher than the 0.7 name threshold: ingredient lists overlap much more than
// names do. Two unrelated chicken dishes legitimately share chicken, oil, salt and garlic.
const NEAR_DUP_INGREDIENT_JACCARD = 0.85

// Preparation words describe how an ingredient was handled, not what it is. Stripping them is what
// makes "melted dark chocolate" and "dark chocolate" compare equal — without it the pair above
// scores 0.75 instead of 1.00 and slips under any safe threshold.
const PREP_MODIFIERS = new Set(['melted','crushed','chopped','diced','sliced','shredded','grated','fresh','frozen','low','fat','nonfat','plain','unsweetened','raw','cooked','ground','whole','large','small','ripe','skinless','boneless','canned','dried','toasted','roasted','mini','light','reduced','sugar','free','extra','virgin','of'])

function ingredientSignature(ingredients: any[]): Set<string> {
  const out = new Set<string>()
  for (const i of ingredients || []) {
    // Rows carry both shapes: most are {name, amount}, a handful of older ones are bare strings.
    const raw = typeof i === 'string' ? i : (i?.name ?? '')
    const cleaned = String(raw).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/)
      .filter(w => w && !PREP_MODIFIERS.has(w)).join(' ')
    if (cleaned) out.add(cleaned)
  }
  return out
}

function setJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  a.forEach(v => { if (b.has(v)) overlap++ })
  const union = a.size + b.size - overlap
  return union > 0 ? overlap / union : 0
}

// Fixed shelf vocabulary. Mixed cuisine + format on purpose: cuisine alone covers only 43% of the
// catalog because half of it is fitness-food constructs with no cuisine, and format alone loses the
// evocative pull of "Indian night" over "Chicken".
const SHELF_TAGS = ['mexican', 'indian', 'asian', 'italian', 'mediterranean', 'american-comfort', 'sweet-treat', 'high-protein-snack', 'breakfast']


// How much of a YouTube description we KEEP, and how much of it the model is SHOWN.
//
// These were one number (500) and it was doing real damage in two directions at once.
// Creators put their socials, links and discount codes above the recipe, so 500 chars routinely
// ends mid-list — measured on a representative 728-char description whose list starts at char 398:
// the full text parses to 15 ingredients, the 500-char slice parses to 5.
//
// Five still clears the >= 3 gate, and that is the dangerous part. The 100%-retention contract is
// built from parseIngredientBlock's output, so a truncated parse silently REWRITES the spec down
// to 5 — the model returns 5, `got >= srcList.length` passes, and the row is stamped
// source_verified while missing ten of the creator's ingredients. Both sides of the comparison
// agree on a wrong answer. Whole descriptions that start their list past char 500 parse to 0 and
// are dropped as "no readable list", which is the other half of the ~28% gate rate.
//
// PARSE gets the whole thing (5000 is YouTube's own description ceiling, so this is effectively
// "no truncation"). Parsing is local string work — it costs nothing to read all of it, and the
// gate and the retention contract are exactly the things that must see everything the creator
// published.
//
// PROMPT stays bounded because the model's copy is not free: 60 videos of link-spam is prompt
// noise, and the model no longer needs the description to find the ingredients — it is handed the
// parsed checklist separately. 2000 is kept generous rather than minimal because creators often
// print their macros BELOW the ingredient list, and the prompt tells the model to read them there.
const DESC_PARSE_CHARS = 5000
const DESC_PROMPT_CHARS = 2000

// The creator's list, normalised EXACTLY the way the model's answer is normalised.
//
// This asymmetry was the single biggest false-rejection source in the pipeline. The model's side
// went through countedIngredients (junk stripped, duplicates collapsed) while the source side was
// raw parser output, so the retention gate compared a cleaned count against an uncleaned one and
// the recipe lost every time the description contained a repeat or a stray instruction line.
// Hand-checked against real rejections: 6 of 7 were false, from exactly two shapes —
//
//   * a repeated line. "1/4 cup (60ml) yogurt" listed twice for two components counts as 2 here
//     and as 1 after countedIngredients, so the model cannot satisfy it by any answer. The irony
//     is that countedIngredients dedupes SPECIFICALLY so a repeat cannot buy a free point; the
//     comparison just forgot to treat both sides alike.
//   * an instruction swept into the block. "Grill on a tawa till crisp", "190-195°C — 30-35 мин",
//     and in one case a whole method used as the ingredient list.
//
// Using it for the CHECKLIST matters as much as for the gate: the prompt hands the model this list
// and says its array must contain all N, so an uncleaned list was actively instructing the model
// to copy instructions in as ingredients — which is exactly what several of them did.
function sourceIngredients(desc: string): string[] {
  return countedIngredients(parseIngredientBlock(desc)) as string[]
}



// Likes as a percentage of views. A quality proxy that view count actively can't provide: the
// most-viewed video in a batch is often the most gimmicky one, since novelty drives the click.
// Guarded against divide-by-zero on brand-new videos.
function likeRate(v: { viewCount: number; likeCount: number }): number {
  return v.viewCount > 0 ? (v.likeCount / v.viewCount) * 100 : 0
}

// Novelty-substitution formats — "X made from not-X". These go viral on disbelief rather than
// taste. Deliberately a small PENALTY and never a filter: tested against a real batch, this
// flagged 3 videos and 2 of them ("Cloud Bread" at 4.52%, "Rice Paper Bagel" at 3.17%) were
// above the median like rate. The pattern is a weak signal; like rate is the strong one.
const GIMMICK_TITLE_RE = /\b(\d+[- ]ingredient|cloud bread|rice paper|chaffle|no[- ](bake|flour|egg|knead)|viral|tiktok made me|i tried|hack)\b/i

// Coerce an LLM-reported number to the int4 the trending_meals columns expect. Handles decimals
// ("44.5"), stringified numbers, and units the model sometimes appends ("25 min", "180g").
// Returns null rather than 0 on garbage — a null macro reads as "unknown" downstream, whereas a
// fabricated 0 would silently misreport the recipe.
function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : null
}

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

  // Bounded fan-out (5 concurrent) so the meal-level cap below keeps total
  // in-flight FatSecret requests sane instead of N×M all at once.
  const results = await mapLimit(ingredients, 5, (ing: any) => {
    const grams = parseInt(String(ing.grams)) || 100
    return lookupIngredientMacros(ing.name, grams)
  })

  for (const macros of results) {
    if (macros) {
      // Skip only truly impossible single-ingredient lookups (wrong-food matches). The old
      // 900cal/100g-protein cap also rejected legitimate calorie-dense ingredients (e.g.
      // 200g peanut butter ≈ 1180cal), undercounting totals and unfairly lowering the
      // macro-agreement score used in selection. Raise to a sane per-ingredient ceiling.
      if (macros.cal > 2500 || macros.p > 250) continue
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

// Derive diet/allergen tags from a meal's ingredient list so Discover can build a
// per-user feed. Keyword substring match — cheap, no extra API calls. Tags are
// computed at generation time and stored on the row.
Deno.serve(async (req: Request) => {
  // Allow service-role-key callers (pg_cron daily job) to bypass user auth and rate limit.
  // pg_cron runs without a user session — service-role JWT is the only token it can attach.
  // Constant-time-ish comparison via === is acceptable here since both are 200+ char tokens
  // and any timing leak would only reveal whether the supplied token matches at byte-N.
  // CRON_SECRET is a dedicated shared secret we control on both ends (function env
  // + vault), so the cron auth doesn't depend on the opaque auto-injected
  // SUPABASE_SERVICE_ROLE_KEY (whose format kept drifting and 401'ing the cron).
  // SERVICE_ROLE_KEY stays as a fallback so a correctly-keyed caller still works.
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? ""
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  const authToken = (req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "").trim()
  const isServiceRole =
    (CRON_SECRET !== "" && authToken === CRON_SECRET) ||
    (SERVICE_ROLE_KEY !== "" && authToken === SERVICE_ROLE_KEY)

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
  // Dry run: do everything up to the point of writing, then return the funnel and stop. No insert,
  // no retention delete, no image generation.
  //
  // Yield questions can only be answered by running the real pipeline against real YouTube results,
  // and every such run SWAPS the day's rows — so measuring the feed degraded it, and six runs in
  // one session churned it six times. Output also varies widely between identical runs (5 and 17
  // recipes from the same prompt and the same code), so one run cannot validate a change and the
  // repeats were the expensive part. This makes them free.
  const dryRun = url.searchParams.get('dryRun') === 'true'
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
    // Was 2 queries per category, now 4. The pools hold ~12 phrases each and only two were sampled
    // per day, so a day whose two rotated queries happened to return thin results starved the whole
    // run — which is what 7 of the last 19 days looked like.
    //
    // This is affordable because YouTube quota was barely touched: search.list costs 100 units and
    // the run made 7 of them, ~700 of a 10,000/day allowance. Going to 13 searches is ~1,300 units,
    // still 13% of quota. The constraint was never the API, it was how little of the pool we asked.
    //
    // Honest about what this does and does not do. It does NOT raise good days: the LLM is asked
    // for 15-20 recipes against max_tokens 8000 and STORE_CAP is 18, so the ceiling is unchanged.
    // It raises the FLOOR — more query diversity means one unlucky rotation can no longer starve a
    // run. Variance reduction, not throughput.
    const QUERIES_PER_CATEGORY = 4
    const buildCategoryConfigs = (arr: string[]): QueryConfig[] => {
      const n = Math.min(QUERIES_PER_CATEGORY, arr.length)
      // Evenly spread around the ring from today's offset rather than taking a contiguous block,
      // so the four sampled phrases stay maximally different from each other.
      const stride = Math.max(1, Math.floor(arr.length / n))
      const picked = new Set<number>()
      for (let i = 0; i < n; i++) picked.add((dayOfYear + i * stride) % arr.length)
      // 90-day window, not 7. A 7-day window plus the 100k view floor below is nearly empty by
      // construction — almost nothing clears 100k inside a week. Three months lets videos
      // accumulate views, and the 90-day video_id dedup already prevents a repeat on another day.
      //
      // Alternating the sort matters as much as the phrase: 'relevance' and 'viewCount' return
      // materially different sets for the same query, so this doubles coverage per phrase sampled.
      return [...picked].map((idx, i) => ({
        query: arr[idx],
        order: (i % 2 === 0 ? 'relevance' : 'viewCount') as 'relevance' | 'viewCount',
        windowDays: 90,
      }))
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
    // Name-comparison window MUST be >= RETENTION_DAYS, or meals still on screen stop being
    // compared against and near-duplicates creep back in.
    //
    // NOTE, measured 2026-08-30: the second half of that intent — "kept wider than retention so a
    // recipe doesn't reappear the moment its twin ages out" — does NOT hold, and cannot. This
    // reads history out of trending_meals, and retention DELETES YouTube rows past RETENTION_DAYS,
    // so asking for 60 days of names from a table pruned at 30 yields at most 30. On the day this
    // was written the table held 21 days of YouTube rows, so the effective window was 21. The same
    // is true of the 90-day video_id guard below.
    //
    // Left at 60 deliberately: it is harmless, it is correct for creator rows (which retention
    // does not delete), and lowering it would change nothing. Implementing the stated guarantee
    // needs a ledger that outlives the rows — a name/video_id table, or a soft-delete flag — not a
    // bigger number here. Do not "fix" this by widening the window; it is already wider than the
    // data can fill.
    const nameWindowDays = Math.max(60, RETENTION_DAYS * 2)
    const nameWindowCutoff = new Date(Date.now() - nameWindowDays * 86400000).toISOString().split('T')[0]
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
    const { data: prevMeals } = await db.from('trending_meals')
      .select('name, video_id, ingredients')
      .neq('generated_at', today())
      .gte('generated_at', nameWindowCutoff)
    const prevNames = (prevMeals || []).map((m: any) => m.name.toLowerCase())
    // Signatures computed once here rather than per candidate — the inner loop below runs this
    // against every survivor, and re-deriving them there would be O(candidates x history).
    // Sets under 3 entries are dropped: a two-ingredient recipe matches too much by chance.
    const prevIngredientSigs = (prevMeals || [])
      .map((m: any) => ingredientSignature(m.ingredients))
      .filter((sig: Set<string>) => sig.size >= 3)

    // Recently-used video IDs (90-day window — catches the same viral video resurfacing
    // weeks later). Pre-filtered against candidates so we don't waste LLM tokens on dupes.
    const { data: recentVideoRows } = await db.from('trending_meals')
      .select('video_id')
      .gte('generated_at', ninetyDaysAgo)
      .not('video_id', 'is', null)
    const recentVideoIds = new Set((recentVideoRows || []).map((r: any) => r.video_id))

    stageLog(`dedup history loaded: ${prevNames.length} prev names, ${prevIngredientSigs.length} prev ingredient sigs, ${recentVideoIds.size} prev video_ids`)

    // sourceLang: YouTube's defaultAudioLanguage/defaultLanguage, null when the creator omitted it.
    const allVideos: { videoId: string; title: string; thumbnail: string; description: string; viewCount: number; likeCount: number; sourceLang: string | null }[] = []
    // Used to filter chart=mostPopular results down to food content (the Howto & Style
    // category includes DIY, beauty, fashion, tech tutorials — we only want recipes).
    const isFoodTitle = (t: string) => /\b(recipe|cook|meal|food|dish|breakfast|lunch|dinner|snack|dessert|bake|grill|fry|roast|smoothie|salad|wrap|bowl|pasta|stir fry|pancake|cheesecake|brownie|cottage cheese|protein|anabolic)\b/i.test(t)
    const isNotRecipeContent = (t: string) => /mukbang|asmr|review|what i ate|day of eating|vlog/i.test(t.toLowerCase())

    for (const config of queryConfigs) {
      try {
        const publishedAfter = new Date(Date.now() - config.windowDays * 86400000).toISOString()
        // maxResults 50, not 20. search.list costs 100 quota units regardless of how many results
        // it returns, so a bigger page is free — and the 100%-retention gate needs the volume: only
        // 28% of raw candidates have a readable ingredient list, so 60 unique videos yielded 17
        // usable ones and the run aborted below MIN_TRENDING_MEALS.
        //
        // (An earlier estimate of 75% was measured on descriptions of meals ALREADY in the table —
        // i.e. recipes the extractor had already succeeded on, which correlates with having a clean
        // list. That's survivorship bias; 28% is the real rate on raw candidates.)
        // Step 1a: Search for video IDs with this query/sort/window combo
        //
        // regionCode + relevanceLanguage, and their absence was doing real damage. This search
        // produces most of the candidate pool and was scoped GLOBALLY, while the algorithmic
        // trending call below it has always been regionCode=US. Indian fitness YouTube is enormous
        // and heavily engaged, so it wins on view count and floods the results: measured over the
        // live 128-meal pool, 37 meals (29%) need besan, poha, suji, atta, chana dal or maida —
        // none of which a US supermarket stocks, against an audience that is ~90% American.
        //
        // The reason this matters is not taste. PANTRY MATCHING is the app's core loop, and it
        // cannot work on ingredients nobody has: "Almost in your kitchen" will never fire for a
        // besan recipe, so those rows are structurally incompatible with the main feature rather
        // than merely unfamiliar.
        //
        // Both are BIASES, not filters — YouTube still returns other-region results that rank
        // strongly, which is the intent. Cuisine variety is worth keeping; unshoppable staples are
        // not.
        //
        // WATCH THE YIELD. This necessarily narrows the candidate pool, and yield is already the
        // binding constraint here (raw output has swung 5 to 24 on identical code). If
        // rawCandidates drops materially, widen the query pool rather than reverting this — the
        // problem it fixes is real.
        const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(config.query)}&type=video&order=${config.order}&maxResults=50&publishedAfter=${publishedAfter}&regionCode=US&relevanceLanguage=en&key=${youtubeKey}`
        const ytRes = await fetchWithTimeout(ytUrl)
        const ytData = await ytRes.json()

        if (ytData.error) {
          console.log(`YouTube search error (${config.query}, ${config.order}, ${config.windowDays}d):`, ytData.error.message)
          continue
        }
        if (!ytData.items) continue

        // Step 1b: Get full descriptions for these videos
        const videoIds = ytData.items.map((item: any) => item.id.videoId).filter(Boolean).join(',')
        if (!videoIds) continue

        // `statistics` is free on a call we're already making, and without it the pipeline has no
        // idea how many views anything has — which is how a 4-view upload reached Discover.
        const detailUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds}&key=${youtubeKey}`
        const detailRes = await fetchWithTimeout(detailUrl)
        const detailData = await detailRes.json()

        if (detailData.items) {
          for (const item of detailData.items) {
            const videoId = item.id
            const title = item.snippet.title
            const description = item.snippet.description || ''
            const thumbnail = item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url
            const viewCount = parseInt(item.statistics?.viewCount ?? '0', 10) || 0
            const likeCount = parseInt(item.statistics?.likeCount ?? '0', 10) || 0
            if (!videoId || !title || !thumbnail) continue
            if (isNotRecipeContent(title)) continue
            // videos.list already returns this and it was being discarded. Authoritative source
            // language beats guessing at it from the extracted text — see recipe-integrity.
            const sourceLang = item.snippet.defaultAudioLanguage ?? item.snippet.defaultLanguage ?? null
            allVideos.push({ videoId, title, thumbnail, description: truncateSafe(description, DESC_PARSE_CHARS), viewCount, likeCount, sourceLang })
          }
        }
      } catch (e) {
        // Timeout/network on one query/sort/window combo shouldn't abort the whole
        // cron — skip this combo and keep gathering from the others.
        console.log(`YouTube fetch failed (${config.query}, ${config.order}, ${config.windowDays}d):`, (e as Error).message)
        continue
      }
    }

    // YouTube algorithmic trending in Howto & Style (videoCategoryId=26) — what YouTube's own
    // ranker considers viral RIGHT NOW. Independent of our keyword queries.
    try {
      const trendingUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&videoCategoryId=26&regionCode=US&maxResults=50&key=${youtubeKey}`
      const trendingRes = await fetchWithTimeout(trendingUrl)
      const trendingData = await trendingRes.json()
      if (trendingData.items) {
        for (const item of trendingData.items) {
          const videoId = item.id
          const title = item.snippet.title
          const description = item.snippet.description || ''
          const thumbnail = item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url
          const viewCount = parseInt(item.statistics?.viewCount ?? '0', 10) || 0
          const likeCount = parseInt(item.statistics?.likeCount ?? '0', 10) || 0
          if (!videoId || !title || !thumbnail) continue
          if (!isFoodTitle(title) || isNotRecipeContent(title)) continue
          const sourceLang = item.snippet.defaultAudioLanguage ?? item.snippet.defaultLanguage ?? null
          allVideos.push({ videoId, title, thumbnail, description: truncateSafe(description, DESC_PARSE_CHARS), viewCount, likeCount, sourceLang })
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
    console.log(`[funnel] raw YouTube candidates: ${allVideos.length}`)
    const deduped = allVideos.filter(v => {
      if (recentVideoIds.has(v.videoId)) return false
      const key = v.title.toLowerCase().replace(/[^a-z]/g, '').substring(0, 20)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // View floor. Target is 100k, but a HARD 100k floor would abort the whole cron on a thin day
    // (MIN_TRENDING_MEALS keeps the previous run, so Discover would just go stale). Step down
    // instead: take the highest tier that still yields a workable pool, and log which one ran so a
    // persistently-degraded floor is visible rather than silent.
    // Funnel telemetry, returned in the RESPONSE as well as logged. The console logs are only
    // reachable from the Supabase dashboard, so from the CLI — and from the cron, which stores its
    // response in net._http_response — "where did the meals go" has been unanswerable. Three
    // separate attempts to reason it out from source were wrong before this existed.
    const funnel: Record<string, unknown> = {}
    const VIEW_FLOOR_TIERS = [100_000, 50_000, 25_000, 0]
    const MIN_POOL = 25  // the LLM needs headroom above STORE_CAP (18) after its own name dedup
    let uniqueVideos = deduped
    let usedFloor = 0
    for (const floor of VIEW_FLOOR_TIERS) {
      const kept = deduped.filter(v => v.viewCount >= floor)
      if (kept.length >= MIN_POOL || floor === 0) { uniqueVideos = kept; usedFloor = floor; break }
    }
    // Best-LIKED first, not most-viewed. Measured on a real batch: the highest-viewed video
    // (7.2M, "2-Ingredient Chia Pita") had the WORST like rate in the pool at 1.17% against a
    // 2.96% median, and it's a recipe trusted reviewers call inedible. Views measure curiosity —
    // a title that sounds impossible earns the click whether or not the food is good. Likes come
    // from people who watched it through, so like RATE separates "went viral" from "was liked".
    // The view floor above still gates entry; this decides the order within it.
    // HARD GATE, and it must run BEFORE the cap. A video without a readable ingredient list can't
    // be verified, so it can't be guaranteed complete. Only 28% of raw candidates qualify.
    //
    // Ordering was the bug that aborted the first run: the pool was capped to 60 and THEN gated,
    // so the gate only ever saw 60 videos and kept 17 — the cap was spending most of its budget on
    // candidates that were about to be discarded. Gating first means the 60 we keep are 60 usable
    // ones. Same cap, ~3.5x the usable pool.
    const beforeGate = uniqueVideos.length
    uniqueVideos = uniqueVideos.filter(v => sourceIngredients(v.description || '').length >= 3)
    console.log(`[funnel] ingredient-list gate: ${uniqueVideos.length}/${beforeGate} videos have a readable list`)
    funnel.rawCandidates = allVideos.length
    funnel.afterDedup = deduped.length
    funnel.viewFloorUsed = usedFloor
    funnel.afterViewFloor = beforeGate
    funnel.afterIngredientGate = uniqueVideos.length

    // Best-LIKED first, not most-viewed. Measured on a real batch: the highest-viewed video
    // (7.2M, "2-Ingredient Chia Pita") had the WORST like rate in the pool at 1.17% against a
    // 2.96% median, and it's a recipe trusted reviewers call inedible. Views measure curiosity —
    // a title that sounds impossible earns the click whether or not the food is good. Likes come
    // from people who watched it through, so like RATE separates "went viral" from "was liked".
    uniqueVideos = uniqueVideos
      .sort((a, b) => likeRate(b) - likeRate(a))
      .slice(0, 60)

    funnel.sentToLLM = Math.min(uniqueVideos.length, 60)
    const medianViews = uniqueVideos.length
      ? uniqueVideos[Math.floor(uniqueVideos.length / 2)].viewCount
      : 0

    const rates = uniqueVideos.map(likeRate).filter(r => r > 0).sort((a, b) => a - b)
    const medianLike = rates.length ? rates[Math.floor(rates.length / 2)] : 0
    console.log(`[funnel] view floor ${usedFloor.toLocaleString()} (of ${VIEW_FLOOR_TIERS[0].toLocaleString()} target) → ${uniqueVideos.length} videos, median ${medianViews.toLocaleString()} views, median like-rate ${medianLike.toFixed(2)}%`)
    const gimmicky = uniqueVideos.filter(v => GIMMICK_TITLE_RE.test(v.title))
    if (gimmicky.length) console.log(`[funnel] gimmick-pattern titles in pool (penalised, not dropped): ${gimmicky.length}`)
    if (usedFloor < VIEW_FLOOR_TIERS[0]) {
      console.log(`[funnel] WARN: fell back below the 100k target — only ${deduped.filter(v => v.viewCount >= VIEW_FLOOR_TIERS[0]).length} candidates cleared it`)
    }
    console.log(`Found ${uniqueVideos.length} unique YouTube videos (after ${recentVideoIds.size} recent-video-id rejections)`)
    stageLog('youtube fetch + dedup done')

    // Step 2: Send video titles + descriptions to Groq to generate accurate recipes
    const videoList = uniqueVideos.map((v, i) => {
      // Shown-to-the-model slice only. The full text is still what parseIngredientBlock reads
      // below, so widening the parse window never costs prompt budget — see DESC_PROMPT_CHARS.
      const desc = v.description ? `\n   Description: ${truncateSafe(v.description, DESC_PROMPT_CHARS)}` : ''
      // Naming the language turns the general "translate" rule into a specific instruction about
      // THIS video, which is the difference between the model noticing and not.
      const langNote = isNonEnglishSource(v.sourceLang)
        ? `\n   SOURCE LANGUAGE: ${v.sourceLang} — this description is NOT English. Translate every ingredient and step into English.`
        : ''
      // When the creator published an explicit list, restate it as a checklist with its exact
      // count. "Return all 14" is a far harder instruction to quietly ignore than "keep every
      // ingredient", which was already in the prompt and was being ignored half the time.
      // The creator's own METHOD, when the description carries one. Same treatment as the
      // ingredient checklist and for the same measured reason: handed a list to COPY the model
      // keeps it, asked to summarise it drops things. "Kala Chana Dosa" published 9 steps and we
      // stored 5, losing "drain the water", "medium heat" and "flip and cook for another 1-2
      // minutes" — every one of which was inside the description the model was already shown.
      // Temperatures and times the creator stated OUTSIDE any method section — an "Air Fryer
      // Settings" block, a bare "Cooking time 10-15 minutes". Nothing captured these, so the model
      // summarised them away: "Chicken Semolina Momos" published "Cooking time 10-15 minutes" and
      // its stored step reads "steam until cooked". Only 27% of stored meals state any cook time,
      // and a stated one is the difference between a recipe you can follow and a guess.
      const cookData = parseCookSettings(v.description || '')
      const cookList = cookData.length
        ? `\n   SOURCE COOK SETTINGS (the creator stated these — put them IN the steps, do not drop them):\n${cookData.map(x => `     - ${x}`).join('\n')}`
        : ''
      const method = parseMethodBlock(v.description || '')
      const methodList = method.length >= 3
        ? `\n   SOURCE METHOD (${method.length} steps — follow these IN ORDER and keep every time, temperature, heat level and technique. Do not merge or summarise them):\n${method.map(x => `     - ${x}`).join('\n')}`
        : ''
      const parsed = sourceIngredients(v.description || '')
      // Which PART of the dish each line belongs to. Creators group a recipe ("Cake" / "Frosting" /
      // "Topping", "Salmon Seasonings" / "Bang Bang Dressing") and the grouping is what makes a
      // repeated ingredient readable: garlic powder three times is faithful when it seasons the
      // pasta, the salmon and the dressing, and looks like a bug when the parts are flattened away.
      // Keyed to a LIST of parts, not one. An identical line can appear under several parts —
      // "2 Tsp Garlic Powder" seasons both the pasta and the salmon — and a plain Map would keep
      // only the last, mislabelling every repeat except one. That is the exact case this feature
      // exists for, so getting it wrong would have been worse than not shipping it.
      //
      // The checklist is DEDUPED (countedIngredients), so a doubly-listed ingredient appears once.
      // Naming both parts on that single line is what tells the model to emit two entries.
      const sections = new Map<string, (string | null)[]>()
      for (const r of parseIngredientSections(v.description || '')) {
        const seen = sections.get(r.line)
        if (seen) seen.push(r.section)
        else sections.set(r.line, [r.section])
      }
      // SAME FOOD, DIFFERENT AMOUNT — the biggest single cause of retention rejections.
      // Measured on the 2026-09-04 dry run: 7 of 19 candidates died on the retention contract, and
      // four of those were this. Apple Pie Cottage Cheese Cake lists "1/2 cup (100 g) sugar",
      // "2 tbsp sugar" and "1 tbsp sugar"; Cottage Cheese Flatbread lists olive oil and garlic
      // twice each; Mango Cheesecake lists yoghurt, erythritol and mango twice each. The model
      // consolidated every one of them and lost the recipe.
      //
      // The existing "[appears Nx]" marker cannot help: `sections` is keyed by the EXACT LINE, and
      // these lines differ, so each looks unique and is annotated as such. The prompt already says
      // "Never merge two lines into one entry" in bold terms and the model does it anyway — so
      // repeating the rule is not the fix. What it is actually doing is TIDYING what looks like a
      // duplicate, which means the useful thing to tell it is that these are deliberate.
      const foodKey = (line: string) => line
        .toLowerCase()
        .replace(/^[\d\s./-]*(?:g|kg|ml|l|oz|lb|lbs|cups?|tbsps?|tsps?|tablespoons?|teaspoons?|packets?|cloves?|pinch(?:es)?|slices?|cans?|blatt|prise)?\b/, '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/).filter(w => w.length > 2).sort().join(' ')
      const foodCounts = new Map<string, number>()
      for (const x of parsed) { const k = foodKey(x); if (k) foodCounts.set(k, (foodCounts.get(k) ?? 0) + 1) }

      const checklist = parsed.length >= 3
        ? `\n   SOURCE INGREDIENT LIST (${parsed.length} items — your ingredients array MUST contain all ${parsed.length}, copied, none merged or omitted):\n${parsed.map(x => {
            const parts = sections.get(x) ?? []
            const named = [...new Set(parts.filter(Boolean))] as string[]
            if (parts.length > 1) {
              // Listed more than once: the model must emit one entry PER occurrence.
              return `     - ${x}   [appears ${parts.length}x — one entry each${named.length ? `, parts: ${named.join(', ')}` : ''}]`
            }
            // Same food on more than one source line, at different amounts. Say so, or it gets
            // consolidated into a single entry and the whole recipe is rejected for the shortfall.
            const repeats = foodCounts.get(foodKey(x)) ?? 1
            if (repeats > 1) {
              return `     - ${x}   [this food is listed ${repeats}x at DIFFERENT amounts — the creator uses it in ${repeats} places. Emit a SEPARATE entry for each, with its own amount. Do NOT add them together or keep only one.${named.length ? ` part: ${named[0]}` : ''}]`
            }
            return `     - ${x}${named.length ? `   [part: ${named[0]}]` : ''}`
          }).join('\n')}`
        : ''
      // Ingredients the creator listed with NO quantity — "Green Onion", "Cilantro", "Cream
      // cheese". parseIngredientBlock needs a leading quantity, so these were invisible: measured
      // across 15 real descriptions, ~27 real ingredients are lost this way.
      //
      // Handed over SEPARATELY and deliberately NOT added to the retention contract. "Water for
      // soaking" and "Cooking Spray" are real lines a faithful recipe may legitimately omit, and
      // counting them would invent a specification the model cannot meet — which is how a parser
      // that over-extracts rejects good food.
      const extras = parseUnquantifiedExtras(v.description || '')
      const extraList = extras.length
        ? `\n   ALSO LISTED, without quantities (include these too, estimating a sensible amount; they do NOT count toward the ${parsed.length} above):\n${extras.map(x => `     - ${x}`).join('\n')}`
        : ''
      return `${i + 1}. "${v.title}"${desc}${langNote}${checklist}${extraList}${methodList}${cookList}`
    }).join('\n\n')

    const prompt = `You are a fitness editor curating the most appetizing high-protein recipes from this week's trending YouTube content. Your job is to FAITHFULLY surface recipes the creator already made — not to invent or modify them. Pantry users trust that what they see in the app matches what the YouTuber actually cooked.

Here are ${uniqueVideos.length} trending YouTube recipe videos. Use both the title AND description to understand what each recipe is.

${videoList}

For each video you select, output the recipe AS THE CREATOR PRESENTED IT.

CORE FIDELITY RULES — do not violate these:
- READ macros from the video description first. Most fitness creators list calories/protein/carbs/fat directly. If they listed numbers, USE THEM VERBATIM. Do not recalculate.
- READ ingredients and quantities from the description verbatim. Preserve the creator's portions exactly. Do not scale, round, or substitute.
- SHELF_TAG — exactly one, from this list ONLY: mexican, indian, asian, italian, mediterranean, american-comfort, sweet-treat, high-protein-snack, breakfast. Pick the one a hungry person would use to describe the dish, not the most technically defensible. A cuisine wins when the dish clearly belongs to one (paneer masala = indian, teriyaki bowl = asian, gnocchi = italian). When it has no cuisine — protein bowls, cottage cheese pancakes, yogurt bites, cloud bread — use sweet-treat, high-protein-snack or breakfast instead. Never invent a value outside the list.
- ALLERGENS — answer for the dish AS COOKED, including anything hidden inside a prepared component. Pesto contains parmesan (dairy) and pine nuts. Gnocchi, teriyaki, hoisin and most soy sauce contain wheat. Caesar dressing contains dairy and anchovy. Naan and brioche contain dairy. If a component's usual recipe contains the allergen, say true — do not assume a special-diet version. When unsure, say TRUE. A false "contains" costs one meal a filter tag; a false "does not contain" sends an allergen to someone avoiding it, and those are not equivalent mistakes.
- SERVINGS AND SCALE — read this before touching any quantity. Creators list INGREDIENTS for the whole batch and MACROS per serving. Do not reconcile those by shrinking the ingredients.
  * "servings" = how many servings the creator's ingredient list makes. If they say "makes 8", use 8. If they give per-serving macros and a batch of ingredients, work out how many servings that batch is. If it's a single-portion dish, 1.
  * "ingredients" = the creator's quantities EXACTLY as written, for the FULL batch. 16 oz of cream cheese stays 16 oz.
  * calories/protein/carbs/fat = PER SERVING, as the creator stated them.
  * NEVER divide ingredient quantities to match per-serving macros. A real failure this rule exists to stop: a cheesecake made with 16oz cream cheese, 4 eggs and 2 scoops of protein powder was stored as 2oz, "0.5 large eggs" and "0.25 scoop". Half an egg is not a recipe.
  * NEVER output a fractional count of a discrete item — eggs, scoops, slices, cloves, cans, bars, tortillas. If a number comes out fractional, you have scaled something you shouldn't have.
- Every video below carries a SOURCE INGREDIENT LIST. It is a CONTRACT, not a suggestion: your ingredients array must have EXACTLY as many entries as that list has lines, in the same order, one entry per line. A recipe with fewer entries than its source list is rejected outright and wasted — if a line looks trivial ("Salt to taste", "Oil for cooking"), it is still an entry. Seasonings, oils and "to taste" items are ingredients — a masala without its ghee, cumin and chilli is a different, worse dish. Never merge two lines into one entry and never drop a line for brevity.
- KEEP EVERY INGREDIENT THE CREATOR LISTS — including toppings, garnishes and sauce components. Do NOT reduce a recipe to its "main" 3-4 ingredients. A bowl or plate dish IS its toppings: strip the diced tomato, pickles and lettuce off a burger bowl and you have described a different, barer dish than the one the creator made. If the creator groups ingredients under headings (Burger / Toppings / Sauce), keep the items from EVERY heading.
- A multi-ingredient sauce or dressing stays intact: list its components as ingredients, and describe it in the steps as one mixed sauce (e.g. "whisk the yogurt, ketchup, mustard and relish into a burger sauce") so downstream knows it is combined rather than served as separate dollops.
- PRESERVE THE PREPARATION METHOD exactly as described. If the creator cuts the potato into fries, the step says fries — not "dice", not "cube", not "roast". The cut and cooking method determine what the finished dish physically looks like, so changing it silently misrepresents the recipe.
- NEVER add ingredients (protein powder, cottage cheese, Greek yogurt, egg whites, etc.) to engineer a recipe into a higher protein density. The recipe is what the creator made — period.
- If the description doesn't list explicit macros, calculate ONLY from the ingredients exactly as the creator listed them — don't invent quantities.
- "macros_from_creator" is REQUIRED and must be honest: true ONLY when the description actually states calories/protein/carbs/fat. If you worked them out yourself, it is false. Do not set it true because the numbers look reasonable — we recompute the false ones from the ingredients ourselves, so a wrong true is the one thing that cannot be caught downstream.

PROTEIN DENSITY — we rank on this downstream, so do NOT skip:
- We prefer recipes where protein is ≈25% of calories (20% for desserts), but DO NOT drop a recipe for missing that bar. Include it with accurate macros — downstream scoring ranks by density and surfaces the highest-protein options automatically.
- Never modify or engineer a recipe to hit a density target. Report it faithfully exactly as the creator made it; we handle ranking.

VARIETY — extract broadly, we curate downstream:
- Do NOT pre-curate for protein balance or drop recipes to "make room." Extract every distinct recipe you find across the videos. Our downstream selection is variety-aware (it penalizes repeated protein sources when picking the final set), so the MORE distinct candidates you hand us, the better the final spread — pre-filtering here only starves that selection.
- The one same-recipe rule: don't output two recipes that are genuinely the same dish/format (e.g. two plain oatmeal bowls, two basic smoothies). Different protein, different format, or a clearly different flavor profile = keep both.

ALSO MANDATORY:
- At most TWO recipes may share a base format (two pancake recipes is fine, five is not). This mirrors what the code enforces after you — it caps each format at 2 and keeps the rest as spares — so returning only one per format does not make the feed more varied, it just leaves the ranker short. Prefer the two most different examples of a format over one.
- Two recipes that are genuinely the SAME dish (same format, same protein, same flavour profile) — return only one.
- Recipe names must all be distinct after normalization

PORTION + MACRO DETAILS:
- MACROS are per single serving. INGREDIENTS are the full batch. See SERVINGS AND SCALE above — never divide the ingredients to match the macros.
- Categorize each recipe by INTENT, not calorie cap:
  - "meal" — a sit-down meal (anywhere from 400 to 1200+ kcal — bigger meal-prep portions are fine for bulkers/athletes)
  - "snack" — a quick bite between meals (typically 150-400 kcal, but can go higher if protein-dense)
  - "dessert" — a sweet treat (typically 150-500 kcal, can go higher)
- Density reference points. These are NOT skip rules — include the recipe either way and report its
  real macros; ranking happens downstream in code. They only tell you what "protein-dense" means here:
  - a 500 kcal meal is dense at ~31g protein
  - an 800 kcal meal is dense at ~50g protein
  - a 300 kcal snack is dense at ~19g protein
  - a 250 kcal dessert is dense at ~13g protein
- APPEAL: Prefer recipes a food photographer would be excited to shoot and someone would want to try mid-scroll. Treat this as a soft preference, not a reason to drop candidates — include the recipe; we rank on appeal downstream.
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
- SECTION: copy the "[part: …]" label from the source list onto that ingredient, verbatim and
  lowercase. Use null when a line carries no label. This is what makes a repeated ingredient
  readable: 2 tsp garlic powder for the pasta and 1 tsp for the dressing are two entries that a
  reader can tell apart only if each says which part it belongs to. Never invent a part that the
  source did not label, and never merge two entries because they share a name.
- BRANDS: drop the brand NAME, keep every descriptor. The descriptors are what make an ingredient
  make sense and what a shopper actually needs; the brand is the part that varies by store.
  ✓ "Quest Chili Lime Protein Chips"        -> "chili lime protein chips"
  ✓ "Sargento Natural Pepper Jack Cheese"   -> "pepper jack cheese"
  ✓ "Hormel 60% Less Fat Turkey Pepperoni"  -> "reduced fat turkey pepperoni"
  ✓ "Mid's Pizza Sauce"                     -> "pizza sauce"
  ✗ NEVER strip to the bare category: "protein chips" alone reads as a random addition, while
    "chili lime protein chips" reads as the deliberate crunchy topping the creator intended.
  KEEP the brand when it IS the food and has no generic name — Oreo, Biscoff, Nutella, Skyr, and
  branded supplements with no equivalent. Dropping those loses the ingredient itself.
- NAME EACH INGREDIENT BY ITS FOOD, never by its role or by the section heading above it. Creators
  structure descriptions in parts ("Cake", "Frosting", "Topping", "For serving") and the food is the
  line UNDER the heading, not the heading.
  ✗ BAD: "toppings"   ✓ GOOD: "sprinkles"        (source: "Topping\n * 20g sprinkles")
  ✗ BAD: "topping"    ✓ GOOD: "egg yolk, sesame seeds"  (source: "Egg yolk & sesame seeds for topping")
  A name nobody can buy, cook or shop for is a rejected recipe. The same goes for "frosting",
  "filling", "garnish", "coating", "glaze" and bare "seasoning" — name what it is made of.
  An ingredient legitimately repeated across two sections STAYS repeated: 50g yogurt in the cake and
  100g in the frosting is two entries, not one.
- INGREDIENT COMPLETENESS (blocking): EVERY item referenced in any step — including oil, butter, salt, pepper, garlic, lemon juice, broth, spices, pasta, rice, sauces, anything — MUST appear in the "ingredients" array with grams and visual. If a step says "add garlic", garlic MUST be in ingredients. No exceptions.

ATOMIC STEPS: each step contains ONE primary cooking action so users can glance-do-advance while cooking.
  ✗ BAD: "Heat oil in pan, add chicken, sear 5 minutes" (3 actions crammed into one step)
  ✓ GOOD: "Heat oil in pan." → "Add chicken." → "Sear 5 minutes." (3 separate steps)
  Combine ONLY when actions happen simultaneously without a state change (e.g. "Season with salt and pepper" is one step).
  Scale step count to dish complexity — simple recipes 4-6 steps, complex 7-12 steps. Don't pad.
  EXCEPTION, and it overrides the range above: when a video carries a SOURCE METHOD, follow ITS
  step count. The creator already decided how many steps their recipe takes. Compressing 9 published
  steps into 5 is how "cook on medium heat, then flip and cook another 1-2 minutes" becomes "cook
  until golden" — the timing and the technique are lost, and they are exactly what a cook needs.
  Never drop a time, a temperature, a heat level or a doneness cue that the creator stated.
  This applies to the FORMAT of the steps, not the content — still respect the creator's recipe faithfully. Just break their consolidated instructions into individual actions.

OUTPUT TARGET: Return a recipe for EVERY video below that is genuinely a recipe — aim for 30-40 from the ${uniqueVideos.length} provided, and treat that as a floor of effort rather than a quota to stop at. Every one of these videos was pre-screened and carries a published ingredient list, so the great majority CAN yield a faithful recipe; skipping is for a video that is not a recipe at all, not for one you judge unexciting.

Do NOT self-filter for density, variety, appeal or balance. Downstream code stores up to 18 and ranks by density, source-video like rate, uniqueness and macro agreement, so a bigger pool directly produces a better feed and a small one silently starves it — returning ~17 is how a day ends up showing 11. Skipping on quality grounds does not raise the bar, it just hands the ranker fewer options.

Never invent a recipe to pad, and never merge two videos into one entry. If a video genuinely is not food, skip it and move on.

SHELF_TAG — REQUIRED, and it must be copied EXACTLY from this list. Any other value is discarded
and the recipe loses its shelf, so never invent one, never leave it out, and never pluralise or
rephrase (not "desserts", not "asian-inspired", not "snack"):
  mexican | indian | asian | italian | mediterranean | american-comfort | sweet-treat | high-protein-snack | breakfast
Pick by what the dish IS: cuisine first if it clearly belongs to one, otherwise sweet-treat for
desserts, high-protein-snack for small savoury bites, breakfast for morning food, and
american-comfort as the catch-all for everything else. Every recipe gets one — there is no "none".

LANGUAGE. Source descriptions are often not in English — this pipeline searches YouTube globally
and German, Polish and Spanish high-protein cooking are large scenes. TRANSLATE everything you
output into English: ingredient names, step text and the dish name. Never copy a source word
through untranslated ("Haferflocken" is rolled oats, "borówki" are blueberries, "serek wiejski" is
cottage cheese). Translate the FOOD, not the brand: "ESN Flexpresso" stays as it is, "Skyr" stays
Skyr. A recipe whose ingredients are still in the source language is unusable to the reader even
though every other field looks correct, and that is exactly what shipped before this line existed —
English dish names sitting over German and Polish ingredient lists.

Respond ONLY with a JSON array, no markdown. Note how EVERY item mentioned in steps (oil, garlic, salt, pepper) appears in the ingredients array:
[
  {
    "video_index": 1,
    "name": "The dish name as a RECIPE TITLE — include what makes it this recipe. A creator's video title is not a dish name: 'We added protein to everything else... why not jello?' is Protein Jello, not Jello. Two to five words. Never a bare category noun on its own.",
    "category": "meal",
    "servings": 1,
    "shelf_tag": "american-comfort",   // REQUIRED. Must be EXACTLY one of the nine values listed below.
    "contains_dairy": false,
    "contains_gluten": false,
    "contains_nuts": false,
    "macros_from_creator": true,   // REQUIRED. true ONLY if the description states the numbers.
    "calories": 550,
    "protein": 45,
    "carbs": 40,
    "fat": 18,
    "prepTime": 25,
    "ingredients": [
      { "name": "chicken breast", "visual": "1 palm-sized piece", "grams": "150g", "section": null },
      { "name": "greek yogurt", "visual": "1/2 cup", "grams": "125g", "section": "bang bang dressing" },
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
      googleAiKey && { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: googleAiKey, model: "gemini-3.1-flash-lite", name: "Google", maxTokens: 48000 },
      // OpenAI fallback. openaiApiKey was already declared at the top of this file and never
      // wired in, so this was the ONLY Gemini-primary function with no second provider — a Gemini
      // outage or rate-limit meant the whole trending pipeline produced nothing, and with 30-day
      // retention that failure is invisible for days: the pool just quietly stops refreshing.
      //
      // Safe to add despite the strict fidelity rules, because those rules are enforced in CODE
      // downstream, not by trusting the model: 100%-ingredient-retention-or-reject, the fractional
      // check, name and ingredient dedup, and the shelf_tag whitelist all run on whatever comes
      // back. A weaker model produces fewer usable recipes, not worse ones that ship.
      openaiApiKey && { url: "https://api.openai.com/v1/chat/completions", key: openaiApiKey, model: "gpt-4o-mini", name: "OpenAI", maxTokens: 16000 },
    ].filter(Boolean) as { url: string; key: string; model: string; name: string; maxTokens: number }[]

    // ?provider=openai — force one provider for this run.
    //
    // The fallback is only ever reached when Gemini fails, which is rare, so in practice it never
    // runs and nothing observes it. That is not a hypothetical: it shipped with TWO independent
    // breaks that survived for weeks — a split-emoji surrogate that made the request body
    // unparseable to a strict JSON parser, and a max_tokens above gpt-4o-mini's ceiling. Both were
    // only found when Gemini happened to fail on the same day, and neither would have been caught
    // by any amount of reading. A provider you cannot exercise is a provider you do not have.
    //
    // Combine with ?dryRun=true to exercise it without touching the day's rows.
    const forceProvider = (url.searchParams.get('provider') ?? '').toLowerCase()
    const selected = forceProvider
      ? providers.filter(p => p.name.toLowerCase() === forceProvider)
      : providers
    if (forceProvider && selected.length === 0) {
      return new Response(JSON.stringify({
        error: `unknown provider "${forceProvider}"`,
        available: providers.map(p => p.name.toLowerCase()),
      }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    let recipes: any[] | null = null
    // Why each provider failed. The 500 below used to say only "Failed to generate recipes from
    // video titles", which is true of a provider outage, a rate limit, an oversized prompt and a
    // JSON parse error alike — four different problems behind one string, in a function whose logs
    // are not reachable from the CLI. The cron reads its response out of net._http_response, so
    // putting the reason IN the response is the difference between diagnosing this in one run and
    // guessing at it.
    const providerErrors: string[] = []
    // Prompt size is the first thing to suspect when every provider fails at once, and it is the
    // one number that is free to compute here.
    console.log(`[funnel] prompt: ${prompt.length} chars across ${uniqueVideos.length} videos`)

    // RETRY THE MODEL, NOT THE PIPELINE.
    //
    // Measured across two dry runs on 2026-09-04: rawCandidates 644 both times, afterDedup 455 and
    // 448, sentToLLM 39 and 40 — every stage before the model is stable — and then the model
    // returned 19 recipes once and 6 the next, storing 5 and 2. The variance is the model's own
    // selectivity, nothing upstream of it.
    //
    // PRELAUNCH proposes running the pipeline 2-3x and keeping the best batch. That works, but it
    // pays ~1,314 YouTube units each time for the half that does NOT vary. Re-asking the model
    // against the SAME candidate list costs zero additional quota, which is the whole reason this
    // sits here rather than around the outside.
    //
    // Appended to `selected` rather than written as a nested loop so the existing "keep the biggest
    // sanitized pool" comparison and the `>= 12` early break govern it unchanged: a healthy first
    // pass still breaks immediately and costs nothing, and only a thin one spends the extra calls.
    const LLM_RETRIES = 2
    const attempts = [...selected, ...Array.from({ length: LLM_RETRIES }, () => selected[0]).filter(Boolean)]
    for (const provider of attempts) {
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
          // max_tokens has been raised twice for the same reason and was still too small: at 8000
          // a run returned finish_reason=length with the JSON cut mid-string at 22,684 chars, and
          // the resulting SyntaxError surfaced as the generic "Failed to generate recipes" 500.
          // That is the third time this cap has masqueraded as "the model produced nothing".
          //
          // It got tighter, not looser, when the description parser stopped truncating at 500
          // chars: the SOURCE INGREDIENT LIST checklists are now complete, so a recipe that used
          // to emit 5 ingredients now correctly emits 15, and 15-20 recipes of that size do not
          // fit in 8000 tokens.
          //
          // Per PROVIDER, because the ceilings differ and a single number silently broke the
          // fallback: gemini-3.1-flash-lite documents a 64K output limit (32000 takes half and
          // leaves headroom), while gpt-4o-mini tops out at 16,384 — so the shared 32000 was an
          // invalid request to OpenAI before its body was even read. The cap is a truncation
          // guard, not a budget: nothing is charged for tokens the model does not emit.
          body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: provider.maxTokens }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId))
        const data = await res.json()
        stageLog(`LLM call done: ${provider.name}, response ${JSON.stringify(data).length} bytes`)
        if (data.error) {
          const msg = String(data.error?.message ?? 'unknown').slice(0, 300)
          stageLog(`LLM error: ${msg}`)
          providerErrors.push(`${provider.name}: api error: ${msg}`)
          continue
        }
        const text = data.choices?.[0]?.message?.content || "[]"
        // finish_reason 'length' means the model hit max_tokens and the JSON is cut mid-array.
        // That parses as a SyntaxError indistinguishable from a malformed response, so name it.
        const finish = data.choices?.[0]?.finish_reason ?? 'unknown'
        const clean = text.replace(/```json|```/g, "").trim()
        let parsed: any
        try {
          parsed = JSON.parse(clean)
        } catch (pe) {
          providerErrors.push(`${provider.name}: unparseable JSON (finish_reason=${finish}, ${clean.length} chars): ${(pe as Error).message.slice(0, 120)}`)
          continue
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
          providerErrors.push(`${provider.name}: returned no recipes (finish_reason=${finish}, ${clean.length} chars)`)
        }
        // A graceful close AT the token limit is invisible to JSON.parse. finish_reason was only
        // consulted when the parse FAILED, so a response the model cut short but closed cleanly was
        // accepted whole — and the recipe carrying the cut is the last one. Three stored rows had a
        // fragment for their final ingredient name ("Roas", "ga", "Turmeric Powd"), each the last
        // entry of its array.
        //
        // Drop the last recipe, not the batch: everything before the cut is complete, and the
        // failure mode here is deliberately "fewer recipes, never incomplete recipes".
        if (finish === 'length' && Array.isArray(parsed) && parsed.length > 0) {
          const cut = parsed.pop()
          console.log(`[funnel] finish_reason=length — dropped trailing recipe "${cut?.name ?? '?'}" as truncated`)
          providerErrors.push(`${provider.name}: output hit max_tokens, dropped trailing recipe "${cut?.name ?? '?'}"`)
        }
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Within-batch name dedup — Groq sometimes ignores the variety prompt
          // and returns two recipes for the same dish (e.g. two oatmeal bowls)
          const normalize = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
          const seenNames = new Set<string>()
          const seenWordSets: Set<string>[] = [] // for same-day Jaccard dedup
          const seenIngredientSigs: Set<string>[] = [] // same-day dedup on the RECIPE, not the name
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
          // Funnel counters — tally exactly why the LLM's raw output shrinks.
          let rejNoName = 0, rejNoMacros = 0, rejDupName = 0, rejNearDup = 0, rejFractional = 0, rejDropped = 0, rejDupIngredients = 0, rejNameGap = 0, rejUntranslated = 0, rejNoSrcList = 0, rejTruncated = 0, rejRoleName = 0, rejMacroIncoherent = 0, rejRecovered = 0
          const droppedDetail: any[] = []
          const sanitized = parsed.filter((r: any) => {
            const name = (r.name ?? '').trim()
            if (!name) { rejNoName++; return false }
            const protein = Number(r.protein) || 0
            const calories = Number(r.calories) || 0
            if (calories <= 0 || protein <= 0) { rejNoMacros++; return false }
            const key = normalize(name)
            if (!key || seenNames.has(key)) { rejDupName++; return false }
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
            // Hard reject near-duplicates of anything already in the table. Previously only an
            // EXACT normalized-name match was rejected and similarity was a soft ranking score —
            // survivable at 7-day retention, but at 30+ days the same dish from four creators
            // would accumulate. Applies to both the stored history and today's own batch.
            const maxJac = Math.max(r._maxJaccardPrev, r._maxJaccardToday)
            if (maxJac >= NEAR_DUP_JACCARD) { rejNearDup++; return false }
            // Second, independent duplicate test: same dish, different label. Checked against both
            // the stored history and today's own batch, exactly like the name test — two creators
            // posting the same recipe on the same day is the common case, not the rare one.
            const candSig = ingredientSignature(r.ingredients)
            if (candSig.size >= 3) {
              let maxIngJac = 0
              for (const prev of prevIngredientSigs) maxIngJac = Math.max(maxIngJac, setJaccard(candSig, prev))
              for (const prev of seenIngredientSigs) maxIngJac = Math.max(maxIngJac, setJaccard(candSig, prev))
              if (maxIngJac >= NEAR_DUP_INGREDIENT_JACCARD) {
                rejDupIngredients++
                console.log(`[funnel] rejected "${name}" — ingredient overlap ${maxIngJac.toFixed(2)} with an existing meal (different name, same recipe)`)
                return false
              }
              seenIngredientSigs.push(candSig)
            }
            // Enforced in CODE, not just the prompt. "Do not scale" was already an explicit
            // instruction and was ignored anyway — same lesson as the format cap. A recipe that
            // asks for half an egg cannot be cooked, so it's rejected outright rather than ranked.
            // 100% RETENTION OR REJECT. Every candidate now has a readable list, so the creator's
            // line count is a hard specification rather than a target. Anything short means an
            // ingredient was dropped, and a dropped ingredient is not a cosmetic loss: a masala
            // without its ghee and cumin is a different dish, two missing cups of mozzarella is
            // ~450 uncounted calories, and a dropped dairy item is how a recipe gets falsely
            // tagged dairy-free.
            //
            // The failure mode is deliberately "fewer recipes", never "incomplete recipes". If too
            // few survive, MIN_TRENDING_MEALS aborts the run and yesterday's feed stays up — stale
            // beats wrong.
            const srcVideo = uniqueVideos[(r.video_index || 1) - 1]
            const srcList = srcVideo ? sourceIngredients(srcVideo.description || '') : []
            // Junk stripped and duplicates collapsed BEFORE counting. Both inflated `got` and so
            // bought a free pass at this threshold: five stored meals counted section headings
            // ("Składniki") or macro lines ("Kalorien: 504 kcal") as ingredients, and seven listed
            // the same item twice. A model that echoes the raw description block should not clear
            // a retention check by echoing more of it.
            // Recover entries the model consolidated BEFORE counting. The creator listing one
            // food at two or three different amounts is the largest single cause of retention
            // rejections, and three prompt-shaped attempts have failed to stop it (see
            // docs/TRENDING-OPEN.md). This invents nothing — every recovered entry carries the
            // creator's own line and quantity, and it only fires when the food is ALREADY in the
            // model's output, so a genuinely omitted ingredient still fails the check below.
            const rec = recoverMergedIngredients(r.ingredients, srcList)
            if (rec.recovered.length) {
              r.ingredients = rec.ingredients
              rejRecovered += rec.recovered.length
              console.log(`[funnel] recovered ${rec.recovered.length} merged ingredient(s) on "${name}": ${rec.recovered.join(' | ')}`)
            }
            const counted = countedIngredients(r.ingredients)
            const got = counted.length
            // Split from `dropped`, which conflated two unrelated failures. Every candidate cleared
            // the ingredient-list gate, so a missing source list here does NOT mean the description
            // had none — it means video_index pointed at the wrong video (or off the end), which is
            // a model indexing error, not an incomplete recipe. Counting them together made an
            // indexing bug look like an ingredient-retention problem.
            if (srcList.length < 3) { rejNoSrcList++; return false }
            console.log(`[funnel] ingredient retention "${name}": ${got}/${srcList.length}`)
            if (got < srcList.length) {
              rejDropped++
              console.log(`[funnel] rejected "${name}" — kept ${got} of ${srcList.length} ingredients`)
              // `dropped` is the largest single sanitize loss (~29% of raw output) and it got
              // larger when the parser stopped truncating descriptions at 500 chars. That is
              // expected — complete source lists make the contract stricter — but it is only
              // CORRECT if srcList is really the creator's list. A parser that over-extracts
              // (absorbing a promo block, a macro line, a second recipe) invents a specification
              // the model cannot meet and rejects good food. Capturing both sides is the only way
              // to tell those apart, and it has to be hand-checked, not counted.
              if (droppedDetail.length < 12) droppedDetail.push({ name, got: counted.map((i: any) => i?.name ?? i), src: srcList })
              return false
            }
            // The count above is blind to IDENTITY: three ingredients satisfy "three or more"
            // whether or not they are the right three, and srcList is only as complete as the
            // parser managed to be — so when parsing under-extracts, the specification quietly
            // shrinks to whatever the model produced and both sides of the comparison agree on a
            // wrong answer. "Blueberry-Lemon High-Protein Pancakes" passed with eggs, yogurt and
            // maple syrup: no blueberries, no lemon, not even flour.
            //
            // A dish named after a food that appears nowhere in its ingredients is the direct
            // evidence of that. Measured over a 168-meal pool this rejects 4% with no false
            // positives; every one of the seven was hand-checked as a genuine drop.
            // Independent of finish_reason, because a provider that misreports it would put us
            // straight back where we started. This reads the answer itself: a name that appears in
            // the creator's list ONLY as a mid-word prefix was cut off mid-generation.
            // A section heading stored as an ingredient. Invisible to the retention gate, which
            // compares counts — one heading substituted for one food still counts as one.
            const roleName = sectionHeadingIngredient(counted)
            if (roleName) {
              rejRoleName++
              console.log(`[funnel] rejected "${name}" — "${roleName}" names a section, not a food`)
              return false
            }
            const cutName = truncatedAgainstSource(counted.map((i: any) => String(i?.name ?? '')), srcList)
            if (cutName) {
              rejTruncated++
              console.log(`[funnel] rejected "${name}" — ingredient name "${cutName}" is a truncated copy of a source item`)
              return false
            }
            const gaps = nameIngredientGaps(name, counted)
            if (gaps.length > 0) {
              rejNameGap++
              console.log(`[funnel] rejected "${name}" — named for ${gaps.join(', ')}, absent from ingredients`)
              return false
            }
            // Untranslated output. TWO signals must agree: YouTube's own defaultAudioLanguage says
            // the source is not English, AND the extracted list shows no sign of English writing.
            // Neither is safe alone — the text check drops a real all-brand English recipe
            // ("Quest Salted Caramel Milkshake, Xanthan Gum, Monk Fruit Sweetener"), and a
            // non-English source that WAS translated properly is exactly what we want to keep. It
            // is the pairing that makes this precise. Absent language metadata counts as English,
            // so this can only ever fire on a video that declared itself foreign.
            if (isNonEnglishSource(srcVideo?.sourceLang) && looksUntranslated(counted)) {
              rejUntranslated++
              console.log(`[funnel] rejected "${name}" — source is ${srcVideo?.sourceLang} and the ingredients were not translated`)
              return false
            }
            // Store the cleaned list. Duplicates are kept here (a recipe may genuinely use eggs
            // twice); only headings, macro lines and instruction text are removed.
            //
            // massBearingIngredients runs HERE, after the retention comparison, and only here: the
            // creator-side list carries no grams, so filtering on mass before the comparison would
            // shrink one side and reject the recipe. It catches the junk no name rule can — a live
            // row stored the creator's channel tags ("Superhero", "Villain", "Anime", "Band Geeks")
            // as eight 0g ingredients, and those are ordinary words no pattern can separate from food.
            r.ingredients = massBearingIngredients(realIngredients(r.ingredients))
            r._sourceVerified = true
            const frac = hasFractionalIndivisible(r.ingredients)
            if (frac) { rejFractional++; console.log(`[funnel] rejected "${name}" — fractional indivisible item: ${frac}`); return false }
            // WHERE THE MACROS CAME FROM. The prompt already asks the model to calculate from the
            // creator's ingredients when the description states nothing, and it does not reliably
            // comply — "Jello" returned 20g protein where 120g of gelatin gives ~26g, and invented
            // a serving count the creator never gave. Multiplying grams by 4 is not a job for a
            // language model, so when the creator published nothing we do the arithmetic here.
            //
            // Deliberately NOT a rejection. Requiring published macros would intersect two already
            // narrow filters — only ~28% of candidates have a parseable ingredient list at all —
            // and the pipeline's yield problem is measured (24 raw vs 5 on identical runs). Same
            // videos, better numbers.
            if (r.macros_from_creator === true) {
              r._macrosSource = 'creator'
            } else {
              const computed = computePerServingMacros(r.ingredients, toInt(r.servings) ?? 1)
              const stated = Number(r.calories) || 0
              // Replace ONLY when the two answers AGREE. A replay of all 178 live rows showed the
              // arithmetic is well calibrated at the median (ratio 0.98) but that the coverage
              // guards alone pass 98% of rows, of which ~half disagree with the stored number by
              // over 25% and some by 2x. A disagreement does not tell us ours is the right one —
              // it is equally often a wrong serving count — so replacing on the guards alone would
              // have overwritten plausible macros with inflated ones across a quarter of the pool.
              const agrees = computed && stated > 0 &&
                Math.abs(computed.calories - stated) / stated <= COMPUTED_AGREEMENT_BAND
              if (computed && agrees) {
                r.calories = computed.calories; r.protein = computed.protein
                r.carbs = computed.carbs; r.fat = computed.fat
                r._macrosSource = 'computed'
              } else if (computed) {
                // Both numbers exist and they disagree. Keep the model's, say so, and LOG it —
                // this is the highest-signal line in the run for finding wrong serving counts.
                r._macrosSource = 'model'
                console.log(`[funnel] macro disagreement "${name}" — model ${stated}kcal vs computed ${computed.calories}kcal (servings ${toInt(r.servings) ?? 1}); keeping the model's`)
              } else {
                // Estimate not trustworthy (unweighable ingredient, or the table recognised too
                // little of the dish). Keep the model's numbers but say so — inventing a fallback
                // here would be the exact defect this block exists to remove.
                r._macrosSource = 'model'
              }
            }
            // Do the four numbers agree with each other? Nothing checked this before, which is how
            // "Pepperoni Pizza Pasta" reached the pool at 540 kcal with 0 carbs and 0 fat. Cheap,
            // needs no reference data, and cannot abstain the way verifyMacros does. Runs AFTER the
            // recompute above so it judges the numbers that will actually be stored.
            const incoherent = macroIncoherence(r)
            if (incoherent) { rejMacroIncoherent++; console.log(`[funnel] rejected "${name}" — ${incoherent}`); return false }
            seenNames.add(key)
            seenWordSets.push(candWords)
            return true
          }).slice(0, 30)
          console.log(`[funnel] ${provider.name} LLM: ${parsed.length} raw → ${sanitized.length} sanitized (rejected: noName ${rejNoName}, noMacros ${rejNoMacros}, dupName ${rejDupName}, nearDup ${rejNearDup}, fractional ${rejFractional}, dupIngredients ${rejDupIngredients}, dropped ${rejDropped}, nameGap ${rejNameGap}, untranslated ${rejUntranslated}, noSrcList ${rejNoSrcList}, truncated ${rejTruncated}, roleName ${rejRoleName}, macroIncoherent ${rejMacroIncoherent}, ingredientsRecovered ${rejRecovered})`)
          funnel[`llm_${provider.name}`] = {
            raw: parsed.length, sanitized: sanitized.length,
            rejected: { noName: rejNoName, noMacros: rejNoMacros, macroIncoherent: rejMacroIncoherent, ingredientsRecovered: rejRecovered, dupName: rejDupName, nearDup: rejNearDup,
              fractional: rejFractional, dupIngredients: rejDupIngredients, dropped: rejDropped,
              nameGap: rejNameGap, untranslated: rejUntranslated, noSrcList: rejNoSrcList, truncated: rejTruncated, roleName: rejRoleName },
            droppedDetail,
          }
          if (!recipes || sanitized.length > recipes.length) { recipes = sanitized; funnel.providerUsed = provider.name }
          funnel.llmAttempts = ((funnel.llmAttempts as number | undefined) ?? 0) + 1
          funnel.llmYields = [...((funnel.llmYields as number[]) ?? []), sanitized.length]
          if (recipes.length >= 12) break // pool large enough for MMR to pick 6 with strong variety
        }
      } catch (e) {
        stageLog(`LLM call threw: ${(e as Error).message}`)
        providerErrors.push(`${provider.name}: threw: ${String((e as Error).message).slice(0, 200)}`)
        continue
      }
    }

    stageLog(`LLM yielded ${recipes?.length ?? 0} recipes`)

    if (!recipes || recipes.length === 0) {
      return new Response(JSON.stringify({
        error: "Failed to generate recipes from video titles",
        providerErrors,
        promptChars: prompt.length,
        candidateVideos: uniqueVideos.length,
        // 0 here with providerErrors empty means the model returned recipes and the sanitize
        // gates rejected every one — a completely different problem from a provider failure.
        sanitizedCount: recipes?.length ?? null,
      }), { status: 500, headers: { 'Content-Type': 'application/json' } })
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
      // 3 recipes at a time × 5 ingredients each = ≤15 concurrent FatSecret calls.
      await mapLimit(recipes, 3, async (r: any) => {
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
      })
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
    // How well-liked the SOURCE video was, normalised to 0-1. Measured range across a real batch
    // was 1.17%-6.39%, so 1% floors and 6% saturates — anything at or above 6% is simply "loved".
    // This is the only term in baseScore about whether the food is any GOOD; density, uniqueness
    // and macro agreement all measure whether it fits, not whether anyone enjoyed it.
    function likeQualityScore(r: any): number {
      const video = uniqueVideos[(r.video_index || 1) - 1] ?? uniqueVideos[0]
      if (!video) return 0.5 // unknown source — stay neutral rather than punish
      const rate = likeRate(video)
      if (rate <= 0) return 0.5 // likes hidden or brand-new video; absence of data isn't evidence
      const normalised = Math.min(1, Math.max(0, (rate - 1) / 5))
      // Small penalty, not a veto — see GIMMICK_TITLE_RE for why this stays weak.
      const gimmick = GIMMICK_TITLE_RE.test(video.title) || GIMMICK_TITLE_RE.test(r.name ?? '')
      return Math.max(0, normalised - (gimmick ? 0.15 : 0))
    }

    function baseScore(r: any): number {
      const dens = densityScore(r._densityRatio || 0, r.category)
      const maxJac = Math.max(r._maxJaccardPrev || 0, r._maxJaccardToday || 0)
      const uniq = nameUniquenessScore(maxJac)
      const macro = macroAgreementScore(r._llmProtein || 0, r._fsProtein || 0)
      const liked = likeQualityScore(r)
      // Verified against the creator's own published list. Worth a real slice of the score: an
      // unverified recipe may be missing half its ingredients, which damages taste, macros and the
      // allergen tags all at once. Not a filter though — see the migration for why.
      const verified = r._sourceVerified ? 1 : 0
      // Density still leads (it's the core value prop), but 20% now goes to whether the source
      // video was actually liked. Taken proportionally from density and macro agreement rather
      // than uniqueness, which is what stops the feed repeating itself.
      return dens * 0.30 + uniq * 0.25 + macro * 0.10 + liked * 0.20 + verified * 0.15
    }

    // Store the full quality-ranked pool (not just 6). Discover now builds a
    // per-user feed from this shared pool — filtering by the user's diet_type +
    // allergen tags and applying variety per user — so the old MMR-to-6 narrowing
    // moved client-side. We keep baseScore for ranking and cap at STORE_CAP to
    // bound the daily image-generation cost.
    const STORE_CAP = 18

    // Base-dish format cap. The LLM prompt already says "don't return two pancake recipes" and it
    // gets ignored — one day's pool came back with FIVE pancake variants out of fifteen, two of
    // them in the featured and first trending slots. A prompt rule the model can silently skip is
    // not a constraint, so this is enforced deterministically after ranking.
    //
    // Deliberately NOT matching "bowl" or "plate": a Burger Bowl and a Poke Bowl are genuinely
    // different dishes, whereas two pancake recipes read as the same thing twice.
    const DISH_FORMATS: [string, RegExp][] = [
      ['pancake',   /\bpancakes?\b/i],
      ['waffle',    /\bwaffles?\b/i],
      ['smoothie',  /\bsmoothies?\b|\bshake\b/i],
      ['oats',      /\boats?\b|\boatmeal\b|\bporridge\b/i],
      ['chia',      /\bchia\b/i],
      ['flatbread', /\bflatbreads?\b|\bpizza\b|\bnaan\b/i],
      ['wrap',      /\bwraps?\b|\bburritos?\b|\bquesadillas?\b/i],
      ['taco',      /\btacos?\b/i],
      ['salad',     /\bsalads?\b/i],
      ['soup',      /\bsoups?\b|\bstew\b|\bchili\b/i],
      ['bites',     /\bbites?\b|\bballs?\b|\bclusters?\b|\btruffles?\b/i],
      ['brownie',   /\bbrownies?\b|\bblondies?\b/i],
      ['mugcake',   /\bmug cake\b|\bcheesecakes?\b|\bcakes?\b/i],
      ['cookie',    /\bcookies?\b/i],
      ['parfait',   /\bparfaits?\b|\byogurt bowl\b/i],
      ['icecream',  /\bice cream\b|\bnice cream\b|\bfroyo\b/i],
      ['toast',     /\btoasts?\b|\bbagels?\b|\bsandwich\b/i],
      ['pasta',     /\bpastas?\b|\bnoodles?\b|\bgnocchi\b|\bmac and cheese\b/i],
    ]
    const dishFormat = (name: string): string | null =>
      DISH_FORMATS.find(([, re]) => re.test(name))?.[0] ?? null

    const FORMAT_CAP = 2
    const ranked = [...recipes].sort((a, b) => baseScore(b) - baseScore(a))
    const formatCounts = new Map<string, number>()
    const kept: any[] = []
    const overflow: any[] = []
    for (const r of ranked) {
      const fmt = dishFormat(r.name || '')
      if (!fmt) { kept.push(r); continue }
      const seen = formatCounts.get(fmt) ?? 0
      if (seen < FORMAT_CAP) { formatCounts.set(fmt, seen + 1); kept.push(r) }
      else overflow.push(r)
    }
    // Overflow is appended rather than dropped: it only gets stored if the capped set can't fill
    // STORE_CAP on its own, which beats shipping a short feed to enforce variety.
    const overCapped = [...formatCounts.entries()].filter(([, n]) => n >= FORMAT_CAP).map(([f]) => f)
    if (overflow.length > 0) {
      console.log(`[funnel] format cap: ${overflow.length} deprioritized (${overCapped.join(', ')} hit the cap of ${FORMAT_CAP})`)
    }
    funnel.formatCapDeprioritised = overflow.length
    recipes = [...kept, ...overflow].slice(0, STORE_CAP)
    funnel.storeCap = STORE_CAP
    funnel.stored = recipes.length

    // A recipe that survives with 3 or fewer ingredients usually means the extractor collapsed the
    // creator's list to its "main" items and dropped the toppings/sauce — which is what makes a
    // dish render bare and wrong downstream. Log it so a systematic regression is visible.
    // Which recipes arrived with non-integer macros, and in which field. toInt() now rounds these
    // at insert so they can't abort the batch, but the SOURCE matters: creators rarely publish
    // decimals, so a decimal usually means the LLM calculated the macro from ingredients instead of
    // reading the creator's stated numbers — which is a fidelity regression worth catching early.
    const decimalMacros = recipes.flatMap((r: any) =>
      ['calories', 'protein', 'carbs', 'fat', 'prepTime']
        .filter(f => { const n = parseFloat(String(r[f])); return Number.isFinite(n) && !Number.isInteger(n) })
        .map(f => `${r.name}.${f}=${r[f]}`)
    )
    if (decimalMacros.length > 0) {
      console.log(`[funnel] non-integer macros rounded at insert (${decimalMacros.length}): ${decimalMacros.join(', ')}`)
    }

    const bare = recipes.filter((r: any) => (r.ingredients?.length ?? 0) <= 3)
    if (bare.length > 0) {
      console.log(`[funnel] WARN: ${bare.length} recipe(s) stored with <=3 ingredients — possible ingredient drop: ${bare.map((r: any) => `${r.name}(${r.ingredients?.length ?? 0})`).join(', ')}`)
    }
    stageLog(`pool ranked + capped: storing ${recipes.length} (cap ${STORE_CAP})`)
    // WHERE THE NUMBERS CAME FROM — the point of macros_source is to be auditable, so it has to be
    // visible in a run rather than only in the table. Read this on every run:
    //   creator-heavy or 100% creator  -> the model is lying about macros_from_creator, which is
    //                                     the ONE failure mode with no downstream catch
    //   model-heavy                    -> computePerServingMacros is abstaining a lot, so the
    //                                     lookup table is not recognising these dishes (coverage
    //                                     < 0.7) or quantities are unreadable — a parser problem,
    //                                     not a macro problem
    const macroSplit = recipes.reduce((acc: Record<string, number>, r: any) => {
      const k = r._macrosSource ?? 'model'; acc[k] = (acc[k] ?? 0) + 1; return acc
    }, {})
    funnel.macrosSource = macroSplit
    stageLog(`macros_source: creator ${macroSplit.creator ?? 0}, computed ${macroSplit.computed ?? 0}, model ${macroSplit.model ?? 0}`)
    // Name the rows we recomputed, so a spot-check against the video is one click rather than a
    // query. The creator's own numbers need no audit; ours do.
    const recomputed = recipes.filter((r: any) => r._macrosSource === 'computed')
    if (recomputed.length) {
      stageLog(`recomputed from ingredients: ${recomputed.map((r: any) => `${r.name} (${r.calories}kcal/${r.protein}p)`).join(' | ')}`)
    }

    // HARD MINIMUM GATE: only triggers if the candidate pool itself was under 6
    // (LLM yielded too few names). With MMR replacing the kill-filters, this
    // should be vanishingly rare — keeps the safety net in place for that case.
    // 6 -> 1. This floor was written when Discover WAS today's batch — 7-11 meals on screen — so
    // a thin run meant a thin feed and its comment reads "keeping previous run's trending meals
    // intact". That premise is gone. RETENTION_DAYS is 30, the pool is ~140, and Discover now
    // renders shelves plus a browse grid over the whole thing. Today's batch is an INCREMENT, not
    // the feed.
    //
    // Two facts make discarding survivors pure loss: this check runs BEFORE the retention delete
    // and before the swap-then-cleanup, so aborting protects nothing that was at risk; and anything
    // reaching this line already cleared 100%-ingredient-retention, both dedup gates and the
    // fractional check. Rejecting 3 verified recipes to avoid a thin feed that can no longer occur
    // trades real content for nothing.
    //
    // Cost of storing them is trivial — each meal triggers one image generation, measured at about
    // $0.0115, so a 3-recipe day is ~4 cents.
    //
    // "Is today healthy?" stays a separate question, answered where it belongs: the
    // trending-health-check job alerts below TRENDING_MIN_EXPECTED (default 12). Lowering this
    // floor makes thin days visible as a yield WARNING instead of invisible as a silent skip —
    // which is what let 7 of 19 days pass unnoticed.
    const MIN_TRENDING_MEALS = 1
    if (recipes.length < MIN_TRENDING_MEALS) {
      console.log(`[abort] candidate pool was ${recipes.length}, below min of ${MIN_TRENDING_MEALS} — keeping previous run's trending meals intact`)
      return new Response(JSON.stringify({
        skipped: true,
        reason: 'min_threshold_not_met',
        survivors: recipes.length,
        min: MIN_TRENDING_MEALS,
        funnel,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    if (dryRun) {
      // Persist BEFORE returning. pg_net gives up on this request long before it finishes, so the
      // response body reaches nobody when the caller is the cron — the table is the only place a
      // run's result survives. Wrapped so a logging failure can never fail the run itself.
      try {
        const { error: logErr } = await db.from('pipeline_runs').insert({
          dry_run: true, provider: (funnel.providerUsed as string | undefined) ?? null, stored: recipes.length, funnel,
        })
        if (logErr) console.log(`[funnel] pipeline_runs insert REFUSED: ${logErr.message}`)
      } catch (e) { console.log(`[funnel] pipeline_runs insert threw (ignored): ${(e as Error).message}`) }
      return new Response(JSON.stringify({ dryRun: true, wouldStore: recipes.length, funnel }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Step 4: Match recipes back to YouTube thumbnails + persist video_id so future
    // cron runs can dedup against this video for the next 90 days.
    const meals = recipes.map((r: any) => {
      const videoIdx = (r.video_index || 1) - 1
      const video = uniqueVideos[videoIdx] || uniqueVideos[0]
      // Normalize category — LLM should output 'meal' / 'snack' / 'dessert', but guard against typos/missing
      const rawCat = (r.category || '').toLowerCase().trim()
      const category = rawCat === 'snack' ? 'snack' : rawCat === 'dessert' ? 'dessert' : 'meal'
      const tags = classifyDietTags(r.ingredients, r.name, r.steps)
      // Two independent judges, ANDed. The keyword list can't enumerate every compound food, and
      // the model can misread a description — but for a meal to be tagged "free" BOTH have to say
      // free. Either one shouting "contains" wins. Fails safe in the only direction that matters:
      // an over-cautious tag costs a meal one filter, a missed one hands an allergen to someone
      // who explicitly asked to avoid it.
      const llmSaysFree = {
        dairy: r.contains_dairy !== true,
        gluten: r.contains_gluten !== true,
        nuts: r.contains_nuts !== true,
      }
      const safeTags = {
        ...tags,
        is_dairy_free: tags.is_dairy_free && llmSaysFree.dairy,
        is_gluten_free: tags.is_gluten_free && llmSaysFree.gluten,
        is_nut_free: tags.is_nut_free && llmSaysFree.nuts,
      }
      if (tags.is_dairy_free !== safeTags.is_dairy_free || tags.is_gluten_free !== safeTags.is_gluten_free || tags.is_nut_free !== safeTags.is_nut_free) {
        console.log(`[funnel] allergen disagreement on "${r.name}" — keyword scan said free, model said contains; taking the cautious side`)
      }
      return {
        name: r.name,
        category,
        // Round before insert — these columns are int4 and the LLM reports macros exactly as the
        // creator wrote them, which is often a decimal ("44.5g protein"). One such value aborts the
        // WHOLE batch with `invalid input syntax for type integer`, losing every meal that day, so
        // this can't be left to chance. Gram-level precision is beyond what the app displays anyway.
        calories: toInt(r.calories),
        protein: toInt(r.protein),
        carbs: toInt(r.carbs),
        fat: toInt(r.fat),
        prep_time: toInt(r.prepTime),
        // Unknown or invented values fall back to null rather than being coerced into a shelf the
        // model didn't mean — a wrong shelf is worse than no shelf, since the meal still reaches
        // the user via the catch-all.
        shelf_tag: (() => {
          const raw = String(r.shelf_tag ?? '')
          if (SHELF_TAGS.includes(raw)) return raw
          // Was silently null before, which hid the real failure: the prompt showed shelf_tag ONLY
          // as one example value with no enumeration, so the model guessed and 27% of an August
          // batch guessed something off-list. A discarded tag now says so.
          console.log(`[funnel] shelf_tag discarded for "${r.name}" — model returned ${raw ? `"${raw}"` : 'nothing'}, not in SHELF_TAGS`)
          return null
        })(),
        source_verified: r._sourceVerified === true,
        // 'creator' = stated in the description | 'computed' = our arithmetic on their ingredients
        // | 'model' = neither could be trusted. The UI needs this to stop showing a guess as a source.
        macros_source: r._macrosSource ?? 'model',
        // Ingredients are stored at the creator's full-batch scale, so servings is what makes the
        // per-serving macros interpretable. Defaults to 1 rather than null: an unknown serving
        // count is far more likely to be a single portion than a missing batch.
        servings: Math.max(1, toInt(r.servings) ?? 1),
        image: video?.thumbnail || null,
        video_id: video?.videoId || null,
        trend_source: 'YouTube trending',
        ingredients: r.ingredients,
        steps: r.steps,
        generated_at: today(),
        compatible_diets: safeTags.compatible_diets,
        is_dairy_free: safeTags.is_dairy_free,
        is_gluten_free: safeTags.is_gluten_free,
        is_nut_free: safeTags.is_nut_free,
      }
    })

    // Retention MUST match Discover's display lifecycle, which shows YouTube meals for 7 days
    // (isYouTubeRecipeVisible in app/(tabs)/discover.tsx). This was 3 days, so the feed was willing
    // to show a week and the pipeline destroyed four days of it — the browsable pool sat at ~45
    // meals when ~110 had already been generated and paid for. Deleting them buys nothing: the rows
    // are tiny, and their images are in the global cache whether the row exists or not.
    // If Discover's window ever changes, change this with it.
    const retentionCutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString().split('T')[0]
    await db.from('trending_meals').delete().lt('generated_at', retentionCutoff).eq('trend_source', 'YouTube trending')
    // Swap-then-cleanup instead of delete-then-insert: capture the prior run's today-rows,
    // insert the new ones FIRST, then delete the old ones by id. Avoids the empty-feed
    // window a reader would hit between a plain delete and the multi-second insert. Scoped
    // to YouTube source so creator recipes posted today aren't touched.
    const { data: priorRows } = await db.from('trending_meals')
      .select('id').eq('generated_at', today()).eq('trend_source', 'YouTube trending')
    const priorIds = (priorRows ?? []).map((r: any) => r.id)
    const { error } = await db.from('trending_meals').insert(meals)
    stageLog(`[funnel] db insert: ${error ? '0 (FAILED)' : meals.length} rows — error: ${error?.message ?? 'none'}`)
    // Only remove the stale rows once the new ones are safely in (keeps them as fallback on failure).
    if (!error && priorIds.length) {
      await db.from('trending_meals').delete().in('id', priorIds)
    }

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
      // Generate in small waves instead of firing all ~18 at FAL at once. The
      // simultaneous burst saturated FAL's rate limit, so even generate-meal-image's
      // internal 3-retry couldn't recover and meals were left on their YouTube
      // thumbnail. Bounding concurrency keeps FAL un-saturated so retries succeed.
      const IMG_CONCURRENCY = 5
      const genImage = async (meal: any) => {
        try {
          // Pass the VISUAL hint with the name ("1 slice American cheese", not "American cheese").
          // Without it the renderer has no idea of scale and draws a whole slab of cheese.
          // A bare gram weight is skipped — it tells the model nothing about how the item looks.
          const ingredientNames = (meal.ingredients || []).map((i: any) => {
            const hint = String(i.visual ?? '').trim()
            return hint && !/^\d+(\.\d+)?\s*(g|ml|oz)$/i.test(hint) ? `${hint} ${i.name}` : i.name
          })
          const imgRes = await fetch(`${supabaseUrl}/functions/v1/generate-meal-image`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Authenticate as the trusted internal caller. generate-meal-image requires auth
              // on a cache miss, and every freshly-generated trending meal IS a miss — without
              // this header the call 401s and the meal stays on its YouTube thumbnail. Use the
              // same CRON_SECRET-preferred token the cron itself authenticates with.
              'Authorization': `Bearer ${CRON_SECRET || supabaseServiceKey}`,
            },
            // steps are LOAD-BEARING for the image, not decoration. generate-meal-image has a rule
            // that an ingredient mixed/whisked/blended into something else must NOT be drawn as a
            // separate dollop — but it can only apply that if it can read the steps. Omitting them
            // is why a Burger Bowl's greek-yogurt-based burger sauce rendered as a white blob of
            // sour cream sitting on top instead of a sauce mixed through the dish.
            body: JSON.stringify({ mealName: meal.name, ingredients: ingredientNames, steps: meal.steps ?? [] }),
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
      }
      for (let i = 0; i < inserted.length; i += IMG_CONCURRENCY) {
        await Promise.all(inserted.slice(i, i + IMG_CONCURRENCY).map(genImage))
      }
    }
    console.log(`Stage: image generation done in ${Date.now() - imgStart}ms`)

    // Re-fetch from DB so the response includes AI-generated image URLs (not YouTube thumbnails)
    const { data: finalMeals } = await db.from('trending_meals').select('*').eq('generated_at', today()).order('id')
    console.log(`Success: ${meals.length} trending meals from YouTube + Groq`)
    try {
      const { error: logErr } = await db.from('pipeline_runs').insert({
        dry_run: false, provider: (funnel.providerUsed as string | undefined) ?? null, stored: meals.length, funnel,
      })
      if (logErr) console.log(`[funnel] pipeline_runs insert REFUSED: ${logErr.message}`)
    } catch (e) { console.log(`[funnel] pipeline_runs insert threw (ignored): ${(e as Error).message}`) }
    return new Response(JSON.stringify({ generated: true, count: meals.length, funnel, meals: finalMeals ?? meals }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
