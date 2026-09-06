// Multi-serving generated recipes.
//
// `calorieGoal / mealsPerDay` is the right size for a PORTION — someone on 6 meals a day really
// does eat ~460 kcal at a time. What it is not is the right size for a RECIPE: eating occasions
// are not cooking occasions, and nobody cooks a 460 kcal dish from scratch. The fix is to keep the
// portion honest and make the recipe bigger by giving it servings, exactly as trending recipes
// already do — calories per serving, ingredients at full batch, servings as a count.
//
// Deliberately here rather than inline in generate-meals so the arithmetic that decides what a
// user logs can be tested without a Deno CLI or a live model call.

/** Calories a recipe should contain to be worth cooking as one batch. */
export const BATCH_RECIPE_KCAL = 700

/** A recipe never makes more than this — past 3 portions it is meal prep, not tonight's dinner. */
export const MAX_SERVINGS = 3

// Measured against every live profile on 2026-09-05: 16 of 18 return 1, so for almost everyone
// this feature is inert and every band it scales is multiplied by one. The two that return >1 are
// both on 6 meals/day. The effective trigger is a portion under ~467 kcal (700/467 rounds to 1).
export function servingsForPortion(portionCalories: number): number {
  const portion = Number(portionCalories)
  // A non-finite or non-positive portion means the profile is missing a goal; 1 serving is the
  // behaviour that predates this function, so degrade to it rather than to MAX_SERVINGS (which is
  // what a naive 700/0 → Infinity → clamp would give).
  if (!Number.isFinite(portion) || portion <= 0) return 1
  return Math.min(MAX_SERVINGS, Math.max(1, Math.round(BATCH_RECIPE_KCAL / portion)))
}

export type BatchMacros = { calories: number; protein: number; carbs: number; fat: number }

// The one place batch macros become per-serving macros. Ingredients are deliberately untouched:
// dividing them is what produced "0.5 large eggs", and the batch list plus a servings count is the
// shape that avoids it. Every caller must already have run its ingredient-derived checks — those
// read the batch, and comparing a divided claim against an undivided ingredient list is precisely
// the double-count this whole module exists to prevent.
export function toPerServing<T extends BatchMacros>(meal: T, servings: number): T & { servings: number } {
  const n = Number.isFinite(servings) && servings >= 1 ? Math.floor(servings) : 1
  if (n <= 1) return { ...meal, servings: 1 }
  return {
    ...meal,
    servings: n,
    calories: Math.round(Number(meal.calories) / n),
    protein: Math.round(Number(meal.protein) / n),
    carbs: Math.round(Number(meal.carbs) / n),
    fat: Math.round(Number(meal.fat) / n),
  }
}
