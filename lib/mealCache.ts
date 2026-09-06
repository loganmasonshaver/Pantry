import AsyncStorage from '@react-native-async-storage/async-storage'
import { todayStr } from './localDate'
import { GeneratedMeal } from './meals'

// ONE definition of the daily meal cache — key, shape and writer.
//
// There were SEVEN writers of `pantry_daily_meals_*` across four files, each hand-rolling the
// object, and they had drifted apart. `onboarding/createaccount.tsx` wrote no `maxPrepMinutes`,
// which the reader treats as an old-format entry and DELETES — so the meals generated during
// onboarding (paid for, and one of the 6 daily generations) were thrown away and regenerated on
// first open, costing the user a 6-8s wait at the exact moment the app is making its first
// impression. `onboarding/index.tsx` wrote no `userId`.
//
// This is the SECOND time these same two files drifted from this same cache: lib/localDate.ts
// records the first, where the date helper "was copied rather than shared, and the two onboarding
// writers kept stamping UTC into the same cache". Patching the two writers again would fix today's
// symptom and leave the mechanism intact, so the shape now has exactly one definition and
// `maxPrepMinutes` is REQUIRED — a caller that forgets it fails to compile instead of silently
// writing an entry the reader will bin.
export const MEAL_CACHE_KEY_PREFIX = 'pantry_daily_meals'
export type MealCacheMode = 'cookNow' | 'mealPlan'

export const mealCacheKey = (mode: MealCacheMode) => `${MEAL_CACHE_KEY_PREFIX}_${mode}`

export type CachedMeals = {
  date: string
  meals: GeneratedMeal[]
  // Optional on READ so a legacy entry still parses — the reader checks for undefined and discards
  // it deliberately. Required on WRITE, below, which is the half that stops new ones being created.
  maxPrepMinutes?: number
  regenCount?: number
  userId?: string
  dietStyle?: string
}

export async function writeMealCache(
  mode: MealCacheMode,
  entry: {
    meals: GeneratedMeal[]
    /** REQUIRED. Omitting it is what made an entry unreadable; the type is the guard. */
    maxPrepMinutes: number
    userId?: string | null
    regenCount?: number
    dietStyle?: string
  },
): Promise<void> {
  const payload: CachedMeals = {
    // Always stamped here, never by the caller — a UTC stamp from one writer is the other half of
    // the bug lib/localDate.ts documents.
    date: todayStr(),
    meals: entry.meals,
    maxPrepMinutes: entry.maxPrepMinutes,
    regenCount: entry.regenCount ?? 0,
    ...(entry.userId ? { userId: entry.userId } : {}),
    ...(entry.dietStyle ? { dietStyle: entry.dietStyle } : {}),
  }
  try {
    await AsyncStorage.setItem(mealCacheKey(mode), JSON.stringify(payload))
  } catch {
    // A cache write must never break the screen that triggered it. The cost of losing one is a
    // regeneration, which the server-side MEAL_GEN_CAP_PER_DAY already bounds.
  }
}

/**
 * Mark today's cached meals as belonging to a PREVIOUS day instead of deleting them.
 *
 * Profile clears this cache on a diet, goal or meal-frequency change so the next open regenerates,
 * and it used `AsyncStorage.multiRemove`. Deleting is too blunt: useMealSuggestions has a carryover
 * branch that paints a previous day's cached meals WHILE the new ones generate, precisely so this
 * moment never looks empty — and that branch needs an entry to exist. With the entry gone, Logan
 * got the bare "Let's cook" empty state for 4-5 seconds instead of the meals he already had.
 *
 * Back-dating keeps the intent exactly ("regenerate rather than serve stale, wrong-sized
 * suggestions" — the stale set is shown, labelled, and replaced) while restoring the carryover the
 * app was already built to do.
 */
export async function staleMealCache(mode: MealCacheMode): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(mealCacheKey(mode))
    if (!raw) return
    const cached = JSON.parse(raw) as CachedMeals
    if (!cached?.meals?.length) { await AsyncStorage.removeItem(mealCacheKey(mode)); return }
    // Any past date works — the reader only asks whether it equals today. 1970 is deliberately
    // absurd so nobody later mistakes it for a real generation date.
    await AsyncStorage.setItem(mealCacheKey(mode), JSON.stringify({ ...cached, date: '1970-01-01' }))
  } catch {
    // Falling back to a delete is safe: worst case the user sees the empty state this was written
    // to avoid, which is exactly the old behaviour.
    try { await AsyncStorage.removeItem(mealCacheKey(mode)) } catch {}
  }
}

/** Both modes at once — every caller so far invalidates the pair. */
export async function staleAllMealCaches(): Promise<void> {
  await Promise.all([staleMealCache('cookNow'), staleMealCache('mealPlan')])
}
