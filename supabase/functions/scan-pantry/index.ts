import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { requirePremium } from '../_shared/premium.ts'
import { checkScanCapWindow, refundScan, scanCapResponse } from '../_shared/scan-cap.ts'
import { rejectOversizeImage } from '../_shared/image.ts'
import { cleanupResult, confScore } from '../_shared/scan-cleanup.ts'

const openaiApiKey = Deno.env.get("OPENAI_API_KEY")
const googleAiKey = Deno.env.get("GOOGLE_AI_KEY")

const OPENAI_URL = "https://api.openai.com/v1/chat/completions"
// Google's OpenAI-compatible endpoint — same request/response shape as OpenAI, so the
// exact same messages work as a drop-in fallback.
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"

// Pantry scan is the priciest call (vision, sometimes 2 passes). One scan =
// one whole-kitchen session (all photos batched), so a few/week covers normal use.
// Rolling 7-day window stops sustained abuse without a rigid daily wall.
// Safe-by-default: prod uses 7 unless SCAN_CAP_WEEK is explicitly set high in the
// Supabase dashboard for testing. Removes the "forgot to revert before launch" footgun.
const SCAN_CAP_PER_WEEK = Number(Deno.env.get('SCAN_CAP_WEEK') ?? 7)
const SCAN_WINDOW_DAYS = 7
// Hard backstop on payload size — a single scan can't exceed this many photos, which
// bounds the per-call token cost the count cap can't (client enforces the same limit).
const MAX_PHOTOS_PER_SCAN = 8

// Confidence floor: drop items the model scored below this (0-100) before they reach the user.
// Kills genuine-guess noise ("unidentifiable blob", opaque unmarked container) that varies
// run-to-run — the stuff that made the review a wall of junk chips. Numeric (not binary
// high/low) so the cutoff is tunable: a binary "drop low" nuked >half the real finds because
// "low" swallowed every confident-but-not-certain item. Default 30 was picked by the pantry-eval
// sweep on gpt-5.4 across 6 real photos: everything scoring <30 was vague blob-junk ("glass jar
// with dark contents", "round tub of food"), and NO real ingredient drops until floor 40 — so 30
// strips noise with a 10-pt safety buffer. Override per-env in the Supabase dashboard if needed.
const SCAN_CONFIDENCE_FLOOR = Number(Deno.env.get('SCAN_CONFIDENCE_FLOOR') ?? 30)

// One vision call with a hard timeout. Throws on error/timeout/empty so the caller can fall back.
// 30s: the model returns in ~10s; 30s leaves headroom for a slow response while keeping the
// whole flow (up to 2 passes × primary+fallback) safely under Supabase's ~150s edge wall-clock
// limit, and surfaces a real failure fast instead of making the user wait 90s.
// opts.tokenParam: gpt-5.x take `max_completion_tokens`; gpt-4-era / Gemini take `max_tokens`.
// opts.temperature: null omits it entirely — gpt-5.4 is a newer-gen model that rejects a forced
// non-default temperature, so we don't send one (its reads are stable enough at the ingredient
// level per the eval); the Gemini fallback still pins temperature 0.
async function visionCall(endpoint: string, apiKey: string, model: string, messages: any[], maxTokens: number, opts: { tokenParam?: string; temperature?: number | null; timeoutMs?: number } = {}): Promise<string> {
  // 60s (was 30s): gpt-5.4 at 'original' detail is slower per call, and a real scan batches
  // several photos into ONE call — a 6-8 photo scan can take 30-45s. Single-pass now, so even
  // primary(60s)+fallback(60s) stays under Supabase's ~150s edge wall-clock limit.
  const { tokenParam = "max_tokens", temperature = 0, timeoutMs = 60000 } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const body: Record<string, unknown> = { model, messages, [tokenParam]: maxTokens }
    if (temperature !== null) body.temperature = temperature
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error))
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error("empty content")
    return content
  } finally {
    clearTimeout(timer)
  }
}

