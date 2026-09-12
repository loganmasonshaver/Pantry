// Can the recipe actually be FOLLOWED in a kitchen? Four things Cook Tonight run 51 got wrong that
// nothing in the pipeline looks at:
//
//   * no salt or pepper anywhere in any of the three shown meals — and across the 129 meals ever
//     generated for Logan, 51% mention neither;
//   * "transfer to a preheated oven at 375°F" with no step that preheats it, on a dish claiming 20
//     minutes — a cold oven is another ten;
//   * "sear until cooked through" on a whole chicken breast: no time, no doneness cue;
//   * "serve over a bed of warm cooked rice" when the pantry's Cooked Rice is cold from the fridge.
//
// MEASURED, NOT GATED. The prompt now asks for all four; these count how often it is ignored, so the
// decision to enforce any of them is made from numbers. Same order every gate in generate-meals took.

export type StepIssues = {
  unseasoned: boolean
  noPreheat: boolean
  untimedCook: number
  coldCarb: boolean
}

// Anything salty counts: a soy-sauce stir-fry is seasoned, and the first live report would have gone
// red on one. A sweet dish (parfait, smoothie, cereal bowl) is not expected to carry salt at all.
const SEASONING = /\b(salt|salted|pepper|peppercorns?|soy sauce|tamari|fish sauce|oyster sauce|miso|salsa|hot sauce|sriracha|seasoning|bouillon|stock|broth|pesto|parmesan|feta|pickles?|kimchi|worcestershire|gochujang|teriyaki)\b/i
const SWEET_NAME = /\b(parfait|smoothie|shake|oats|oatmeal|porridge|pudding|dessert|cereal|granola|yogurt bowl|cottage cheese bowl|fruit bowl|pancakes?|waffles?|crepes?|muffins?|cookies?|bites?|clusters?|brownies?|french toast)\b/i
// "preheated oven" must NOT satisfy this — that phrase is the bug, not the instruction. Requiring the
// word "oven" right after the verb separates "Preheat the oven to 375°F" from "a preheated oven".
const PREHEAT_STEP = /\bpre-?heats?\s+(?:your\s+|the\s+)?(?:oven|air fryer|broiler)\b/i
const USES_OVEN = /\b(oven|baked?|baking|roast(?:ed|ing)?|broil(?:ed|ing)?|air fryer)\b/i
const COOK_VERB = /\b(sear|cook|bake|roast|grill|fry|saut[ée]|simmer|boil|broil|scramble|poach|steam|toast|brown|caramelise|caramelize)\b/i
const DURATION = /\d+\s*(?:-\s*\d+\s*)?(?:min|minute|hour|hr|sec)/i
// Pantry food that is already cooked and sitting cold in the fridge.
const PRECOOKED_COLD = /\b(cooked rice|cooked pasta|cooked quinoa|cooked potatoes?|leftover)\b/i
// An ACTION, not an adjective. "Serve over a bed of warm cooked rice" describes rice that nothing in
// the recipe ever warmed — that sentence is the defect, so a bare "warm" must not satisfy this.
const REHEATS = /\b(reheat\w*|microwav\w*|heat\s+(?:it\s+|the\s+\w+\s+)?through|warm\s+(?:it\s+|the\s+)?(?:through|up|rice|pasta|quinoa|potatoes)|steam\w*|toast\w*|fry|fried|saut)\b/i

const textOf = (steps: unknown): string =>
  (Array.isArray(steps) ? steps : [])
    .map(s => (typeof s === 'string' ? s : `${(s as any)?.title ?? ''} ${(s as any)?.detail ?? ''}`))
    .join(' \n ')

const stepDetails = (steps: unknown): string[] =>
  (Array.isArray(steps) ? steps : [])
    .map(s => (typeof s === 'string' ? s : `${(s as any)?.title ?? ''} ${(s as any)?.detail ?? ''}`))

export function stepIssues(meal: { name?: unknown; ingredients?: unknown; steps?: unknown } | null | undefined): StepIssues {
  const ingredients = (Array.isArray(meal?.ingredients) ? meal!.ingredients as unknown[] : [])
    .map(i => String((i as any)?.name ?? i ?? ''))
    .join(' | ')
  const steps = textOf(meal?.steps)
  const all = `${ingredients} \n ${steps}`
  return {
    unseasoned: !SWEET_NAME.test(String(meal?.name ?? '')) && !SEASONING.test(all),
    noPreheat: USES_OVEN.test(steps) && !PREHEAT_STEP.test(steps),
    untimedCook: stepDetails(meal?.steps).filter(d => COOK_VERB.test(d) && !DURATION.test(d)).length,
    coldCarb: PRECOOKED_COLD.test(ingredients) && !REHEATS.test(steps),
  }
}
