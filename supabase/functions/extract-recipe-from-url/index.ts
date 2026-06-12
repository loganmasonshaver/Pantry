import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { requirePremium } from '../_shared/premium.ts'
import { checkScanCap, refundScan, scanCapResponse } from '../_shared/scan-cap.ts'

const openaiApiKey = Deno.env.get("OPENAI_API_KEY")

// Daily per-user ceiling. Scraping social pages is ToS-fragile and each extraction
// ends in a GPT call, so this bounds both cost and abuse of the scrape path.
const URL_EXTRACT_CAP_PER_DAY = 15

// External fetches (YouTube watch page, oEmbed proxies, OpenAI) can hang indefinitely
// and force-kill the whole function past the edge runtime limit. A per-call ceiling
// fails cleanly instead. Default 10s suits the scrape/oEmbed hops; AI call passes 30s.
async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 10000): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

// Detect platform from URL
function detectPlatform(url: string): 'youtube' | 'tiktok' | null {
  if (/youtu\.?be/.test(url)) return 'youtube'
  if (/tiktok\.com/.test(url)) return 'tiktok'
  return null
}

// Extract YouTube video ID from various URL formats
function extractYouTubeId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)
  return match?.[1] ?? null
}

// Fetch YouTube content — three-tier fallback chain. Captions are the richest source
// (full recipe spoken in the video), but only present on ~30% of cooking videos.
// Description falls back to title-only via oEmbed/noembed which still gives GPT enough
// to construct a "most likely" recipe from cooking-knowledge priors.
async function getYouTubeContent(videoId: string): Promise<string | null> {
  // Approach 1: Scrape captions from the watch page HTML. YouTube embeds a JSON blob
  // with captionTracks[].baseUrl pointing to the XML transcript. Requires a real browser
  // UA — bare fetches get a 429 or cookie-consent wall.
  try {
    const html = await fetchWithTimeout(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }).then(r => r.text())

    // Try caption tracks
    const captionMatch = html.match(/"captionTracks":\[.*?"baseUrl":"(.*?)"/)
    if (captionMatch) {
      // YouTube escapes & as & in the JSON blob — must un-escape before fetching
      const captionUrl = captionMatch[1].replace(/\\u0026/g, '&')
      const xml = await fetchWithTimeout(captionUrl).then(r => r.text())
      const lines = [...xml.matchAll(/<text[^>]*>(.*?)<\/text>/gs)].map(m =>
        m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      )
      const transcript = lines.join(' ')
      if (transcript.length > 50) return transcript
    }

    // Try video description from page
    const descMatch = html.match(/"shortDescription":"(.*?)"/)
    if (descMatch) {
      const desc = descMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
      if (desc.length > 30) return desc
    }
  } catch { /* continue to fallback */ }

  // Approach 2: YouTube oEmbed for title
  try {
    const oembedResp = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    )
    if (oembedResp.ok) {
      const oembed = await oembedResp.json()
      if (oembed.title) return `YouTube Recipe Video: ${oembed.title}`
    }
  } catch { /* continue */ }

  // Approach 3: noembed.com (free proxy)
  try {
    const noembedResp = await fetchWithTimeout(
      `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`
    )
    if (noembedResp.ok) {
      const noembed = await noembedResp.json()
      if (noembed.title) return `YouTube Recipe Video: ${noembed.title}`
    }
  } catch { /* continue */ }

  return null
}

// Fetch TikTok caption via oEmbed API
async function getTikTokCaption(url: string): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`)
    if (!resp.ok) return null
    const data = await resp.json()
    // Combine title and author for more context
    const parts = []
    if (data.title) parts.push(data.title)
    if (data.author_name) parts.push(`by ${data.author_name}`)
    return parts.join(' ') || null
  } catch {
    return null
  }
}

// Send extracted text to GPT-4o-mini for structured recipe extraction
async function extractRecipeFromText(text: string, sourceUrl: string): Promise<Record<string, unknown>> {
  const prompt = `Extract a recipe from this social media video content. The text below may be a transcript, caption, video title, or description. Use whatever information is available to construct a complete recipe.

