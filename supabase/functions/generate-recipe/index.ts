import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'

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

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 10, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const { description } = await req.json()
    if (!description?.trim()) {
      return new Response(JSON.stringify({ error: 'Description is required' }), {
        status: 400, headers: { "Content-Type": "application/json" },
      })
    }

    const prompt = `Generate a complete recipe for: "${description}"

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
    "Season the chicken with salt and pepper.",
    "Heat oil in a skillet over medium-high heat.",
    "Cook chicken for 6-7 minutes per side."
  ]
}`

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    })

    const data = await response.json()
    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      })
    }

    const text = data.choices?.[0]?.message?.content || "{}"
    const clean = text.replace(/```json|```/g, "").trim()
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
