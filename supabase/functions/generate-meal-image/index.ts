import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const falApiKey = Deno.env.get("FAL_API_KEY")
const googleAiKey = Deno.env.get("GOOGLE_AI_KEY")
const openaiApiKey = Deno.env.get("OPENAI_API_KEY")
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const db = createClient(supabaseUrl, supabaseServiceKey)

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

// Stage 1 of the two-stage Flux pipeline: ask an LLM to describe how the FINISHED dish
// looks when plated. Without this, Flux gets a generic "professional food photo of {name}"
// template and has to guess the visual form — which is why fusion dishes (cottage cheese
// brownie) end up as stacked components and cold dishes get steam plumes. Gemini Flash
// Lite is essentially free; OpenAI fallback is cheap. If both fail, the caller falls back
// to the original static template so image generation never hard-stops.
async function generateVisualDescription(mealName: string, ingredients: string[]): Promise<string | null> {
  const sysPrompt = `You are a food stylist. In ONE concise sentence (under 35 words), describe how the FINISHED dish appears when photographed for a recipe blog. Include: the dish visual form (color, texture, structure), the vessel it is served in (glass / bowl / plate / board / ramekin), and natural garnish if appropriate. Do NOT list ingredients. Do NOT mention cooking process.

Examples:
- "Cottage Cheese Brownie Bake" -> "A dense baked chocolate brownie square with a slightly cracked golden top, served on a wooden cutting board."
- "Strawberry Protein Smoothie" -> "A thick pink smoothie in a tall clear glass, topped with a yogurt swirl and a strawberry slice."
- "Greek Chicken Salad" -> "A wide ceramic bowl of mixed greens with grilled chicken slices, feta crumbles, and olives, drizzled with olive oil."`

  const userPrompt = `Now describe: ${mealName}${ingredients.length ? ` — ingredients: ${ingredients.join(', ')}` : ''}`

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
          max_tokens: 120,
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

  // No auth required — images are globally cached (shared across all users).
  // The global Supabase image_cache table means one user's generation benefits everyone.
  // IP rate limiting below is sufficient to prevent abuse.
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 15, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const { mealName, ingredients = [] } = await req.json()
    if (!mealName) return new Response(JSON.stringify({ image: null }), { headers: jsonHeaders })

    const cacheKey = normalizeKey(mealName)

    // Check DB cache — use Supabase Storage URLs (permanent, no expiry)
    const { data: cached } = await db.from('image_cache').select('image_url').eq('meal_key', cacheKey).single()
    if (cached?.image_url) {
      return new Response(JSON.stringify({ image: cached.image_url }), { headers: jsonHeaders })
    }

    if (!falApiKey) {
      console.log('FAL_API_KEY is missing or empty')
      return new Response(JSON.stringify({ image: null, error: 'no FAL key' }), { headers: jsonHeaders })
    }

    // STAGE 1: ask an LLM to visually describe the finished dish. If it succeeds we use
    // that as the basis for the Flux prompt; if it fails we fall back to a static template
    // built from keyword heuristics so image generation never hard-stops.
    const description = await generateVisualDescription(mealName, ingredients)

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
          upsert: true,
        })
        if (uploadErr) {
          console.log('Storage upload attempt 1 failed:', uploadErr.message, '— retrying in 1.5s')
          await new Promise(r => setTimeout(r, 1500))
          const retry = await db.storage.from('meal-images').upload(filename, blob, {
            contentType: 'image/jpeg',
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

    return new Response(JSON.stringify({ image: null }), { headers: jsonHeaders })
  } catch (error) {
    return new Response(JSON.stringify({ image: null, error: (error as Error).message }), {
      status: 500, headers: jsonHeaders,
    })
  }
})
