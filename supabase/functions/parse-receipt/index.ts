import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'

const openaiApiKey = Deno.env.get("OPENAI_API_KEY")
const googleAiKey  = Deno.env.get("GOOGLE_AI_KEY")

const RECEIPT_PROMPT = `This is a grocery receipt. Extract every food or grocery item purchased.
For each item, return a JSON array with objects: { "name": string, "category": string }

CRITICAL — Name format rules:
- Always use the GENERIC ingredient name, never the brand name.
  ✓ "Whole Milk" not "Horizon Whole Milk"
  ✓ "Chicken Breast" not "Perdue Chicken Breast"
  ✓ "Greek Yogurt" not "Chobani Greek Yogurt"
  ✓ "Pasta" not "Barilla Pasta"
  ✓ "Cheddar Cheese" not "Tillamook Cheddar Cheese"
- Strip all brand names, store names, and retailer prefixes.
- Strip size/weight info and item codes.
- Use plain descriptive names (e.g. "Sliced Bread", "Brown Rice", "Baby Spinach").

Categories must be one of: Protein, Carbs, Produce, Condiments, Dairy, Pantry Staples, Other.
- Protein: meat, fish, eggs, beans, tofu
- Carbs: bread, pasta, rice, cereals, flour
- Produce: fruits, vegetables, herbs
- Condiments: sauces, oils, spices, dressings
- Dairy: milk, cheese, yogurt, butter
- Pantry Staples: canned goods, broth, baking items
- Other: anything else that doesn't fit

Only include actual food/grocery items. Skip non-food items, fees, taxes, and totals.
Return ONLY the raw JSON array, no markdown, no explanation.`

async function parseWithGemini(base64: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleAiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64 } },
            { text: RECEIPT_PROMPT },
          ],
        }],
        generationConfig: { maxOutputTokens: 1000 },
      }),
    }
  )
  const data = await res.json()
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error))
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]"
}

async function parseWithOpenAI(base64: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "high" } },
          { type: "text", text: RECEIPT_PROMPT },
        ],
      }],
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error))
  return data.choices?.[0]?.message?.content?.trim() ?? "[]"
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

  const user = await verifyUser(req)
  if (!user) return unauthorizedResponse()

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 10, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const { base64 } = await req.json()
    if (!base64) {
      return new Response(JSON.stringify({ error: "No image provided" }), { status: 400 })
    }

    // Gemini Flash primary (cheaper, receipt = structured text — quality identical)
    // GPT-4o fallback if Gemini key missing or fails
    let text: string
    if (googleAiKey) {
      try {
        text = await parseWithGemini(base64)
      } catch (e) {
        console.warn("Gemini failed, falling back to GPT-4o:", e)
        text = await parseWithOpenAI(base64)
      }
    } else {
      text = await parseWithOpenAI(base64)
    }

    const clean = text.replace(/```json|```/g, "").trim()
    const items = JSON.parse(clean)

    return new Response(JSON.stringify(items), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
