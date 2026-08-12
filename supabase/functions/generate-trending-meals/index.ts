import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { mapLimit } from '../_shared/concurrency.ts'
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

// Fixed shelf vocabulary. Mixed cuisine + format on purpose: cuisine alone covers only 43% of the
// catalog because half of it is fitness-food constructs with no cuisine, and format alone loses the
// evocative pull of "Indian night" over "Chicken".
const SHELF_TAGS = ['mexican', 'indian', 'asian', 'italian', 'mediterranean', 'american-comfort', 'sweet-treat', 'high-protein-snack', 'breakfast']

// Pull the creator's OWN ingredient list out of the description, mechanically.
//
// Measured against 10 source descriptions, the model kept only 50% of listed ingredients and 7 of
// 10 recipes lost 3 or more. It wasn't just seasonings: a Soya Potato Masala arrived without ghee,
// onion, green chilli or cumin (14 -> 4), and a pesto gnocchi lost two bags of spinach and two cups
// of mozzarella. That destroys the taste of the dish, understates calories, and silently breaks the
// allergen tags derived from the ingredient array.
//
// The fix is to stop leaving inclusion to the model's discretion. Where the description contains a
// real list, it is parsed here and handed over as a checklist to COPY rather than a text to
// summarise. Summarising is where things get dropped.
const BULLET_LINE = /^\s*(?:[•\-\*●▪]|\d+[.)])\s*(.+)$/gm
function parseIngredientBlock(desc: string): string[] {
  const m = desc.match(/ingredients?\s*:?\s*\n([\s\S]*?)(?:\n\s*\n|directions|instructions|method|steps|macros|nutrition)/i)
  if (!m) return []
  const out: string[] = []
  let hit: RegExpExecArray | null
  const re = new RegExp(BULLET_LINE)
  while ((hit = re.exec(m[1])) !== null) {
    const line = hit[1].trim().replace(/[:\s]+$/, '')
    // Skip headings and prose that slip into the block.
    if (line.length > 2 && line.length < 90) out.push(line)
  }
  return out
}

