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
  /** real ingredients whose quantity could not be read — the estimate is missing their macros */
  unweighed: string[]
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

  // Shirataki / konjac is ~97% water and glucomannan fibre — about 10 kcal/100g. The pasta row
  // below matches "konjac noodles" on \bnoodles\b and priced a 200g serving at 262 kcal instead of
  // 20, a 13x overstatement. Must precede the pasta row for the same reason "almond milk" precedes
  // almonds.
  { re: /\b(konjac|shirataki)\b/i, kcal: 10, p: 0.2, c: 3, f: 0 },

  // ── COMPOUND NAMES. These must resolve before the generic food they contain, or the broader
  // row below steals them: "almond milk" is not almonds (21g protein vs 1.2) and "chicken broth"
  // is not chicken (31g vs 0.9). Both were caught by the shadowing test, not by review.
  { re: /\b(almond|oat|soy) milk\b/i, kcal: 45, p: 1.2, c: 6, f: 1.5 },
  { re: /\b(broth|stock)\b/i, kcal: 6, p: 0.9, c: 0.5, f: 0.2 },
  // "bean curd" is TOFU. Without this the `curd` row below (Indian dahi, ~3.5g protein) claims it
  // and reports a fifth of the real protein — the same trap diet-tags.ts documents for allergens.
  { re: /\b(bean|soy|soya)[\s-]*curd\b/i, kcal: 144, p: 17.3, c: 2.8, f: 8.7 },
  // "milk chocolate" is chocolate, not milk. The dairy \bmilk\b row sits above the sweets section
  // and was reporting 3.3g protein and 50 kcal for it — an 11x calorie understatement. Caught by
  // the shadowing test, not by reading. diet-tags.ts keeps 'milk chocolate' in COMPOUND_DAIRY for
  // the mirror-image reason.
  { re: /\bmilk chocolate\b/i, kcal: 535, p: 7.6, c: 59.4, f: 29.7 },
  // High-protein pasta is a DIFFERENT FOOD from pasta, and the generic pasta row below matches
  // macaroni/penne/noodles regardless of any qualifier — so all six live rows built on it were
  // priced at plain pasta's 5g. The understatement does not merely blur the estimate: verifyMacros
  // reads it, so a recipe legitimately built on protein pasta reads as a protein OVERCLAIM.
  // "One-Pot Pasta & Peas" (chickpea pasta) was flagged at 1.72x for exactly this reason.
  //
  // Cooked basis, matching the generic pasta row these precede. Legume and protein-enriched wheat
  // are split because they differ enough to be worth it: Banza is ~11g cooked, Barilla Protein+ ~9.
  //
  // Brand names cannot be caught generically — "Carb Diem elbow pasta" is a real stored ingredient
  // and still resolves as plain pasta. Noted rather than guessed at.
  { re: /\b(chickpea|lentil|edamame|black bean|legume|banza)[\s-]*(pasta|penne|macaroni|noodles?|rotini|fusilli|spaghetti|shells?|elbows?)\b/i, kcal: 155, p: 11, c: 27, f: 2.5 },
  { re: /\b(high[\s-]?protein|protein)[\s-]*(pasta|penne|macaroni|noodles?|rotini|fusilli|spaghetti|shells?|elbows?)\b/i, kcal: 160, p: 9, c: 28, f: 1.5 },
  // A ready-to-drink shake is mostly water. Must precede the chocolate rows or "chocolate protein
  // shake" (a real 330g stored ingredient) gets priced as a bar of chocolate — 5x its calories.
  { re: /\bprotein (shake|drink|milkshake)\b/i, kcal: 60, p: 8, c: 3, f: 1.5 },

  // ── nut butters & nuts. MUST precede fats & oils: "peanut butter" has to be claimed here or
  // the generic /butter/ row swallows it and reports 0.85g protein per 100g instead of 25.
  { re: /\bpeanut butter\b/i, kcal: 588, p: 25.1, c: 20, f: 50 },
  { re: /\balmond butter\b/i, kcal: 614, p: 21, c: 19, f: 56 },
  { re: /\bpecans?\b/i, kcal: 691, p: 9.2, c: 13.9, f: 72 },
  { re: /\bwalnuts?\b/i, kcal: 654, p: 15.2, c: 13.7, f: 65 },
  { re: /\balmonds?\b/i, kcal: 579, p: 21.2, c: 21.6, f: 49.9 },
  { re: /\bcashews?\b/i, kcal: 553, p: 18.2, c: 30.2, f: 43.9 },
  { re: /\bchia|flax\s*seeds?\b/i, kcal: 486, p: 16.5, c: 42.1, f: 30.7 },
  { re: /\bsunflower seeds?\b/i, kcal: 584, p: 20.8, c: 20, f: 51.5 },
  { re: /\b(pumpkin|pepita)\s*seeds?\b/i, kcal: 559, p: 30.2, c: 10.7, f: 49 },
  { re: /\bsesame seeds?\b/i, kcal: 573, p: 17.7, c: 23.4, f: 49.7 },
  { re: /\bhemp (hearts?|seeds?)\b/i, kcal: 553, p: 31.6, c: 8.7, f: 48.8 },
  { re: /\bpistachios?\b/i, kcal: 560, p: 20.2, c: 27.2, f: 45.3 },

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
  { re: /\blow[\s-]?fat paneer\b/i, kcal: 206, p: 24, c: 4, f: 10.5 },
  { re: /\bpaneer\b/i, kcal: 296, p: 18.3, c: 3.4, f: 23 },
  { re: /\b(chh?ena|chh?anna)\b/i, kcal: 265, p: 18, c: 2, f: 20 },
  { re: /\b(quark|skyr)\b/i, kcal: 66, p: 11.5, c: 4, f: 0.3 },
  { re: /\b(curd|dahi)\b/i, kcal: 61, p: 3.5, c: 4.7, f: 3.3 },
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
  { re: /\b(cooked )?(pasta|spaghetti|penne|noodles?|soba|udon|orzo|fettuccine|linguine|macaroni|rigatoni|farfalle|lasagne|lasagna)\b/i, kcal: 131, p: 5, c: 25, f: 1.1 },
  { re: /\bquinoa\b/i, kcal: 120, p: 4.4, c: 21.3, f: 1.9 },
  { re: /\b(rolled |steel.cut )?oats?\b|\boatmeal\b/i, kcal: 389, p: 16.9, c: 66.3, f: 6.9 },
  { re: /\bgranola\b/i, kcal: 471, p: 10.1, c: 64.3, f: 20 },
  { re: /\b(tortillas?|wraps?|pita)\b/i, kcal: 300, p: 8, c: 50, f: 7 },
  { re: /\b(bread|toast|bagel|bun|roll|sourdough|loaf|naan|roti|chapati|paratha)\b/i, kcal: 265, p: 9, c: 49, f: 3.2 },
  { re: /\bsweet potato(es)?\b/i, kcal: 86, p: 1.6, c: 20.1, f: 0.1 },
  { re: /\bpotato(es)?\b/i, kcal: 77, p: 2, c: 17.5, f: 0.1 },
  { re: /\b(black beans|kidney beans|pinto|beans)\b/i, kcal: 132, p: 8.9, c: 23.7, f: 0.5 },
  { re: /\b(chickpeas?|garbanzo)\b/i, kcal: 164, p: 8.9, c: 27.4, f: 2.6 },
  { re: /\blentils?\b/i, kcal: 116, p: 9, c: 20.1, f: 0.4 },
  { re: /\bcorn\b/i, kcal: 96, p: 3.4, c: 21, f: 1.5 },

  // ── SOUTH ASIAN STAPLES. The table was Western-biased and it showed: paneer alone accounted for
  // 1,815g across 13 live rows with no entry at all, and 21.5% of all weighed grams in the pool
  // went unpriced. That bias is not only an accuracy problem — coverage feeds macroAgreementScore,
  // so an Indian recipe scored worse than an American one for being unrecognised, and the same
  // blindness is why food-table coverage was rejected as a language detector (a "Lauki Galouti
  // Kebab" scored identically to a Polish ingredient list).
  //
  // DRY vs COOKED: pulses are listed DRY, because creators write dry weights in an ingredient
  // list. The soaked/boiled forms roughly double in weight and so roughly halve per 100g, and are
  // matched first so the prefix wins.
  { re: /\b(soaked|boiled|cooked)\s+\w*\s*(chana|dal|daal|rajma|moong|masoor|toor|urad)\b/i, kcal: 160, p: 9.5, c: 27, f: 1 },
  { re: /\bsoya?\s*(chunks?|granules?|nuggets?)\b/i, kcal: 336, p: 52, c: 33, f: 0.5 },
  { re: /\b(chana|kala chana|chickpea)\s*dal\b|\b(moong|masoor|toor|urad|chana)\b|\bdaals?\b|\bdals?\b/i, kcal: 352, p: 22, c: 60, f: 1.5 },
  { re: /\brajma\b/i, kcal: 333, p: 24, c: 60, f: 0.8 },
  { re: /\bbesan\b|\bgram flour\b/i, kcal: 387, p: 22.4, c: 57.8, f: 6.7 },
  { re: /\batta\b|\bwhole wheat flour\b/i, kcal: 340, p: 13.2, c: 72, f: 2.5 },
  { re: /\b(semolina|sooji|suji|rava)\b/i, kcal: 360, p: 12.7, c: 72.8, f: 1.1 },
  { re: /\b(lauki|bottle gourd|ghiya)\b/i, kcal: 14, p: 0.6, c: 3.4, f: 0.1 },

  // ── flours. Specific before generic, or "almond flour" (50g fat) is priced as wheat (1g).
  { re: /\balmond flour\b|\balmond meal\b/i, kcal: 571, p: 21.2, c: 21.6, f: 50 },
  { re: /\bcoconut flour\b/i, kcal: 400, p: 18, c: 60, f: 13 },
  { re: /\boat flour\b/i, kcal: 389, p: 16.9, c: 66.3, f: 6.9 },
  { re: /\bflour\b/i, kcal: 364, p: 10.3, c: 76.3, f: 1 },

  // ── chocolate & sweets. Cocoa POWDER is not chocolate — 228 kcal against 546 — and it appeared
  // in 18 rows. The generic row is last so the specific forms claim their own names first.
  { re: /\b(cocoa|cacao)\s*powder\b/i, kcal: 228, p: 19.6, c: 57.9, f: 13.7 },
  { re: /\bdark chocolate\b/i, kcal: 546, p: 7.8, c: 45.9, f: 31.3 },
  { re: /\bwhite chocolate\b/i, kcal: 539, p: 5.9, c: 59.2, f: 32.1 },
  { re: /\bchocolate chips?\b/i, kcal: 480, p: 4.2, c: 63, f: 25 },
  { re: /\bchocolate\b|\bcocoa\b|\bcacao\b/i, kcal: 500, p: 5, c: 60, f: 28 },
  { re: /\b(medjool )?dates?\b/i, kcal: 282, p: 2.5, c: 75, f: 0.4 },
  { re: /\b(biscoff|speculoos)\b/i, kcal: 500, p: 5, c: 70, f: 22 },
  { re: /\b(oreo|cookies?|biscuits?)\b/i, kcal: 480, p: 5, c: 70, f: 20 },

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
  { re: /\b(bell )?peppers?\b|\bcapsicum\b|jalape[nñ]o/i, kcal: 31, p: 1, c: 6, f: 0.3 },
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
  // Jarred pasta sauces read as produce-adjacent but carry real fat. "vodka sauce" was the single
  // largest unmatched line in the pool at 700g.
  { re: /\b(vodka|marinara|bolognese|pasta|tomato|alfredo|arrabbiata)\s*sauce\b/i, kcal: 110, p: 2, c: 12, f: 5 },
  { re: /\b(buffalo|wing|bbq|barbecue|teriyaki|chilli?|sweet chilli?)\s*sauce\b/i, kcal: 90, p: 1, c: 20, f: 0.5 },
  { re: /\b(media crema|table cream|single cream|double cream)\b/i, kcal: 200, p: 2.5, c: 4, f: 19 },
  { re: /\b(frozen )?(mixed )?(vegetables?|veg|veggies)\b/i, kcal: 65, p: 3, c: 12, f: 0.4 },
  { re: /\bpeas\b/i, kcal: 81, p: 5.4, c: 14.5, f: 0.4 },
  { re: /\bmangoe?s?\b/i, kcal: 60, p: 0.8, c: 15, f: 0.4 },
  { re: /\bpineapples?\b/i, kcal: 50, p: 0.5, c: 13, f: 0.1 },
]

