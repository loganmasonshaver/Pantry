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
  steps: (string | { title: string; detail: string })[]
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
  cuisinePreferences = [],
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
  cuisinePreferences?: string[]
  mode?: 'cookNow' | 'mealPlan'
}): Promise<GeneratedMeal[]> {
  // Ensure we have a fresh access token before invoking edge functions.
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  console.log('[generateMeals] getSession →', { hasSession: !!sessionData?.session, expires_at: sessionData?.session?.expires_at, sessionError: sessionError?.message })

  if (!sessionData?.session) {
    // Try refreshing — if we have a refresh token we can recover.
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
    console.log('[generateMeals] refreshSession (no session) →', { hasSession: !!refreshed?.session, refreshError: refreshError?.message })
    if (!refreshed?.session) {
      throw new Error('Not signed in — please sign out and sign back in')
    }
  }

  // extracted so it can be called twice (initial attempt + 401 retry) without duplicating the body
  const invoke = async () => supabase.functions.invoke('generate-meals', {
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
      cuisinePreferences,
      mode,
    },
  })

  let { data, error } = await invoke()

  // JWT can expire mid-session; force a token refresh then retry once
  // If we hit a 401, force a refresh and retry once.
  if (error && (error as any)?.context?.status === 401) {
    console.log('[generateMeals] hit 401, forcing refreshSession and retrying')
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
    console.log('[generateMeals] refreshSession after 401 →', { hasSession: !!refreshed?.session, refreshError: refreshError?.message })
    if (refreshError || !refreshed?.session) {
      throw new Error('Session expired — please sign out and sign back in')
    }
    const retry = await invoke()
    data = retry.data
    error = retry.error
    console.log('[generateMeals] retry result →', { hasData: !!data, retryError: (error as any)?.message, status: (error as any)?.context?.status })
  }

  if (error) throw error
  return data as GeneratedMeal[]
}
