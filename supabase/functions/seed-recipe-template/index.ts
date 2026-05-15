// One-shot admin function for seeding lib/recipeTemplates.ts via Gemini.
// No user auth (rate-limited per IP). Designed to be deployed, called 94 times by
// scripts/seed_recipe_templates.py, then deleted. Uses the existing GOOGLE_AI_KEY
// from Supabase secrets so we never have to extract or share the API key locally.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'

const googleAiKey = Deno.env.get("GOOGLE_AI_KEY")

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function buildPrompt(name: string): string {
  return `Generate a complete recipe for: "${name}"

This is the BASE 1-serving template. The app scales it linearly to each user's
per-meal calorie target. Aim for ~500 kcal as the base serving size.

Rules:
- Real, practical recipe people actually cook
- Include realistic per-serving macros for the base 500 kcal target
- Steps: 3-7 concise instructions, each as a {title, detail} pair
- Title is 2-4 words, action-oriented (e.g. "Sear Chicken", "Whisk Eggs")
- No weird combinations, no diet/punishment framing

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "name": "${name}",
  "prepTime": 20,
  "calories": 500,
  "protein": 40,
  "carbs": 35,
  "fat": 18,
  "ingredients": [
    { "name": "chicken breast", "visual": "1 palm-sized piece", "grams": "150g" }
  ],
  "steps": [
    { "title": "Season Chicken", "detail": "Season the chicken with salt and pepper." }
  ]
}`
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: jsonHeaders })
  }

  if (!googleAiKey) {
    return new Response(JSON.stringify({ error: "GOOGLE_AI_KEY not configured" }), {
      status: 500, headers: jsonHeaders,
    })
  }

  // Generous rate limit — script paces itself but allow burst recovery
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 30, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const { mealName } = await req.json()
    if (!mealName || typeof mealName !== 'string') {
      return new Response(JSON.stringify({ error: "mealName required" }), { status: 400, headers: jsonHeaders })
    }

    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${googleAiKey}`,
      },
      body: JSON.stringify({
        model: "gemini-3.1-flash-lite",
        messages: [{ role: "user", content: buildPrompt(mealName) }],
        temperature: 0.6,
        max_tokens: 1500,
      }),
    })

    if (!r.ok) {
      const errText = await r.text()
      return new Response(JSON.stringify({ error: `Gemini ${r.status}: ${errText.slice(0, 300)}` }), {
        status: 500, headers: jsonHeaders,
      })
    }

    const data = await r.json()
    const text = data?.choices?.[0]?.message?.content ?? "{}"
    const clean = text.replace(/```json|```/g, "").trim()
    const recipe = JSON.parse(clean)

    return new Response(JSON.stringify(recipe), { headers: jsonHeaders })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: jsonHeaders,
    })
  }
})