// Household measures the generator puts in the `grams` field despite the name. Approximate on
// purpose — a lie detector with a 1.5x bar does not care that a tbsp of honey is 21g and a tbsp
// of oil is 13.5g, it cares that neither is 1g.
const UNIT_G: Array<[RegExp, number]> = [
  [/\bscoops?\b/, 30],       // protein powder scoops run 28-35g
  [/\btablespoons?\b|\btbsps?\b/, 15],
  [/\bteaspoons?\b|\btsps?\b/, 5],
  [/\bcups?\b/, 240],
  [/\bcloves?\b/, 5],
  [/\bslices?\b/, 30],
  [/\bcans?\b/, 400],
  [/\bhandfuls?\b/, 30],
  [/\bpinch(es)?\b|\bdash(es)?\b/, 1],
]

export type ParsedQty = {
  /** grams, 0 when nothing usable could be read */
  g: number
  /** false when a quantity was present but its unit was not understood — such an ingredient must
   *  count AGAINST coverage rather than silently contributing a wrong number */
  known: boolean
}

/**
 * "120g" | "15ml" | "1.5 oz" | "1 scoop" | 200 -> grams.
 *
 * A bare number is read as grams, which is the documented contract for this field. The unit
 * conversions exist because the generator does NOT always honour it: a real meal shipped
 * "1 scoop" protein powder, "1 tbsp" butter and "1 tsp" maple syrup, and reading those as 1g each
 * cost ~24g of protein and made an honest meal look like it was overstating by 1.51x.
 */
