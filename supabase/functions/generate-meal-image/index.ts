import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { verifyUser } from '../_shared/auth.ts'
import { checkScanCap, refundScan, scanCapResponse } from '../_shared/scan-cap.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Photographic direction, varied per DISH and stable for it.
//
// Every image was generated with one identical direction string — "overhead or 3/4-angle, natural
// daylight from upper left, Sony A7R IV 50mm" — so two unrelated chocolate cheesecakes came back as
// the same photograph, and a browse grid of six brownies looked like the same brownie six times.
// The recipes were genuinely different; only the camera was not.
//
// Keyed by a hash of the dish name, deliberately NOT random and NOT per user:
//   * stable, so regenerating a dish yields the same frame instead of a new one each time;
//   * per DISH, so the image cache stays one image per meal shared by everyone. Varying per user
//     would multiply generations per dish, which is the cost model that must not be touched.
//
// Changing this string does NOT invalidate anything already stored: the cache key is
// normalizeKey(mealName), not the prompt. Existing images keep resolving; only new dishes pick up
// the variation.
function photoVariant(mealName: string): string {
  let h = 0
  for (let i = 0; i < mealName.length; i++) h = (h * 31 + mealName.charCodeAt(i)) >>> 0
  const ANGLE = [
    'straight overhead flat-lay',
    'three-quarter angle at table height',
    'low fifteen-degree angle close to the surface',
    'tight forty-five-degree crop filling the frame',
  ]
  // BACKDROP ONLY — deliberately no plate/bowl/dish here. These four strings used to name a
  // vessel too ("pale ceramic plate on a warm oak board"), which silently overrode the vessel
  // Stage 1 had already chosen and, worse, could only ever express ONE. Kala Chana Protein Balls
  // was described as balls on a plate "alongside a curd dip in a small ramekin" and rendered with
  // no ramekin at all: the description asked for two vessels and the trailer asserted one.
  // Choosing the vessel is Stage 1's job; this axis is only the surface it stands on.
  const SURFACE = [
    'on a warm oak board',
    'on a dark slate surface',
    'on natural linen',
    'on weathered wood',
  ]
  const LIGHT = [
    'soft window light from the upper left',
    'warm directional light from the right with long shadows',
    'diffused overcast daylight with minimal shadow',
    'golden late-afternoon side light',
  ]
  // Independent bit ranges per axis, so two dishes that collide on one axis still differ on the
  // others instead of sharing the whole look.
  return `${ANGLE[h % ANGLE.length]}, ${SURFACE[(h >>> 3) % SURFACE.length]}, ${LIGHT[(h >>> 6) % LIGHT.length]}`
}

// Per-user daily ceiling on actual generations (cache hits are exempt). Derived from the
// real max a user can drive: meal-gen is capped at 3/day server-side × up to 5 meals per
// Cook Now generation = 15 images, plus a small buffer for the onboarding plan reveal and
// the occasional uncached meal-detail view. 20 covers legit heavy use; anything past it is
// abuse. (Hitting it just means "no photo" for the extra meals — never blocks the meal.)
const IMAGE_GEN_DAILY_CAP = 20

const falApiKey = Deno.env.get("FAL_API_KEY")
const googleAiKey = Deno.env.get("GOOGLE_AI_KEY")
const openaiApiKey = Deno.env.get("OPENAI_API_KEY")
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const db = createClient(supabaseUrl, supabaseServiceKey)

// The key the cache used before it was tightened. Kept so the existing library still resolves —
// without it, tightening the key would orphan every stored image and we'd re-pay to rebuild it.
function legacyNormalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

// Multi-word phrases are stripped as phrases, BEFORE word-level filtering — otherwise "one pot"
// would leave "pot" in the filler list and quietly turn "Pot Roast" into "Roast".
const KEY_PHRASES: RegExp[] = [
  /\bone (?:pan|pot)\b/g,
  /\bsheet pan\b/g,
  /\bslow cooker\b/g,
  /\binstant pot\b/g,
  /\bmeal prep\b/g,
  /\bhigh protein\b/g,
  /\bprotein packed\b/g,
  /\blow carb\b/g,
  /\b\d+\s*(?:minute|min|ingredient)s?\b/g,
]

// Words describing effort or vibe, not the finished plate — "Easy Chicken Parmesan", "Classic
// Chicken Parmesan" and "Chicken Parmesan" should all share one image.
//
// Cooking METHODS are deliberately absent (grilled / fried / baked / roasted / air fried): those
// genuinely change how the dish looks, so collapsing them would serve a wrong photo — which is a
// worse outcome than paying for a second image.
const KEY_FILLER = new Set([
  'easy', 'quick', 'simple', 'best', 'ultimate', 'perfect', 'classic', 'traditional', 'authentic',
  'homemade', 'healthy', 'delicious', 'tasty', 'hearty', 'amazing', 'favorite', 'super', 'weeknight',
  'style', 'recipe', 'my', 'your', 'the', 'a', 'an', 'with', 'and', 'of', 'in', 'on', 'for',
])

