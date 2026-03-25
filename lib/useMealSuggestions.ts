import { useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { generateMeals, GeneratedMeal } from './meals'

const CACHE_KEY = 'pantry_daily_meals'

type CachedMeals = { date: string; meals: GeneratedMeal[] }

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function useMealSuggestions(userId: string | undefined, isPremium: boolean) {
  const [meals, setMeals] = useState<GeneratedMeal[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      })

      // Cache today's meals for free-tier daily limit
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ date: todayStr(), meals: generated }))

      return generated
    } catch (err: any) {
      throw err
    }
  }

  const fetchAndGenerate = async (forceGenerate = false) => {
    if (!userId) return
    setLoading(true)
    setError(null)

    try {
      // Free users: serve cached meals if already generated today
      if (!isPremium && !forceGenerate) {
        const raw = await AsyncStorage.getItem(CACHE_KEY)
        if (raw) {
          const cached: CachedMeals = JSON.parse(raw)
          if (cached.date === todayStr() && cached.meals.length > 0) {
            setMeals(cached.meals)
            setLoading(false)
            return
          }
        }
      }

      const generated = await generate()
      if (generated) setMeals(generated)
    } catch (err: any) {
      console.log('MEAL ERROR:', err.message, err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (userId) fetchAndGenerate()
  }, [userId, isPremium])

  return { meals, loading, error, regenerate: () => fetchAndGenerate(true) }
}
