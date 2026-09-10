// Type-only: no runtime import, so constants never pulls lib code into its module graph.
import type { TimePhase } from '@/lib/ingredientDisplay'

export type Ingredient = {
  id: string
  visual: string
  grams: string
  name: string
  inPantry: boolean
}

export type MealDetail = {
  id: string
  name: string
  prepTime: number
  // Hands-off time (chill/soak/marinate). See GeneratedMeal.restTime — only active time counts
  // against the user's prep budget, so this can be hours without disqualifying a dish.
  restTime?: number
  // Unattended cooking the cook must stay for (bake, simmer). See GeneratedMeal.cookTime — unlike
  // restTime this DOES count against the prep budget, because the user is still in the kitchen.
  cookTime?: number
  // The same time in cooking order (Discover only, when the extractor's phases agreed with the
  // totals). Absent = render the type-ordered breakdown.
  timePhases?: TimePhase[] | null
  calories: number
  protein: number
  carbs: number
  fat: number
  image: string | null
  // Portions the ingredient list makes. Macros above are PER SERVING while ingredients are the
  // FULL BATCH — the screen prints "Makes N servings · macros are per serving" to reconcile the
  // two. Absent on meals generated before multi-serving shipped, and on every saved_meals row
  // (the table has no servings column), so read it as 1 when missing.
  servings?: number
  ingredients: Ingredient[]
  steps: string[]
}
