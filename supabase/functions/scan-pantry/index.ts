import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { checkScanCap, refundScan, scanCapResponse } from '../_shared/scan-cap.ts'

const openaiApiKey = Deno.env.get("OPENAI_API_KEY")

// Daily per-user abuse ceiling. Real usage is a few scans/week; 5/day clears any
// legit heavy day while capping OpenAI cost exposure if a client is scripted.
const SCAN_CAP_PER_DAY = 5

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    })
  }

  // Early log — fires on EVERY invocation including ones that abort at auth or
  // rate-limit, so we can tell from logs whether the function was even reached.
  // Critical when debugging client-side hangs: without this, an auth-rejected
  // call looks identical to a never-invoked one from the dashboard.
  console.log('[scan-pantry] invoked')

  // Manual auth check — gateway JWT verification is disabled (ES256 incompatibility).
  // Timed because verifyUser() hits the Auth API with no timeout; if a scan stalls
  // between "invoked" and "received images", this log splits auth vs. body upload.
  const tAuth = Date.now()
  const user = await verifyUser(req)
  if (!user) return unauthorizedResponse()
  console.log(`[scan-pantry] auth ok: ${Date.now() - tAuth}ms`)

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 10, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const tBody = Date.now()
    const { images } = await req.json() as { images: string[] }
    console.log(`[scan-pantry] body read: ${Date.now() - tBody}ms`)
    if (!images || images.length === 0) {
      return new Response(JSON.stringify({ error: "No images provided" }), { status: 400 })
    }
    // Log payload size — a multi-MB body means the client isn't downscaling and
    // req.json() above will have stalled for tens of seconds before this line.
    const payloadKB = Math.round(images.reduce((a, b) => a + b.length, 0) / 1024)
    console.log(`[scan-pantry] received ${images.length} image(s), ~${payloadKB}KB base64`)

    // Gate the cost-bearing OpenAI call behind the daily cap. Atomic check+increment
    // — counts the attempt up front; the 504/500 paths below refund on transient fail.
    const { allowed, used } = await checkScanCap(req, 'pantry', SCAN_CAP_PER_DAY)
    if (!allowed) {
      console.log(`[scan-pantry] daily cap hit: ${used}/${SCAN_CAP_PER_DAY}`)
      return scanCapResponse(SCAN_CAP_PER_DAY)
    }

    const imageContent = images.map((base64: string) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "high" as const },
    }))

    const firstPassPrompt = `These are ${images.length} photo(s) of a kitchen (fridge, pantry shelves, counter), numbered 0 to ${images.length - 1} in the order shown. Identify every visible food ingredient or grocery item.

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

EXCLUDE only these (they're groceries but NOT pantry ingredients):
- Pet food and pet treats (cat food, dog food, kibble) — never include these
- Non-edible household goods: cleaning supplies, paper towels, napkins, foil/wrap, dish soap, sponges, trash bags, batteries, toiletries
These two categories are the ONLY exclusions. EVERY actual human food or drink item still follows the exhaustiveness rules above — when unsure whether a FOOD item is X or Y, still include it with a best-guess name. Never drop a real food/drink just because you're unsure what it is.

Return a JSON object with this structure:
{
  "layout": "shelves" | "horizontal",
  "zones": [
    {
      "zone": "Top Shelf",
      "items": [
        { "name": "Non-Fat Greek Yogurt", "category": "Dairy", "photo": 0 },
        { "name": "Whole Wheat Pasta", "category": "Carbs", "photo": 1 }
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
- "photo" — 0-based index of which photo this item came from. Required for downstream density analysis. If you genuinely can't tell, use 0.
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

    const t0 = Date.now()
    // OpenAI vision endpoint occasionally hangs past the Supabase edge runtime's
    // ~150s platform limit, getting the whole function force-killed with no logs
    // and no response to the client. AbortController gives us a clean 90s ceiling
    // so we fail with a real error message instead of silently dying.
    const firstPassCtrl = new AbortController()
    const firstPassTimeout = setTimeout(() => firstPassCtrl.abort(), 90000)
    let response: Response
    try {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
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
        signal: firstPassCtrl.signal,
      })
    } catch (e) {
      const msg = (e as Error).name === 'AbortError'
        ? 'OpenAI vision timed out (90s). Try again with fewer or smaller photos.'
        : `OpenAI vision request failed: ${(e as Error).message}`
      console.log(`[scan-pantry] first pass aborted: ${msg}`)
      await refundScan(req, 'pantry') // transient fail — don't burn the user's daily slot
      return new Response(JSON.stringify({ error: msg }), {
        status: 504, headers: { "Content-Type": "application/json" },
      })
    } finally {
      clearTimeout(firstPassTimeout)
    }

    const data = await response.json()
    if (data.error) {
      await refundScan(req, 'pantry') // OpenAI rejected the call — refund the slot
      return new Response(JSON.stringify({ error: data.error.message || JSON.stringify(data.error) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      })
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? "{}"
    const clean = text.replace(/```json|```/g, "").trim()
    const result = JSON.parse(clean)
    const firstPassMs = Date.now() - t0
    const firstPassItemCount = (result.zones || []).reduce(
      (acc: number, z: any) => acc + (z.items?.length || 0), 0,
    )
    console.log(`[scan-pantry] first pass: ${firstPassMs}ms, ${firstPassItemCount} items, ${images.length} photos`)

    // Per-photo density check — drives the gate that decides whether the second
    // pass is worth its ~30s cost. The "photo" field on each item is supplied by
    // the first-pass prompt; if the LLM forgot to include it (older models, prompt
    // drift) we conservatively treat everything as photo 0, which yields the
    // densest possible distribution and triggers the second pass — safer default
    // than skipping.
    const photoCounts = new Map<number, number>()
    for (const zone of (result.zones || [])) {
      for (const item of (zone.items || [])) {
        const idx = typeof item.photo === 'number' ? item.photo : 0
        photoCounts.set(idx, (photoCounts.get(idx) || 0) + 1)
      }
    }
    const maxPerPhoto = Math.max(...photoCounts.values(), 0)
    // 12+ items in a single photo triggers the second pass. Lowered from 20: a
    // real fridge/pantry shot routinely has 20+ items but GPT-4o under-counts
    // (a 13-detected fridge actually had ~21), so a high threshold meant the
    // densest, most-missed scans never got the catch-misses pass. 12 errs toward
    // recall — the ~30s second-pass cost is worth not dropping milk/eggs/PB.
    const shouldRunSecondPass = maxPerPhoto >= 12
    console.log(`[scan-pantry] per-photo density: max=${maxPerPhoto} across ${photoCounts.size} photo(s), secondPass=${shouldRunSecondPass}`)

    // ── SECOND PASS: catch what the first pass missed ───────────────────
    // GPT-4o spreads attention thin on dense kitchen photos. A focused
    // second pass with the first-pass list as context reliably surfaces
    // small/partial/back-row items that got skipped. Cost ~2× per scan
    // but recognition rate jumps noticeably. Failures here are non-fatal —
    // if the second pass errors out, we just return the first-pass result.
    if (shouldRunSecondPass) try {
      const secondPassStart = Date.now()
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

EXCLUDE pet food/treats and non-edible household goods (cleaning supplies, paper goods, toiletries) — only list things a person would cook with or eat.

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
        console.log(`[scan-pantry] second pass: ${Date.now() - secondPassStart}ms, added ${missed.length} items`)
      }
    } catch (e) {
      console.log('[scan-pantry] second pass failed (non-fatal):', e)
    }

    // Strip the photo index from the response — it's only used server-side for
    // the density gate above; the client only consumes { name, category }.
    for (const zone of (result.zones || [])) {
      for (const item of (zone.items || [])) {
        delete item.photo
      }
    }
    console.log(`[scan-pantry] total: ${Date.now() - t0}ms`)

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    await refundScan(req, 'pantry') // first-pass parse / unexpected fail — refund the slot
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
