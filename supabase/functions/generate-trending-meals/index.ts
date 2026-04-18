import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const youtubeKey = Deno.env.get("YOUTUBE_API_KEY")
const groqApiKey = Deno.env.get("GROQ_API_KEY")
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
  // and the total is within a reasonable single-serving range
  if (lookedUp >= ingredients.length / 2 && totalCal >= 200 && totalCal <= 1200) {
    recipe.calories = Math.round(totalCal)
    recipe.protein = Math.round(totalP)
    recipe.carbs = Math.round(totalC)
    recipe.fat = Math.round(totalF)
  }
  return recipe
}

Deno.serve(async (req: Request) => {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 3, 60000)
  if (!allowed) return rateLimitResponse()

  const url = new URL(req.url)
  const forceRefresh = url.searchParams.get('refresh') === 'true'

  // Return cached if already generated today
  if (!forceRefresh) {
    const { data: existing } = await db.from('trending_meals').select('id').eq('generated_at', today()).limit(1)
    if (existing && existing.length > 0) {
      const { data: meals } = await db.from('trending_meals').select('*').eq('generated_at', today()).order('id')
      return new Response(JSON.stringify({ cached: true, meals }), { headers: { 'Content-Type': 'application/json' } })
    }
  }

  if (!youtubeKey) {
    return new Response(JSON.stringify({ error: "No YouTube API key" }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    // Step 1: Search YouTube for today's trending high-protein meal videos
    // Rotate queries by day-of-year so each day gets different search terms
    const allQueries = [
      'high protein meal prep recipe',
      'healthy high protein dinner',
      'high protein lunch ideas',
      'high protein breakfast recipe',
      'high protein snack ideas',
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
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000)
    const searchQueries = Array.from({ length: 3 }, (_, i) => allQueries[(dayOfYear * 3 + i) % allQueries.length])

    // Fetch previous meal names to avoid repeats
    const { data: prevMeals } = await db.from('trending_meals').select('name').neq('generated_at', today())
    const prevNames = (prevMeals || []).map((m: any) => m.name.toLowerCase())

    const allVideos: { title: string; thumbnail: string; description: string }[] = []

    for (const query of searchQueries) {
      // Step 1a: Search for video IDs
      const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&order=relevance&maxResults=5&publishedAfter=${new Date(Date.now() - 7 * 86400000).toISOString()}&key=${youtubeKey}`
      const ytRes = await fetch(ytUrl)
      const ytData = await ytRes.json()

      if (ytData.error) {
        console.log('YouTube search error:', ytData.error.message)
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
          const title = item.snippet.title
          const description = item.snippet.description || ''
          const thumbnail = item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url
          if (!title || !thumbnail) continue
          // Skip videos that are clearly not recipes
          if (/mukbang|asmr|review|what i ate|day of eating|vlog/i.test(title.toLowerCase())) continue
          allVideos.push({ title, thumbnail, description: description.substring(0, 1000) })
        }
      }
    }

    if (allVideos.length === 0) {
      return new Response(JSON.stringify({ error: "No YouTube results" }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    // Deduplicate by title similarity
    const seen = new Set<string>()
    const uniqueVideos = allVideos.filter(v => {
      const key = v.title.toLowerCase().replace(/[^a-z]/g, '').substring(0, 20)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 15)

    console.log(`Found ${uniqueVideos.length} unique YouTube videos`)

    // Step 2: Send video titles + descriptions to Groq to generate accurate recipes
    const videoList = uniqueVideos.map((v, i) => {
      const desc = v.description ? `\n   Description: ${v.description}` : ''
      return `${i + 1}. "${v.title}"${desc}`
    }).join('\n\n')

    const prompt = `Here are ${uniqueVideos.length} trending YouTube recipe videos. Use both the title AND description to understand exactly what the recipe is.

${videoList}

For each one, generate a recipe that ACCURATELY matches what the video describes. Use ingredients and details from the description when available.

RULES:
- The recipe MUST match the video content — use the description to determine exact ingredients and method
- ALL macros and ingredient quantities must be PER SINGLE SERVING (1 person). If the video makes a batch, divide everything down to one portion
- Every recipe MUST have at least 40g protein. If the original recipe is low protein, add a protein source but keep the core dish the same
- Calories between 400-800 per serving
- MACROS MUST BE CALCULATED FROM THE INGREDIENTS. Add up the calories, protein, carbs, and fat from each ingredient at the listed gram weight. The totals MUST match — do not estimate macros separately from ingredients
- If the video isn't clearly a recipe or food, skip it
- Use the actual dish name from the title (cleaned up, no channel name or emoji)
- "visual" = intuitive kitchen portion (e.g. "1 palm-sized piece", "1 fist-sized scoop", "a small handful", "1/2 cup"). NEVER use grams in visual
- "grams" = exact weight in grams (e.g. "150g", "200g"). ALWAYS use grams only

Respond ONLY with a JSON array, no markdown:
[
  {
    "video_index": 1,
    "name": "The actual dish name (cleaned up)",
    "calories": 550,
    "protein": 45,
    "carbs": 40,
    "fat": 18,
    "prepTime": 25,
    "ingredients": [
      { "name": "chicken breast", "visual": "1 palm-sized piece", "grams": "150g" }
    ],
    "steps": [
      { "title": "Short Title", "detail": "Full instruction." }
    ]
  }
]`

    const providers = [
      groqApiKey && { url: "https://api.groq.com/openai/v1/chat/completions", key: groqApiKey, model: "llama-3.3-70b-versatile" },
      openaiApiKey && { url: "https://api.openai.com/v1/chat/completions", key: openaiApiKey, model: "gpt-4o-mini" },
    ].filter(Boolean) as { url: string; key: string; model: string }[]

    let recipes: any[] | null = null

    for (const provider of providers) {
      try {
        const res = await fetch(provider.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${provider.key}` },
          body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 6000 }),
        })
        const data = await res.json()
        if (data.error) continue
        const text = data.choices?.[0]?.message?.content || "[]"
        const clean = text.replace(/```json|```/g, "").trim()
        const parsed = JSON.parse(clean)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const filtered = parsed.filter((r: any) => {
            if (r.protein < 25) return false
            // Skip meals too similar to previous days
            const name = r.name.toLowerCase()
            return !prevNames.some((prev: string) => name.includes(prev.split(' ')[0]) && name.includes(prev.split(' ').slice(-1)[0]))
          }).slice(0, 6)
          if (!recipes || filtered.length > recipes.length) recipes = filtered
          if (recipes.length >= 6) break
        }
      } catch { continue }
    }

    if (!recipes || recipes.length === 0) {
      return new Response(JSON.stringify({ error: "Failed to generate recipes from video titles" }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Step 3: Correct macros using FatSecret nutrition data
    if (fsKey && fsSecret) {
      console.log('Correcting macros via FatSecret...')
      recipes = await Promise.all(recipes.map((r: any) => correctMealMacros(r)))
      // Re-filter after correction — keep meals with at least 25g protein
      recipes = recipes.filter((r: any) => r.protein >= 25)
      console.log(`${recipes.length} meals after macro correction`)
    }

    // Step 4: Match recipes back to YouTube thumbnails
    const meals = recipes.map((r: any) => {
      const videoIdx = (r.video_index || 1) - 1
      const video = uniqueVideos[videoIdx] || uniqueVideos[0]
      return {
        name: r.name,
        calories: r.calories,
        protein: r.protein,
        carbs: r.carbs,
        fat: r.fat,
        prep_time: r.prepTime,
        image: video?.thumbnail || null,
        trend_source: 'YouTube trending',
        ingredients: r.ingredients,
        steps: r.steps,
        generated_at: today(),
      }
    })

    // Clear old and insert
    await db.from('trending_meals').delete().neq('id', '')
    const { error } = await db.from('trending_meals').insert(meals)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    // Generate AI images for trending meals (different style than suggested meals)
    const falApiKey = Deno.env.get("FAL_API_KEY")
    if (falApiKey) {
      console.log('Generating AI images for trending meals...')
      const { data: inserted } = await db.from('trending_meals').select('id, name, ingredients').eq('generated_at', today())
      if (inserted) {
        for (const meal of inserted) {
          try {
            const topIngredients = (meal.ingredients || []).slice(0, 4).map((i: any) => i.name).join(', ')
            const prompt = `Eye-level close-up food photography of ${meal.name} with ${topIngredients}, vivid vibrant colors, shallow depth of field, warm golden natural light, steam rising, fresh ingredients visible, bright and appetizing, food magazine cover style, photorealistic, 8k`

            const res = await fetch("https://fal.run/fal-ai/flux-2", {
              method: "POST",
              headers: { "Authorization": `Key ${falApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ prompt, image_size: "square", num_images: 1, output_format: "jpeg" }),
            })
            const data = await res.json()
            const imageUrl = data.images?.[0]?.url
            if (!imageUrl) { console.log(`No image for ${meal.name}`); continue }

            // Upload to Supabase Storage
            const imageRes = await fetch(imageUrl)
            const blob = await imageRes.blob()
            const filename = `trending-${meal.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}.jpg`
            await db.storage.from('meal-images').upload(filename, blob, { contentType: 'image/jpeg', upsert: true })
            const { data: urlData } = db.storage.from('meal-images').getPublicUrl(filename)

            // Update trending meal with AI image
            await db.from('trending_meals').update({ image: urlData.publicUrl }).eq('id', meal.id)
            console.log(`AI image generated for: ${meal.name}`)

            await new Promise(r => setTimeout(r, 1000)) // Rate limit between generations
          } catch (e) { console.log(`Image gen failed for ${meal.name}:`, e) }
        }
      }
    }

    console.log(`Success: ${meals.length} trending meals from YouTube + Groq`)
    return new Response(JSON.stringify({ generated: true, count: meals.length, meals }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
