import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { requirePremium } from '../_shared/premium.ts'
import { checkScanCap, refundScan, scanCapResponse } from '../_shared/scan-cap.ts'
import { rejectOversizeImage } from '../_shared/image.ts'

const openaiApiKey = Deno.env.get("OPENAI_API_KEY")
const googleAiKey  = Deno.env.get("GOOGLE_AI_KEY")

// Daily per-user abuse ceiling, tracked separately from pantry scans. Matches the
// scan-pantry cap — a few receipts/week is normal; 5/day caps cost exposure.
const RECEIPT_CAP_PER_DAY = 5

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

Only include food a PERSON would cook with or eat. Skip fees, taxes, totals, and these non-pantry items:
- Pet food and pet treats (cat food, dog food, kibble) — never include these
- Non-edible household goods: cleaning supplies, paper towels, napkins, foil/wrap, dish soap, trash bags, batteries, toiletries
When in doubt about whether something is human food, leave it out.
Return ONLY the raw JSON array, no markdown, no explanation.`

async function parseWithGemini(base64: string): Promise<string> {
  // Use Google's OpenAI-compatible endpoint — the SAME proven config as generate-meals.
  // The old native v1beta `:generateContent` shape was silently 4xx-ing every receipt,
  // so we paid GPT-4o on every scan via the fallback. This matches the working caller.
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${googleAiKey}`,
    },
    body: JSON.stringify({
      model: "gemini-3.1-flash-lite",
      max_tokens: 1000, // receipts rarely exceed 50 items; 1000 tokens is sufficient
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "high" } }, // high detail improves OCR on receipt text
          { type: "text", text: RECEIPT_PROMPT },
        ],
      }],
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error))
  return data.choices?.[0]?.message?.content?.trim() ?? "[]"
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
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "high" } }, // high detail improves OCR accuracy on receipt text
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
  // Server-side premium gate (dormant until PREMIUM_ENFORCEMENT=on; fails open on errors).
  const denied = await requirePremium(user.id)
  if (denied) return denied

  // Rate-limit by the authenticated user id (un-spoofable) instead of a client-padded IP.
  const { allowed } = rateLimit(`u:${user.id}`, 10, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const { base64 } = await req.json()
    if (!base64) {
      return new Response(JSON.stringify({ error: "No image provided" }), { status: 400 })
    }
    // Size backstop before the paid OCR call — client downscales, a forged client can't.
    const tooBig = rejectOversizeImage(base64, 'parse-receipt')
    if (tooBig) return tooBig

    // Daily cap gate — atomic check+increment before any AI call; outer catch refunds on fail.
    const { allowed, used } = await checkScanCap(req, 'receipt', RECEIPT_CAP_PER_DAY)
    if (!allowed) {
      console.log(`[parse-receipt] daily cap hit: ${used}/${RECEIPT_CAP_PER_DAY}`)
      return scanCapResponse(RECEIPT_CAP_PER_DAY)
    }

    // Gemini Flash primary (essentially free, and receipt OCR is structured-text territory
    // where Gemini matches GPT-4o quality). GPT-4o fallback when Gemini errors — receipt
    // quality is critical to UX and a single retry against the paid model is cheap insurance.
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
    await refundScan(req, 'receipt') // both models failed / parse error — refund the slot
    console.error('[parse-receipt] error:', (error as Error).message) // detail server-side only
    return new Response(
      JSON.stringify({ error: "Could not read receipt" }), // generic — don't leak internals
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
