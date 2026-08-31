// Pulling a creator's OWN ingredient list out of a YouTube description, mechanically.
//
// Split out of generate-trending-meals/index.ts so it can be unit-tested without booting the Deno
// runtime. That is not tidiness: the numbered-list marker below silently mangled every decimal
// quantity for as long as it existed, and it could not have been caught by a test because there
// was no way to run this code outside the edge function. Same lesson recipe-integrity.ts records
// for hasFractionalIndivisible, which was dead for 19 days inside the pipeline.

// Pull the creator's OWN ingredient list out of the description, mechanically.
//
// Measured against 10 source descriptions, the model kept only 50% of listed ingredients and 7 of
// 10 recipes lost 3 or more. It wasn't just seasonings: a Soya Potato Masala arrived without ghee,
// onion, green chilli or cumin (14 -> 4), and a pesto gnocchi lost two bags of spinach and two cups
// of mozzarella. That destroys the taste of the dish, understates calories, and silently breaks the
// allergen tags derived from the ingredient array.
//
// The fix is to stop leaving inclusion to the model's discretion. Where the description contains a
// real list, it is parsed here and handed over as a checklist to COPY rather than a text to
// summarise. Summarising is where things get dropped.
// Measured on 37 real descriptions: the first version required an "Ingredients:" heading AND ascii
// bullets and found a list in 35%. This finds one in 75%. The two things that mattered were emoji
// bullets (creators use 🥦🥚🧄 as list markers) and stopping at the method AFTER stripping the
// bullet — "🍳 Recipe Steps" is emoji-prefixed, so an unstripped ^ anchor never matched it and 21
// step lines were being swallowed into one recipe's ingredient list.
const BULLET_CHARS = "[•\\-\\*●▪‣▫○◦·–—▶►✅✔☑📌🔸🔹🥚🥦🧄🧅🧀🍗🍚🥩🌶🫒🍋🥔🧈🍯🥜🍫🍓🍌🍳🥄🍽🥣🧊🔥]"
// Where the ingredient block ends. The second group is load-bearing now that the parse window is
// the whole description rather than 500 chars: creators close with a promo block of OTHER recipes,
// and those are bulleted exactly like ingredients. Measured on a real-shaped description, a
// 4-ingredient bagel recipe followed by "MORE RECIPES YOU'LL LOVE:" parsed to 8 items — which
// would then fail the 100%-retention check and reject a perfectly good recipe for being "short".
// The first group already stopped at METHOD/DIRECTIONS; this stops at the promo block when the
// creator never wrote a method heading.
const STOP_LINE = /^(?:recipe\s+)?(?:directions?|instructions?|method|steps?|macros?|nutrition|how to|preparation|notes?|serve|enjoy|more\s+recipes?|other\s+(?:recipes?|videos?)|recipes?\s+you|watch\s+next|related|playlist|chapters?|timestamps?)\b/i
const NOISE_LINE = /(https?:\/\/|www\.|@[\w.]+|#\w+|comment |subscribe|follow me|link in bio|discount|instagram|tiktok)/i
const QTY_START = /^(?:\d+[\d/.\s]*|½|¼|¾|⅓|⅔|⅛)\s*\S/

// A numbered-list marker — "1." or "2)" — and the lookahead is load-bearing.
//
// Without it, \d+[.)] matches the DECIMAL POINT in a quantity: "1.5 tsp Salt" is read as list item
// "1." followed by "5 tsp Salt". Two ways that goes wrong, both measured on a real description
// (video FRyfG33qReo, "1.5 tsp Salt"):
//
//   * In a description with no real bullets, the line is misclassified as bulleted. Since the
//     parser keeps ONLY bulleted lines when there are >= 3 of them and falls back to quantified
//     otherwise, a lone false bullet lands in the discarded pile — the ingredient disappears from
//     the checklist entirely. It then also disappears from the retention contract built from that
//     same checklist, so the model is never asked for it and the gate never notices: both sides
//     agree on a wrong answer. That is how a kebab lost 1.5 tsp of salt while passing 100%
//     retention.
//   * In a genuinely bulleted description the line SURVIVES as "5 tsp Salt" — the quantity
//     inflated 3.3x, which is worse than losing it.
//
// Matches "1. Flour" and "2) Flour" exactly as before; those are followed by a space.
const NUMBERED_MARKER = String.raw`\d+[.)](?=\s|$)`

function stripBullet(raw: string): string {
  return raw
    .replace(new RegExp(`^\\s*(?:${BULLET_CHARS}|${NUMBERED_MARKER}|\\d+️⃣)+\\s*`), '')
    .replace(new RegExp(`^\\s*(?:${BULLET_CHARS})+\\s*`), '')
    .trim()
    .replace(/[:\s]+$/, '')
}


function parseIngredientBlock(desc: string): string[] {
  if (!desc) return []
  const heading = desc.match(/ingredients?\s*:?\s*\n/i)
  const body = heading ? desc.slice(heading.index! + heading[0].length) : desc
  const bulleted: string[] = []
  const quantified: string[] = []
  for (const raw of body.split('\n')) {
    const line = stripBullet(raw)
    if (STOP_LINE.test(line)) break
    if (!line || NOISE_LINE.test(line) || line.length <= 2 || line.length >= 90) continue
    const wasBulleted = new RegExp(`^\\s*(?:${BULLET_CHARS}|${NUMBERED_MARKER}|\\d+️⃣)`).test(raw)
    if (wasBulleted) bulleted.push(line)
    else if (QTY_START.test(line)) quantified.push(line)
  }
  // When the block uses bullets, keep ONLY bulleted lines — the unbulleted lines between them are
  // group headings ("Potatoes", "Burger Sauce") and counting them would inflate the expected total.
  const out = bulleted.length >= 3 ? bulleted : quantified
  return out.length >= 3 ? out : []
}

export { parseIngredientBlock, stripBullet }
