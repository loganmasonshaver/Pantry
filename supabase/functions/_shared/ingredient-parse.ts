// Pulling a creator's OWN ingredient list AND method out of a YouTube description, mechanically.
//
// Split out of generate-trending-meals/index.ts so it can be unit-tested without booting the Deno
// runtime. That is not tidiness: the numbered-list marker below silently mangled every decimal
// quantity for as long as it existed, and it could not have been caught by a test because there
// was no way to run this code outside the edge function. Same lesson recipe-integrity.ts records
// for hasFractionalIndivisible, which was dead for 19 days inside the pipeline.

import { isNonIngredientLine } from './recipe-integrity.ts'

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

// The first ingredient name that looks CUT OFF against the creator's own list, or null.
//
// A model that hits its token limit sometimes closes the JSON gracefully, so JSON.parse succeeds
// and the response looks healthy while its last string is a fragment. Three stored rows carried
// one — "Roas" for "1 tsp Roasted Jeera Powder", "ga" for "garlic powder", "Turmeric Powd" — and
// every one was the LAST entry of its array, which is what a token-limit cut looks like from here.
//
// This checks the OUTPUT rather than trusting finish_reason, because a provider that misreports
// that field would put us straight back where we started.
//
// Two conditions, and the first is what keeps it safe: a name that appears as a COMPLETE word-run
// anywhere in the source is a real ingredient and is never flagged, however short. Only a name that
// appears solely as a mid-word prefix at a word boundary is a cut. So "Salt" beside "Salted butter"
// is fine as long as the creator also listed salt on its own, which is the case that would
// otherwise produce a false positive.
export function truncatedAgainstSource(names: string[], srcList: string[]): string | null {
  const lower = (v: unknown) => String(v ?? '').toLowerCase().trim()
  const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const src = srcList.map(lower).filter(Boolean)
  if (src.length === 0) return null
  for (const raw of names) {
    const n = lower(raw)
    if (n.length < 2) continue
    const rx = escape(n)
    if (src.some(line => new RegExp(`(^|[^a-z])${rx}([^a-z]|$)`).test(line))) continue
    for (const line of src) {
      const hit = new RegExp(`(^|[^a-z])${rx}([a-z]+)`).exec(line)
      // A PLURAL is not a cut. "egg" against the creator's "2 eggs" is the same ingredient, and
      // without this the detector rejects a healthy recipe for writing the singular — which is
      // most of them. Caught by the test, not by reading.
      if (hit && hit[2] !== 's' && hit[2] !== 'es') return raw
    }
  }
  return null
}


// ── The creator's METHOD ────────────────────────────────────────────────────────────────────────
//
// parseIngredientBlock STOPS at the method heading and throws the rest away. That text is the
// single most valuable thing in the description and it was being discarded.
//
// Measured on 14 sampled source videos: 8 of them (57%) publish a numbered method, all of it well
// inside the 2000-char prompt window — so the model could already SEE it. It was summarising it
// anyway. "Kala Chana Dosa" published 9 steps and we stored 5, losing "drain the water", "lightly
// grease it", "medium heat", "flip and cook for another 1-2 minutes" and the serving suggestion.
// That is the same failure the INGREDIENT checklist was built to fix: a model asked to summarise
// drops things, and a model handed a list to copy does not.
const METHOD_HEADING = /^(?:recipe\s+)?(?:directions?|instructions?|method|steps?|how to (?:make|prepare)|preparation|procedure)\b\s*:?\s*$/i

// A trailing block that is not method any more — socials, hashtags, promos, a macro summary.
const METHOD_END = /^(?:macros?|nutrition|calories|ingredients?|notes?|more\s+recipes?|other\s+(?:recipes?|videos?)|watch\s+next|related|playlist|chapters?|timestamps?|follow|subscribe)\b/i

// Marketing prose that follows the method in longer descriptions — health claims, disclaimers, a
// nutrition table. Unanchored, because these lines are emoji-led ("‼️ Consult your doctor before
// use…", "❤️ Supports Heart and Vascular Health") and an anchored pattern slides straight past the
// emoji. One sampled description ran 16 real steps and then 12 lines of this.
const METHOD_PROSE = /\b(consult your (?:doctor|physician|healthcare)|nutritional values?|not medical advice|disclaimer)\b/i