// Primary GPT-5.4 at 'original' image detail — in the pantry-eval on Logan's real photos it hit
// 82% recall vs gpt-4.1's 63%, because gpt-4.1's tile tokenizer downscales the shortest side to
// 768px and shreds small labels; gpt-5.4's full-res patches actually read them. Its SINGLE pass
// already out-recalls gpt-4.1's old two-pass, so the second pass is off (halves scan cost).
// Fallback: Gemini 3.1 Flash-Lite keeps the paid scan alive during an OpenAI outage.
async function scanVision(messages: any[], maxTokens: number): Promise<string> {
  try {
    return await visionCall(OPENAI_URL, openaiApiKey!, "gpt-5.4", messages, maxTokens, { tokenParam: "max_completion_tokens", temperature: null })
  } catch (e) {
    if (!googleAiKey) throw e
    console.log(`[scan-pantry] gpt-5.4 failed (${(e as Error).message}); falling back to Gemini Flash-Lite`)
    return await visionCall(GEMINI_URL, googleAiKey, "gemini-3.1-flash-lite", messages, maxTokens)
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
  // Server-side premium gate (dormant until PREMIUM_ENFORCEMENT=on; fails open on errors).
  const denied = await requirePremium(user.id)
  if (denied) return denied
  console.log(`[scan-pantry] auth ok: ${Date.now() - tAuth}ms`)

  // Key on the verified user id, not x-forwarded-for — XFF is fully client-controlled,
  // so an attacker could send a unique value per request and land each in a fresh bucket,
  // defeating the limiter on this (GPT-4o vision, costliest) endpoint entirely.
  const { allowed } = rateLimit(`u:${user.id}`, 10, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    const tBody = Date.now()
    const { images: rawImages } = await req.json() as { images: string[] }
    console.log(`[scan-pantry] body read: ${Date.now() - tBody}ms`)
    if (!rawImages || rawImages.length === 0) {
      return new Response(JSON.stringify({ error: "No images provided" }), { status: 400 })
    }
    // Hard-cap photos per scan (server backstop — the client enforces the same limit).
    // Bounds the per-call token cost that the frequency cap alone can't.
    const images = rawImages.slice(0, MAX_PHOTOS_PER_SCAN)
    if (rawImages.length > MAX_PHOTOS_PER_SCAN) {
      console.log(`[scan-pantry] truncated ${rawImages.length} -> ${MAX_PHOTOS_PER_SCAN} photos`)
    }
    // Reject if any single image blew past the size backstop (client downscales; a forged
    // client can't). One oversize photo fails the whole batch before the paid vision call.
    for (const img of images) {
      const tooBig = rejectOversizeImage(img, 'scan-pantry')
      if (tooBig) return tooBig
    }
    // Log payload size — a multi-MB body means the client isn't downscaling and
    // req.json() above will have stalled for tens of seconds before this line.
    const payloadKB = Math.round(images.reduce((a, b) => a + b.length, 0) / 1024)
    console.log(`[scan-pantry] received ${images.length} image(s), ~${payloadKB}KB base64`)

    // Gate the cost-bearing OpenAI call behind the rolling weekly cap. Atomic check+increment
    // — counts the attempt up front; the 504/500 paths below refund on transient fail.
    const { allowed, used } = await checkScanCapWindow(req, 'pantry', SCAN_CAP_PER_WEEK, SCAN_WINDOW_DAYS)
    if (!allowed) {
      console.log(`[scan-pantry] weekly cap hit: ${used}/${SCAN_CAP_PER_WEEK}`)
      return scanCapResponse(SCAN_CAP_PER_WEEK, 'week')
    }

    const imageContent = images.map((base64: string) => ({
      type: "image_url" as const,
      // 'original' = full-resolution patches on gpt-5.4 (up to 6000px), the whole reason for the
      // upgrade — it lets the model read small jar/spice/condiment labels 'high' (768px) blurs out.
      image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "original" as const },
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
- If you can tell WHAT the food is but not the exact variant, use a best-guess generic name (e.g. "leafy greens" if you can't tell spinach from kale). BUT if you cannot identify the actual food at all — a foil-covered pan, an opaque tub, an unlabeled container of "something" — SKIP it. NEVER invent placeholder entries like "leftovers", "covered pot of leftovers", "food in container", "deli container", "sauce jar", "drink bottle", or "condiment cup". Those name a container, not a food — nobody can cook from them.
- If a single product is duplicated (3 cans of beans), list it ONCE — but don't skip a real second item because it "looks similar" to another
- Partial labels still count — if you can see part of a label that suggests a product, include it with your best inference

SCAN METHOD — work systematically so cluttered/back areas don't get skimmed:
- Go shelf by shelf. For EACH shelf sweep front→back AND left→right. The BACK ROW behind the front items is where most misses happen — actively look past the front items for caps, lids, and label edges poking out behind or between them. A jar behind a jar, a tub behind a carton — each is a separate item.
- Scan the DOOR shelves and built-in trays separately: condiments, butter/cheese compartments, and EGG TRAYS. Loose eggs sit in molded trays or on door shelves and blend into the tray shape — look for the rounded egg shapes and count them ("eggs").
- Scan each DRAWER (produce, deli) separately — items there are dim and easy to skip.
- A sliver of a KNOWN item (a readable cap, a recognizable package) counts — include it. But a sliver you genuinely can't identify is not worth a placeholder; skip it rather than inventing "unknown jar".
- Stacked or nested items each count separately, even if mostly hidden.

COUNT CHECK before you finish: a full fridge/pantry typically holds 20-40 distinct items. If your list looks short for a full scene, you've skipped back-row and small items — go back to the back rows, door shelves, and shelf edges and look again before returning. (Only include items that are actually visible — never invent — but don't stop early.)

ONE PHYSICAL ITEM = ONE ENTRY (do not over-split or pad the list):
- If you can see only ONE container, list it exactly ONCE with your single best name. NEVER output multiple near-synonyms or alternate guesses for the same object (e.g. don't list both "Tomato Soup" and "Tomato Rice Soup" for one can, or "Protein Powder" + "Whey Protein Isolate" for one tub).
- Name each item at the generic product-type level — do NOT invent finer sub-variants you're only guessing at. When unsure of the exact variant, use the single broader generic name.
- NEVER hedge with an "A or B" name (no "Lemon or orange", "Mayonnaise or aioli", "Mustard or hot sauce bottle", "Chocolate protein bar or candy"). Commit to your single most-likely guess, or step up to the broader category ("Citrus", "Condiment") — exactly ONE clean name per item.

EXCLUDE — these are NOT food and must NEVER appear in the list:
- Pet food and pet treats (cat food, dog food, kibble)
- Non-edible household goods: cleaning supplies, paper towels, napkins, tissues, foil/wrap, dish soap, sponges, trash bags, batteries, toiletries, nail polish
- Dishware, cookware, and kitchen tools: plates, bowls, cups, mugs, glasses, utensils, cutting boards, pots, pans, kettles, trays
- Small appliances (coffee makers, toasters, blenders), cookbooks, and any container that is clearly EMPTY
- Unidentifiable leftovers and generic containers: "leftovers", "covered pot", "food in foil pan", "food in a clear/plastic/deli container", or a plain "sauce jar"/"drink bottle"/"condiment cup" whose actual contents you can't name. If you can't say what the FOOD is, it is NOT a pantry item — leave it out.
Apart from these exclusions, include every actual food/drink you can NAME. When unsure of the exact variant, use ONE broader generic name — never an "X or Y" hedge, and never a container-description in place of a food. Never drop a real, identifiable food just because you're unsure of its brand or variant.

Return a JSON object with this structure:
{
  "layout": "shelves" | "horizontal",
  "photoContainers": ["fridge"],
  "zones": [
    {
      "zone": "Top Shelf",
      "items": [
        { "name": "Non-Fat Greek Yogurt", "category": "Dairy", "photo": 0, "box": [0.41, 0.12, 0.10, 0.18], "confidence": 95 },
        { "name": "Whole Wheat Pasta", "category": "Carbs", "photo": 1, "box": [0.22, 0.55, 0.14, 0.20], "confidence": 45 }
      ]
    }
  ]
}

Photo classification:
- "photoContainers" — an array with exactly ONE entry PER PHOTO (length ${images.length}), in photo order. Classify each photo as one of: "fridge" (refrigerator interior/shelves with cold items), "freezer" (freezer compartment / frozen foods), "pantry" (dry-goods shelves, cabinet, or pantry closet), "counter" (food sitting out on a countertop or table), or "other". ${images.length === 1 ? 'There is one photo → return exactly one entry, e.g. ["fridge"].' : `Classify each of the ${images.length} photos independently, e.g. ["fridge","freezer"].`} This drives context-aware quick-add suggestions, so pick the closest match.

Zone detection rules:
- First, look for VERTICAL layers (shelves, racks, rows stacked top to bottom). If you detect 2+ distinct horizontal layers, use layout "shelves" with zones like: "Top Shelf", "Upper Shelf", "Middle Shelf", "Lower Shelf", "Bottom Shelf", "Drawer", "Door"
- If the image is a single flat surface (countertop, single shelf, table), use layout "horizontal" with zones like: "Left Side", "Center", "Right Side"
- Only include zones that actually contain items
- Order zones top-to-bottom for shelves, left-to-right for horizontal
- Distribute items into the SPECIFIC zone where each physically sits — do NOT dump everything into one generic zone. A full fridge usually spans 3-6 zones (several shelves + the door + drawers); put each item in the zone matching its real location so the user can scan shelf-by-shelf.

Item rules:
- "name" must be a GENERIC ingredient name — NEVER a brand or product name. Before writing each name, STRIP the brand to its generic type: "A1" → "Steak Sauce", "Quest Bars" → "Protein Bars", "Babybel" → "Cheese", "Hamburger Helper" → "Pasta Dinner Kit", "Campbell's Cream of Mushroom Soup" → "Cream of Mushroom Soup", "Uncle Ben's Rice" → "Rice", "Chobani" → "Greek Yogurt". A brand in the name creates duplicate entries. Use the brand/label only as CONTEXT to make the GENERIC name more specific (e.g. "Non-Fat Plain Greek Yogurt", not just "Yogurt").
- "photo" — REQUIRED on EVERY item object, never omit it. The 0-based index (0 to ${images.length - 1}) of the photo this item is visible in. ${images.length === 1 ? 'There is only ONE photo, so "photo" is ALWAYS 0 on every item.' : `Assign each item to the specific photo it actually appears in — an item seen in the 3rd photo must be "photo": 2, NOT 0. Do not default everything to 0.`}
- "box" — REQUIRED on every item: the item's location in ITS photo as [x, y, w, h], all normalized 0-1 with the ORIGIN at the TOP-LEFT of that photo. x,y = the top-left corner of a tight box around the visible item (include its cap/lid); w,h = the box's width/height as fractions of the photo. Examples: an item in the upper-left quarter ≈ [0.05, 0.08, 0.15, 0.22]; one centered near the bottom ≈ [0.45, 0.70, 0.12, 0.20]. Estimate as accurately as you can — this box is drawn over the photo so the user can see exactly which item you mean. If an item is partially hidden, box only its VISIBLE part. Coordinates are for the same photo given in "photo".
- "confidence" — REQUIRED integer 0-100: how sure you are this exact item is really present and correctly named. Calibrate honestly, using the full range:
  - 90-100: you can clearly READ the label/brand, or the shape is unmistakable (a carton of milk, a visible egg tray)
  - 60-85: confident on the food TYPE but guessing the exact variant (clearly yogurt, unsure if Greek/regular)
  - 35-55: plausible but partially hidden, blurry, dim, or an ambiguous shape you're inferring
  - 0-30: a genuine guess at a barely-visible blob, an opaque/unmarked container, or contents you mostly can't see
  Scores below a cutoff get filtered out as noise, so DO NOT inflate — an honest 25 on a mystery blob is far better than a dishonest 80. Most clear front-row items land 85+; most back-row/small/ambiguous ones land under 50.
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
    const firstPassMessages = [{
      role: "user",
      content: [...imageContent, { type: "text", text: firstPassPrompt }],
    }]
    // gpt-4.1 primary (best recall in eval), Gemini Flash-Lite fallback. Each call has a 90s
    // ceiling (vision can hang past the edge runtime's ~150s limit and force-kill the function).
    let text: string
    try {
      text = await scanVision(firstPassMessages, 10000) // 10k: gpt-5.4 max_completion_tokens covers reasoning + a dense multi-photo JSON without truncating (you only pay for tokens actually generated)
    } catch (e) {
      const msg = (e as Error).name === 'AbortError'
        ? 'Scan timed out. Try again with fewer or smaller photos.'
        : `Scan failed: ${(e as Error).message}`
      console.log(`[scan-pantry] first pass failed (both providers): ${msg}`)
      await refundScan(req, 'pantry') // transient fail — don't burn the user's weekly slot
      return new Response(JSON.stringify({ error: msg }), {
        status: 504, headers: { "Content-Type": "application/json" },
      })
    }
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
    // Second pass DISABLED for gpt-5.4: its single full-res pass already out-recalls gpt-4.1's
    // old two-pass (82% vs 63% in the eval), so the catch-misses pass is redundant and would
    // just double the scan cost. Density calc kept for the log. Re-enable if we ever fall back
    // to a weaker primary model. (maxPerPhoto still referenced below in the log line.)
    const shouldRunSecondPass = false
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
- Back-row items partially hidden behind front items — look PAST the front row for caps, lids, and label edges poking out behind/between items
- Loose EGGS in molded door trays or egg shelves — they blend into the tray shape and are easy to miss
- Door contents — fridge door condiments, butter/cheese compartments
- Top shelf and bottom shelf items (these get less attention)
- Items in drawers, especially the produce drawer
- Anything edible you previously dismissed as ambiguous — give a best-guess name now

EXCLUDE pet food/treats and non-edible household goods (cleaning supplies, paper goods, toiletries) — only list things a person would cook with or eat.

Use SAME zone names from first pass where possible: ${knownZones.join(', ') || '(none — invent zones based on layout)'}.
Categories: Protein, Carbs, Produce, Condiments, Dairy, Pantry Staples, Other.
"photo" is REQUIRED on every item — the 0-based index (0 to ${images.length - 1}) of the photo it appears in${images.length === 1 ? ' (always 0 here)' : ', so it groups under the right photo'}.
"box" is REQUIRED on every item — [x, y, w, h] normalized 0-1 from the photo's TOP-LEFT corner, a tight box around the visible item (its width/height as fractions of the photo).
"confidence" is REQUIRED — integer 0-100 for how sure you are the item is really there and correctly named (90-100 clearly readable; 60-85 confident type, unsure variant; 35-55 partly hidden/ambiguous; 0-30 a genuine guess at a blob/opaque container). These are items you MISSED the first time, so most will score lower; only give 85+ to one you can now clearly read/identify. Don't inflate — low scores get filtered as noise.

Return JSON: { "missed": [{ "name": "...", "category": "...", "zone": "...", "photo": 0, "box": [0.1, 0.2, 0.1, 0.15], "confidence": 40 }] }

Return ONLY the JSON, no markdown. If nothing was missed, return { "missed": [] }.`

        const secondText = await scanVision(
          [{ role: "user", content: [...imageContent, { type: "text", text: secondPassPrompt }] }],
          2000,
        )
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
          // Carry the photo index (default 0) so second-pass finds don't orphan to the
          // client's "More" page in multi-photo scans the way first-pass items wouldn't.
          // Second-pass finds are the small/hidden/ambiguous items — default to a middling-low
          // score (40) when the model omits one, so a genuinely-uncertain find can still be
          // floor-dropped rather than waved through as fully confident.
          zone.items.push({ name: item.name, category: item.category || 'Other', photo: typeof item.photo === 'number' ? item.photo : 0, box: Array.isArray(item.box) && item.box.length === 4 ? item.box : null, confidence: confScore(item.confidence) === 100 ? 40 : confScore(item.confidence) })
        }
        console.log(`[scan-pantry] second pass: ${Date.now() - secondPassStart}ms, added ${missed.length} items`)
      }
    } catch (e) {
      console.log('[scan-pantry] second pass failed (non-fatal):', e)
    }

    // Deterministic safety net over the model output: drop hallucinated non-food (dishes,
    // nail polish, pet food), strip parenthetical qualifiers, and collapse dupes across the
    // whole result. Catches what even a good model occasionally slips through.
    const beforeCleanup = (result.zones || []).reduce((a: number, z: any) => a + (z.items?.length || 0), 0)
    cleanupResult(result, SCAN_CONFIDENCE_FLOOR)
    const afterCleanup = (result.zones || []).reduce((a: number, z: any) => a + (z.items?.length || 0), 0)
    if (beforeCleanup !== afterCleanup) console.log(`[scan-pantry] cleanup: ${beforeCleanup} -> ${afterCleanup} items`)

    // NOTE: previously we stripped item.photo here ("client only consumes name+category") — but
    // the per-photo review now NEEDS photo, so the strip was silently breaking attribution (every
    // item arrived photo-less → orphaned). Keep photo in the response.
    console.log(`[scan-pantry] total: ${Date.now() - t0}ms`)

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    await refundScan(req, 'pantry') // first-pass parse / unexpected fail — refund the slot
    console.error('[scan-pantry] error:', (error as Error).message) // detail server-side only
    return new Response(
      JSON.stringify({ error: "Scan failed" }), // generic — don't leak internals to the client
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
