import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'

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

  // Manual auth check — gateway JWT verification is disabled (ES256 incompatibility)
  const user = await verifyUser(req)
  if (!user) return unauthorizedResponse()

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 10, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const { description, existingSteps } = await req.json()
    if (!description?.trim()) {
      return new Response(JSON.stringify({ error: 'Description is required' }), {
        status: 400, headers: { "Content-Type": "application/json" },
      })
    }

    // When existingSteps is provided, we only need prepTime + a short title per step
    // (creator-recipe flow). Skip the full recipe generation.
    const annotateMode = Array.isArray(existingSteps) && existingSteps.length > 0

    const prompt = annotateMode ? `Recipe: "${description}"

The recipe has these existing instruction steps written by the author:
${existingSteps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}

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
