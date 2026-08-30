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
  ingredients: Ingredient[]
  steps: string[]
}
