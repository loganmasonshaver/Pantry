import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { generateMeals, GeneratedMeal } from './meals'
import { fetchMealImage } from './mealImages'

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
// How many meals cook-reveal shows (meals.slice(0, 3) there) — i.e. how many images are worth warming.
const REVEAL_CARDS = 3

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
      // 24, matching useMealSuggestions — the prefetch drains the same shared window.
      const merged = [...generated.map(m => m.name).filter(Boolean), ...recentMealNames].slice(0, 24)
      await AsyncStorage.setItem(`${RECENT_MEALS_KEY_PREFIX}_${mode}`, JSON.stringify(merged))
    } catch {}

    // Warm the reveal's images NOW, during the user's review window — images are the slow half
    // (~5-10s each) and starting them at cook-reveal mount meant the deck out-ran them.
    //
    // Hero first and alone, so card 1 is never at risk; the rest only after it resolves. That
    // ordering matters twice: it avoids a 3-way burst (see the throttle note in mealImages.ts), and
    // it means a scan abandoned in the first second still costs just the one image.
    //
    // NOTE: must not call warmMealImages() here — it awaits the in-flight prefetch, which is this
    // very promise, and would deadlock. Hence the direct fetchMealImage calls.
    const warmable = generated.slice(0, REVEAL_CARDS).filter(m => m?.name)
    if (warmable.length > 0) {
      ;(async () => {
        const [hero, ...rest] = warmable
        await fetchMealImage(hero.name, hero.ingredients?.map((ing: any) => ing.name) ?? [], hero.steps ?? []).catch(() => null)
        // Cards 2-3 get the remainder of the review window as runway instead of the ~2s between
        // "Add all to Pantry" and the reveal mounting, which is what made them lag behind card 1.
        await Promise.all(rest.map(m =>
          fetchMealImage(m.name, m.ingredients?.map((ing: any) => ing.name) ?? [], m.steps ?? []).catch(() => null)
        ))
      })()
    }

    return generated
  } catch {
    return null // best-effort — any failure just means the hook generates normally
  }
}

// Warm images for the first `count` cached meals into the shared device image cache, so the reveal's
// own fetch resolves instantly instead of generating on-screen. Called once the user has COMMITTED
// (tapped "Add all to Pantry") — at that point they're heading to the reveal, so this is the same
// spend the reveal would make anyway, just a few seconds earlier.
export async function warmMealImages(userId: string, mode: 'cookNow' | 'mealPlan', count: number) {
  try {
    const pre = takeCookNowPrefetch(userId, mode)
    if (pre) await pre // text may still be generating — its meals are what we're warming
    const raw = await AsyncStorage.getItem(`${CACHE_KEY_PREFIX}_${mode}`)
    if (!raw) return
    const cached = JSON.parse(raw)
    if (cached?.userId && cached.userId !== userId) return // different account on this device
    if (cached?.date !== todayStr()) return                // stale day — the hook will regenerate
    const meals: GeneratedMeal[] = (cached.meals ?? []).slice(0, count)
    await Promise.all(meals.map(m =>
      m?.image || !m?.name
        ? null
        : fetchMealImage(m.name, m.ingredients?.map((ing: any) => ing.name) ?? [], m.steps ?? []).catch(() => null)
    ))
  } catch {}
}

// Fire-and-forget. Safe to call more than once; the latest call replaces the in-flight slot.
export function prefetchCookNowMeals(userId: string, extraIngredients: string[], mode: 'cookNow' | 'mealPlan' = 'cookNow') {
  const promise = runPrefetch(userId, mode, extraIngredients)
  inflight = { userId, mode, promise }
  return promise
}
