import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'

const openaiApiKey = Deno.env.get("OPENAI_API_KEY")

// ── Barcode lookup via Open Food Facts → generic name ──────────────────
async function lookupBarcode(barcode: string): Promise<string | null> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`)
    if (!res.ok) return null
    const json = await res.json()
    if (json.status !== 1) return null
    const p = json.product
    // Build a generic name from the product data
    const generic = p.generic_name_en ?? p.generic_name ?? null
    const productName = p.product_name_en ?? p.product_name ?? null
    const categories = p.categories_tags?.[0]?.replace('en:', '')?.replace(/-/g, ' ') ?? null
    // Prefer generic name, fall back to product name stripped of brand
    if (generic) return generic
    if (productName) {
      // Strip brand prefix if present
      const brand = (p.brands?.split(',')[0]?.trim() ?? '').toLowerCase()
      let name = productName
      if (brand && name.toLowerCase().startsWith(brand)) {
        name = name.slice(brand.length).trim()
      }
      return name || null
    }
    return categories || null
  } catch {
    return null
  }
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

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 10, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const { images } = await req.json() as { images: string[] }
    if (!images || images.length === 0) {
      return new Response(JSON.stringify({ error: "No images provided" }), { status: 400 })
    }

    const imageContent = images.map((base64: string) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "high" as const },
    }))

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: [
              ...imageContent,
              {
                type: "text",
                text: `These are photos of a kitchen (fridge, pantry shelves, counter). Identify every visible food ingredient or grocery item.

You are a kitchen inventory scanner. Analyze these photos using ALL available clues to identify every food item as accurately as possible.

Use these 4 detection strategies on every item:
1. VISUAL RECOGNITION — identify foods by their appearance, shape, color, container type
2. BRAND/LOGO READING — if you can see a brand name, logo, or product label, use it to determine the exact product variant (e.g. "Non-Fat Greek Yogurt" instead of just "Greek Yogurt")
3. BARCODE NUMBERS — if any barcodes or UPC numbers are visible and readable, include the number in the "barcode" field
4. NUTRITION LABEL / INGREDIENT LIST — if a product is turned showing its back label, read any visible nutrition facts or ingredient lists to help identify the specific product (e.g. seeing "Whole Wheat" in ingredients → "Whole Wheat Bread" not just "Bread")

Return a JSON object with this structure:
{
  "layout": "shelves" | "horizontal",
  "zones": [
    {
      "zone": "Top Shelf",
      "items": [
        { "name": "Non-Fat Greek Yogurt", "category": "Dairy", "barcode": null },
        { "name": "Whole Wheat Pasta", "category": "Carbs", "barcode": "076808006803" }
      ]
    }
  ]
}

Zone detection rules:
- First, look for VERTICAL layers (shelves, racks, rows stacked top to bottom). If you detect 2+ distinct horizontal layers, use layout "shelves" with zones like: "Top Shelf", "Upper Shelf", "Middle Shelf", "Lower Shelf", "Bottom Shelf", "Drawer", "Door"
- If the image is a single flat surface (countertop, single shelf, table), use layout "horizontal" with zones like: "Left Side", "Center", "Right Side"
- Only include zones that actually contain items
- Order zones top-to-bottom for shelves, left-to-right for horizontal

Item rules:
- "name" must be a GENERIC ingredient name — no brand names in this field. Use the most specific generic name you can determine from all context clues (e.g. "Non-Fat Plain Greek Yogurt" not "Chobani" and not just "Yogurt")
- "barcode" — include ONLY if you can clearly read a UPC/EAN barcode number in the image. Set to null otherwise. Do not guess barcode numbers.
- Be thorough — include everything visible, even partially obscured items
- Use brand logos and nutrition labels as CONTEXT to make the generic name more specific, but never put the brand in the name field
- Categories must be one of: Protein, Carbs, Produce, Condiments, Dairy, Pantry Staples, Other
  - Protein: meat, fish, eggs, beans, tofu
  - Carbs: bread, pasta, rice, cereals, flour
  - Produce: fruits, vegetables, herbs
  - Condiments: sauces, oils, spices, dressings
  - Dairy: milk, cheese, yogurt, butter
  - Pantry Staples: canned goods, broth, baking items
  - Other: anything else

Return ONLY the raw JSON object, no markdown, no explanation.`,
              },
            ],
          },
        ],
      }),
    })

    const data = await response.json()
    if (data.error) {
      return new Response(JSON.stringify({ error: data.error.message || JSON.stringify(data.error) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      })
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? "{}"
    const clean = text.replace(/```json|```/g, "").trim()
    const result = JSON.parse(clean)

    // Second pass: look up any detected barcodes for more accurate names
    for (const zone of (result.zones || [])) {
      for (const item of zone.items) {
        if (item.barcode) {
          const betterName = await lookupBarcode(item.barcode)
          if (betterName) {
            item.name = betterName
              .toLowerCase()
              .replace(/\b\w/g, (c: string) => c.toUpperCase())
          }
        }
      }
    }

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
