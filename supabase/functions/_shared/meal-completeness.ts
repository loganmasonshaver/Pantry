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

// Neither is an omelet. The carb rule was written against protein-and-veg PLATES, and an egg dish is
// not one — nobody serves a starch inside a frittata to make it a meal. Enforcing it on eggs is what
// put rice "alongside" a scramble (run 48) and granola on a savory omelet (run 51): with potato
// base-banned, the only carbs this pantry could offer were rice, protein cereal and granola.
// Name-based, like isDrink, and restricted to forms that ARE the egg dish — "Egg and Cheese Breakfast
// Wrap" is a wrap and still owes a carb.
export function isEggDish(name: unknown): boolean {
  return /\b(omelet(?:te)?s?|frittatas?|scrambles?|scrambled eggs|shakshuka|quiches?|egg bakes?|egg cups?|egg bites?|fried eggs|poached eggs|boiled eggs|deviled eggs|egg salad)\b/i.test(String(name ?? ''))
}

// Keto / low-carb / carnivore users are the prompt's own exception to the carb rule.
export function carbRequired(dietaryRestrictions: readonly unknown[]): boolean {
  return !dietaryRestrictions.some(d => /keto|low[- ]?carb|carnivore/i.test(String(d)))
}

export function isCompleteMeal(meal: { name?: unknown; ingredients?: unknown }, dietaryRestrictions: readonly unknown[] = []): boolean {
  return !carbRequired(dietaryRestrictions) || isDrink(meal?.name) || isEggDish(meal?.name)
    || hasCarbSource(meal?.ingredients, meal?.name)
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

// Carbs that belong in a SAVORY dinner. Granola, cereal and oats are carbs, but offering them as the
// base for a savory dish is how run 51 ended up with granola beside an omelet: with potato base-banned
// this pantry's only other carbs were protein cereal and granola.
const SWEET_CARB = /\b(granola|cereal|oats|oatmeal|porridge|pancakes?|waffles?|crepes?|muffins?|rice cakes?)\b/i

export function savoryCarbs(pantryNames: readonly string[]): string[] {
  return pantryCarbs(pantryNames).filter(n => !SWEET_CARB.test(String(n)))
}

// Protein powder — or any sweet-flavoured product — in a SAVORY dish. Logan's 2026-09-10 17:47 deck
// led with "Protein-Fortified Creamy Rice Soup": 2/3 cup milk, rice, 70g chicken and a scoop of
// protein powder "whisked in to thicken". Not a dish anyone cooks — whey clumps in hot milk and reads
// sweet-dairy — and not even needed: 140g chicken hits the same protein. The prompt's REAL DISHES
// rule forbids it and lost to the protein target, as the carb rule did, so it is checked in code.
// Powder's own dishes (pancakes, oats, smoothies, bars…) are exempt even with bacon on the side.
const PROTEIN_POWDER = /\b(protein powder|whey|casein|protein isolate|pea protein)\b/i
const SWEET_FLAVOUR = /\b(vanilla|chocolate|cocoa|cookies? (?:and|&|n) cream|cookie dough|birthday cake|caramel|strawberry|banana|blueberry|raspberry|cinnamon roll|mocha|marshmallow)\b/i
const FLAVOURED_PRODUCT = /\b(protein|whey|yogurt|yoghurt|skyr|kefir|milk|creamer|shake|cottage cheese)\b/i
const SAVORY_INGREDIENT = /\b(chicken|beef|pork|turkey|lamb|bacon|ham|sausages?|salmon|tuna|cod|tilapia|shrimp|prawns?|fish|steak|garlic|onions?|shallots?|soy sauce|broth|stock|salsa|pesto|mustard|cumin|curry|chil(?:l)?i|paprika|italian seasoning|oregano|tomato sauce|marinara|parmesan)\b/i
const SAVORY_DISH = /\b(soup|stew|curry|stir[- ]?fry|skillet|chili|tacos?|burritos?|pizza|pasta|casserole|risotto|fried rice|hash|frittata|omelet(?:te)?|quesadilla|burger|sandwich)\b/i
// Sweet FOOD that is wrong in a savory dish whatever it is flavoured with. Kept to items that are
// never a savory ingredient: honey, maple and brown sugar are deliberately absent, because
// honey-garlic chicken and a brown-sugar BBQ rub are real cooking. Granola is here because the carb
// rule put it on a savory omelet (run 51) and on an egg plate before that — with potato base-banned,
// granola and protein cereal are the only carbs left that the model can reach for.
const SWEET_FOOD = /\b(granola|cereal|cookies?|ice cream|whipped cream|chocolate chips?|marshmallows?|jam|jelly|frosting|sprinkles)\b/i

const POWDER_HOMES = /\b(pancakes?|waffles?|crepes?|oats|oatmeal|porridge|overnight|muffins?|smoothie|shake|parfait|pudding|bars?|bites|balls|brownies?|cookies?|mug cake|cake|ice cream|french toast)\b/i

export function savoryClash(meal: { name?: unknown; ingredients?: unknown }): boolean {
  const name = String(meal?.name ?? '')
  if (POWDER_HOMES.test(name)) return false
  const names = ingredientNames(meal?.ingredients)
  const offending = names.some(n => PROTEIN_POWDER.test(n) || SWEET_FOOD.test(n) || (SWEET_FLAVOUR.test(n) && FLAVOURED_PRODUCT.test(n)))
  if (!offending) return false
  return SAVORY_DISH.test(name) || names.some(n => SAVORY_INGREDIENT.test(n) && !PROTEIN_POWDER.test(n))
}
