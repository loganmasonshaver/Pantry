import { useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { generateMeals, GeneratedMeal } from './meals'
import { useAIConsent } from '../context/AIConsentContext'

const CACHE_KEY_PREFIX = 'pantry_daily_meals'
const IMAGE_URL_CACHE_KEY = 'pantry_image_urls_v1'

type CachedMeals = { date: string; meals: GeneratedMeal[] }

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function useMealSuggestions(userId: string | undefined, isPremium: boolean, mode: 'cookNow' | 'mealPlan' = 'cookNow') {
  const { requestConsent } = useAIConsent()
  const [meals, setMeals] = useState<GeneratedMeal[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchImage = async (name: string, ingredientNames: string[] = []): Promise<string | null> => {
    // Check device cache first — avoids any network call if already fetched before
    try {
      const raw = await AsyncStorage.getItem(IMAGE_URL_CACHE_KEY)
      if (raw) {
        const localCache: Record<string, string> = JSON.parse(raw)
        if (localCache[name]) return localCache[name]
      }
    } catch {}

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data, error } = await supabase.functions.invoke('generate-meal-image', { body: { mealName: name, ingredients: ingredientNames } })
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
      await new Promise(r => setTimeout(r, 3000))
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
        mode,
      })

      // Cache today's meals for free-tier daily limit
      await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}_${mode}`, JSON.stringify({ date: todayStr(), meals: generated }))

      // images load progressively after meals are shown; errors must not block the UI
      // Fetch all images in parallel
      const mealsToImage = [...generated]
      ;(async () => {
        await Promise.all(mealsToImage.map(async (meal, i) => {
          if (meal.image) return
          const ingNames = meal.ingredients?.map((ing: any) => ing.name) ?? []
          const image = await fetchImage(meal.name, ingNames)
          if (image) {
            mealsToImage[i] = { ...mealsToImage[i], image }
            setMeals(prev => {
              const updated = [...prev]
              updated[i] = { ...updated[i], image }
              return updated
            })
          }
        }))
        await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}_${mode}`, JSON.stringify({ date: todayStr(), meals: mealsToImage }))
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
      // Free users: serve cached meals instantly (no loading state)
      if (!forceGenerate) {
        const raw = await AsyncStorage.getItem(`${CACHE_KEY_PREFIX}_${mode}`)
        if (raw) {
          const cached: CachedMeals = JSON.parse(raw)
          if (cached.date === todayStr() && cached.meals.length > 0) {
            const isSeeded = cached.meals.every(m => m.id?.startsWith('seeded_'))
            if (!isSeeded) {
              setMeals(cached.meals)
              setLoading(false)
              // Fetch any missing images for cached meals
              const cachedMeals = [...cached.meals]
              if (cachedMeals.some(m => !m.image)) {
                ;(async () => {
                  await Promise.all(cachedMeals.map(async (meal, i) => {
                    if (meal.image) return
                    const ingNames = meal.ingredients?.map((ing: any) => ing.name) ?? []
                    const image = await fetchImage(meal.name, ingNames)
                    if (image) {
                      cachedMeals[i] = { ...cachedMeals[i], image }
                      setMeals(prev => {
                        const updated = [...prev]
                        updated[i] = { ...updated[i], image }
                        return updated
                      })
                    }
                  }))
                  await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}_${mode}`, JSON.stringify({ date: todayStr(), meals: cachedMeals }))
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

  // On mode change, immediately load cached meals before async fetch.
  // On mode change, immediately load cached meals before async fetch.
  // Seeded meals (onboarding placeholders) are skipped — they have no recipe data.
  useEffect(() => {
    if (!userId) return
    let cancelled = false // prevents setMeals on an unmounted component if the user navigates away
    ;(async () => {
      const raw = await AsyncStorage.getItem(`${CACHE_KEY_PREFIX}_${mode}`)
      if (raw && !cancelled) {
        const cached: CachedMeals = JSON.parse(raw)
        if (cached.date === todayStr() && cached.meals.length > 0) {
          const isSeeded = cached.meals.every(m => m.id?.startsWith('seeded_')) // onboarding placeholder meals have no recipe data; clear them before real generation
          if (!isSeeded) {
            // Real AI meals: show immediately, then fetch any missing images in background
            setMeals(cached.meals)
            if (cached.meals.some(m => !m.image)) {
              const cachedMeals = [...cached.meals]
              ;(async () => {
                await Promise.all(cachedMeals.map(async (meal, i) => {
                  if (meal.image) return
                  const ingNames = meal.ingredients?.map((ing: any) => ing.name) ?? []
                  const image = await fetchImage(meal.name, ingNames)
                  if (image && !cancelled) {
                    cachedMeals[i] = { ...cachedMeals[i], image }
                    setMeals(prev => {
                      const updated = [...prev]
                      updated[i] = { ...updated[i], image }
                      return updated
                    })
                  }
                }))
                await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}_${mode}`, JSON.stringify({ date: todayStr(), meals: cachedMeals }))
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
  }, [userId, isPremium, mode])

  return { meals, loading, error, regenerate: () => fetchAndGenerate(true) }
}
