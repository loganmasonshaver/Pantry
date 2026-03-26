import { supabase } from './supabase'

export type GeneratedMeal = {
  id: string
  name: string
  prepTime: number
  calories: number
  protein: number
  carbs: number
  fat: number
  ingredients: { name: string; visual: string; grams: string }[]
  steps: string[]
  image: null
}

export async function generateMeals({
  ingredients,
  calorieGoal,
  proteinGoal,
  mealsPerDay,
  cookingSkill,
  maxPrepMinutes,
  dietaryRestrictions,
  foodDislikes = [],
  dislikedMeals = [],
  likedMeals = [],
  mode = 'cookNow',
}: {
  ingredients: string[]
  calorieGoal: number
  proteinGoal: number
  mealsPerDay: number
  cookingSkill: string
  maxPrepMinutes: number
  dietaryRestrictions: string[]
  foodDislikes?: string[]
  dislikedMeals?: string[]
  likedMeals?: string[]
  mode?: 'cookNow' | 'mealPlan'
}): Promise<GeneratedMeal[]> {
  const { data, error } = await supabase.functions.invoke('generate-meals', {
    body: {
      ingredients,
      calorieGoal,
      proteinGoal,
      mealsPerDay,
      cookingSkill,
      maxPrepMinutes,
      dietaryRestrictions,
      foodDislikes,
      dislikedMeals,
      likedMeals,
      mode,
    },
  })

  if (error) throw error
  return data as GeneratedMeal[]
}
