import { useState, useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { generateMeals, GeneratedMeal } from './meals'
import { useAIConsent } from '../context/AIConsentContext'

const CACHE_KEY_PREFIX = 'pantry_daily_meals'
const IMAGE_URL_CACHE_KEY = 'pantry_image_urls_v1'
const RECENT_MEALS_KEY_PREFIX = 'pantry_recent_meal_names'  // last N gens of meal names, per mode, to suppress repeats

// Hard cap on user-initiated regens per day. The auto-fire on first daily visit is free
// (doesn't count); this cap only governs the manual "Refresh after shopping" button.
// 1 = one regen per day. Closes the unbounded refresh loop without losing the after-grocery
// use case. Resets at midnight because cache is keyed by date.
const MAX_DAILY_REGENS = 1

type CachedMeals = { date: string; meals: GeneratedMeal[]; maxPrepMinutes?: number; regenCount?: number }

// Local-timezone date string. Previously this used toISOString() which is UTC,
// so reloading the app after ~7pm CT (00:00 UTC) treated cached meals as
// stale and forced regeneration even though it was still "today" for the user.
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useMealSuggestions(userId: string | undefined, isPremium: boolean, mode: 'cookNow' | 'mealPlan' = 'cookNow', enabled = true) {
  const { requestConsent } = useAIConsent()
  const [meals, setMeals] = useState<GeneratedMeal[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Track manual regens used today so the UI can disable the button at cap.
  // Mirrored to a ref so generate() can persist the right count without re-renders.
  const [regensUsedToday, setRegensUsedToday] = useState(0)
  const regensUsedTodayRef = useRef(0)
  useEffect(() => { regensUsedTodayRef.current = regensUsedToday }, [regensUsedToday])

  const fetchImage = async (name: string, ingredientNames: string[] = [], steps: any[] = []): Promise<string | null> => {
    // Check device cache first — avoids any network call if already fetched before
    try {
      const raw = await AsyncStorage.getItem(IMAGE_URL_CACHE_KEY)
      if (raw) {
        const localCache: Record<string, string> = JSON.parse(raw)
        if (localCache[name]) return localCache[name]
      }
    } catch {}

    // 3 attempts with 3s gaps — Replicate occasionally returns transient 5xx or
    // queue timeouts; per-call retries are far cheaper than letting the meal
    // card render image-less. Sequential not parallel — bursting Replicate
    // causes cascading throttles.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data, error } = await supabase.functions.invoke('generate-meal-image', { body: { mealName: name, ingredients: ingredientNames, steps } })
        console.log(`[MealImage] ${name}: data=`, JSON.stringify(data)?.substring(0, 100), 'error=', error)
        if (data?.image) {
          // Persist to device cache so future renders are instant
          try {
            const raw = await AsyncStorage.getItem(IMAGE_URL_CACHE_KEY)
            const localCache: Record<string, string> = raw ? JSON.parse(raw) : {}
            localCache[name] = data.image
            await AsyncStorage.setItem(IMAGE_URL_CACHE_KEY, JSON.stringify(localCache))
          } catch {}
          return data.image
        }
      } catch (e) { console.log(`[MealImage] ${name} error:`, e) }
      await new Promise(r => setTimeout(r, 3000)) // 3s gap between retries
    }
    return null
  }

  const generate = async () => {
    if (!userId) return

    try {
      // DIAGNOSTIC: check session state before making any auth-required calls
      const sessionCheck = await supabase.auth.getSession()
      console.log('[SESSION_CHECK v3]', {
        hasSession: !!sessionCheck.data?.session,
        userId: sessionCheck.data?.session?.user?.id,
        expires_at: sessionCheck.data?.session?.expires_at,
        expires_in_seconds: sessionCheck.data?.session?.expires_at
          ? sessionCheck.data.session.expires_at - Math.floor(Date.now() / 1000)
          : null,
        access_token_preview: sessionCheck.data?.session?.access_token?.slice(0, 40),
      })

      // If no session, try refreshing
      if (!sessionCheck.data?.session) {
        console.log('[SESSION_CHECK v3] no session, attempting refresh...')
        const refreshed = await supabase.auth.refreshSession()
        console.log('[SESSION_CHECK v3] refresh result', {
          hasSession: !!refreshed.data?.session,
          error: refreshed.error?.message,
        })
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('calorie_goal, protein_goal, meals_per_day, cooking_skill, max_prep_minutes, dietary_restrictions, food_dislikes, cuisine_preferences')
        .eq('id', userId)
        .single()

      const { data: pantryItems } = await supabase
        .from('pantry_items')
        .select('name')
        .eq('user_id', userId)
        .eq('in_stock', true)
        .order('created_at', { ascending: true })

      // Oldest items first — GPT prompt will prioritize using them up
      const ingredients = pantryItems?.map(i => i.name) || []

      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // limits rating history fed to GPT so stale preferences don't bloat the prompt
      const { data: ratings } = await supabase
        .from('meal_ratings')
        .select('meal_name, rating')
        .eq('user_id', userId)
        .gte('created_at', since)

      const dislikedMeals = ratings?.filter(r => r.rating === -1).map(r => r.meal_name) ?? []
      const likedMeals = ratings?.filter(r => r.rating === 1).map(r => r.meal_name) ?? []

      // Suppress repeats from recent generations — keeps suggestions feeling fresh between regens.
      // Stored device-local (per-mode), trimmed to last 12 meal names = ~3-4 prior generations.
      let recentMealNames: string[] = []
      try {
        const recentRaw = await AsyncStorage.getItem(`${RECENT_MEALS_KEY_PREFIX}_${mode}`)
        if (recentRaw) recentMealNames = JSON.parse(recentRaw)
      } catch {}

      const ok = await requestConsent()
      if (!ok) { setLoading(false); return }

      const generated = await generateMeals({
        ingredients: ingredients.length > 0 ? ingredients : ['chicken breast', 'rice', 'eggs', 'broccoli'], // GPT needs at least some ingredients to generate meaningful meals
        calorieGoal: profile?.calorie_goal || 2400,
        proteinGoal: profile?.protein_goal || 150,
        mealsPerDay: profile?.meals_per_day || 3,
        cookingSkill: profile?.cooking_skill || 'moderate',
        maxPrepMinutes: profile?.max_prep_minutes || 30,
        dietaryRestrictions: profile?.dietary_restrictions || ['None'],
        foodDislikes: profile?.food_dislikes || [],
        dislikedMeals,
        likedMeals,
        cuisinePreferences: profile?.cuisine_preferences || [],
        recentMealNames,
        mode,
      })

      // Cache today's meals — include maxPrepMinutes so stale meals can be invalidated if preference changes,
      // and regenCount to track how many manual refreshes have been used today (cap enforced in regenerate()).
      const maxPrep = profile?.max_prep_minutes || 30
      await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}_${mode}`, JSON.stringify({ date: todayStr(), meals: generated, maxPrepMinutes: maxPrep, regenCount: regensUsedTodayRef.current }))

      // Append new meal names to the recent-meals list (keep last 12 names, ~3-4 gens) so
      // future generations can exclude them and feel fresh between regens.
      try {
        const newNames = generated.map(m => m.name).filter(Boolean)
        const merged = [...newNames, ...recentMealNames].slice(0, 12)
        await AsyncStorage.setItem(`${RECENT_MEALS_KEY_PREFIX}_${mode}`, JSON.stringify(merged))
      } catch {}

      // Images load progressively after meals are shown; errors must not block the UI.
      // Fetched in parallel here (different meal names → independent Replicate jobs);
      // the per-image retry loop above is what's serialized to avoid burst throttling.
      const mealsToImage = [...generated]
      ;(async () => {
        await Promise.all(mealsToImage.map(async (meal, i) => {
          if (meal.image) return
          const ingNames = meal.ingredients?.map((ing: any) => ing.name) ?? []
          const image = await fetchImage(meal.name, ingNames, meal.steps ?? [])
          if (image) {
            mealsToImage[i] = { ...mealsToImage[i], image }
            setMeals(prev => {
              const updated = [...prev]
              updated[i] = { ...updated[i], image }
              return updated
            })
          }
        }))
        await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}_${mode}`, JSON.stringify({ date: todayStr(), meals: mealsToImage, maxPrepMinutes: maxPrep, regenCount: regensUsedTodayRef.current }))
      })()

      return generated
    } catch (err: any) {
      throw err
    }
  }

  const fetchAndGenerate = async (forceGenerate = false) => {
    if (!userId) return
    setError(null)

    try {
      // Serve cached meals instantly (no loading state)
      if (!forceGenerate) {
        const raw = await AsyncStorage.getItem(`${CACHE_KEY_PREFIX}_${mode}`)
        if (raw) {
          const cached: CachedMeals = JSON.parse(raw)
          // Old cache format has no maxPrepMinutes — treat as miss so it regenerates with correct prep constraint
          if (cached.maxPrepMinutes === undefined) {
            await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}_${mode}`)
          } else if (cached.date === todayStr() && cached.meals.length > 0) {
            const validMeals = cached.meals.filter(m => !m.prepTime || Number(m.prepTime) <= cached.maxPrepMinutes!)
            const isSeeded = validMeals.every(m => m.id?.startsWith('seeded_'))
            if (validMeals.length > 0 && !isSeeded) {
              setMeals(validMeals)
              setLoading(false)
              setRegensUsedToday(cached.regenCount ?? 0)
              // Fetch any missing images for cached meals
              const cachedMeals = [...cached.meals]
              if (cachedMeals.some(m => !m.image)) {
                ;(async () => {
                  await Promise.all(cachedMeals.map(async (meal, i) => {
                    if (meal.image) return
                    const ingNames = meal.ingredients?.map((ing: any) => ing.name) ?? []
                    const image = await fetchImage(meal.name, ingNames, meal.steps ?? [])
                    if (image) {
                      cachedMeals[i] = { ...cachedMeals[i], image }
                      setMeals(prev => {
                        const updated = [...prev]
                        updated[i] = { ...updated[i], image }
                        return updated
                      })
                    }
                  }))
                  await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}_${mode}`, JSON.stringify({ date: todayStr(), meals: cachedMeals, maxPrepMinutes: cached.maxPrepMinutes, regenCount: cached.regenCount ?? 0 }))
                })()
              }
              return
            }
            // Seeded placeholders have no recipe data — clear and fall through to generate
            await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}_${mode}`)
          }
        }
      }

      setLoading(true)
      const generated = await generate()
      if (generated) setMeals(generated)
    } catch (err: any) {
      console.log('MEAL ERROR v3:', err.message)
      console.log('MEAL ERROR status:', err?.context?.status)
      // Read the response body — use clone so we don't consume it
      try {
        if (err?.context && typeof err.context.clone === 'function') {
          const bodyText = await err.context.clone().text()
          console.log('MEAL ERROR body text:', bodyText)
        } else if (err?.context && typeof err.context.text === 'function') {
          const bodyText = await err.context.text()
          console.log('MEAL ERROR body text:', bodyText)
        }
      } catch (readErr: any) {
        console.log('MEAL ERROR body read failed:', readErr?.message)
      }
      // Check session state AFTER the error
      try {
        const s = await supabase.auth.getSession()
        console.log('MEAL ERROR post-session', {
          hasSession: !!s.data?.session,
          expires_at: s.data?.session?.expires_at,
          token_preview: s.data?.session?.access_token?.slice(0, 40),
        })
      } catch {}
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Triggers on mount, mode change, or enabled flip. Cache load is instant; daily cache
  // means the auto-fire generation happens at most once per user per day.
  // Seeded meals (onboarding placeholders) are skipped — they have no recipe data.
  useEffect(() => {
    if (!userId || !enabled) return
    let cancelled = false // prevents setMeals on an unmounted component if the user navigates away
    ;(async () => {
      const raw = await AsyncStorage.getItem(`${CACHE_KEY_PREFIX}_${mode}`)
      if (raw && !cancelled) {
        const cached: CachedMeals = JSON.parse(raw)
        // Invalidate if no maxPrepMinutes stored (old cache format) — forces regeneration with correct prep constraint
        if (cached.maxPrepMinutes === undefined) {
          await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}_${mode}`)
        } else if (cached.date === todayStr() && cached.meals.length > 0) {
          // Filter out any meals that somehow slipped past the prep cap
          const validMeals = cached.meals.filter(m => !m.prepTime || Number(m.prepTime) <= cached.maxPrepMinutes!)
          const isSeeded = validMeals.every(m => m.id?.startsWith('seeded_')) // onboarding placeholder meals have no recipe data; clear them before real generation
          if (validMeals.length > 0 && !isSeeded) {
            // Real AI meals: show immediately, then fetch any missing images in background
            setMeals(validMeals)
            setRegensUsedToday(cached.regenCount ?? 0)
            if (cached.meals.some(m => !m.image)) {
              const cachedMeals = [...cached.meals]
              ;(async () => {
                await Promise.all(cachedMeals.map(async (meal, i) => {
                  if (meal.image) return
                  const ingNames = meal.ingredients?.map((ing: any) => ing.name) ?? []
                  const image = await fetchImage(meal.name, ingNames, meal.steps ?? [])
                  if (image && !cancelled) {
                    cachedMeals[i] = { ...cachedMeals[i], image }
                    setMeals(prev => {
                      const updated = [...prev]
                      updated[i] = { ...updated[i], image }
                      return updated
                    })
                  }
                }))
                await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}_${mode}`, JSON.stringify({ date: todayStr(), meals: cachedMeals, maxPrepMinutes: cached.maxPrepMinutes, regenCount: cached.regenCount ?? 0 }))
              })()
            }
            return
          }
          // Seeded: treat as cache miss — clear and generate real meals
          await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}_${mode}`)
        }
      }
      if (!cancelled) fetchAndGenerate()
    })()
    return () => { cancelled = true }
  }, [userId, isPremium, mode, enabled])

  // Manual refresh gated by daily cap. Increments regensUsedToday so the ref is set
  // BEFORE generate() writes the cache, ensuring the new count is persisted.
  const regenerate = async () => {
    if (regensUsedTodayRef.current >= MAX_DAILY_REGENS) return
    const nextCount = regensUsedTodayRef.current + 1
    setRegensUsedToday(nextCount)
    regensUsedTodayRef.current = nextCount
    await fetchAndGenerate(true)
  }

  // Retry a failed gen — does NOT count against MAX_DAILY_REGENS. Failed gens never
  // reach image fetch (which is where real cost lives), so retries are effectively free.
  // Users shouldn't lose their daily refresh shot recovering from a network blip.
  const retry = async () => {
    await fetchAndGenerate(true)
  }

  return { meals, loading, error, regenerate, retry, canRegenerate: regensUsedToday < MAX_DAILY_REGENS, regensUsedToday }
}
