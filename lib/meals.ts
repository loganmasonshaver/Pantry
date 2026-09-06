import { supabase } from './supabase'
import { trackAIError } from './analytics'
import { edgeErrorInfo } from './edgeError'

export type GeneratedMeal = {
  id: string
  name: string
  // Eating occasion the dish suits. Meals are generated ONCE a day and shown all day, so the
  // generator spreads them across occasions and the UI surfaces the time-appropriate ones first —
  // generating "breakfast" at 8am would strand the user with oats at dinner. Optional: older
  // cached meals predate the field.
  slot?: 'breakfast' | 'lunch' | 'dinner' | 'any'
  prepTime: number
  calories: number
  protein: number
  carbs: number
  fat: number
  ingredients: { name: string; visual: string; grams: string }[]
  // How many portions the ingredient list makes. Macros above are PER SERVING, ingredients are the
  // FULL BATCH — the same convention trending meals already use, so meal/[id] renders both without
  // a special case. Set server-side from the user's meal frequency: a 6-meal/day eater's ~460 kcal
  // portion is too small to be worth cooking on its own, so the recipe makes two. Optional because
  // every meal cached before this shipped has no field; treat a missing value as 1.
  servings?: number
  missing_ingredients?: string[]
  steps: (string | { title: string; detail: string })[]
  image?: string | null
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
  recentMealNames = [],
  mode = 'cookNow',
  staplesExcluded = [],
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
  recentMealNames?: string[]
  mode?: 'cookNow' | 'mealPlan'
  staplesExcluded?: string[]
}): Promise<GeneratedMeal[]> {
  // Edge functions verify the JWT — a stale or missing token returns 401 from
  // the gateway before our function even runs. Validating up front gives a
  // clearer error than the opaque 401 the client would otherwise see.
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  __DEV__ && console.log('[generateMeals] getSession →', { hasSession: !!sessionData?.session, expires_at: sessionData?.session?.expires_at, sessionError: sessionError?.message })

  if (!sessionData?.session) {
    // Try refreshing — if we have a refresh token we can recover.
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
    __DEV__ && console.log('[generateMeals] refreshSession (no session) →', { hasSession: !!refreshed?.session, refreshError: refreshError?.message })
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
      recentMealNames,
      mode,
      staplesExcluded,
    },
  })

  let { data, error } = await invoke()

  // JWT can expire mid-session; force a token refresh then retry once
  // If we hit a 401, force a refresh and retry once.
  if (error && (error as any)?.context?.status === 401) {
    __DEV__ && console.log('[generateMeals] hit 401, forcing refreshSession and retrying')
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
    __DEV__ && console.log('[generateMeals] refreshSession after 401 →', { hasSession: !!refreshed?.session, refreshError: refreshError?.message })
    if (refreshError || !refreshed?.session) {
      throw new Error('Session expired — please sign out and sign back in')
    }
    const retry = await invoke()
    data = retry.data
    error = retry.error
    __DEV__ && console.log('[generateMeals] retry result →', { hasData: !!data, retryError: (error as any)?.message, status: (error as any)?.context?.status })
  }

  if (error) {
    trackAIError('generate-meals', error, { mode })
    // The raw error's .message is the opaque "non-2xx status code" — the real reason (e.g. the
    // daily cap) is in the response body. Surface it so the UI can tell the user WHY.
    throw await toUserFacingMealError(error)
  }
  return data as GeneratedMeal[]
}

// Turn a raw Functions error into one whose .message is safe to show the user, and whose .code
// (when known) lets the UI adapt — e.g. hide a pointless "Try again" when the daily cap is hit.
// Preserves .context so the existing diagnostic logging in useMealSuggestions still works.
async function toUserFacingMealError(error: any): Promise<Error> {
  const { message, code } = await edgeErrorInfo(error, "We couldn't generate meals right now. Please try again in a moment.")
  const friendly: any = new Error(message)
  if (code) friendly.code = code
  friendly.context = error?.context // keep for diagnostics downstream
  return friendly
}