// Fold plurals so "Tacos"/"Taco" and "Noodles"/"Noodle" don't buy two images. Guarded against the
// words that merely end in s (hummus, couscous, swiss) rather than being plural.
function singularize(w: string): string {
  // NOT guarding on -os: tacos/burritos are real plurals. Only ss/us/is are the false friends.
  if (w.length < 4 || /(?:ss|us|is)$/.test(w)) return w
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y'
  if (/oes$/.test(w)) return w.slice(0, -2)          // potatoes -> potato
  if (/(?:ch|sh|x|z|s)es$/.test(w)) return w.slice(0, -2)
  return w.endsWith('s') ? w.slice(0, -1) : w
}

// Cache key for a meal name. Deliberately lossy: every variant that plates the same should collapse
// to one paid image, since cost scales with UNIQUE KEYS, not users.
function normalizeKey(name: string): string {
  let s = legacyNormalizeKey(name)
  for (const re of KEY_PHRASES) s = s.replace(re, ' ')
  const words = s.split(' ').map(singularize).filter(w => w && !KEY_FILLER.has(w))
  const key = words.join(' ').trim()
  return key || legacyNormalizeKey(name) // never return empty (e.g. a name that was all filler)
}

// Word-ORDER-insensitive variant of the cache key, used only as an extra LOOKUP.
//
// normalizeKey strips filler and singularises but preserves order, so "paneer chocolate mousse" and
// "chocolate paneer mousse" are different keys for the same dish — and each one paid for its own
// Flux generation. Four such exact-reorder pairs exist in the live 994-image library
// ("sesame tuna steak with bok choy" / "tuna steak with sesame bok choy",
//  "panseared salmon with asparagus and sweet potato" / "...with sweet potato and asparagus", ...).
//
// Deliberately NOT used as the storage key. Sorting the primary key would change all ~1000 existing
// keys at once, turning the entire library into a cache miss and re-paying for every image — far
// more expensive than the handful of duplicates it would prevent. As a lookup it costs one extra
// key in an `in()` that is already running, and the existing backfill aliases the hit forward, so
// the library converges without a single extra generation.
function sortedKey(name: string): string {
  return normalizeKey(name).split(' ').filter(Boolean).sort().join(' ')
}

// Stage 1 of the two-stage Flux pipeline: ask an LLM to describe how the FINISHED dish
// looks when plated. Without this, Flux gets a generic "professional food photo of {name}"
// template and has to guess the visual form — which is why fusion dishes (cottage cheese
// brownie) end up as stacked components and cold dishes get steam plumes. Gemini Flash
// Lite is essentially free; OpenAI fallback is cheap. If both fail, the caller falls back
// to the original static template so image generation never hard-stops.
// Ingredients that are INVISIBLE in a finished dish and whose NAMES mislead an image model.
// Telling the description writer not to draw them was not enough: "Jello" regenerated under that
// rule on 2026-09-04 and Flux still produced diced fruit, because "fruit flavored zero sugar water
// drink enhancer" was in the list at all and the word survives into the pipeline. The reliable fix
// is to never hand these to the model — a word that is not in the prompt cannot be rendered.
//
// Every entry here dissolves completely: extracts, essences, flavour drops and syrups, drink
// enhancers, sweeteners, food colouring. Deliberately NOT "powder" on its own, which would strip
// cocoa powder and baking powder; and not gelatin, which IS the dish in the case that motivated it.
const INVISIBLE_INGREDIENT = /(extract|essence|drink enhancer|water enhancer|sweetener|food colou?ring|flavou?r(?:ing|ed)?\s*(?:drops?|syrup|enhancer|concentrate))/i