// No recipe method is longer than this. A backstop for a description whose marketing block uses
// wording none of the rules above anticipate.
const MAX_METHOD_STEPS = 20

/** The creator's published method as ordered steps, or [] when the description carries none. */
export function parseMethodBlock(desc: string): string[] {
  if (!desc) return []
  const lines = desc.split('\n')
  const start = lines.findIndex(l => METHOD_HEADING.test(stripBullet(l)))
  if (start === -1) return []
  const out: string[] = []
  for (const raw of lines.slice(start + 1)) {
    const line = stripBullet(raw)
    if (!line) continue
    if (METHOD_END.test(line) || NOISE_LINE.test(line) || METHOD_PROSE.test(line)) break
    if (out.length >= MAX_METHOD_STEPS) break
    // A method step is a sentence, not a two-word heading, and not a wall of text.
    if (line.length <= 6 || line.length >= 400) continue
    out.push(line)
  }
  return out
}


// ── Ingredients the creator listed with NO quantity ─────────────────────────────────────────────
//
// parseIngredientBlock requires a leading quantity, so "Green Onion", "Cilantro", "Cream cheese"
// and "Smoked salmon" are invisible to it. Measured across 15 real descriptions, roughly 27 real
// ingredients are lost this way.
//
// A first pass at rescuing them looked hopeless — accepting every unquantified non-heading line
// admitted 160 lines, almost all junk. That measurement was wrong because it applied none of the
// gates that already exist. With isNonIngredientLine, the method-heading stop, and the two rules
// below, the same corpus yields ~27 real against 1 junk line.
//
// The two rules that did the work:
//   * The ingredient block STARTS at the first quantified line. Anything unquantified above it is
//     the title, the hook or a promo — that single rule removed every stylised-unicode title.
//   * A leading emoji or symbol defeats an ^-anchored rule, so the prefix is stripped before
//     testing. Same trap already recorded for "🍳 Recipe Steps" and for \b being ASCII-only.
//
// DELIBERATELY NOT part of the retention contract. These are handed to the model as things to
// include, never as things it will be REJECTED for omitting: "Water for soaking" and "Cooking
// Spray" are real lines that a faithful recipe may legitimately leave out, and counting them would
// invent a specification the model cannot meet — the over-extraction failure this parser's own
// comments warn about.
const PROMO_LINE = /\b(save this|follow for more|in my bio|recipe books?|full recipe|try it today|listed below|exact measurements)\b/i
const META_LINE = /^(servings?|calories|macros?|protein|carbs?|fat|per serving|total)\b/i
const SUB_HEADING = /^(for\b|.*:\s*$)/i

export function parseUnquantifiedExtras(desc: string): string[] {
  if (!desc) return []
  const lines = desc.split('\n')
  const out: string[] = []
  let started = false
  // Skip line 0: it is the video title, which is never an ingredient.
  for (let i = 1; i < lines.length; i++) {
    const line = stripBullet(lines[i]).replace(/^[^\p{L}\p{N}]+/u, '').trim()
    if (METHOD_HEADING.test(line) || METHOD_END.test(line)) break
    if (QTY_START.test(line)) { started = true; continue }
    if (!started || !line) continue
    if (SUB_HEADING.test(line) || PROMO_LINE.test(line) || META_LINE.test(line)) continue
    if (isNonIngredientLine(line)) continue
    if (line.length <= 2 || line.length >= 60) continue
    if (!out.includes(line)) out.push(line)
  }
  return out.slice(0, 12)
}


