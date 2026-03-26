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
  const { allowed } = rateLimit(ip, 15, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const { mode, description, base64 } = await req.json()

    let messages: any[]

    if (mode === "photo" && base64) {
      messages = [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "high" },
            },
            {
              type: "text",
              text: `Estimate the macros for the meal in this photo.
Return ONLY a JSON object with these fields:
{ "name": string, "calories": number, "protein": number, "carbs": number, "fat": number }
- name: a clean short meal name (e.g. "Grilled Chicken & Rice")
- calories: total kcal (integer)
- protein: grams (integer)
- carbs: grams (integer)
- fat: grams (integer)
Be realistic. No explanation, just JSON.`,
            },
          ],
        },
      ]
    } else {
      messages = [
        {
          role: "user",
          content: `Estimate the macros for this meal: "${description}"
Return ONLY a JSON object with these fields:
{ "name": string, "calories": number, "protein": number, "carbs": number, "fat": number }
- name: a clean short meal name (e.g. "Scrambled Eggs & Toast")
- calories: total kcal (integer)
- protein: grams (integer)
- carbs: grams (integer)
- fat: grams (integer)
Be realistic. No explanation, just JSON.`,
        },
      ]
    }

    const model = mode === "photo" ? "gpt-4o" : "gpt-4o-mini"

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        messages,
      }),
    })

    const data = await response.json()
    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message || JSON.stringify(data.error) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      })
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? "{}"
    const clean = text.replace(/^```(?:json)?/, "").replace(/```$/, "").trim()
    const result = JSON.parse(clean)

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
