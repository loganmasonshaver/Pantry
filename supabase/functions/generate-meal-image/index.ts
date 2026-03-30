import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const replicateToken = Deno.env.get("REPLICATE_API_TOKEN")
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

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 20, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const { mealName, ingredients = [] } = await req.json()
    if (!mealName) return new Response(JSON.stringify({ image: null }), { headers: jsonHeaders })

    const cacheKey = normalizeKey(mealName)

    // Check DB cache — verify URL is still valid
    const { data: cached, error: cacheReadErr } = await db.from('image_cache').select('image_url').eq('meal_key', cacheKey).single()
    console.log('Cache read:', cacheKey, cached ? 'HIT' : 'MISS', cacheReadErr?.message ?? '')
    if (cached?.image_url) {
      // Verify the URL hasn't expired (Replicate URLs can expire)
      try {
        const check = await fetch(cached.image_url, { method: 'HEAD' })
        if (check.ok) {
          return new Response(JSON.stringify({ image: cached.image_url }), { headers: jsonHeaders })
        }
        // URL expired — delete stale cache entry and regenerate
        console.log('Cache expired:', cacheKey)
        await db.from('image_cache').delete().eq('meal_key', cacheKey)
      } catch {
        await db.from('image_cache').delete().eq('meal_key', cacheKey)
      }
    }

    if (!replicateToken) return new Response(JSON.stringify({ image: null }), { headers: jsonHeaders })

    const prompt = `Hyperrealistic professional food photography of ${mealName}${ingredients.length ? ` made with ${ingredients.join(', ')}` : ''}. ONLY show these exact ingredients, nothing else. Overhead shot on a dark plate, restaurant quality, warm natural lighting, sharp focus, photorealistic, 8k`

    // Try up to 3 times to create and poll a prediction
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", {
          method: "POST",
          headers: { Authorization: `Bearer ${replicateToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ input: { prompt, num_outputs: 1, aspect_ratio: "16:9", output_format: "webp", output_quality: 80 } }),
        })
        const prediction = await res.json()

        // Direct output (unlikely but handle it)
        if (prediction.output?.[0]) {
          const { error: ce } = await db.from('image_cache').upsert({ meal_key: cacheKey, image_url: prediction.output[0] })
          console.log('Cache save (direct):', cacheKey, ce?.message ?? 'OK')
          return new Response(JSON.stringify({ image: prediction.output[0] }), { headers: jsonHeaders })
        }

        // No polling URL — Replicate returned an error, retry
        if (!prediction.urls?.get) {
          console.log(`Attempt ${attempt + 1}: no polling URL, status=${prediction.status}, error=${JSON.stringify(prediction.error)}`)
          await new Promise(r => setTimeout(r, 2000))
          continue
        }

        // Poll for completion
        let result = prediction
        for (let poll = 0; poll < 100; poll++) {
          await new Promise(r => setTimeout(r, 500))
          const pollRes = await fetch(result.urls.get, {
            headers: { Authorization: `Bearer ${replicateToken}` },
          })
          result = await pollRes.json()
          if (result.status === "succeeded" || result.status === "failed") break
        }

        if (result.output?.[0]) {
          const { error: cacheErr } = await db.from('image_cache').upsert({ meal_key: cacheKey, image_url: result.output[0] })
          if (cacheErr) console.log('Cache save error:', cacheErr.message)
          else console.log('Cached:', cacheKey)
          return new Response(JSON.stringify({ image: result.output[0] }), { headers: jsonHeaders })
        }

        // Failed — retry
        console.log(`Attempt ${attempt + 1}: prediction ended with status=${result.status}`)
        await new Promise(r => setTimeout(r, 2000))
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
