// Independent macro estimate from an ingredient list.
//
// WHY THIS EXISTS: generate-meals treats protein and calories as blocking constraints, but every
// gate in that function reads the numbers the MODEL reported — the same model that wrote the
// ingredient list. Nothing cross-checked one against the other, so a meal whose ingredients only
// support 35g of protein could claim 70g and sail through both the band check and the fit ranking.
// Worse, the ranking rewards meals whose claimed numbers sit closest to target, which selects for
// confident numbers rather than accurate ones.
//
// This is deliberately a REFERENCE TABLE, not a food-database lookup. The job is catching a meal
// that is lying by 2x, not computing exact nutrition — and a local table costs no latency, no API
// budget, and no rate limit inside a function that already runs close to its wall clock.
// FatSecret (lib/fatsecret.ts) stays the source of truth for anything the USER logs.

export type MacroIngredient = { name?: string; grams?: string | number; visual?: string }

export type MacroEstimate = {
  kcal: number
  protein: number
  carbs: number
  fat: number
  /** grams that matched a table row */
  matchedG: number
  /** grams seen across all ingredients with a parseable quantity */
  totalG: number
  /** matchedG / totalG — below ~0.7 the estimate is too partial to judge anything by */
  coverage: number
  unmatched: string[]
}

type Row = { re: RegExp; kcal: number; p: number; c: number; f: number }

