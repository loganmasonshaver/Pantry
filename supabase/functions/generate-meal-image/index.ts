import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { verifyUser } from '../_shared/auth.ts'
import { checkScanCap, refundScan, scanCapResponse } from '../_shared/scan-cap.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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

// Stage 1 of the two-stage Flux pipeline: ask an LLM to describe how the FINISHED dish
// looks when plated. Without this, Flux gets a generic "professional food photo of {name}"
// template and has to guess the visual form — which is why fusion dishes (cottage cheese
// brownie) end up as stacked components and cold dishes get steam plumes. Gemini Flash
// Lite is essentially free; OpenAI fallback is cheap. If both fail, the caller falls back
// to the original static template so image generation never hard-stops.
async function generateVisualDescription(mealName: string, ingredients: string[], steps: string[] = []): Promise<string | null> {
  const sysPrompt = `You are a food stylist. In ONE concise sentence (under 50 words), describe how the FINISHED dish appears when photographed for a recipe blog. Include: the dish visual form (color, texture, structure), the vessel it is served in (glass / bowl / plate / board / ramekin), and natural garnish if appropriate.

CRITICAL — INGREDIENT FIDELITY: Compose the description from the SPECIFIC ingredients listed. If the dish name is generic (e.g., "Fruit", "Bowl", "Plate"), use the exact ingredient (e.g., "sliced apple" not "berries"). NEVER substitute photogenic alternatives or generic interpretations of the name.

COVERAGE — every visible ingredient must appear: After applying the visibility rules below, EVERY ingredient that ends up visible on the plate MUST be named in the description. Do not silently drop ingredients for brevity. If 6+ ingredients are visible, briefly list them all (it's fine to extend the sentence). Do not invent ingredients that aren't listed (e.g., microgreens, herbs) unless the recipe explicitly includes them.

ASSEMBLED, NOT STACKED: Describe the dish AS PLATED — fully assembled, integrated, ready to eat. Never describe separate visible components (e.g., a brownie with cottage cheese baked in, NOT cottage cheese piled on top of a brownie). Do NOT mention cooking process.

READ THE STEPS FOR INGREDIENT ROLES: If recipe steps are provided, use them to determine each ingredient's role in the finished plate. An ingredient that is mashed, blended, mixed, stirred, folded, dissolved, melted, whisked, or otherwise incorporated INTO another component is INVISIBLE in the photo — do NOT depict it as a separate dollop, drizzle, swirl, sprinkle, or pile. Only ingredients that are plated separately, served on top, used as garnish, or remain as recognizable solids should appear visually.

Examples:
- "Cottage Cheese Brownie Bake" (ingredients: cottage cheese, cocoa, eggs) -> "A dense baked chocolate brownie square with a slightly cracked golden top, served on a wooden cutting board."
- "Strawberry Protein Smoothie" (ingredients: strawberries, yogurt, protein powder; steps: blend everything until smooth) -> "A thick pink smoothie in a tall clear glass, topped with a single strawberry slice."
- "Greek Chicken Salad" (ingredients: chicken, greens, feta, olives) -> "A wide ceramic bowl of mixed greens with grilled chicken slices, feta crumbles, and olives, drizzled with olive oil."
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  let capConsumed = false // track whether we incremented the per-user cap, so we can refund on failure
  try {
    const { mealName, ingredients = [], steps = [] } = await req.json()
    if (!mealName) return new Response(JSON.stringify({ image: null }), { headers: jsonHeaders })

    // Normalize steps to a string array — accepts either ["raw text"] or [{title, detail}]
    const stepStrings: string[] = Array.isArray(steps)
      ? steps.map((s: any) => typeof s === 'string' ? s : (s?.detail ?? s?.title ?? '')).filter(Boolean)
      : []

    const cacheKey = normalizeKey(mealName)
    const legacyKey = legacyNormalizeKey(mealName)

    // Check DB cache FIRST (free, no auth) — globally-cached images are shared across all
    // users, so serving a hit costs nothing and preserves pre-auth use (e.g. onboarding).
    // Always cache-first: no client bypass, so a user can't force credit spend to drain quota.
    //
    // Two keys are checked: the tightened one, plus the pre-tightening key so images stored under
    // the old scheme still resolve. A legacy hit is backfilled under the new key, so each old entry
    // costs one extra lookup exactly once and the library migrates itself instead of being re-paid for.
    const lookupKeys = legacyKey && legacyKey !== cacheKey ? [cacheKey, legacyKey] : [cacheKey]
    const { data: cachedRows } = await db.from('image_cache').select('meal_key, image_url').in('meal_key', lookupKeys)
    const hit = cachedRows?.find((r: any) => r.meal_key === cacheKey) ?? cachedRows?.[0]
    if (hit?.image_url) {
      if (hit.meal_key !== cacheKey) {
        const { error: backfillErr } = await db.from('image_cache').upsert({ meal_key: cacheKey, image_url: hit.image_url }, { onConflict: 'meal_key' })
        if (backfillErr) console.log('Backfill FAILED:', cacheKey, backfillErr.message)
      }
      return new Response(JSON.stringify({ image: hit.image_url }), { headers: jsonHeaders })
    }

    // Cache MISS = we're about to spend FAL/LLM credits. Require a logged-in user so
    // anonymous callers can't drain image-generation credits by enumerating meal names.
    // Exception: the trending-meals cron is a trusted server-side caller that authenticates
    // with the service-role key (it has no user JWT). Its meal names are freshly generated =
    // always a cache miss, so without this bypass every new trending meal 401s and is left on
    // its YouTube-thumbnail fallback — the real cause of the all-YT Discover feed.
    // Match the same internal-auth tokens generate-trending-meals accepts: CRON_SECRET (the
    // dedicated, reliable shared secret) preferred, SUPABASE_SERVICE_ROLE_KEY as fallback.
    const cronSecret = Deno.env.get("CRON_SECRET") ?? ""
    const authToken = (req.headers.get('Authorization') ?? req.headers.get('authorization') ?? '')
      .replace(/^Bearer\s+/i, '').trim()
    const isInternal = (cronSecret !== '' && authToken === cronSecret) ||
                       (supabaseServiceKey !== '' && authToken === supabaseServiceKey)
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
      // STAGE 2 (preferred): description-led prompt with photography direction layered on.
      // The negative-prompt trailer is embedded in the prompt body since Flux 2's API
      // doesn't accept a separate negative_prompt field — this is best-effort guidance.
      prompt = `${description}. Professional overhead or 3/4-angle food photography, natural daylight from upper left, sharp focus on subject, shallow depth of field, shot on Sony A7R IV with 50mm f/2.8 prime, photorealistic raw photo aesthetic, soft natural shadows. Negative prompt: text, watermark, logo, signage, label, blurry, oversaturated, artificial steam plume, cartoon, illustration, plastic-looking, stacked separate components, hallucinated ingredients not in the dish, weird AI artifacts, multiple plates, deconstructed.`
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
      prompt = `Professional food photography of ${mealName}${ingredientList}, served in a ${vessel}, complete and fully assembled exactly as served in a restaurant — glossy saucy finish with sauces fully integrated into the food (never in separate bowls or jars), sheen and moisture visible, rich saturated colors, no side dishes, no garnish props, no extra vessels, dark moody background, warm moody restaurant lighting, sharp focus, appetizing, photorealistic`
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
            image_size: "square",
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
          const permanentUrl = urlData.publicUrl
          const { error: cacheErr } = await db.from('image_cache').upsert({ meal_key: cacheKey, image_url: permanentUrl }, { onConflict: 'meal_key' })
          if (cacheErr) console.log('Cache write FAILED:', cacheKey, cacheErr.message)
          else console.log('Cached OK:', cacheKey)
          return new Response(JSON.stringify({ image: permanentUrl }), { headers: jsonHeaders })
        }

        // Both upload attempts failed — return the FAL URL so the caller has SOMETHING
        // to render right now, but skip the cache write so the next request retries
        // from scratch instead of pinning everyone to a soon-to-expire URL.
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
