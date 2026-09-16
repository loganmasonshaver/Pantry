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
 * Present when a pantry item names the SAME FOOD as the ingredient — the ingredient plus
 * adjectives ("cooked rice" for rice), a cut of it ("chicken breast" for chicken), or its plural.
 *
 * Still GENEROUS where it is honest to be: a pantry "Oat Milk" covers "milk", "Ground Beef" covers
 * "beef", "Chicken Thighs" covers "chicken breast". A false "present" costs a slightly wrong
 * shopping line; a false "missing" drops a dinner the user could have cooked.
 *
 * NOT generous about a different food that merely contains the word. "Banana Peppers" is peppers;
 * a bare substring test called it banana, passed a banana smoothie as cookable, and the card said
 * "Ready to cook" over a shelf with no banana on it. The same test accepted "eggplant" for egg,
 * "licorice" for rice and "salted butter" for salt.
 */
// A product MADE from a food, named "<food> <product>". It does not stock the food itself: pantry
// "Oat Milk" was covering "oats" through the head-noun rule below ("oat milk" starts with "oat "),
// so a porridge with no oats passed as cookable tonight and the card said "Better with: oats".
// The same shape let "rice vinegar" cover rice, "tomato sauce" tomatoes, "almond butter" almonds.
const DERIVED_PRODUCT = /^(.+?) (milk|flour|butter|oil|syrup|water|juice|powder|sauce|paste|extract|cream|vinegar|broth|stock|chips|bars?|cookies|cakes|drink|spread|wine)$/

// Last words that name a CLASS of product rather than a food. Two items sharing one of these share
// nothing: the modifier in front of it is the actual ingredient. See the head-noun rule below.
const GENERIC_HEAD = new Set(['powder', 'sauce', 'oil', 'butter', 'milk', 'cream', 'flour', 'vinegar',
  'syrup', 'paste', 'seasoning', 'stock', 'broth', 'juice', 'extract', 'spread', 'dressing', 'mix',
  'crumb', 'chip', 'bar', 'drink', 'water', 'sugar', 'salt'])

// Last words that name a CUT or PART of the food in front of them, not a different food: "chicken
// breast" is chicken, "broccoli florets" is broccoli, "garlic cloves" is garlic. Stripped before
// names are compared. A real food as the last word ("banana PEPPERS") is deliberately not here.
// Both the plural and sing()'s crude singular are listed where they differ (leaves → leave).
const FORM_WORDS = new Set(['breast', 'thigh', 'wing', 'drumstick', 'leg', 'fillet', 'filet', 'cutlet',
  'tender', 'tenderloin', 'chop', 'steak', 'loin', 'mince', 'floret', 'leaf', 'leave', 'stalk', 'stem',
  'spear', 'slice', 'chunk', 'cube', 'strip', 'half', 'halve', 'wedge', 'kernel', 'clove', 'bulb',
  'root', 'heart', 'piece'])

// The crude rule dishKey and dishArchetype use, PLUS an -oes case, and the difference is not
// cosmetic: that rule turns "potatoes" into "potatoe", which then fails to match "potato".
// Potatoes are a pantry staple and were the first thing a test caught.
const sing = (w: string) => {
  if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2)
  return w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w
}
// "boneless skinless chicken thighs" → "boneless skinless chicken". A lone form word stays: "steak"
// is a food when it is the whole name.
const stripForms = (s: string): string => {
  const w = s.split(' ').filter(Boolean)
  while (w.length > 1 && FORM_WORDS.has(sing(w[w.length - 1]))) w.pop()
  return w.join(' ')
}
const headOf = (s: string): string => sing(s.split(' ').filter(Boolean).pop() ?? '')
// "cheddar" and "cheddar cheese" are one food; the type word adds nothing. Kept apart from
// FORM_WORDS because "cheese" IS the food in "shredded cheese", and stripping it there would
// leave "shredded".
const TYPE_SUFFIX = ' cheese'
const sameByTypeSuffix = (a: string, b: string) =>
  (a.endsWith(TYPE_SUFFIX) && a.slice(0, -TYPE_SUFFIX.length) === b) ||
  (b.endsWith(TYPE_SUFFIX) && b.slice(0, -TYPE_SUFFIX.length) === a)

// The food a derived pantry product is made from, or null. Singularised to match the head rule.
const derivedBase = (item: string): string | null => {
  const m = DERIVED_PRODUCT.exec(item)
  return m ? m[1] : null
}