// Per 100g. Ordered MOST SPECIFIC FIRST — the first regex that hits wins, so "greek yogurt" must
// precede "yogurt" and "chicken breast" must precede "chicken". Values are ordinary reference
// figures; they only need to be close enough to separate an honest meal from an invented one.
const TABLE: Row[] = [
  // ── seasonings & aromatics: ~0 macros, but they still occupy grams. Listed FIRST and matched
  // so they count as covered rather than dragging coverage down and suppressing the check.
  // "pepper" is qualified on purpose — a bare /pepper/ here also swallowed "bell pepper" and
  // zeroed a real vegetable, while "bell peppers" (plural) slipped past to produce. Same trap
  // applies to any future seasoning whose name is a substring of a whole food.
  { re: /\b(salt|(black|white|red|ground) pepper|peppercorns?|spices?|seasoning|herbs?|cumin|paprika|oregano|basil|thyme|rosemary|cinnamon|turmeric|chili powder|cayenne|garlic powder|onion powder|baking (powder|soda)|vanilla extract|water|ice)\b/i, kcal: 0, p: 0, c: 0, f: 0 },

  // ── COMPOUND NAMES. These must resolve before the generic food they contain, or the broader
  // row below steals them: "almond milk" is not almonds (21g protein vs 1.2) and "chicken broth"
  // is not chicken (31g vs 0.9). Both were caught by the shadowing test, not by review.
  { re: /\b(almond|oat|soy) milk\b/i, kcal: 45, p: 1.2, c: 6, f: 1.5 },
  { re: /\b(broth|stock)\b/i, kcal: 6, p: 0.9, c: 0.5, f: 0.2 },

  // ── nut butters & nuts. MUST precede fats & oils: "peanut butter" has to be claimed here or
  // the generic /butter/ row swallows it and reports 0.85g protein per 100g instead of 25.
  { re: /\bpeanut butter\b/i, kcal: 588, p: 25.1, c: 20, f: 50 },
  { re: /\balmond butter\b/i, kcal: 614, p: 21, c: 19, f: 56 },
  { re: /\bpecans?\b/i, kcal: 691, p: 9.2, c: 13.9, f: 72 },
  { re: /\bwalnuts?\b/i, kcal: 654, p: 15.2, c: 13.7, f: 65 },
  { re: /\balmonds?\b/i, kcal: 579, p: 21.2, c: 21.6, f: 49.9 },
  { re: /\bcashews?\b/i, kcal: 553, p: 18.2, c: 30.2, f: 43.9 },
  { re: /\bchia|flax\s*seeds?\b/i, kcal: 486, p: 16.5, c: 42.1, f: 30.7 },

  // ── fats & oils
  { re: /\b(olive|avocado|coconut|vegetable|canola|sesame|peanut)\s*oil\b/i, kcal: 884, p: 0, c: 0, f: 100 },
  { re: /\boil\b/i, kcal: 884, p: 0, c: 0, f: 100 },
  { re: /\bbutter\b/i, kcal: 717, p: 0.85, c: 0.06, f: 81.1 },
  { re: /\bghee\b/i, kcal: 900, p: 0, c: 0, f: 100 },
  { re: /\bmayo(nnaise)?\b/i, kcal: 680, p: 1, c: 0.6, f: 75 },

  // ── dairy & eggs (specific forms first — this is where the egg-white bug lived)
  { re: /\b(liquid )?egg whites?\b/i, kcal: 52, p: 10.9, c: 0.73, f: 0.17 },
  { re: /\begg yolks?\b/i, kcal: 322, p: 15.9, c: 3.6, f: 26.5 },
  { re: /\beggs?\b/i, kcal: 143, p: 12.6, c: 0.7, f: 9.5 },
  { re: /\bgreek yogurt\b/i, kcal: 59, p: 10.3, c: 3.6, f: 0.4 },
  { re: /\byogh?urt\b/i, kcal: 61, p: 3.5, c: 4.7, f: 3.3 },
  { re: /\bcottage cheese\b/i, kcal: 84, p: 11.8, c: 4.3, f: 2.3 },
  { re: /\b(cream cheese)\b/i, kcal: 342, p: 6, c: 4.1, f: 34 },
  { re: /\b(parmesan|pecorino)\b/i, kcal: 431, p: 38.5, c: 4.1, f: 29 },
  { re: /\b(feta)\b/i, kcal: 264, p: 14.2, c: 4.1, f: 21.3 },
  { re: /\b(mozzarella)\b/i, kcal: 300, p: 22.2, c: 2.2, f: 22.4 },
  { re: /\b(cheddar|shredded cheese|cheese)\b/i, kcal: 403, p: 24.9, c: 1.3, f: 33.1 },
  { re: /\bheavy cream\b/i, kcal: 340, p: 2.1, c: 2.8, f: 36 },
  { re: /\bmilk\b/i, kcal: 50, p: 3.3, c: 4.8, f: 2 },
  { re: /\bprotein powder|whey\b/i, kcal: 375, p: 75, c: 10, f: 5 },

  // ── meat, fish, plant protein
  { re: /\bchicken (breast|thigh|tenderloin)s?\b/i, kcal: 120, p: 22.5, c: 0, f: 2.6 },
  { re: /\b(rotisserie|shredded|cooked) chicken\b/i, kcal: 165, p: 31, c: 0, f: 3.6 },
  { re: /\bchicken salad\b/i, kcal: 190, p: 14, c: 3, f: 13 },
  { re: /\bchicken\b/i, kcal: 165, p: 31, c: 0, f: 3.6 },
  { re: /\bground (beef|chuck)\b/i, kcal: 215, p: 18.6, c: 0, f: 15 },
  { re: /\b(steak|sirloin|beef)\b/i, kcal: 217, p: 26, c: 0, f: 12 },
  { re: /\bground turkey\b/i, kcal: 148, p: 19.7, c: 0, f: 7.7 },
  { re: /\b(turkey|deli meat|ham)\b/i, kcal: 135, p: 22, c: 1.5, f: 4 },
  { re: /\bbacon\b/i, kcal: 541, p: 37, c: 1.4, f: 42 },
  { re: /\b(pork|chop)\b/i, kcal: 242, p: 27, c: 0, f: 14 },
  { re: /\bsalmon\b/i, kcal: 208, p: 20.4, c: 0, f: 13.4 },
  { re: /\b(tuna)\b/i, kcal: 116, p: 25.5, c: 0, f: 0.8 },
  { re: /\b(shrimp|prawns?)\b/i, kcal: 85, p: 20.1, c: 0, f: 0.5 },
  { re: /\b(cod|tilapia|halibut|trout|white fish)\b/i, kcal: 105, p: 21, c: 0, f: 2 },
  { re: /\btofu\b/i, kcal: 144, p: 17.3, c: 2.8, f: 8.7 },
  { re: /\b(tempeh)\b/i, kcal: 192, p: 20.3, c: 7.6, f: 10.8 },

  // ── grains & starches. "cooked" forms differ ~3x from dry, so both are listed.
  { re: /\b(cooked )?(white |brown |jasmine |basmati )?rice\b/i, kcal: 130, p: 2.7, c: 28.2, f: 0.3 },
  { re: /\b(cooked )?(pasta|spaghetti|penne|noodles?|soba|udon)\b/i, kcal: 131, p: 5, c: 25, f: 1.1 },
  { re: /\bquinoa\b/i, kcal: 120, p: 4.4, c: 21.3, f: 1.9 },
  { re: /\b(rolled |steel.cut )?oats?\b|\boatmeal\b/i, kcal: 389, p: 16.9, c: 66.3, f: 6.9 },
  { re: /\bgranola\b/i, kcal: 471, p: 10.1, c: 64.3, f: 20 },
  { re: /\b(tortillas?|wraps?|pita)\b/i, kcal: 300, p: 8, c: 50, f: 7 },
  { re: /\b(bread|toast|bagel|bun|roll)\b/i, kcal: 265, p: 9, c: 49, f: 3.2 },
  { re: /\bsweet potato(es)?\b/i, kcal: 86, p: 1.6, c: 20.1, f: 0.1 },
  { re: /\bpotato(es)?\b/i, kcal: 77, p: 2, c: 17.5, f: 0.1 },
  { re: /\b(black beans|kidney beans|pinto|beans)\b/i, kcal: 132, p: 8.9, c: 23.7, f: 0.5 },
  { re: /\b(chickpeas?|garbanzo)\b/i, kcal: 164, p: 8.9, c: 27.4, f: 2.6 },
  { re: /\blentils?\b/i, kcal: 116, p: 9, c: 20.1, f: 0.4 },
  { re: /\bcorn\b/i, kcal: 96, p: 3.4, c: 21, f: 1.5 },

  // ── produce
  { re: /\bavocados?\b/i, kcal: 160, p: 2, c: 8.5, f: 14.7 },
  { re: /\bbananas?\b/i, kcal: 89, p: 1.1, c: 22.8, f: 0.3 },
  { re: /\b(blue|straw|rasp|black)berries|\bberries\b/i, kcal: 57, p: 0.7, c: 14.5, f: 0.3 },
  { re: /\bapples?\b/i, kcal: 52, p: 0.3, c: 13.8, f: 0.2 },
  { re: /\b(oranges?|mandarin|clementine)\b/i, kcal: 47, p: 0.9, c: 11.8, f: 0.1 },
  { re: /\b(spinach|kale|arugula|greens)\b/i, kcal: 23, p: 2.9, c: 3.6, f: 0.4 },
  { re: /\b(lettuce|romaine|cabbage)\b/i, kcal: 17, p: 1.2, c: 3.3, f: 0.3 },
  { re: /\bbroccoli\b/i, kcal: 34, p: 2.8, c: 6.6, f: 0.4 },
  { re: /\bcauliflower\b/i, kcal: 25, p: 1.9, c: 5, f: 0.3 },
  { re: /\b(bell )?peppers?\b/i, kcal: 31, p: 1, c: 6, f: 0.3 },
  { re: /\b(tomato(es)?|salsa)\b/i, kcal: 22, p: 1, c: 4.5, f: 0.2 },
  { re: /\bonions?\b/i, kcal: 40, p: 1.1, c: 9.3, f: 0.1 },
  { re: /\bgarlic\b/i, kcal: 149, p: 6.4, c: 33.1, f: 0.5 },
  { re: /\bcarrots?\b/i, kcal: 41, p: 0.9, c: 9.6, f: 0.2 },
  { re: /\b(cucumbers?|zucchini|squash)\b/i, kcal: 16, p: 0.9, c: 3.4, f: 0.2 },
  { re: /\bmushrooms?\b/i, kcal: 22, p: 3.1, c: 3.3, f: 0.3 },
  { re: /\b(lemons?|limes?)\b/i, kcal: 29, p: 1.1, c: 9.3, f: 0.3 },

  // ── condiments & sweeteners
  { re: /\b(honey|maple syrup|agave)\b/i, kcal: 304, p: 0.3, c: 82.1, f: 0 },
  { re: /\bsugar\b/i, kcal: 387, p: 0, c: 100, f: 0 },
  { re: /\bsoy sauce|tamari\b/i, kcal: 53, p: 8.1, c: 4.9, f: 0.1 },
  { re: /\bketchup\b/i, kcal: 101, p: 1.3, c: 25.8, f: 0.1 },
  { re: /\bmustard\b/i, kcal: 66, p: 4, c: 5.8, f: 3.3 },
  { re: /\b(hot sauce|sriracha|vinegar|relish|pickles?)\b/i, kcal: 20, p: 0.5, c: 3, f: 0.2 },
  { re: /\b(pesto)\b/i, kcal: 450, p: 5, c: 6, f: 45 },
  { re: /\b(hummus)\b/i, kcal: 166, p: 7.9, c: 14.3, f: 9.6 },
]

