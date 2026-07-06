import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { sanitizeStr, sanitizeList } from '../_shared/sanitize.ts'

const googleAiKey = Deno.env.get("GOOGLE_AI_KEY")
const openaiApiKey = Deno.env.get("OPENAI_API_KEY")

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    })
  }

  const user = await verifyUser(req)
  if (!user) return unauthorizedResponse()

  // Key the limit on the authenticated user, not IP — ties cost to identity and stops
  // users behind a shared NAT from starving each other's bucket.
  const { allowed } = rateLimit(user.id, 60, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const { name: rawName, categories: rawCategories } = await req.json()
    if (!rawName || typeof rawName !== 'string' || !Array.isArray(rawCategories) || rawCategories.length === 0) {
      return new Response(JSON.stringify({ error: "name and categories[] required" }), { status: 400 })
    }
    // Sanitize before interpolation — item name and the category list are both caller-supplied.
    const name = sanitizeStr(rawName, 80)
    const categories = sanitizeList(rawCategories, 30, 40)
    if (!name || categories.length === 0) {
      return new Response(JSON.stringify({ error: "name and categories[] required" }), { status: 400 })
    }

    const prompt = `You are categorizing a grocery item for a pantry app. The user may have typed a misspelling — interpret what they meant.

Item: "${name}"

Categories (pick exactly one): ${categories.join(', ')}

Rules:
- Return ONLY the category name, exactly as listed, no other text.
- If the item is misspelled (e.g. "avacodo" → avocado, "chickn" → chicken), categorize based on the intended item.
- If the item doesn't fit any specific category, return "Other".

Category:`

    // Gemini Flash Lite first (free + commercial-OK), OpenAI mini as paid fallback.
    // Gemini exposes an OpenAI-compatible endpoint so both providers share the same body shape.
    const providers = [
      googleAiKey && { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: googleAiKey, model: "gemini-3.1-flash-lite" },
      openaiApiKey && { url: "https://api.openai.com/v1/chat/completions", key: openaiApiKey, model: "gpt-4o-mini" },
    ].filter(Boolean) as { url: string; key: string; model: string }[]

    for (const p of providers) {
      try {
        const res = await fetch(p.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${p.key}` },
          body: JSON.stringify({
            model: p.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0,        // deterministic — categorization should always pick the same bucket for the same input
            max_tokens: 20,        // category names are 1-2 words; 20 tokens is plenty and caps cost
          }),
        })
        const data = await res.json()
        if (data.error) continue   // try next provider on API error (quota, transient 5xx, etc.)
        const text = (data.choices?.[0]?.message?.content ?? "").trim()
        // Strict case-insensitive match against the caller-supplied category list. If the LLM
        // returns anything else (hallucinated category, prose, refusal), fall back to 'Other'.
        const matched = categories.find((c: string) => c.toLowerCase() === text.toLowerCase()) ?? 'Other'
        return new Response(JSON.stringify({ category: matched }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        })
      } catch {
        continue
      }
    }

    return new Response(JSON.stringify({ category: 'Other' }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