// Items that cannot be fractional. A fraction here is proof the recipe was scaled down from a
// batch, which is what produced a stored cheesecake calling for "0.5 large eggs" and "0.25 scoop".
// Deliberately excludes onion, clove and scoop — a quarter onion, half a clove and half a scoop are
// all things people genuinely measure, and flagging them cost 10+ false positives in the audit.
const INDIVISIBLE_ITEM = "(egg|slice|can|bar|tortilla|bun|packet|container|bottle|patty|link|cookie|muffin|fillet|breast|thigh)"
// Leading fraction: 0.5 / .5 / 1/2 / ½, then up to two adjective words, then the item.
// (?<![\\d/.]) stops "1/2 cup" being read as the "2" in "2 cup" — that exact bug produced 26
// false positives when auditing stored rows, so it is load-bearing, not defensive noise.
const FRACTIONAL_INDIVISIBLE = new RegExp(
  String.raw`(?<![\d/.])(?:0?\.\d+|\d+\.\d+|\d+\s*/\s*\d+|[¼½¾⅓⅔⅛])\s*(?:[a-z-]+\s+){0,2}` + INDIVISIBLE_ITEM + String.raw`s?`,
  'i',
)
function hasFractionalIndivisible(ingredients: any[]): string | null {
  for (const ing of ingredients ?? []) {
    const text = typeof ing === 'string' ? ing : `${ing?.visual ?? ''} ${ing?.grams ?? ''} ${ing?.name ?? ''}`
    if (FRACTIONAL_INDIVISIBLE.test(text)) return text.trim()
  }
  return null
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
const TAG_MEAT = ['chicken', 'beef', 'steak', 'pork', 'turkey', 'bacon', 'sausage', 'lamb', 'veal', 'prosciutto', 'pepperoni', 'salami', 'chorizo', 'carnitas', 'ribeye', 'sirloin', 'brisket', 'pastrami', 'jerky', 'duck', 'venison', 'bison', 'meatball', 'ground meat']
const TAG_SEAFOOD = ['salmon', 'tuna', 'shrimp', 'prawn', 'crab', 'lobster', 'cod', 'tilapia', 'fish', 'anchovy', 'sardine', 'scallop', 'mussel', 'clam', 'oyster', 'squid']
// 'butter' handled separately so nut butters don't read as dairy.
// COMPOUND FOODS are the second failure mode, and the one that scanning more text cannot fix.
// The first mode was the extractor dropping an ingredient (parmesan missing from a dish literally
// named "Parmesan-Crusted Chicken") — solved by widening the haystack. This one is different: the
// ingredient IS present, but its NAME contains no allergen keyword. "Pesto" is not in a dairy list,
// so a pesto dish read as dairy-free and nut-free; "gnocchi" and "teriyaki" read as gluten-free.
// Four live rows were mis-tagged this way, one of them wrong on all three axes.
//
// The list below can never be complete — regional dishes, brand products and "house sauce" are
// unbounded — which is exactly why the LLM's own allergen judgement is ANDed with it downstream.
const COMPOUND_DAIRY = ['pesto', 'ranch', 'caesar', 'alfredo', 'tzatziki', 'naan', 'brioche', 'croissant', 'carbonara', 'stroganoff', 'au gratin', 'bechamel', 'tiramisu', 'ice cream', 'custard', 'butterscotch', 'milk chocolate']
const COMPOUND_GLUTEN = ['gnocchi', 'teriyaki', 'hoisin', 'orzo', 'farro', 'bulgur', 'semolina', 'graham', 'pretzel', 'brioche', 'croissant', 'naan', 'roux', 'tempura', 'panzanella', 'miso', 'malt']
const COMPOUND_NUTS = ['pesto', 'satay', 'marzipan', 'praline', 'nutella', 'baklava', 'romesco', 'gianduja']

const TAG_DAIRY = ['milk', 'cheese', 'cream', 'yogurt', 'whey', 'ghee', 'mozzarella', 'cheddar', 'parmesan', 'ricotta', 'brie', 'feta', 'paneer', 'queso', 'casein', ...COMPOUND_DAIRY]
const TAG_GLUTEN = ['bread', 'pasta', 'flour', 'wheat', 'barley', 'rye', 'soy sauce', 'breadcrumb', 'panko', 'crouton', 'tortilla', 'noodle', 'ramen', 'udon', 'couscous', 'cracker', 'bun', 'pita', 'bagel', 'wrap', 'seitan', ...COMPOUND_GLUTEN]
const TAG_NUTS = ['peanut', 'almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'pine nut', 'nut butter', ...COMPOUND_NUTS]
// SAFETY: scans the NAME and STEPS as well as the ingredient list.
//
// Scanning ingredients alone made these tags only as trustworthy as the extractor's completeness,
// and the extractor drops things. Three live rows proved it: "Parmesan-Crusted Chicken Sheet Pan"
// was tagged DAIRY-FREE because parmesan never made it into the ingredients array — despite being
// in the dish's own name — and "Stuffed Chicken Caesar Sourdough" was tagged GLUTEN-FREE the same
// way. passesDietTags treats is_dairy_free === true as safe, so those were being served to users
// who had asked to avoid exactly that.
//
// Widening the haystack fails SAFE: a stray mention costs one meal its "free" tag, while a missed
// one hands an allergen to someone avoiding it. Those errors are not equivalent, so the false
// positives are the correct trade.
function classifyDietTags(
  ingredients: any[],
  name = '',
  steps: any[] = [],
): { compatible_diets: string[]; is_dairy_free: boolean; is_gluten_free: boolean; is_nut_free: boolean } {
  const stepText = (steps || [])
    .map((st: any) => typeof st === 'string' ? st : `${st?.title ?? ''} ${st?.detail ?? ''}`)
    .join(' | ')
  const hay = [
    (ingredients || []).map((i: any) => (i?.name ?? '')).join(' | '),
    name,
    stepText,
  ].join(' | ').toLowerCase()
  const has = (arr: string[]) => arr.some(k => hay.includes(k))
  const hasMeat = has(TAG_MEAT) || /\bham\b/.test(hay)   // \bham\b avoids "graham"
  const hasSeafood = has(TAG_SEAFOOD)
  // Dairy butter only — a nut/seed butter (peanut, almond…) is not dairy.
  const dairyButter = /\bbutter\b/.test(hay) && !/(peanut|almond|cashew|hazelnut|pecan|nut|seed|sun)[\s-]*butter/.test(hay)
  const hasDairy = has(TAG_DAIRY) || dairyButter
  const hasEgg = /\beggs?\b/.test(hay)          // whole word — avoids "eggplant"
  const hasHoney = hay.includes('honey')
  // Nested: every meal is Classic; no land meat → Pescatarian; also no seafood →
  // Vegetarian; also no dairy/egg/honey → Vegan.
  const compatible = ['Classic']
  if (!hasMeat) compatible.push('Pescatarian')
  if (!hasMeat && !hasSeafood) compatible.push('Vegetarian')
  if (!hasMeat && !hasSeafood && !hasDairy && !hasEgg && !hasHoney) compatible.push('Vegan')
  return {
    compatible_diets: compatible,
    is_dairy_free: !hasDairy,
    is_gluten_free: !has(TAG_GLUTEN),
    is_nut_free: !has(TAG_NUTS),
  }
}

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
      // 90-day window, not 7. A 7-day window plus the 100k view floor below is nearly empty by
      // construction — almost nothing clears 100k inside a week. Three months lets videos
      // accumulate views, and the 90-day video_id dedup already prevents a repeat on another day.
      if (a === b) return [{ query: arr[a], order: 'relevance', windowDays: 90 }]
      return [
        { query: arr[a], order: 'relevance', windowDays: 90 },
        { query: arr[b], order: 'viewCount', windowDays: 90 },
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
    // Name-comparison window MUST be >= RETENTION_DAYS, or meals still on screen stop being
    // compared against and near-duplicates creep back in. Kept deliberately wider than retention
    // so a recipe doesn't reappear the moment its twin ages out.
    const nameWindowDays = Math.max(60, RETENTION_DAYS * 2)
    const nameWindowCutoff = new Date(Date.now() - nameWindowDays * 86400000).toISOString().split('T')[0]
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
    const { data: prevMeals } = await db.from('trending_meals')
      .select('name, video_id')
      .neq('generated_at', today())
      .gte('generated_at', nameWindowCutoff)
    const prevNames = (prevMeals || []).map((m: any) => m.name.toLowerCase())

    // Recently-used video IDs (90-day window — catches the same viral video resurfacing
    // weeks later). Pre-filtered against candidates so we don't waste LLM tokens on dupes.
    const { data: recentVideoRows } = await db.from('trending_meals')
      .select('video_id')
      .gte('generated_at', ninetyDaysAgo)
      .not('video_id', 'is', null)
    const recentVideoIds = new Set((recentVideoRows || []).map((r: any) => r.video_id))

    stageLog(`dedup history loaded: ${prevNames.length} prev names, ${recentVideoIds.size} prev video_ids`)

    const allVideos: { videoId: string; title: string; thumbnail: string; description: string; viewCount: number; likeCount: number }[] = []
    // Used to filter chart=mostPopular results down to food content (the Howto & Style
    // category includes DIY, beauty, fashion, tech tutorials — we only want recipes).
    const isFoodTitle = (t: string) => /\b(recipe|cook|meal|food|dish|breakfast|lunch|dinner|snack|dessert|bake|grill|fry|roast|smoothie|salad|wrap|bowl|pasta|stir fry|pancake|cheesecake|brownie|cottage cheese|protein|anabolic)\b/i.test(t)
    const isNotRecipeContent = (t: string) => /mukbang|asmr|review|what i ate|day of eating|vlog/i.test(t.toLowerCase())

    for (const config of queryConfigs) {
      try {
        const publishedAfter = new Date(Date.now() - config.windowDays * 86400000).toISOString()
        // Step 1a: Search for video IDs with this query/sort/window combo
        const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(config.query)}&type=video&order=${config.order}&maxResults=20&publishedAfter=${publishedAfter}&key=${youtubeKey}`
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
            allVideos.push({ videoId, title, thumbnail, description: description.substring(0, 500), viewCount, likeCount })
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
      const trendingUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&videoCategoryId=26&regionCode=US&maxResults=25&key=${youtubeKey}`
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
          allVideos.push({ videoId, title, thumbnail, description: description.substring(0, 500), viewCount, likeCount })
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
    uniqueVideos = uniqueVideos
      .sort((a, b) => likeRate(b) - likeRate(a))
      .slice(0, 60)

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
      const desc = v.description ? `\n   Description: ${v.description}` : ''
      // When the creator published an explicit list, restate it as a checklist with its exact
      // count. "Return all 14" is a far harder instruction to quietly ignore than "keep every
      // ingredient", which was already in the prompt and was being ignored half the time.
      const parsed = parseIngredientBlock(v.description || '')
      const checklist = parsed.length >= 3
        ? `\n   SOURCE INGREDIENT LIST (${parsed.length} items — your ingredients array MUST contain all ${parsed.length}, copied, none merged or omitted):\n${parsed.map(x => `     - ${x}`).join('\n')}`
        : ''
      return `${i + 1}. "${v.title}"${desc}${checklist}`
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
- If a video shows a SOURCE INGREDIENT LIST, that list is the specification, not a suggestion. Output one ingredients entry per line, in order, same count. Seasonings, oils and "to taste" items are ingredients — a masala without its ghee, cumin and chilli is a different, worse dish. Never merge two lines into one entry and never drop a line for brevity.
- KEEP EVERY INGREDIENT THE CREATOR LISTS — including toppings, garnishes and sauce components. Do NOT reduce a recipe to its "main" 3-4 ingredients. A bowl or plate dish IS its toppings: strip the diced tomato, pickles and lettuce off a burger bowl and you have described a different, barer dish than the one the creator made. If the creator groups ingredients under headings (Burger / Toppings / Sauce), keep the items from EVERY heading.
- A multi-ingredient sauce or dressing stays intact: list its components as ingredients, and describe it in the steps as one mixed sauce (e.g. "whisk the yogurt, ketchup, mustard and relish into a burger sauce") so downstream knows it is combined rather than served as separate dollops.
- PRESERVE THE PREPARATION METHOD exactly as described. If the creator cuts the potato into fries, the step says fries — not "dice", not "cube", not "roast". The cut and cooking method determine what the finished dish physically looks like, so changing it silently misrepresents the recipe.
- NEVER add ingredients (protein powder, cottage cheese, Greek yogurt, egg whites, etc.) to engineer a recipe into a higher protein density. The recipe is what the creator made — period.
- If the description doesn't list explicit macros, calculate ONLY from the ingredients exactly as the creator listed them — don't invent quantities.

PROTEIN DENSITY — we rank on this downstream, so do NOT skip:
- We prefer recipes where protein is ≈25% of calories (20% for desserts), but DO NOT drop a recipe for missing that bar. Include it with accurate macros — downstream scoring ranks by density and surfaces the highest-protein options automatically.
- Never modify or engineer a recipe to hit a density target. Report it faithfully exactly as the creator made it; we handle ranking.

VARIETY — extract broadly, we curate downstream:
- Do NOT pre-curate for protein balance or drop recipes to "make room." Extract every distinct recipe you find across the videos. Our downstream selection is variety-aware (it penalizes repeated protein sources when picking the final set), so the MORE distinct candidates you hand us, the better the final spread — pre-filtering here only starves that selection.
- The one same-recipe rule: don't output two recipes that are genuinely the same dish/format (e.g. two plain oatmeal bowls, two basic smoothies). Different protein, different format, or a clearly different flavor profile = keep both.

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
- INGREDIENT COMPLETENESS (blocking): EVERY item referenced in any step — including oil, butter, salt, pepper, garlic, lemon juice, broth, spices, pasta, rice, sauces, anything — MUST appear in the "ingredients" array with grams and visual. If a step says "add garlic", garlic MUST be in ingredients. No exceptions.

ATOMIC STEPS: each step contains ONE primary cooking action so users can glance-do-advance while cooking.
  ✗ BAD: "Heat oil in pan, add chicken, sear 5 minutes" (3 actions crammed into one step)
  ✓ GOOD: "Heat oil in pan." → "Add chicken." → "Sear 5 minutes." (3 separate steps)
  Combine ONLY when actions happen simultaneously without a state change (e.g. "Season with salt and pepper" is one step).
  Scale step count to dish complexity — simple recipes 4-6 steps, complex 7-12 steps. Don't pad.
  This applies to the FORMAT of the steps, not the content — still respect the creator's recipe faithfully. Just break their consolidated instructions into individual actions.

OUTPUT TARGET: Return 15-20 DISTINCT recipes — this is a floor of effort, not an aspiration. Extract every appetizing, faithful recipe you can from the ${uniqueVideos.length} videos. Do NOT self-filter for density, variety, appeal, or balance — downstream scoring + variety-aware selection picks the final 6 from YOUR pool, so a bigger pool directly means a better, more varied final feed. Returning fewer than ~12 risks the whole feed coming up short. Never invent recipes to pad, but with ${uniqueVideos.length} real source videos you should comfortably clear 15.

Respond ONLY with a JSON array, no markdown. Note how EVERY item mentioned in steps (oil, garlic, salt, pepper) appears in the ingredients array:
[
  {
    "video_index": 1,
    "name": "The actual dish name (cleaned up)",
    "category": "meal",
    "servings": 1,
    "shelf_tag": "american-comfort",
    "contains_dairy": false,
    "contains_gluten": false,
    "contains_nuts": false,
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
          // 8000 (was 6000): now that the prompt asks for a generous 15-20 candidate
          // pool, the JSON output is larger — too low a cap truncates mid-array and
          // the parse fails, masquerading as "0 recipes generated".
          body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 8000 }),
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
          // Funnel counters — tally exactly why the LLM's raw output shrinks.
          let rejNoName = 0, rejNoMacros = 0, rejDupName = 0, rejNearDup = 0, rejFractional = 0, rejDropped = 0
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
            // Enforced in CODE, not just the prompt. "Do not scale" was already an explicit
            // instruction and was ignored anyway — same lesson as the format cap. A recipe that
            // asks for half an egg cannot be cooked, so it's rejected outright rather than ranked.
            // Retention check against the creator's own list. Logged for every recipe and rejected
            // only below 50%, deliberately: the pre-fix average WAS 50%, so a stricter gate would
            // starve the pool before the prompt change has a chance to work. Tighten once the logs
            // show what the new baseline actually is — don't guess it.
            const srcVideo = uniqueVideos[(r.video_index || 1) - 1]
            const srcList = srcVideo ? parseIngredientBlock(srcVideo.description || '') : []
            if (srcList.length >= 3) {
              const kept = (r.ingredients?.length ?? 0) / srcList.length
              console.log(`[funnel] ingredient retention "${name}": ${r.ingredients?.length ?? 0}/${srcList.length} (${Math.round(kept * 100)}%)`)
              if (kept < 0.5) { rejDropped++; console.log(`[funnel] rejected "${name}" — dropped more than half the creator's ingredients`); return false }
            }
            const frac = hasFractionalIndivisible(r.ingredients)
            if (frac) { rejFractional++; console.log(`[funnel] rejected "${name}" — fractional indivisible item: ${frac}`); return false }
            seenNames.add(key)
            seenWordSets.push(candWords)
            return true
          }).slice(0, 30)
          console.log(`[funnel] ${provider.name} LLM: ${parsed.length} raw → ${sanitized.length} sanitized (rejected: noName ${rejNoName}, noMacros ${rejNoMacros}, dupName ${rejDupName}, nearDup ${rejNearDup}, fractional ${rejFractional}, dropped ${rejDropped})`)
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
      // Density still leads (it's the core value prop), but 20% now goes to whether the source
      // video was actually liked. Taken proportionally from density and macro agreement rather
      // than uniqueness, which is what stops the feed repeating itself.
      return dens * 0.35 + uniq * 0.30 + macro * 0.15 + liked * 0.20
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
    recipes = [...kept, ...overflow].slice(0, STORE_CAP)

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
        shelf_tag: SHELF_TAGS.includes(String(r.shelf_tag)) ? String(r.shelf_tag) : null,
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
    return new Response(JSON.stringify({ generated: true, count: meals.length, meals: finalMeals ?? meals }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
