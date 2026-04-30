import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const falApiKey = Deno.env.get("FAL_API_KEY")
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const db = createClient(supabaseUrl, supabaseServiceKey)

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
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

    // Build prompt with ingredients for visual accuracy.
    // Filter out sauces/oils/seasonings from the ingredient list — the model treats
    // them as separate plated items (bowls of oil next to the dish) instead of integrating
    // them into the food. They're emphasized via "glossy, sauced" language instead.
    const sauceKeywords = ['oil', 'sauce', 'vinegar', 'dressing', 'syrup', 'butter', 'seasoning', 'spice', 'paste', 'glaze', 'marinade', 'mayo', 'mayonnaise', 'ketchup', 'mustard', 'sriracha', 'soy sauce']
    const visibleIngredients = ingredients.filter((i: string) => {
      const lower = i.toLowerCase()
      return !sauceKeywords.some(k => lower.includes(k))
    })
    const ingredientList = visibleIngredients.length ? ` with ${visibleIngredients.join(', ')}` : ''
    const prompt = `Professional food photography of ${mealName}${ingredientList}, complete and fully assembled dish exactly as served in a restaurant — buns on burgers, tortillas on tacos and wraps, rice in bowls, pasta in dishes — dark ceramic plate or appropriate vessel, glossy saucy finish with sauces fully integrated into the food (never in separate bowls or jars), sheen and moisture visible, rich saturated colors, no side dishes, no garnish props, no extra bowls, dark moody background, warm moody restaurant lighting, sharp focus, appetizing, photorealistic`

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

        // Upload to Supabase Storage for permanent caching
        const imageRes = await fetch(imageUrl)
        const blob = await imageRes.blob()
        const filename = `${cacheKey.replace(/\s+/g, '-')}.jpg`

        const { error: uploadErr } = await db.storage.from('meal-images').upload(filename, blob, {
          contentType: 'image/jpeg',
          upsert: true,
        })

        let permanentUrl = imageUrl // fallback to FAL URL if upload fails
        if (!uploadErr) {
          const { data: urlData } = db.storage.from('meal-images').getPublicUrl(filename)
          permanentUrl = urlData.publicUrl
        } else {
          console.log('Storage upload failed, using FAL URL:', uploadErr.message)
        }

        // Cache in DB
        const { error: cacheErr } = await db.from('image_cache').upsert({ meal_key: cacheKey, image_url: permanentUrl }, { onConflict: 'meal_key' })
        if (cacheErr) console.log('Cache write FAILED:', cacheKey, cacheErr.message)
        else console.log('Cached OK:', cacheKey)

        return new Response(JSON.stringify({ image: permanentUrl }), { headers: jsonHeaders })
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
