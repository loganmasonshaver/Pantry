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
    const { images } = await req.json() as { images: string[] }
    if (!images || images.length === 0) {
      return new Response(JSON.stringify({ error: "No images provided" }), { status: 400 })
    }

    const imageContent = images.map((base64: string) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "high" as const },
    }))

    const firstPassPrompt = `These are photos of a kitchen (fridge, pantry shelves, counter). Identify every visible food ingredient or grocery item.

You are a kitchen inventory scanner. Be EXHAUSTIVE — your job is to spot every single edible item in these photos, even ones that are small, partially hidden, in clear containers, on shelf edges, or at the very top/bottom/back of the frame. Better to over-include with a best-guess name than to silently miss something.

Use these 3 detection strategies on every item:
1. VISUAL RECOGNITION — identify foods by their appearance, shape, color, container type
2. BRAND/LOGO READING — if you can see a brand name, logo, or product label, use it to determine the exact product variant (e.g. "Non-Fat Greek Yogurt" instead of just "Greek Yogurt")
3. NUTRITION LABEL / INGREDIENT LIST — if a product is turned showing its back label, read any visible nutrition facts or ingredient lists to help identify the specific product (e.g. seeing "Whole Wheat" in ingredients → "Whole Wheat Bread" not just "Bread")

EXHAUSTIVENESS RULES (these matter more than naming precision):
- Scan EVERY zone in the image — don't focus on the obvious centerpiece items and skip the rest
- Common misses to actively look for: spices in small jars, condiment bottles on fridge doors, sauces, oils, items in CLEAR or SEMI-TRANSPARENT containers (you can see contents through the plastic), back-row items partially hidden behind front items, frozen drawer contents, items on the very top shelf, items on the bottom that may look like packaging trash
- For items in clear containers (Tupperware, glass jars, ziplock bags), identify the CONTENTS not the container
- If you see something edible but can't ID it precisely, use a best-guess generic name (e.g. "leafy greens" if you can't tell spinach from kale, "white sauce" if you can't ID it specifically) — DO NOT skip it
- If a single product is duplicated (3 cans of beans), list it ONCE — but don't skip a real second item because it "looks similar" to another
- Partial labels still count — if you can see part of a label that suggests a product, include it with your best inference

Return a JSON object with this structure:
{
  "layout": "shelves" | "horizontal",
  "zones": [
    {
      "zone": "Top Shelf",
      "items": [
        { "name": "Non-Fat Greek Yogurt", "category": "Dairy" },
        { "name": "Whole Wheat Pasta", "category": "Carbs" }
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
- Use brand logos and nutrition labels as CONTEXT to make the generic name more specific, but never put the brand in the name field
- Categories must be one of: Protein, Carbs, Produce, Condiments, Dairy, Pantry Staples, Other
  - Protein: meat, fish, eggs, beans, tofu
  - Carbs: bread, pasta, rice, cereals, flour
  - Produce: fruits, vegetables, herbs
  - Condiments: sauces, oils, spices, dressings
  - Dairy: milk, cheese, yogurt, butter
  - Pantry Staples: canned goods, broth, baking items
  - Other: anything else

Return ONLY the raw JSON object, no markdown, no explanation.`

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",   // mini's vision is too weak to read partial labels / back-row items
        max_tokens: 6000,  // dense kitchen scans were silently truncating at lower caps — losing whole zones at the end of the JSON
        messages: [
          {
            role: "user",
            content: [...imageContent, { type: "text", text: firstPassPrompt }],
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

    // ── SECOND PASS: catch what the first pass missed ───────────────────
    // GPT-4o spreads attention thin on dense kitchen photos. A focused
    // second pass with the first-pass list as context reliably surfaces
    // small/partial/back-row items that got skipped. Cost ~2× per scan
    // but recognition rate jumps noticeably. Failures here are non-fatal —
    // if the second pass errors out, we just return the first-pass result.
    try {
      const firstPassNames: string[] = (result.zones || []).flatMap(
        (z: any) => (z.items || []).map((i: any) => i.name)
      )
      const knownZones: string[] = (result.zones || []).map((z: any) => z.zone)
      if (firstPassNames.length > 0) {
        const secondPassPrompt = `You previously scanned these same photos and identified these items:
${firstPassNames.map(n => `- ${n}`).join('\n')}

NOW LOOK AGAIN more carefully. List ONLY items you MISSED in the first pass. DO NOT repeat any item already in the list above.

Focus your attention on:
- Small items: spices, herbs in small jars, salt/pepper shakers, hot sauce bottles
- Items in clear/transparent containers — identify the CONTENTS, not the container
- Back-row items partially hidden behind front items
- Door contents — fridge door condiments, butter shelf, egg shelf
- Top shelf and bottom shelf items (these get less attention)
- Items in drawers, especially the produce drawer
- Anything edible you previously dismissed as ambiguous — give a best-guess name now

Use SAME zone names from first pass where possible: ${knownZones.join(', ') || '(none — invent zones based on layout)'}.
Categories: Protein, Carbs, Produce, Condiments, Dairy, Pantry Staples, Other.

Return JSON: { "missed": [{ "name": "...", "category": "...", "zone": "..." }] }

Return ONLY the JSON, no markdown. If nothing was missed, return { "missed": [] }.`

        const secondResp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${openaiApiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            max_tokens: 2000,
            messages: [
              {
                role: "user",
                content: [...imageContent, { type: "text", text: secondPassPrompt }],
              },
            ],
          }),
        })
        const secondData = await secondResp.json()
        const secondText = secondData.choices?.[0]?.message?.content?.trim() ?? "{}"
        const secondClean = secondText.replace(/```json|```/g, "").trim()
        const secondResult = JSON.parse(secondClean)
        const missed: any[] = Array.isArray(secondResult.missed) ? secondResult.missed : []

        // Merge missed items into the first-pass result, deduping by lowercased name
        const seenNames = new Set<string>(firstPassNames.map(n => n.toLowerCase()))
        for (const item of missed) {
          if (!item?.name || typeof item.name !== 'string') continue
          const key = item.name.toLowerCase()
          if (seenNames.has(key)) continue
          seenNames.add(key)
          const zoneName = item.zone || 'Other'
          let zone = result.zones.find((z: any) => z.zone === zoneName)
          if (!zone) {
            zone = { zone: zoneName, items: [] }
            result.zones.push(zone)
          }
          zone.items.push({ name: item.name, category: item.category || 'Other' })
        }
        console.log(`[scan-pantry] second pass added ${missed.length} items`)
      }
    } catch (e) {
      console.log('[scan-pantry] second pass failed (non-fatal):', e)
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
