// Is this meal ACTUALLY cookable from the pantry, and if not, does that matter?
//
// "Cook Now" promises a dish you can make tonight with what you have. The prompt asks the model to
// use pantry items only and to declare anything else in `missing_ingredients` — and on real output
// it declared the thing that did not matter and hid the thing that did:
//
//   Barbecue Chicken and Rice Plate   missing: ["fresh parsley"]   1g, dish still 100% makeable
//   Cottage Cheese Tortilla Wrap      missing: []                  50g of TORTILLA, none in pantry
//
// Without a tortilla there is no wrap. Without the parsley it is the same dinner. So the check has
// to run in code — the same conclusion the macro bands and the repeat filter already reached about
// this model — and it has to tell those two cases apart, because dropping every meal with any
// unlisted ingredient would throw away good dinners over a herb.

/**
 * Foods a dish is BUILT from. If the recipe calls for one and the pantry has none, the meal is not
 * cookable tonight at any quality — this is not a substitution the user can shrug off.
 *
 * Deliberately separate from BASE_FOODS in dish-key.ts. That list drives the base BAN and is tuned
 * for "what is this dish made of"; this one has to include the VESSEL carbs it omits — tortilla,
 * bread, bun, pita, noodles — which are exactly the ones that turn out to be missing.
 */
const STRUCTURAL = [
  'tortilla', 'wrap', 'bread', 'toast', 'bun', 'roll', 'bagel', 'pita', 'naan', 'crust', 'dough',
  'pasta', 'noodle', 'spaghetti', 'penne', 'macaroni', 'lasagna', 'rice', 'quinoa', 'couscous',
  'potato', 'oats', 'oatmeal', 'cereal', 'granola', 'tortilla chip', 'cracker',
  'chicken', 'beef', 'steak', 'turkey', 'pork', 'bacon', 'sausage', 'ham', 'salmon', 'tuna',
  'shrimp', 'fish', 'tofu', 'tempeh', 'egg', 'egg white',
  'yogurt', 'cottage cheese', 'cream cheese', 'cheese', 'milk', 'protein powder', 'peanut butter',
  'bean', 'lentil', 'chickpea',
]

/**
 * Finishing touches. A dish is the same dinner without them, and the user should be TOLD rather
 * than have the meal withheld. Quantity backs this up: the parsley above was 1g.
 */
const GARNISH = [
  'parsley', 'cilantro', 'coriander', 'chives', 'dill', 'mint', 'basil', 'thyme', 'rosemary',
  'scallion', 'green onion', 'zest', 'juice', 'wedge', 'sprig', 'garnish',
  'sesame seed', 'pepper flake', 'flaky salt', 'sprinkle', 'drizzle', 'topping',
]

/** Below this a non-structural ingredient is a seasoning, whatever it is called. */
export const GARNISH_MAX_GRAMS = 12

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Present when any pantry item shares a meaningful name with the ingredient, in either direction —
 * "cooked rice" covers "rice", and a pantry "Red Potatoes" covers "red potatoes".
 *
 * Deliberately GENEROUS. A false "present" costs a slightly wrong shopping line; a false "missing"
 * drops a dinner the user could have cooked. Given the choice, be wrong in the cheap direction.
 */
export function isInPantry(ingredientName: unknown, pantry: readonly string[]): boolean {
  const ing = norm(ingredientName)
  if (!ing) return true
  for (const raw of pantry) {
    const item = norm(raw)
    if (!item) continue
    if (ing.includes(item) || item.includes(ing)) return true
    // Head-noun fallback: "large eggs" against a pantry "Eggs".
    //
    // SINGULARISED on both sides. Without it the fallback compared "onion" against a pantry
    // "Yellow Onions" and failed on the plural alone, so "diced onion" counted as MISSING against
    // a shelf that had onions on it — and a missing STRUCTURAL ingredient disqualifies the whole
    // meal in Cook Now. Measured against the real 55-item pantry: nine of forty-one plausible
    // ingredient names missed, and this was the largest single cause.
    //
    // The crude rule dishKey and dishArchetype use, PLUS an -oes case, and the difference is not
    // cosmetic: that rule turns "potatoes" into "potatoe", which then fails to match "potato".
    // Potatoes are a pantry staple and were the first thing a test caught. Dish names rarely end
    // in -oes, which is why the other two copies have never needed it.
    const sing = (w: string) => {
      if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2)
      return w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w
    }
    const head = sing(ing.split(' ').filter(Boolean).pop() ?? '')
    const itemLast = sing(item.split(' ').filter(Boolean).pop() ?? '')
    if (head && head.length > 2 && (sing(item) === head || itemLast === head || item.startsWith(head + ' '))) return true
  }
  return false
}

export function isStructural(ingredientName: unknown, grams?: unknown): boolean {
  const n = norm(ingredientName)
  if (!n) return false
  if (GARNISH.some(g => n.includes(g))) return false
  if (STRUCTURAL.some(s => n.includes(s))) return true
  const g = parseFloat(String(grams ?? '').replace(/[^0-9.]/g, ''))
  // Unknown food in a real quantity is treated as structural: a 200g mystery ingredient is more
  // likely a component than a garnish, and being wrong here only costs one candidate meal.
  return Number.isFinite(g) && g > GARNISH_MAX_GRAMS
}

export type MissingReport = { structural: string[]; garnish: string[] }

export function findMissing(
  ingredients: ReadonlyArray<{ name?: unknown; grams?: unknown }> | undefined,
  pantry: readonly string[],
  assumedStaples: readonly string[] = [],
): MissingReport {
  const out: MissingReport = { structural: [], garnish: [] }
  if (!Array.isArray(ingredients)) return out
  for (const ing of ingredients) {
    const name = String(ing?.name ?? '').trim()
    if (!name) continue
    if (isInPantry(name, pantry)) continue
    // The kitchen is assumed to stock these, so they are never "missing" — the prompt says as much
    // to the model and the code has to agree, or salt would disqualify every meal.
    if (isInPantry(name, assumedStaples)) continue
    if (isStructural(name, ing?.grams)) out.structural.push(name)
    else out.garnish.push(name)
  }
  return out
}
