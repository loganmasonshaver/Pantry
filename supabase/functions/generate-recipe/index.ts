import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { requirePremium } from '../_shared/premium.ts'
import { sanitizeStr, sanitizeList } from '../_shared/sanitize.ts'
import { checkScanCap, scanCapResponse } from '../_shared/scan-cap.ts'

const openaiApiKey = Deno.env.get("OPENAI_API_KEY")

// Durable per-user daily ceiling. The in-memory rate-limit below is only per-isolate burst
// protection (resets on cold start), so on its own it's not a real abuse cap. Recipe gen is
// a deliberate action (creating/importing a recipe) — 30/day never bothers a real user but
// blocks someone scripting the cheap gpt-4o-mini call all day. Backed by the same DB RPC as
// the vision scan caps; fails open on infra error.
const RECIPE_GEN_CAP_PER_DAY = 30

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

  // Durable daily cap (DB-backed) — the real abuse ceiling, atomic check+increment.
  const { allowed: underCap, used } = await checkScanCap(req, 'recipe_gen', RECIPE_GEN_CAP_PER_DAY)
  if (!underCap) {
    console.log(`[generate-recipe] daily cap hit: ${used}/${RECIPE_GEN_CAP_PER_DAY}`)
    return scanCapResponse(RECIPE_GEN_CAP_PER_DAY)
  }

  try {
    const { description: rawDescription, existingSteps: rawSteps } = await req.json()
    if (!rawDescription?.trim()) {
      return new Response(JSON.stringify({ error: 'Description is required' }), {
        status: 400, headers: { "Content-Type": "application/json" },
      })
    }
    // Strip quotes/newlines + cap length before either field hits the prompt. This is the
    // creator-import path — submitted text can be shown to other users — so unsanitized
    // input here is a prompt-injection surface, not just a formatting nuisance. Generous
    // caps: a recipe name/blurb fits in 1000 chars, an instruction step in 500.
    const description = sanitizeStr(rawDescription, 1000)
    const existingSteps = sanitizeList(rawSteps, 40, 500)

    // Two modes — full recipe gen vs annotate-existing.
    // Annotate mode handles the creator-import path: a creator submits a recipe with their
    // own instructions; we only need to add step titles + estimate prepTime, not rewrite the
    // recipe. Skipping full gen here preserves the creator's voice and avoids macro drift.
    const annotateMode = existingSteps.length > 0

    const prompt = annotateMode ? `Recipe: "${description}"

The recipe has these existing instruction steps written by the author:
${existingSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Generate (a) a short 2-4 word title for each step that captures what the step does, and
(b) an estimated total prep + cook time in minutes for the whole recipe.

Title rules: Title Case, no period, action-oriented (e.g. "Sear Chicken", "Whisk Eggs", "Bake & Cool"). Match titles to the steps in order — return exactly ${existingSteps.length} titles.

Respond ONLY with valid JSON, no markdown:
{
  "prepTime": 25,
  "titles": ["Title One", "Title Two", "Title Three"]
}` : `Generate a complete recipe for: "${description}"

Rules:
- Create a practical, real recipe that people actually cook
- Include accurate macro estimates per serving
- Each ingredient must have both a visual portion size AND gram weight
- Steps should be clear and concise
- Only suggest real, coherent meals — no bizarre combinations

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
    { "title": "Season Chicken", "detail": "Season the chicken with salt and pepper." },
    { "title": "Heat Pan", "detail": "Heat oil in a skillet over medium-high heat." },
    { "title": "Cook Chicken", "detail": "Cook chicken for 6-7 minutes per side until golden." }
  ]
}`

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // cheaper model; recipe generation doesn't need vision or top-tier reasoning
        messages: [{ role: "user", content: prompt }],
        temperature: annotateMode ? 0.3 : 0.7, // titles want consistency; full recipes want variety
        max_tokens: annotateMode ? 500 : 2000,
      }),
    })

    const data = await response.json()
    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      })
    }

    const text = data.choices?.[0]?.message?.content || "{}"
    const clean = text.replace(/```json|```/g, "").trim() // GPT sometimes wraps JSON in markdown code fences despite instructions
    const recipe = JSON.parse(clean)

    return new Response(JSON.stringify(recipe), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