export function parseQty(raw: string | number | undefined): ParsedQty {
  if (raw === undefined || raw === null) return { g: 0, known: false }
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? { g: raw, known: true } : { g: 0, known: false }
  const s = String(raw).trim().toLowerCase()
  const n = parseFloat(s.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return { g: 0, known: false }

  if (/\bkg\b/.test(s)) return { g: n * 1000, known: true }
  if (/\blbs?\b|\bpounds?\b/.test(s)) return { g: n * 453.6, known: true }
  if (/\boz\b|\bounces?\b/.test(s)) return { g: n * 28.35, known: true }
  for (const [re, grams] of UNIT_G) if (re.test(s)) return { g: n * grams, known: true }
  if (/\d\s*(g|grams?|ml|milliliters?)\b/.test(s)) return { g: n, known: true }
  // A number with no unit at all: trust the field name and read it as grams.
  if (/^[\d.\s/]+$/.test(s)) return { g: n, known: true }
  // A number with a unit we do not recognise ("1 palm-sized piece"). Guessing here is how an
  // honest meal gets dropped, so report the weight as unusable and let coverage fall.
  return { g: 0, known: false }
}

/** Back-compat convenience — grams only. */
export function parseGrams(raw: string | number | undefined): number {
  return parseQty(raw).g
}

export function estimateMacros(ingredients: MacroIngredient[] | undefined): MacroEstimate {
  const out: MacroEstimate = { kcal: 0, protein: 0, carbs: 0, fat: 0, matchedG: 0, totalG: 0, coverage: 0, unmatched: [], unweighed: [] }
  if (!Array.isArray(ingredients)) return out

  for (const ing of ingredients) {
    const name = String(ing?.name ?? '').trim()
    if (!name) continue
    const qty = parseQty(ing?.grams)
    const row = TABLE.find(r => r.re.test(name))

    if (qty.g <= 0) {
      // No usable weight. Harmless for a zero-macro seasoning ("salt, to taste"), but for a real
      // contributor it means the estimate is missing food and must not be used to accuse anyone.
      if (row && row.kcal > 20) out.unweighed.push(name)
      continue
    }
    out.totalG += qty.g
    if (!row) { out.unmatched.push(name); continue }
    out.matchedG += qty.g
    const k = qty.g / 100
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

  // An ingredient we can price but cannot weigh leaves a hole in the estimate. Accusing a meal of
  // overstating protein while knowingly omitting one of its protein sources is how this check
  // would drop honest food, so abstain instead.
  if (estimate.unweighed.length > 0) {
    return {
      ok: true, skipped: true, estimate, proteinRatio, kcalRatio,
      reason: `unreadable quantity on ${estimate.unweighed.join(', ')} — estimate incomplete`,
    }
  }
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

// ── Internal macro coherence ────────────────────────────────────────────────────────────────
// verifyMacros compares a claim against an INGREDIENT-derived estimate, so it abstains whenever
// the ingredients cannot be weighed — which is often, and is why it was never a per-row verdict.
// This is the complementary check and it needs no reference data at all: do the four numbers the
// model returned agree with each other? Logan's framing when he found "Jello": "someone who can do
// quick math would look at that and call this app unreliable." This is that quick math.
//
// The trending pipeline ran NO macro check of any kind — verifyMacros is imported only by
// generate-meals. Measured across the 178 live rows: 124 within 5%, 42 at 5-10%, 11 at 10-20%,
// 1 at 64%.
//
// THRESHOLDS ARE TUNED AGAINST THAT DISTRIBUTION, not guessed:
//  * The 10-14% band is almost entirely protein desserts (Brownie Muffin, Funfetti Protein Cake,
//    two cheesecakes, Mega Protein Ice Cream). That is exactly where sugar alcohols (~0.2-2.4
//    kcal/g against Atwater's 4) and fiber (~2 against 4) live, so the "error" is real food being
//    measured by an approximation. Rejecting it would drop good rows.
//  * Percentage alone is the wrong lens on small dishes: Jello's 12% is 12 kcal, while Philly
//    Cheesesteak Pasta's 10.3% is 37 kcal. Requiring BOTH a large fraction and a large absolute
//    gap stops small dishes being punished for rounding.
// On the live pool these rules reject exactly 1 of 178 rows, and it is the one that is genuinely
// broken rather than the one that was easiest to notice.
const ATWATER_MIN_ABS_GAP = 50   // kcal — below this, the fraction does not matter
const ATWATER_MAX_FRACTION = 0.25 // and the gap must also exceed this share of the stated calories

export function macroIncoherence(m: {
  calories?: unknown; protein?: unknown; carbs?: unknown; fat?: unknown
}): string | null {
  const kcal = Number(m?.calories) || 0
  const p = Number(m?.protein) || 0
  const c = Number(m?.carbs) || 0
  const f = Number(m?.fat) || 0
  // Nothing to check. A missing/zero calorie figure is the noMacros gate's job, not this one.
  if (kcal <= 0) return null

  // Two macros at zero together is not a rounding artefact, it is a missing answer. Live example:
  // "Pepperoni Pizza Pasta", 540 kcal, 48g protein, 0 carbs, 0 fat — a pasta dish with pepperoni
  // and cheese. Deliberately requires BOTH to be zero: fat=0 alone is legitimate and common
  // (Jello is gelatin and water, and its 0 is correct), and carbs=0 alone is a real low-carb dish.
  if (c === 0 && f === 0) {
    return `carbs and fat both 0 against ${kcal} kcal — macros missing, not low`
  }

  const atwater = p * 4 + c * 4 + f * 9
  const gap = Math.abs(kcal - atwater)
  if (gap >= ATWATER_MIN_ABS_GAP && gap / kcal > ATWATER_MAX_FRACTION) {
    return `stated ${kcal} kcal vs ${atwater} from ${p}p/${c}c/${f}f — off by ${gap} kcal (${Math.round(gap / kcal * 100)}%)`
  }
  return null
}

// ── Macros computed from the creator's own ingredients ──────────────────────────────────────
// The trending prompt already tells the model: "If the description doesn't list explicit macros,
// calculate ONLY from the ingredients exactly as the creator listed them." The model does not
// reliably comply. Live example: "Jello" (hcBwG5_7POU) — the creator published no macros at all,
// 120g of beef gelatin is ~26g protein per serving across the batch, and the model returned 20g
// and invented a serving count the creator never gave.
//
// Multiplying grams by 4 is not a job for a language model. estimateMacros already does it
// deterministically off a lookup table, so when the creator published nothing we compute the
// numbers here instead of asking. Same yield — no video is rejected for lacking macros — but the
// number stops being a guess.
//
// Returns null when the estimate is not trustworthy enough to publish, using the SAME guards
// verifyMacros abstains on: an unreadable quantity means real food is missing from the total, and
// low coverage means the lookup table did not recognise enough of the dish. Null is the caller's
// signal to keep the model's numbers and label them as such, never to invent a fallback.
export function computePerServingMacros(
  ingredients: MacroIngredient[] | undefined,
  servings: number,
): { calories: number; protein: number; carbs: number; fat: number } | null {
  const n = Math.max(1, Math.round(Number(servings) || 1))
  const est = estimateMacros(ingredients)
  // An ingredient we can price but cannot weigh leaves a hole. Publishing a total that is knowingly
  // missing a protein source is worse than admitting the number came from the model.
  if (est.unweighed.length > 0) return null
  if (est.totalG < MACRO_TOLERANCE.minTotalG || est.coverage < MACRO_TOLERANCE.minCoverage) return null
  // estimateMacros works at FULL BATCH scale, matching how ingredients are stored; macros are
  // per serving. This division is the one place the two scales meet — see CLAUDE.md on never
  // scaling ingredients to match macros, which is the same bug in the opposite direction.
  const per = (v: number) => Math.max(0, Math.round(v / n))
  return { calories: per(est.kcal), protein: per(est.protein), carbs: per(est.carbs), fat: per(est.fat) }
}
