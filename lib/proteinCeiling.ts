// How much protein this pantry can honestly put in ONE meal — so the "light on protein" line on Home
// only fires when the SHELF is the limit, never because the goal moved.
//
// The first version showed the line whenever every meal in the deck missed the floor. Raising the
// protein goal to 300g produced exactly that deck and the line blamed the pantry for it — Logan's
// objection, and correct: the message's whole job is to name the cause, and it named the wrong one.
// Now the deck being short is only the SYMPTOM; this is the cause test. The two densest protein
// foods on the shelf, each at a culinary-normal 200g (a scoop and a half for powder), inside the
// per-meal calorie budget. If that cannot reach the target, adding a protein source is the honest
// advice. If it can, the shortfall belongs to the generator and is tracked server-side, not blamed
// on the user.
//
// Densities mirror supabase/functions/_shared/macro-estimate.ts (per 100g). Client-side copy on
// purpose: the deck response is a bare array and the app never sees the server's table.

type Food = { re: RegExp; p: number; kcal: number; capG?: number }

// Most specific first — "chicken breast" before "chicken", "greek yogurt" before "yogurt".
const PROTEIN_FOODS: readonly Food[] = [
  { re: /\bprotein powder|whey|casein\b/i, p: 75, kcal: 375, capG: 60 },
  { re: /\bchicken breast\b/i, p: 31, kcal: 165 },
  { re: /\bchicken\b/i, p: 27, kcal: 190 },
  { re: /\bturkey\b/i, p: 25, kcal: 150 },
  { re: /\b(steak|ribeye|sirloin|beef)\b/i, p: 26, kcal: 250 },
  { re: /\bground beef|mince\b/i, p: 19, kcal: 215 },
  { re: /\bpork\b/i, p: 27, kcal: 240 },
  { re: /\btuna\b/i, p: 25, kcal: 116 },
  { re: /\bsalmon\b/i, p: 20, kcal: 208 },
  { re: /\b(shrimp|prawns?)\b/i, p: 24, kcal: 99 },
  { re: /\b(cod|tilapia|halibut|fish)\b/i, p: 20, kcal: 90 },
  { re: /\b(liquid )?egg whites?\b/i, p: 10.9, kcal: 52 },
  { re: /\beggs?\b/i, p: 12.6, kcal: 143 },
  { re: /\bgreek yogurt|skyr\b/i, p: 10.3, kcal: 59 },
  { re: /\bcottage cheese\b/i, p: 11.8, kcal: 84 },
  { re: /\btempeh\b/i, p: 19, kcal: 195 },
  { re: /\btofu\b/i, p: 17.3, kcal: 144 },
  { re: /\b(cheddar|mozzarella|parmesan|shredded cheese|sliced cheese|feta|cheese)\b/i, p: 25, kcal: 400 },
  { re: /\bpeanut butter\b/i, p: 25, kcal: 588 },
  { re: /\b(lentils?|chickpeas?|black beans|kidney beans|beans)\b/i, p: 9, kcal: 125 },
  { re: /\bedamame\b/i, p: 11, kcal: 121 },
  { re: /\bhummus\b/i, p: 8, kcal: 166 },
  { re: /\byogurt|yoghurt\b/i, p: 3.5, kcal: 61 },
  { re: /\bmilk\b/i, p: 3.3, kcal: 50 },
]

/** Grams of protein the pantry can carry in one meal at normal portions inside `calorieTarget`. */
export function pantryProteinCeiling(pantryNames: Iterable<string>, calorieTarget: number): number {
  const foods: Food[] = []
  for (const name of pantryNames) {
    const hit = PROTEIN_FOODS.find(f => f.re.test(String(name)))
    // "Oat Milk" is not milk and "Almond Butter" is not peanut butter — the server's derived-product
    // rule, in miniature. Plant milks carry no protein worth counting here.
    if (hit && !/\b(oat|almond|soy|coconut|cashew|rice) (milk|butter)\b/i.test(String(name))) foods.push(hit)
  }
  const best = [...new Set(foods)].sort((a, b) => b.p - a.p).slice(0, 2)
  let kcal = 0, protein = 0
  for (const f of best) {
    const cap = f.capG ?? 200
    const grams = Math.min(cap, Math.max(0, ((Math.max(calorieTarget, 1) - kcal) / f.kcal) * 100))
    protein += (f.p * grams) / 100
    kcal += (f.kcal * grams) / 100
  }
  return Math.round(protein)
}

// Above this no single meal is expected to carry the target, whatever the shelf holds — a shortfall
// there is the goal's, and the line must not blame the pantry for it.
export const REALISTIC_MEAL_PROTEIN_MAX = 70
