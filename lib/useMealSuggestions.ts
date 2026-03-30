import { useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { generateMeals, GeneratedMeal } from './meals'

const CACHE_KEY_PREFIX = 'pantry_daily_meals'

type CachedMeals = { date: string; meals: GeneratedMeal[] }

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function useMealSuggestions(userId: string | undefined, isPremium: boolean, mode: 'cookNow' | 'mealPlan' = 'cookNow') {
  const [meals, setMeals] = useState<GeneratedMeal[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchImage = async (name: string, ingredientNames: string[] = []): Promise<string | null> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data } = await supabase.functions.invoke('generate-meal-image', { body: { mealName: name, ingredients: ingredientNames } })
        if (data?.image) return data.image
      } catch {}
      await new Promise(r => setTimeout(r, 3000))
    }
    return null
  }

  const generate = async () => {
    if (!userId) return

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('calorie_goal, protein_goal, meals_per_day, cooking_skill, max_prep_minutes, dietary_restrictions, food_dislikes')
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

      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data: ratings } = await supabase
        .from('meal_ratings')
        .select('meal_name, rating')
        .eq('user_id', userId)
        .gte('created_at', since)

      const dislikedMeals = ratings?.filter(r => r.rating === -1).map(r => r.meal_name) ?? []
      const likedMeals = ratings?.filter(r => r.rating === 1).map(r => r.meal_name) ?? []

      const generated = await generateMeals({
        ingredients: ingredients.length > 0 ? ingredients : ['chicken breast', 'rice', 'eggs', 'broccoli'],
        calorieGoal: profile?.calorie_goal || 2400,
        proteinGoal: profile?.protein_goal || 150,
        mealsPerDay: profile?.meals_per_day || 3,
        cookingSkill: profile?.cooking_skill || 'moderate',
        maxPrepMinutes: profile?.max_prep_minutes || 30,
        dietaryRestrictions: profile?.dietary_restrictions || ['None'],
        foodDislikes: profile?.food_dislikes || [],
        dislikedMeals,
        likedMeals,
        mode,
      })

      // Cache today's meals for free-tier daily limit
      await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}_${mode}`, JSON.stringify({ date: todayStr(), meals: generated }))

      // Fetch images one at a time with retry
      const mealsToImage = [...generated]
      ;(async () => {
        for (let i = 0; i < mealsToImage.length; i++) {
          if (mealsToImage[i].image) continue
          const meal = mealsToImage[i]
          const ingNames = meal.ingredients?.map((ing: any) => ing.name) ?? []
          const image = await fetchImage(meal.name, ingNames)
          if (image) {
            mealsToImage[i] = { ...mealsToImage[i], image }
            setMeals(prev => {
              const updated = [...prev]
              updated[i] = { ...updated[i], image }
              return updated
            })
            await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}_${mode}`, JSON.stringify({ date: todayStr(), meals: mealsToImage }))
          }
          await new Promise(r => setTimeout(r, 2000))
        }
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
            setMeals(cached.meals)
            setLoading(false)
            // Fetch any missing images for cached meals
            const cachedMeals = [...cached.meals]
            if (cachedMeals.some(m => !m.image)) {
              ;(async () => {
                for (let i = 0; i < cachedMeals.length; i++) {
                  if (cachedMeals[i].image) continue
                  const ingNames = cachedMeals[i].ingredients?.map((ing: any) => ing.name) ?? []
                  const image = await fetchImage(cachedMeals[i].name, ingNames)
                  if (image) {
                    cachedMeals[i] = { ...cachedMeals[i], image }
                    setMeals(prev => {
                      const updated = [...prev]
                      updated[i] = { ...updated[i], image }
                      return updated
                    })
                    await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}_${mode}`, JSON.stringify({ date: todayStr(), meals: cachedMeals }))
                  }
                  await new Promise(r => setTimeout(r, 2000))
                }
              })()
            }
            return
          }
        }
      }

      setLoading(true)
      const generated = await generate()
      if (generated) setMeals(generated)
    } catch (err: any) {
      console.log('MEAL ERROR:', err.message, err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // On mode change, immediately load cached meals before async fetch
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      const raw = await AsyncStorage.getItem(`${CACHE_KEY_PREFIX}_${mode}`)
      if (raw && !cancelled) {
        const cached: CachedMeals = JSON.parse(raw)
        if (cached.date === todayStr() && cached.meals.length > 0) {
          setMeals(cached.meals)
          return
        }
      }
      if (!cancelled) fetchAndGenerate()
    })()
    return () => { cancelled = true }
  }, [userId, isPremium, mode])

  return { meals, loading, error, regenerate: () => fetchAndGenerate(true) }
}
