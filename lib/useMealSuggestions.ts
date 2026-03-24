import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import { generateMeals, GeneratedMeal } from './meals'

export function useMealSuggestions(userId: string | undefined) {
  const [meals, setMeals] = useState<GeneratedMeal[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAndGenerate = async () => {
    if (!userId) return
    setLoading(true)
    setError(null)

    try {
      // Get user profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('calorie_goal, protein_goal, meals_per_day, cooking_skill, max_prep_minutes, dietary_restrictions, food_dislikes')
        .eq('id', userId)
        .single()

      // Get pantry ingredients
      const { data: pantryItems } = await supabase
        .from('pantry_items')
        .select('name')
        .eq('user_id', userId)

      const ingredients = pantryItems?.map(i => i.name) || []

      // Get recent meal ratings (last 30 days)
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data: ratings } = await supabase
        .from('meal_ratings')
        .select('meal_name, rating')
        .eq('user_id', userId)
        .gte('created_at', since)

      const dislikedMeals = ratings?.filter(r => r.rating === -1).map(r => r.meal_name) ?? []
      const likedMeals = ratings?.filter(r => r.rating === 1).map(r => r.meal_name) ?? []

      // Fall back to defaults if profile incomplete
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

      setMeals(generated)
    } catch (err: any) {
      console.log('MEAL ERROR:', err.message, err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (userId) fetchAndGenerate()
  }, [userId])

  return { meals, loading, error, regenerate: fetchAndGenerate }
}