async function generateVisualDescription(mealName: string, ingredients: string[], steps: string[] = []): Promise<string | null> {
  // REWRITTEN before the prompt is built, not removed and not forbidden inside it.
  //
  // Removing them was the first attempt and it over-corrected: with the enhancer gone, "Protein
  // Jello" rendered as PLAIN GELATIN — clear and colourless — when the real dish is orange. A
  // flavour concentrate is invisible as a SOLID and highly visible as COLOUR, and dropping it threw
  // away the colour along with the false chunks.
  //
  // So strip the food NOUN and keep the tint. The description writer receives "flavouring
  // concentrate (dissolves completely — tints the dish a bright colour, contributes NO solid
  // pieces)", which carries everything true about it and contains no food word Flux can render.
  // Name the COLOUR, not just "a bright colour". Saying only that it tints produced a pale cream
  // jelly on 2026-09-05 — the model has no value to use, so it falls back to the base ingredient's
  // own colour, which for gelatin is cream. The flavour word carries the colour, so map it and emit
  // the colour alone: Flux gets something concrete and still never sees a food noun to render.
  // Returns the colour a flavouring produces, or null when it produces none.
  //
  // Two bugs worth keeping in the comment because both were silent. Bare `red` as an alternative
  // matched INSIDE "flavoured", so every "fruit flavored ..." resolved to red; every short colour
  // word is now \b-bounded. And the first version emitted "a distinctly coloured tone" as a
  // fallback, which over-claims for vanilla extract and sweetener — they are colourless, and
  // asserting a colour there is how a plain gelatin gets painted for no reason.
  const flavourColour = (text: string): string | null => {
    const t = text.toLowerCase()
    if (/blue\s*raspberry|blueberr/.test(t)) return 'a deep blue-purple'
    if (/strawberr|raspberr|cherry|watermelon|\bred\b/.test(t)) return 'a vivid red'
    if (/orange|mango|peach|apricot|papaya/.test(t)) return 'a bright orange'
    if (/lemon|pineapple|banana|\byellow\b/.test(t)) return 'a bright yellow'
    if (/\blime\b|apple|\bgreen\b|kiwi|melon/.test(t)) return 'a bright green'
    if (/grape|blackcurrant|berry|\bpurple\b/.test(t)) return 'a deep purple'
    if (/cola|coffee|caramel|chocolate/.test(t)) return 'a deep brown'
    // "fruit flavoured" naming no fruit — the fruit-punch default, and far closer than cream.
    if (/\bfruit\b|punch|tropical/.test(t)) return 'a vivid red-orange'
    return null   // vanilla, plain sweetener, salt-like flavourings: no colour to claim
  }
  const rewritten = ingredients.map(i => {
    const text = String(i)
    if (!INVISIBLE_INGREDIENT.test(text)) return text
    const colour = flavourColour(text)
    return colour
      ? `flavouring concentrate (dissolves completely — tints the whole dish ${colour} throughout, contributes NO solid pieces or chunks)`
      : 'flavouring (dissolves completely — adds no colour and NO solid pieces or chunks)'
  })
  const changed = rewritten.filter((v, n) => v !== String(ingredients[n])).length
  if (changed) console.log(`[image] rewrote ${changed} flavouring(s) as colour-only for "${mealName}"`)
  ingredients = rewritten
  const sysPrompt = `You are a food stylist. In ONE concise sentence (under 50 words), describe how the FINISHED dish appears when photographed for a recipe blog. Include: the dish visual form (color, texture, structure), the vessel it is served in (glass / bowl / plate / board / ramekin), and natural garnish if appropriate.

CRITICAL — INGREDIENT FIDELITY: Compose the description from the SPECIFIC ingredients listed. If the dish name is generic (e.g., "Fruit", "Bowl", "Plate"), use the exact ingredient (e.g., "sliced apple" not "berries"). NEVER substitute photogenic alternatives or generic interpretations of the name.

COVERAGE — every visible ingredient must appear: After applying the visibility rules below, EVERY ingredient that ends up visible on the plate MUST be named in the description. Do not silently drop ingredients for brevity. If 6+ ingredients are visible, briefly list them all (it's fine to extend the sentence). Do not invent ingredients that aren't listed (e.g., microgreens, herbs) unless the recipe explicitly includes them.

FLAVOURINGS ARE NOT THE FOOD THEY ARE NAMED AFTER: an ingredient whose name contains a food word but which is a syrup, extract, essence, powder, drink enhancer, sweetener or "X flavoured" product must NEVER be drawn as that food. "fruit flavored zero sugar water drink enhancer" is a liquid concentrate that tints the dish — it is NOT fruit pieces. "vanilla extract" is not a vanilla pod. "strawberry protein powder" is not strawberries. "banana flavour drops" are not banana slices. Drawing the named food instead of the product is the single most common way these photos end up showing something the recipe does not contain — a real example rendered diced fruit suspended in a gelatin dessert whose only fruit reference was a flavour concentrate.

SET AND DISSOLVED DISHES ARE UNIFORM BUT NOT COLOURLESS: a jelly, gelatin dessert, sorbet, granita, panna cotta or anything else where the ingredients dissolve into a single mass is EVENLY coloured throughout, with no pieces, chunks, swirls or inclusions of any kind — and it is NOT clear or colourless unless the recipe genuinely contains no colouring. If a flavouring concentrate is present, say the colour it produces (a bright orange, red or amber set jelly). Both halves matter: a real example was rendered first with diced fruit floating in it, and then, after the flavouring was removed entirely, as plain colourless gelatin. Neither is the dish.

EQUIPMENT IS NOT AN INGREDIENT: some creators list their container or tools in the ingredient list ("64 fl oz glass container", "baking tray", "piping bag"). These are never food and never garnish. Use them ONLY as the vessel if relevant, and never depict them as something on or in the dish.

PROCESSED INGREDIENTS — NAME THE FINISHED FORM, NOT THE RAW BASE: Some ingredients are made FROM something else and get rendered as that base unless you describe their actual appearance. Always spell out the characteristic look: "granola" = golden-brown baked clusters and chunks, NOT loose raw oat flakes. "tortilla chips" = crisp fried triangles, not soft tortillas. "breadcrumbs" = fine golden crumbs, not bread slices. "peanut butter" = a glossy brown swirl, not whole peanuts. "protein powder" = invisible once blended. "cereal, oats or wheat biscuits that have been crushed, soaked, or left overnight in milk or yogurt" = a DENSE, UNIFORM, MOIST compressed layer like a soft cake base, with NO individual dry flakes, clusters or recognisable pieces left, and in the SOAKED COLOUR OF THAT CEREAL — soaked wheat biscuits and oats are pale tan-beige, never chocolate-brown, unless the recipe genuinely adds cocoa to the base — this is the single most common miss, because the model knows the cereal's dry appearance far better than its soaked one. Apply this to ANY processed ingredient, not just these.

LAYERED DISHES — DESCRIBE THE LAYERS IN BUILD ORDER, BOTTOM FIRST: If the steps build a dish in layers (overnight oats, parfaits, trifles, jars, terrines), name the layers in the exact order the steps add them, from the bottom of the vessel upward, and say which are visible through a clear vessel. A layer that a later step covers or spreads something OVER is UNDERNEATH that thing, not on top of it. Getting this backwards is how a coconut layer that the recipe buries under a chocolate ganache ends up dusted across the top of the finished photo.

ASSEMBLED, NOT STACKED: Describe the dish AS PLATED — fully assembled, integrated, ready to eat. Never describe separate visible components (e.g., a brownie with cottage cheese baked in, NOT cottage cheese piled on top of a brownie). Do NOT mention cooking process.

READ THE STEPS FOR INGREDIENT ROLES: If recipe steps are provided, use them to determine each ingredient's role in the finished plate. An ingredient that is mashed, blended, mixed, stirred, folded, dissolved, melted, whisked, or otherwise incorporated INTO another component is INVISIBLE in the photo — do NOT depict it as a separate dollop, drizzle, swirl, sprinkle, or pile. Only ingredients that are plated separately, served on top, used as garnish, or remain as recognizable solids should appear visually.

Examples:
- "Cottage Cheese Brownie Bake" (ingredients: cottage cheese, cocoa, eggs) -> "A dense baked chocolate brownie square with a slightly cracked golden top, served on a wooden cutting board."
- "Strawberry Protein Smoothie" (ingredients: strawberries, yogurt, protein powder; steps: blend everything until smooth) -> "A thick pink smoothie in a tall clear glass, topped with a single strawberry slice."
- "Greek Chicken Salad" (ingredients: chicken, greens, feta, olives) -> "A wide ceramic bowl of mixed greens with grilled chicken slices, feta crumbles, and olives, drizzled with olive oil."
- "Whipped Greek Yogurt Protein Bowl" (ingredients: greek yogurt, chocolate protein powder, granola; steps: whip yogurt with protein powder, top with granola) -> "A thick whipped chocolate-brown yogurt bowl in a white ceramic bowl, topped with a cluster of golden-brown baked granola chunks." (NOTE: protein powder is invisible — whipped in. Granola is baked CLUSTERS, never loose raw oats.)
- "Hard-Boiled Eggs and Fruit" (ingredients: eggs, apple, almonds, greek yogurt; steps: arrange components on plate) -> "Halved hard-boiled eggs arranged on a dark plate beside sliced apple, a small mound of almonds, and a dollop of greek yogurt."
- "Roasted Salmon and Sweet Potato Mash" (ingredients: salmon, sweet potato, asparagus, olive oil, greek yogurt; steps: mash potatoes with yogurt; plate salmon, asparagus, mash) -> "A roasted salmon fillet resting on a bed of creamy orange sweet potato mash, with bright green roasted asparagus alongside, on a dark ceramic plate." (NOTE: greek yogurt is invisible — mashed into the potatoes.)`

  const stepsText = steps.length
    ? `\nSteps: ${steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}`
    : ''
  const userPrompt = `Now describe: ${mealName}${ingredients.length ? ` — ingredients: ${ingredients.join(', ')}` : ''}${stepsText}`

  const providers = [
    googleAiKey && { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: googleAiKey, model: "gemini-3.1-flash-lite" },
    openaiApiKey && { url: "https://api.openai.com/v1/chat/completions", key: openaiApiKey, model: "gpt-4o-mini" },
  ].filter(Boolean) as { url: string; key: string; model: string }[]

  for (const provider of providers) {
    try {
      const res = await fetch(provider.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${provider.key}` },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }],
          temperature: 0.3,
          max_tokens: 180,
        }),
      })
      const data = await res.json()
      if (data.error) { console.log(`[visualDesc] ${provider.model} error:`, data.error?.message); continue }
      const text = (data.choices?.[0]?.message?.content || '').trim()
        .replace(/^["']/, '').replace(/["']$/, '') // strip surrounding quotes if model added them
      if (text.length > 0 && text.length < 400) {
        console.log(`[visualDesc] ${provider.model}: "${text}"`)
        return text
      }
    } catch (e) {
      console.log(`[visualDesc] ${provider.model} threw:`, e)
    }
  }
  return null
}

const jsonHeaders = { "Content-Type": "application/json" }
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Backfill trending_meals.image when we resolve a photo for a row that has none.
//
// Discover renders `meal.image && meal.image.startsWith('http')` straight off trending_meals, while
// the meal detail screen asks THIS function by name. Those are two different sources, and nothing
// wrote the generated URL back — so a row with a null image showed the fork-and-knife placeholder in
// Discover FOREVER, while opening it produced the photo after a round-trip. Exactly the symptom
// Logan reported on Protein Jello, and it would never have self-healed.
//
// Server-side because it has to be: RLS on trending_meals allows updates only to a creator's own
// rows, so a client write-back is correctly refused. Scoped to `image is null` so it can never
// overwrite a photo the pipeline already chose, and awaited-but-ignored so it cannot fail a request.
async function backfillTrendingImage(db: any, mealName: string, url: string, isInternal: boolean, replaceExisting = false) {
  // GUARD 1 — internal callers only. My first version claimed RLS made this safe; it does not.
  // `db` is the SERVICE-ROLE client, which bypasses RLS entirely, so any signed-in caller could
  // have named a real trending row, passed their own `ingredients`, and had the resulting image
  // written to public content. The URL is always one this function derived, so no arbitrary URL
  // could be injected — but a WRONG image for a real dish is poisoning enough. The pipeline and
  // the cron still self-heal rows; a user opening a meal no longer writes to shared content.
  if (!isInternal) return
  // GUARD 2 — durable URLs only. The last-resort path returns a FAL CDN link when both uploads
  // fail, and that link EXPIRES. Writing it here would pin a guaranteed future 404 into the row,
  // and `.is('image', null)` would then block any later successful upload from correcting it —
  // the guard that makes this safe to retry is the same one that would make the mistake permanent.
  if (!url.includes('/storage/v1/object/public/')) {
    console.log(`[image] backfill skipped, not a durable storage URL: ${url.slice(0, 60)}`)
    return
  }
  try {
    // `.is('image', null)` is what makes an unattended backfill safe — it can only ever FILL a
    // gap, never replace a photo the pipeline chose. But that same scope makes it useless for a
    // REPAIR, which by definition targets a row that already has a (wrong) image, so a repair
    // regeneration silently left the stale URL in place and Discover kept serving it. Callers
    // doing a deliberate fix opt in; the default stays gap-fill-only.
    const q = db.from('trending_meals').update({ image: url }).eq('name', mealName)
    const { error } = await (replaceExisting ? q : q.is('image', null))
    if (error) console.log(`[image] trending backfill refused for "${mealName}": ${error.message}`)
  } catch (e) { console.log(`[image] trending backfill threw (ignored): ${(e as Error).message}`) }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  let capConsumed = false // track whether we incremented the per-user cap, so we can refund on failure
  try {
    const { mealName, ingredients = [], steps = [], describeOnly = false, imageSize, seed, replaceTrending = false } = await req.json()
    if (!mealName) return new Response(JSON.stringify({ image: null }), { headers: jsonHeaders })

    // Declared HERE, above the cache lookup, because the cache-HIT path backfills
    // trending_meals and needs it. Leaving it below produced TS2448/TS2454 — a temporal dead zone,
    // which in this file would have thrown a ReferenceError on every cached image request. This
    // codebase has lost a day to a TDZ bug before; the baseline delta caught this one in seconds.
    // Match the same internal-auth tokens generate-trending-meals accepts: CRON_SECRET (the
    // dedicated, reliable shared secret) preferred, SUPABASE_SERVICE_ROLE_KEY as fallback.
    const cronSecret = Deno.env.get("CRON_SECRET") ?? ""
    const authToken = (req.headers.get('Authorization') ?? req.headers.get('authorization') ?? '')
      .replace(/^Bearer\s+/i, '').trim()
    const isInternal = (cronSecret !== '' && authToken === cronSecret) ||
                       (supabaseServiceKey !== '' && authToken === supabaseServiceKey)


    // Normalize steps to a string array — accepts either ["raw text"] or [{title, detail}]
    const stepStrings: string[] = Array.isArray(steps)
      ? steps.map((s: any) => typeof s === 'string' ? s : (s?.detail ?? s?.title ?? '')).filter(Boolean)
      : []

    // DESCRIBE-ONLY: return stage 1's description and stop, without touching the cache, the
    // FAL credits or the stored image. Stage 1 is otherwise only ever console.logged during a real
    // generation, which made "is the description wrong, or is Flux ignoring a correct one?"
    // unanswerable — the Kala Chana photo drew blended ingredients raw on top and dropped the curd
    // dip, and there was no way to tell which stage did it. Internal-auth only: it is an
    // unmetered LLM call, so a signed-in user must not be able to spin it.
    if (describeOnly) {
      if (!isInternal) return new Response(JSON.stringify({ error: 'internal only' }), { status: 401, headers: jsonHeaders })
      const desc = await generateVisualDescription(mealName, ingredients, stepStrings)
      return new Response(JSON.stringify({ description: desc, steps: stepStrings }), { headers: jsonHeaders })
    }

    const cacheKey = normalizeKey(mealName)
    const legacyKey = legacyNormalizeKey(mealName)

    // Check DB cache FIRST (free, no auth) — globally-cached images are shared across all
    // users, so serving a hit costs nothing and preserves pre-auth use (e.g. onboarding).
    // Always cache-first: no client bypass, so a user can't force credit spend to drain quota.
    //
    // Two keys are checked: the tightened one, plus the pre-tightening key so images stored under
    // the old scheme still resolve. A legacy hit is backfilled under the new key, so each old entry
    // costs one extra lookup exactly once and the library migrates itself instead of being re-paid for.
    // Third variant: same words, any order. Catches the reorder duplicates described at sortedKey().
    const orderKey = sortedKey(mealName)
    const lookupKeys = [...new Set([cacheKey, legacyKey, orderKey].filter(Boolean))] as string[]
    const { data: cachedRows } = await db.from('image_cache').select('meal_key, image_url').in('meal_key', lookupKeys)
    const hit = cachedRows?.find((r: any) => r.meal_key === cacheKey) ?? cachedRows?.[0]
    if (hit?.image_url) {
      if (hit.meal_key !== cacheKey) {
        const { error: backfillErr } = await db.from('image_cache').upsert({ meal_key: cacheKey, image_url: hit.image_url }, { onConflict: 'meal_key' })
        if (backfillErr) console.log('Backfill FAILED:', cacheKey, backfillErr.message)
      }
      await backfillTrendingImage(db, mealName, hit.image_url, isInternal)
      return new Response(JSON.stringify({ image: hit.image_url }), { headers: jsonHeaders })
    }

    // Cache MISS = we're about to spend FAL/LLM credits. Require a logged-in user so
    // anonymous callers can't drain image-generation credits by enumerating meal names.
    // Exception: the trending-meals cron is a trusted server-side caller that authenticates
    // with the service-role key (it has no user JWT). Its meal names are freshly generated =
    // always a cache miss, so without this bypass every new trending meal 401s and is left on
    // its YouTube-thumbnail fallback — the real cause of the all-YT Discover feed.
    const user = isInternal ? null : await verifyUser(req)
    if (!isInternal && !user) return new Response(JSON.stringify({ image: null, error: 'auth required' }), { status: 401, headers: jsonHeaders })

    if (!falApiKey) {
      console.log('FAL_API_KEY is missing or empty')
      return new Response(JSON.stringify({ image: null, error: 'no FAL key' }), { headers: jsonHeaders })
    }

    // Per-user daily generation ceiling (atomic, server-side). Cache hits above are exempt;
    // only real generations count. Refunded below if generation ultimately fails. Skipped for
    // the internal cron — there's no user to key the cap on, and its volume is already bounded
    // by the daily trending batch size (~18), not user behavior.
    if (!isInternal) {
      const { allowed } = await checkScanCap(req, 'image_gen', IMAGE_GEN_DAILY_CAP)
      if (!allowed) return scanCapResponse(IMAGE_GEN_DAILY_CAP)
      capConsumed = true
    }

    // STAGE 1: ask an LLM to visually describe the finished dish. If it succeeds we use
    // that as the basis for the Flux prompt; if it fails we fall back to a static template
    // built from keyword heuristics so image generation never hard-stops.
    const description = await generateVisualDescription(mealName, ingredients, stepStrings)

    let prompt: string
    if (description) {
      // STAGE 2 (preferred): the description leads and everything after it is camera direction.
      //
      // The "Negative prompt: text, watermark, ... multiple plates, deconstructed." trailer that
      // used to live here is GONE, and it must not come back. Two reasons, both verified:
      //   1. fal-ai/flux-2 exposes no `negative_prompt` field (checked against fal's API schema
      //      2026-09-05 — prompt, guidance_scale, seed, num_inference_steps, image_size,
      //      num_images, acceleration, enable_prompt_expansion, sync_mode, enable_safety_checker,
      //      output_format, and nothing else). So the trailer was never a negative prompt; it was
      //      ~60 words appended to the POSITIVE one.
      //   2. Flux's text encoder has no negation semantics. "no X" and "X" light up the same
      //      features, so the trailer was handing the model the exact vocabulary of the thing it
      //      was trying to forbid — "pieces", "solid chunks", "ingredients", "components",
      //      "containers", "multiple plates" — and burying a 27-word description under 90 words
      //      of boilerplate that is byte-identical for every dish in the app.
      // Anything that must NOT appear has to be handled where a word can still be removed: in
      // Stage 1's INVISIBLE_INGREDIENT rewrite, which works by never emitting the noun at all.
      prompt = `${description} Professional food photography, ${photoVariant(mealName)}, sharp focus, shallow depth of field, photorealistic.`
    } else {
      // FALLBACK: original static template (keyword-detected vessel + sauce-filtered
      // ingredients). Worse than the LLM-guided version but never breaks image gen.
      console.log(`[visualDesc] no LLM description for "${mealName}" — falling back to static template`)
      const sauceKeywords = ['oil', 'sauce', 'vinegar', 'dressing', 'syrup', 'butter', 'seasoning', 'spice', 'paste', 'glaze', 'marinade', 'mayo', 'mayonnaise', 'ketchup', 'mustard', 'sriracha', 'soy sauce']
      const visibleIngredients = ingredients.filter((i: string) => {
        const lower = i.toLowerCase()
        return !sauceKeywords.some(k => lower.includes(k))
      })
      const ingredientList = visibleIngredients.length ? ` with ${visibleIngredients.join(', ')}` : ''
      const nameLower = mealName.toLowerCase()
      const vessel = nameLower.includes('bowl')      ? 'deep ceramic bowl'
                   : nameLower.includes('wrap')      ? 'flour tortilla wrap, folded and served on a board'
                   : nameLower.includes('taco')      ? 'corn or flour taco shells'
                   : nameLower.includes('burger')    ? 'toasted brioche bun, fully assembled'
                   : nameLower.includes('sandwich')  ? 'toasted bread or bun, fully assembled'
                   : nameLower.includes('smoothie')  ? 'tall glass with a straw'
                   : nameLower.includes('oats')      ? 'ceramic bowl'
                   : nameLower.includes('pudding')   ? 'glass jar or ceramic bowl'
                   : nameLower.includes('salad')     ? 'wide ceramic bowl or plate'
                   : nameLower.includes('soup')      ? 'deep ceramic bowl'
                   : nameLower.includes('stir-fry') || nameLower.includes('stir fry') ? 'ceramic bowl with rice'
                   : nameLower.includes('curry')     ? 'ceramic bowl with rice on the side'
                   : nameLower.includes('toast')     ? 'dark ceramic plate'
                   : 'dark ceramic plate'
      // Phrased affirmatively for the same reason Stage 2 above dropped its negative trailer:
      // "no side dishes, no garnish props, no extra vessels" put "side dishes", "garnish props"
      // and "extra vessels" into a prompt that cannot negate them.
      prompt = `Professional food photography of ${mealName}${ingredientList}, served in a ${vessel}, complete and fully assembled exactly as served in a restaurant, sauces integrated into the food, sheen and moisture visible, rich saturated colors, a single plated serving, ${photoVariant(mealName)}, sharp focus, appetizing, photorealistic`
    }

    // Generate via FAL Flux 2
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log('FAL key prefix:', falApiKey?.substring(0, 4))
        const falUrl = "https://fal.run/fal-ai/flux-2"
        const res = await fetch(falUrl, {
          method: "POST",
          headers: {
            "Authorization": `Key ${falApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            // 512x512. NOT a considered choice: it arrived as the migration default when image gen
            // moved Replicate -> FAL in 22e790a, where `aspect_ratio: "16:9"` silently became
            // `image_size: "square"` inside an unrelated onboarding commit. Square IS right — the
            // consumers span 0.78 (detail hero, Discover rail) to 1.24 (Home hero), so no single
            // aspect fits and 1:1 is the least-bad. The RESOLUTION is the problem: the meal-detail
            // hero is 500pt full-width = 1179x1500 real px at @3x, so this is upscaled 2.93x.
            // Overridable internally so a resolution can be A/B'd against a FIXED SEED — without
            // pinning the seed you are comparing two different pictures, not two resolutions.
            image_size: (isInternal && imageSize) ? imageSize : "square",
            ...(isInternal && seed !== undefined ? { seed } : {}),
            num_images: 1,
            output_format: "jpeg",
          }),
        })
        const data = await res.json()
        console.log('FAL response status:', res.status, 'body:', JSON.stringify(data).substring(0, 300))

        // FAL returns images array
        const imageUrl = data.images?.[0]?.url
        if (!imageUrl) {
          console.log(`Attempt ${attempt + 1}: no image URL`, JSON.stringify(data).substring(0, 200))
          await new Promise(r => setTimeout(r, 2000))
          continue
        }

        // Upload to Supabase Storage for permanent caching. Retry once on failure
        // (transient blips between Edge Function and Storage are the most common
        // failure mode — a 1.5s wait usually clears them). Only cache the URL if
        // upload succeeded — caching the FAL fallback URL bites later because FAL
        // CDN URLs expire ~24 hr and the cached row would then serve a 404 forever.
        const imageRes = await fetch(imageUrl)
        const blob = await imageRes.blob()
        const filename = `${cacheKey.replace(/\s+/g, '-')}.jpg`

        let { error: uploadErr } = await db.storage.from('meal-images').upload(filename, blob, {
          contentType: 'image/jpeg',
          cacheControl: '31536000', // 1yr — filename is content-addressed (meal_key) + write-once, so let the CDN/client cache it instead of re-fetching at the 1hr default
          upsert: true,
        })
        if (uploadErr) {
          console.log('Storage upload attempt 1 failed:', uploadErr.message, '— retrying in 1.5s')
          await new Promise(r => setTimeout(r, 1500))
          const retry = await db.storage.from('meal-images').upload(filename, blob, {
            contentType: 'image/jpeg',
            cacheControl: '31536000', // see note above — content-addressed, write-once
            upsert: true,
          })
          uploadErr = retry.error
          if (uploadErr) console.log('Storage upload retry also failed:', uploadErr.message, '— returning FAL URL without caching')
          else console.log('Storage upload succeeded on retry')
        }

        if (!uploadErr) {
          const { data: urlData } = db.storage.from('meal-images').getPublicUrl(filename)
          // CACHE-BUST. `upload` uses `upsert`, so regenerating a dish overwrites the object at the
          // SAME path — and every client that already has it keeps serving the old bytes from its
          // own disk cache, indefinitely. Protein Jello was corrected three times on 2026-09-05 and
          // the device still showed the first version; the file at the URL was right the whole time.
          // A version token makes each regeneration a distinct URL, so clients refetch. It changes
          // nothing about storage — the object path is untouched — only what the client is asked for.
          const permanentUrl = `${urlData.publicUrl}?v=${Date.now()}`
          // Store under BOTH the exact key and the order-insensitive one, so the next meal whose
          // name is these same words in a different order resolves to this image instead of paying
          // for its own. Two tiny rows against one Flux generation is the right trade.
          const keyRows = [...new Set([cacheKey, orderKey])].map(k => ({ meal_key: k, image_url: permanentUrl }))
          const { error: cacheErr } = await db.from('image_cache').upsert(keyRows, { onConflict: 'meal_key' })
          if (cacheErr) console.log('Cache write FAILED:', cacheKey, cacheErr.message)
          else console.log('Cached OK:', cacheKey)
          // Write the fresh URL to trending_meals HERE. This call was missing entirely: a
          // successful generation wrote image_cache and returned, so trending_meals only ever
          // learned the URL on some LATER request via the cache-HIT branch. Until that second
          // request happened, Discover — which reads trending_meals.image directly — showed the
          // fork-and-knife placeholder for a meal whose photo already existed. That is the same
          // symptom 17905c0 was written to kill; it fixed the cache-hit path and left this one.
          await backfillTrendingImage(db, mealName, permanentUrl, isInternal, isInternal && replaceTrending)
          return new Response(JSON.stringify({ image: permanentUrl }), { headers: jsonHeaders })
        }

        // Both upload attempts failed — return the FAL URL so the caller has SOMETHING to render
        // right now, but write NOTHING: not image_cache (a FAL CDN link expires ~24h and the row
        // would serve a 404 forever) and not trending_meals. There used to be a
        // backfillTrendingImage call here; it was dead code, because guard 2 rejects any URL that
        // is not a durable /storage/ one and this branch only ever holds a FAL URL. Dead code that
        // reads like a safety net is worse than none — it is why the missing call on the SUCCESS
        // path above went unnoticed.
        return new Response(JSON.stringify({ image: imageUrl }), { headers: jsonHeaders })
      } catch (e) {
        console.log(`Attempt ${attempt + 1} error:`, e)
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    // All attempts failed — give the user's cap slot back so a failure they must retry
    // doesn't cost them quota.
    if (capConsumed) await refundScan(req, 'image_gen')
    return new Response(JSON.stringify({ image: null }), { headers: jsonHeaders })
  } catch (error) {
    if (capConsumed) await refundScan(req, 'image_gen')
    console.error('[generate-meal-image] error:', (error as Error).message) // detail server-side only
    return new Response(JSON.stringify({ image: null }), { // client only consumes `image`; no raw error
      status: 500, headers: jsonHeaders,
    })
  }
})