export function isInPantry(ingredientName: unknown, pantry: readonly string[]): boolean {
  const ing = norm(ingredientName)
  if (!ing) return true
  const head = headOf(stripForms(ing))
  for (const raw of pantry) {
    const item = norm(raw)
    if (!item) continue
    if (ing === item || sameByTypeSuffix(ing, item)) return true
    // Asked for the FOOD, holding a product made from it: not a match. Asked for the product itself
    // ("oat milk") still matches below, and "milk" is still covered by "oat milk" — that swap is fine.
    const base = derivedBase(item)
    if (base && (ing === base || sing(ing) === sing(base))) continue
    const itemFood = stripForms(item)
    // One name inside the other counts only when both name the same food: the longer is the
    // shorter plus adjectives or a cut. Same head noun after cuts are stripped is the test —
    // "banana peppers" contains "banana" and fails it. Raw heads are compared too, so a recipe's
    // bare "steak" is covered by "Ribeye Steak".
    if (ing.includes(item) || item.includes(ing)) {
      if (headOf(itemFood) === head || headOf(item) === headOf(ing)) return true
    }
    // Head-noun fallback: "diced onion" against a pantry "Yellow Onions", "diced chicken" against
    // "Chicken Breast".
    //
    // SINGULARISED on both sides. Without it the fallback compared "onion" against a pantry
    // "Yellow Onions" and failed on the plural alone, so "diced onion" counted as MISSING against
    // a shelf that had onions on it — and a missing STRUCTURAL ingredient disqualifies the whole
    // meal in Cook Now. Measured against the real 55-item pantry: nine of forty-one plausible
    // ingredient names missed, and this was the largest single cause.
    //
    // A CLASS word is not a food, and the head-noun rule cannot be trusted with one. "protein powder"
    // and "garlic powder" share a last word and nothing else — and because garlic powder is an ASSUMED
    // staple, every pantry on earth counted as holding protein powder. The 2026-09-12 sweep served two
    // protein shakes off a shelf with no protein powder on it, and the cookability gate saw nothing
    // wrong. Same shape for "sesame oil" vs "vegetable oil" and "chicken broth" vs "beef broth": the
    // modifier IS the ingredient. Exact and substring matches above still cover the honest cases
    // ("whole milk" against a pantry "Milk"), so this only removes the last-word guess.
    if (head && head.length > 2 && !GENERIC_HEAD.has(head)
        && (sing(itemFood) === head || headOf(itemFood) === head)) return true
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

// Plain water comes out of the tap, and the prompt already tells the model so ("you may ALWAYS use
// these ... and water"). It was never in the staples ARRAY the code checks, so a recipe that listed
// water was disqualified as uncookable — Cook Tonight run 51 lost a candidate exactly that way, with
// `notCookableMissing: ["water"]` as the only trace. Handled here rather than by adding "water" to
// that array because isInPantry matches substrings: a bare "water" staple would also make
// "watermelon" and "coconut water" assumed in stock, the same trap that forced "ice cubes".
// Qualifiers stack in real recipes ("reserved pasta water"), so the prefix repeats.
const PLAIN_WATER = /^(?:(?:cold|warm|hot|boiling|filtered|tap|ice|iced|room temperature|lukewarm|reserved|pasta|cooking|starchy)\s+)*water$/

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
    if (PLAIN_WATER.test(norm(name))) continue
    if (isInPantry(name, pantry)) continue
    // The kitchen is assumed to stock these, so they are never "missing" — the prompt says as much
    // to the model and the code has to agree, or salt would disqualify every meal.
    if (isInPantry(name, assumedStaples)) continue
    if (isStructural(name, ing?.grams)) out.structural.push(name)
    else out.garnish.push(name)
  }
  return out
}

// Fewer in-stock items than this and Cook Now is refused before the model is called: it cannot make
// three real dinners from four things, so it reaches for food the user does not own, the gate drops
// them, and the deck comes back empty. Shared with the client, which short-circuits with the same
// message so the round trip is never made. Assumed staples do not count; they are not in the pantry.
export const MIN_PANTRY_FOR_COOK_NOW = 6

// One sentence, same on every surface: the count is what tells the user how far off they are.
export function thinPantryMessage(count: number): string {
  return `Not enough in your pantry yet for full meals — ${count} ingredient${count === 1 ? '' : 's'} so far. Scan another shelf or add a few basics.`
}