/** "120g" | "15ml" | "1.5 oz" | 200 -> grams. ml is treated as grams; close enough for a lie check. */
export function parseGrams(raw: string | number | undefined): number {
  if (raw === undefined || raw === null) return 0
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0
  const s = String(raw).trim().toLowerCase()
  const n = parseFloat(s.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return 0
  if (/\boz\b/.test(s)) return n * 28.35
  if (/\blbs?\b|\bpounds?\b/.test(s)) return n * 453.6
  if (/\bkg\b/.test(s)) return n * 1000
  return n // g, ml, or bare number
}

export function estimateMacros(ingredients: MacroIngredient[] | undefined): MacroEstimate {
  const out: MacroEstimate = { kcal: 0, protein: 0, carbs: 0, fat: 0, matchedG: 0, totalG: 0, coverage: 0, unmatched: [] }
  if (!Array.isArray(ingredients)) return out

  for (const ing of ingredients) {
    const name = String(ing?.name ?? '').trim()
    const g = parseGrams(ing?.grams)
    if (!name || g <= 0) continue
    out.totalG += g
    const row = TABLE.find(r => r.re.test(name))
    if (!row) { out.unmatched.push(name); continue }
    out.matchedG += g
    const k = g / 100
    out.kcal += row.kcal * k
    out.protein += row.p * k
    out.carbs += row.c * k
    out.fat += row.f * k
  }
  out.coverage = out.totalG > 0 ? out.matchedG / out.totalG : 0
  for (const key of ['kcal', 'protein', 'carbs', 'fat'] as const) out[key] = Math.round(out[key] * 10) / 10
  return out
}

export type MacroClaim = { calories?: number; protein?: number; carbs?: number; fat?: number }

export type MacroVerdict = {
  /** false only when the claim is contradicted by the ingredients with enough coverage to be sure */
  ok: boolean
  /** true when coverage was too low to judge — treated as ok, but worth logging */
  skipped: boolean
  reason: string
  estimate: MacroEstimate
  proteinRatio: number
  kcalRatio: number
}

// Tolerances are deliberately loose. The table is approximate and portion weights vary, so this
// must only fire on claims the ingredients cannot support under any reasonable reading. The two
// asymmetric directions are the ones that mislead a user tracking macros: protein OVERstated
// (they think they hit their goal) and calories UNDERstated (they think they're in deficit).
export const MACRO_TOLERANCE = {
  minCoverage: 0.7,
  /** claimed protein may not exceed the estimate by more than this multiple */
  proteinOver: 1.5,
  /** claimed calories may not fall below the estimate by more than this fraction */
  kcalUnder: 0.65,
  /** below this many grams the meal is too small to reason about */
  minTotalG: 80,
}

export function verifyMacros(claim: MacroClaim, ingredients: MacroIngredient[] | undefined): MacroVerdict {
  const estimate = estimateMacros(ingredients)
  const claimedP = Number(claim?.protein) || 0
  const claimedK = Number(claim?.calories) || 0
  const proteinRatio = estimate.protein > 0 ? claimedP / estimate.protein : 0
  const kcalRatio = estimate.kcal > 0 ? claimedK / estimate.kcal : 0

  if (estimate.totalG < MACRO_TOLERANCE.minTotalG || estimate.coverage < MACRO_TOLERANCE.minCoverage) {
    return {
      ok: true, skipped: true, estimate, proteinRatio, kcalRatio,
      reason: `coverage ${(estimate.coverage * 100).toFixed(0)}% of ${estimate.totalG.toFixed(0)}g — not enough to judge`,
    }
  }
  if (estimate.protein > 0 && proteinRatio > MACRO_TOLERANCE.proteinOver) {
    return {
      ok: false, skipped: false, estimate, proteinRatio, kcalRatio,
      reason: `claims ${claimedP}g protein, ingredients support ~${estimate.protein}g (${proteinRatio.toFixed(2)}x)`,
    }
  }
  if (estimate.kcal > 0 && kcalRatio > 0 && kcalRatio < MACRO_TOLERANCE.kcalUnder) {
    return {
      ok: false, skipped: false, estimate, proteinRatio, kcalRatio,
      reason: `claims ${claimedK} kcal, ingredients suggest ~${estimate.kcal.toFixed(0)} kcal (${kcalRatio.toFixed(2)}x)`,
    }
  }
  return {
    ok: true, skipped: false, estimate, proteinRatio, kcalRatio,
    reason: `protein ${proteinRatio.toFixed(2)}x, kcal ${kcalRatio.toFixed(2)}x of estimate`,
  }
}
