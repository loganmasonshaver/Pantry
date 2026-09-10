// Is a generated meal a complete dish — or protein + vegetables that reads like a snack?
//
// The generate-meals prompt has said since 2026-04-30 that every meal must include a carbohydrate
// source and that "a meal with only protein + vegetables is NOT a complete meal". Nothing enforced it.
// Measured on Logan's 2026-09-10 17:14 generation: 5 of 8 ranked candidates had no carb while his
// pantry held cooked rice and two kinds of potato, and the ranker picked "Chicken and Cauliflower
// Stir-Fry" (chicken, cauliflower, soy sauce, garlic, oil) — the fourth chicken-or-beef-and-cauliflower
// plate in five days, three of them with no starch. The pull is the macro targets: 40g+ protein
// inside ~525 kcal, and dropping the rice is the cheapest way to fit. So it is enforced in code.

// Foods eaten AS the carbohydrate base of a plate. Deliberately the prompt's own list plus the obvious
// forms of each; fruit is not on it, matching the prompt.
const CARB = /\b(rice|pasta|spaghetti|penne|macaroni|fusilli|rigatoni|linguine|orzo|noodles?|ramen|udon|soba|vermicelli|bread|toast|sourdough|baguette|tortillas?|wraps?|pitas?|naan|flatbread|buns?|bagels?|muffins?|potato(?:es)?|fries|hash ?browns?|oats|oatmeal|porridge|granola|cereal|quinoa|couscous|barley|bulgur|farro|polenta|grits|gnocchi|beans?|lentils?|chickpeas?|hummus|corn|crackers?|rice cakes?|plantains?|waffles?|pancakes?|crepes?)\b/i

// Phrases that contain a carb WORD without being a carb base. Removed before the test, so "rice
// vinegar" or "green beans" never makes a protein-and-veg plate count as complete.
const NOT_A_BASE = /\b(cauliflower rice|rice vinegar|rice wine|oat milk|bread ?crumbs|panko|potato starch|corn ?starch|corn syrup|(?:green|string|french|coffee|vanilla|cocoa) beans?|bean sprouts)\b/gi

// Flour is a carb BASE only when the dish is made of it — a wrap, crepe, pancake or noodle the
// model builds from the assumed-staple flour. A tablespoon thickening a sauce is not a base, so
// flour alone never counts; the dish's NAME has to be one of these forms. Measured: without this,
// a Breakfast Wrap, Protein Crepes and Protein Pancakes all read as "protein + veg".
const FLOUR_FORM = /\b(wraps?|crepes?|pancakes?|waffles?|noodles?|pasta|dumplings?|flatbreads?|tortillas?|breads?|biscuits?|muffins?|pizza|scones?)\b/i

const ingredientNames = (ingredients: unknown): string[] =>
  (Array.isArray(ingredients) ? ingredients : []).map((i: any) => String(typeof i === 'string' ? i : i?.name ?? ''))

export function hasCarbSource(ingredients: unknown, mealName: unknown = ''): boolean {
  const names = ingredientNames(ingredients)
  if (names.some(n => CARB.test(n.replace(NOT_A_BASE, ' ')))) return true
  return FLOUR_FORM.test(String(mealName ?? '')) && names.some(n => /\bflour\b/i.test(n))
}

// A drink is not a plate; a shake with no starch is still a complete shake.
export function isDrink(name: unknown): boolean {
  return /\b(shake|smoothie|latte|frappe|protein drink|milkshake)\b/i.test(String(name ?? ''))
}

// Keto / low-carb / carnivore users are the prompt's own exception to the carb rule.
export function carbRequired(dietaryRestrictions: readonly unknown[]): boolean {
  return !dietaryRestrictions.some(d => /keto|low[- ]?carb|carnivore/i.test(String(d)))
}

export function isCompleteMeal(meal: { name?: unknown; ingredients?: unknown }, dietaryRestrictions: readonly unknown[] = []): boolean {
  return !carbRequired(dietaryRestrictions) || isDrink(meal?.name) || hasCarbSource(meal?.ingredients, meal?.name)
}

// Water and ice carry no calories. Looked up by name, FatSecret's top hit for "Ice Cubes" was an
// entry at 217 kcal/100g, which turned a 565 kcal protein shake into 782. Callers skip the lookup.
export function isZeroCalorie(name: unknown): boolean {
  const n = String(name ?? '').trim().toLowerCase()
  return /^((cold|warm|hot|boiling|ice|iced|filtered|sparkling|tap|lukewarm)\s+)?water$/.test(n)
    || /^(crushed\s+)?ice( cubes?)?$/.test(n)
}

// The carb bases a pantry actually holds, for naming in the prompt. Without the list the carb rule
// pushed the model to bread, pasta and noodles the user did not own: run 46 lost 4 of 8 candidates
// to not-cookable that way, leaving only incomplete dishes for the deck. Products made FROM a carb
// ("Oat Milk", "Granola Butter") are not bases.
export function pantryCarbs(pantryNames: readonly string[]): string[] {
  return pantryNames.filter(n =>
    hasCarbSource([n]) && !/\b(milk|butter|oil|syrup|spread|vinegar|flour|cookies?|bars?|chips)$/i.test(String(n).trim()))
}
