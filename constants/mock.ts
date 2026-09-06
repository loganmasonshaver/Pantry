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
