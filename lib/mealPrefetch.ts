import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { generateMeals, GeneratedMeal } from './meals'

// Speculative "cook now" meal generation, kicked off while the user reviews a scan so the
// cook-reveal screen can reuse the result instead of generating a SECOND time. This removes
// the back-to-back loading screens (scan wait → meal wait).
//
// TEXT ONLY on purpose: it does not touch generate-meal-image, so an abandoned scan never
// burns Flux $ — cook-reveal still fetches images progressively as it always has.
//
// Cache format + keys are kept identical to useMealSuggestions so the hook's existing
// cache-serve path picks these up with zero changes. If the hook mounts while a prefetch is
// still in flight, it awaits `takeCookNowPrefetch()` rather than starting a paid second gen.

const CACHE_KEY_PREFIX = 'pantry_daily_meals'
const RECENT_MEALS_KEY_PREFIX = 'pantry_recent_meal_names'

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Single in-flight slot — only one prefetch runs at a time, and the latest scan wins (a new
// scan changes the pantry, so its meals should replace an earlier scan's this session).
let inflight: { userId: string; mode: string; promise: Promise<GeneratedMeal[] | null> } | null = null

// Returns the in-flight prefetch promise for this user+mode, or null. The hook awaits this to
// avoid a double-generation race when cook-reveal mounts before the prefetch has finished.
export function takeCookNowPrefetch(userId: string, mode: 'cookNow' | 'mealPlan'): Promise<GeneratedMeal[] | null> | null {
  if (inflight && inflight.userId === userId && inflight.mode === mode) return inflight.promise
  return null
}

async function runPrefetch(userId: string, mode: 'cookNow' | 'mealPlan', extraIngredients: string[]): Promise<GeneratedMeal[] | null> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('calorie_goal, protein_goal, meals_per_day, cooking_skill, max_prep_minutes, dietary_restrictions, food_dislikes, cuisine_preferences, staples_excluded')
      .eq('id', userId)
      .single()

    const { data: pantryItems } = await supabase
      .from('pantry_items')
      .select('name')
      .eq('user_id', userId)
      .eq('in_stock', true)
      .order('created_at', { ascending: true })
      .limit(200)

    // Merge the freshly-scanned items with the existing pantry (the just-scanned rows may not be
    // persisted yet when we fire during review) and dedupe, so the prefetch matches what the hook
    // will see after save.
    const pantryNames = pantryItems?.map(i => i.name) ?? []
    const seen = new Set(pantryNames.map(n => n.toLowerCase()))
    const ingredients = [...pantryNames]
    for (const name of extraIngredients) {
      if (!seen.has(name.toLowerCase())) { ingredients.push(name); seen.add(name.toLowerCase()) }
    }
    if (ingredients.length === 0) return null // nothing to build from — let the hook handle its own fallback

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: ratings } = await supabase
      .from('meal_ratings')
      .select('meal_name, rating')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(100)
    const dislikedMeals = ratings?.filter(r => r.rating === -1).map(r => r.meal_name) ?? []
    const likedMeals = ratings?.filter(r => r.rating === 1).map(r => r.meal_name) ?? []

    let recentMealNames: string[] = []
    try {
      const raw = await AsyncStorage.getItem(`${RECENT_MEALS_KEY_PREFIX}_${mode}`)
      if (raw) recentMealNames = JSON.parse(raw)
    } catch {}

    const maxPrep = profile?.max_prep_minutes || 30
    const generated = await generateMeals({
      ingredients,
      calorieGoal: profile?.calorie_goal || 2400,
      proteinGoal: profile?.protein_goal || 150,
      mealsPerDay: profile?.meals_per_day || 3,
      cookingSkill: profile?.cooking_skill || 'moderate',
      maxPrepMinutes: maxPrep,
      dietaryRestrictions: profile?.dietary_restrictions || ['None'],
      foodDislikes: profile?.food_dislikes || [],
      dislikedMeals,
      likedMeals,
      cuisinePreferences: profile?.cuisine_preferences || [],
      recentMealNames,
      mode,
      staplesExcluded: profile?.staples_excluded || [],
    })
    if (!generated || generated.length === 0) return null

    // Write the exact cache shape the hook serves from (text only — images filled in on reveal).
    // userId stamps ownership so the cache survives sign-out for this user (see useMealSuggestions).
    await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}_${mode}`, JSON.stringify({ date: todayStr(), meals: generated, maxPrepMinutes: maxPrep, regenCount: 0, userId }))
    try {
      const merged = [...generated.map(m => m.name).filter(Boolean), ...recentMealNames].slice(0, 12)
      await AsyncStorage.setItem(`${RECENT_MEALS_KEY_PREFIX}_${mode}`, JSON.stringify(merged))
    } catch {}

    return generated
  } catch {
    return null // best-effort — any failure just means the hook generates normally
  }
}

// Fire-and-forget. Safe to call more than once; the latest call replaces the in-flight slot.
export function prefetchCookNowMeals(userId: string, extraIngredients: string[], mode: 'cookNow' | 'mealPlan' = 'cookNow') {
  const promise = runPrefetch(userId, mode, extraIngredients)
  inflight = { userId, mode, promise }
  return promise
}