// ── Which SECTION each ingredient belongs to ───────────────────────────────────────────────────
//
// Creators group a recipe into parts and the grouping is load-bearing for the reader. Flattened
// into one list it looks like a bug: "Crispy Pasta Bang Bang Salmon Salad" lists garlic powder
// three times and paprika twice, which is FAITHFUL — the creator seasons the pasta, the salmon and
// the dressing separately — but a flat list gives no way to tell that from a duplicate.
//
// Returned alongside the same lines parseIngredientBlock produces, deliberately as a separate
// function: the retention contract is built from that one and must not change shape.
const SECTION_LABEL = /^(?:for\s+(?:the\s+)?)?([a-z][a-z0-9 &'-]{1,38})\s*:?\s*$/i

/** Tidy a heading into a label: "Bang Bang Dressing:" -> "bang bang dressing", "FOR KEBAB" -> "kebab". */
function sectionLabel(line: string): string | null {
  const m = SECTION_LABEL.exec(line.trim())
  if (!m) return null
  const label = m[1].trim().toLowerCase().replace(/\s+/g, ' ')
  // "ingredients" is the list's own title, not a part of the dish. Neither is a method heading.
  if (/^(ingredients?|recipe|method|directions?|instructions?|steps?|notes?)$/.test(label)) return null
  if (label.length < 3) return null
  return label
}

/**
 * The creator's ingredient lines paired with the section each sits under.
 * `section` is null for lines above any heading, which is the common single-part case.
 */
export function parseIngredientSections(desc: string): { line: string; section: string | null }[] {
  const lines = parseIngredientBlock(desc)
  if (lines.length === 0) return []
  const wanted = new Set(lines)
  const raws = (desc || '').split('\n')
  const isBullet = (raw: string) => new RegExp(`^\\s*(?:${BULLET_CHARS}|${NUMBERED_MARKER}|\\d+️⃣)`).test(raw)

  // Which shape is this description? When the ingredients are BULLETED, an unbulleted line between
  // them is a heading — that is already why parseIngredientBlock keeps only bulleted lines. When
  // nothing is bulleted, a heading has to announce itself with a colon or a leading "For", because
  // otherwise it is indistinguishable from an ingredient listed without a quantity ("Cooking Spray"
  // sits mid-list in a real description and was being read as the heading for everything below it).
  const bulletedMode = raws.some(r => isBullet(r) && wanted.has(stripBullet(r)))

  const out: { line: string; section: string | null }[] = []
  let current: string | null = null
  for (let i = 0; i < raws.length; i++) {
    const line = stripBullet(raws[i])
    // Line 0 is the video title. A recipe is not a section of itself.
    if (i === 0 || !line) continue
    if (METHOD_HEADING.test(line)) break
    if (wanted.has(line)) { out.push({ line, section: current }); continue }
    if (QTY_START.test(line)) continue
    const announced = /:\s*$/.test(raws[i].trim()) || /^for\b/i.test(line)
    if (!announced && !(bulletedMode && !isBullet(raws[i]))) continue
    const label = sectionLabel(line)
    if (label) current = label
  }
  return out
}


// ── Cook temperatures and times stated outside the method ──────────────────────────────────────
//
// Creators often put the numbers in their own block — "Air Fryer Settings: 🌡️ 140°C ⏱️ 35 Minutes",
// "Cooking time 10-15 minutes" — which is neither an ingredient nor a method step, so nothing
// captured it and the model summarised it away. "Chicken Semolina Momos" published "Cooking time
// 10-15 minutes" and the stored step reads "steam until cooked".
//
// This matters more than its size suggests: only 27% of stored meals state any cook time at all,
// and a stated one is the difference between a recipe you can follow and a guess.
const TEMP_OR_TIME = /\d\s*°|\b\d{2,3}\s*°?\s*[cf]\b|\b\d+\s*(?:-\s*\d+\s*)?(?:min(?:ute)?s?|hours?|hrs?|seconds?|secs?)\b/i

/** Lines where the creator stated a temperature or a duration. Deduped against the method. */
export function parseCookSettings(desc: string): string[] {
  if (!desc) return []
  const inMethod = new Set(parseMethodBlock(desc))
  const out: string[] = []
  const raws = desc.split('\n')
  // Line 0 is the video title, and titles sell on time: "Crispy Salmon Wrap in just 5 minutes!"
  // is a hook, not a cook time. Same skip the other parsers here make, for the same reason.
  for (let i = 1; i < raws.length; i++) {
    const line = stripBullet(raws[i]).replace(/^[^\p{L}\p{N}]+/u, '').trim()
    if (!line || line.length > 80) continue
    if (/!/.test(line)) continue   // a sentence selling the recipe, not stating a setting
    if (!TEMP_OR_TIME.test(line)) continue
    if (NOISE_LINE.test(line) || inMethod.has(line)) continue   // already carried by the method list
    if (!out.includes(line)) out.push(line)
    if (out.length >= 6) break
  }
  return out
}

export { parseIngredientBlock, stripBullet }