If only a title/caption is provided (e.g. "Easy Chicken Stir Fry"), use your cooking knowledge to create the most likely version of that recipe with accurate ingredients, steps, and macros.

Source URL: ${sourceUrl}

Content:
"""
${text.slice(0, 4000)}
"""

Rules:
- Create a complete, practical recipe
- Estimate accurate macros per serving (calories, protein, carbs, fat)
- Estimate prep time in minutes
- Each ingredient must have a visual portion (e.g. "1 cup") and gram weight
- Steps should be clear and concise

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "name": "Recipe Name",
  "prepTime": 25,
  "calories": 500,
  "protein": 45,
  "carbs": 40,
  "fat": 15,
  "ingredients": [
    { "name": "chicken breast", "visual": "1 palm-sized piece", "grams": "150g" }
  ],
  "steps": [
    "Season the chicken with salt and pepper.",
    "Heat oil in a skillet over medium-high heat."
  ]
}`

  const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,     // moderate variety — recipe reconstructions benefit from some creativity when source is sparse
      max_tokens: 2000,     // full recipe JSON with 8+ ingredients and 6+ steps fits comfortably
    }),
  }, 30000) // AI call gets a longer ceiling than the scrape hops

  const data = await response.json()
  if (data.error) throw new Error(data.error.message)

  const raw = data.choices?.[0]?.message?.content || "{}"
  const clean = raw.replace(/```json|```/g, "").trim()
  return JSON.parse(clean)
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

  // Rate-limit by the authenticated user id (un-spoofable) instead of a client-padded IP.
  const { allowed } = rateLimit(`u:${user.id}`, 10, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const { url } = await req.json()
    if (!url?.trim()) {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
        status: 400, headers: { "Content-Type": "application/json" },
      })
    }

    const platform = detectPlatform(url)
    if (!platform) {
      return new Response(JSON.stringify({ error: 'Unsupported platform. Please use a YouTube or TikTok link.' }), {
        status: 400, headers: { "Content-Type": "application/json" },
      })
    }

    // Daily cap gate — checked after URL/platform validation so malformed links don't
    // burn a slot. Atomic check+increment; refunded below on no-content and error paths.
    const { allowed, used } = await checkScanCap(req, 'url_extract', URL_EXTRACT_CAP_PER_DAY)
    if (!allowed) {
      console.log(`[extract-recipe] daily cap hit: ${used}/${URL_EXTRACT_CAP_PER_DAY}`)
      return scanCapResponse(URL_EXTRACT_CAP_PER_DAY)
    }

    // Extract text content based on platform
    let text: string | null = null

    if (platform === 'youtube') {
      const videoId = extractYouTubeId(url)
      if (!videoId) {
        return new Response(JSON.stringify({ error: 'Could not parse YouTube video ID' }), {
          status: 400, headers: { "Content-Type": "application/json" },
        })
      }
      text = await getYouTubeContent(videoId)
    } else if (platform === 'tiktok') {
      text = await getTikTokCaption(url)
    }

    if (!text || text.trim().length < 5) {
      await refundScan(req, 'url_extract') // nothing extracted — don't charge the user's slot
      return new Response(JSON.stringify({ error: 'Could not extract content from this video. Try a different link.' }), {
        status: 422, headers: { "Content-Type": "application/json" },
      })
    }

    // Send to GPT for structured recipe extraction
    const recipe = await extractRecipeFromText(text, url)

    return new Response(JSON.stringify(recipe), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    await refundScan(req, 'url_extract') // scrape/AI/parse failure after increment — refund
    console.error('[extract-recipe-from-url] error:', (error as Error).message) // detail server-side only
    return new Response(
      JSON.stringify({ error: "Could not extract recipe" }), // generic — don't leak internals
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
