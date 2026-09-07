import { supabase } from './supabase'
import { trackAIError } from './analytics'
import { edgeErrorInfo, isTransportFailure } from './edgeError'

export type GeneratedMeal = {
  id: string
  name: string
  // Eating occasion the dish suits. Meals are generated ONCE a day and shown all day, so the
  // generator spreads them across occasions and the UI surfaces the time-appropriate ones first —
  // generating "breakfast" at 8am would strand the user with oats at dinner. Optional: older
  // cached meals predate the field.
  slot?: 'breakfast' | 'lunch' | 'dinner' | 'any'
  prepTime: number
  // HANDS-OFF minutes — chilling, soaking, marinating — where the cook does nothing. Separate from
  // prepTime because only ACTIVE time is filtered against the user's max-prep budget: folding a
  // soak into prepTime is what made the model shrink an overnight oats rest to "15 minutes to
  // allow oats to soften" so the dish would fit a 30-minute cap. Optional; absent on meals cached
  // before this shipped, and 0 on anything ready the moment the work is done.
  restTime?: number
  // UNATTENDED but you cannot leave — a bake, a simmer, a roast. Separate from restTime because
  // the two are only alike from the stove's point of view: an 8 hr soak means "start it tonight",
  // a 20 min bake means "you are in the kitchen for another 20 minutes". Counts toward the user's
  // max-prep budget for exactly that reason; restTime does not. Optional — meals cached before it
  // shipped have none, and 0 means nothing is cooking unattended.
  cookTime?: number
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
  // Set once image fetching has genuinely FINISHED and produced nothing — the daily image cap,
  // an API failure, or all retries exhausted. `image: null` alone cannot express this: it means
  // both "not fetched yet" and "will never arrive", so a card had no way to stop shimmering and
  // sat in a loading animation forever. A user who hits the image cap saw permanent skeletons.
  imageUnavailable?: boolean
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

  // Captured BEFORE the call so a rescue can never hand back an EARLIER generation's batch.
  const startedAt = new Date().toISOString()

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

  // THE APP WAS BACKGROUNDED MID-GENERATION, and the work is not lost.
  //
  // iOS suspends the network stack seconds after the user switches apps, so the in-flight fetch
  // dies while the Edge Function runs happily to completion — it stores generated_meals, has
  // already incremented the daily cap and has already paid OpenAI. supabase-js reports that as
  // FunctionsFetchError, which is a TRANSPORT failure and says nothing about whether the work
  // happened. Observed on run 31: the client showed "Failed to send a request to the Edge
  // Function" while three finished meals sat in the table.
  //
  // Without this the user loses one of six daily generations AND spends a second one retrying,
  // for a request that already succeeded and was already billed.
  if (error && isTransportFailure(error)) {
    const rescued = await rescueCompletedBatch(startedAt, mode)
    if (rescued.length > 0) {
      __DEV__ && console.log(`[generateMeals] transport failed but the server finished — rescued ${rescued.length} meals`)
      return rescued
    }
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



// Look for a batch this call produced. Rows from ONE generation share a single created_at, which
// is what makes a batch identifiable; `since` is the timestamp taken before the invoke, so an
// older successful generation can never be mistaken for this one.
//
// Tried twice. The fetch can die while the app is still backgrounded and the function is still
// running, so the first look can legitimately be too early — the retry costs one query and covers
// the race. RLS on generated_meals grants SELECT scoped to the caller, so no user filter is needed
// here and none should be trusted from the client anyway.
async function rescueCompletedBatch(since: string, mode: string): Promise<GeneratedMeal[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000))
    try {
      const { data, error } = await supabase
        .from('generated_meals')
        .select('meal_data, created_at')
        .eq('mode', mode)
        .gt('created_at', since)
        .order('created_at', { ascending: false })
        .limit(12)
      if (error || !data?.length) continue
      // Never mix two batches: keep only the newest timestamp present.
      const newest = data[0].created_at
      return data.filter(r => r.created_at === newest).map(r => r.meal_data) as GeneratedMeal[]
    } catch {
      // A rescue that throws must never replace the real error the caller is about to report.
    }
  }
  return []
}
