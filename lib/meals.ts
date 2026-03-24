import OpenAI from 'openai'

export type GeneratedMeal = {
  id: string
  name: string
  prepTime: number
  calories: number
  protein: number
  carbs: number
  fat: number
  ingredients: { name: string; visual: string; grams: string }[]
  steps: string[]
  image: null
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
}): Promise<GeneratedMeal[]> {
  const openai = new OpenAI({
    apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
    dangerouslyAllowBrowser: true,
  })

  const count = Math.min(mealsPerDay, 3)
  const restrictions = dietaryRestrictions.filter(d => d !== 'None').join(', ') || 'none'
  const dislikesLine = foodDislikes.length > 0
    ? `\nThe user dislikes these ingredients — never include them: ${foodDislikes.join(', ')}.`
    : ''
  const dislikedMealsLine = dislikedMeals.length > 0
    ? `\nThe user rated these meals poorly — do NOT suggest them or anything similar: ${dislikedMeals.join(', ')}.`
    : ''
  const likedMealsLine = likedMeals.length > 0
    ? `\nThe user loved these meals — suggest meals with a similar style or ingredients: ${likedMeals.join(', ')}.`
    : ''

  const prompt = `You are a nutrition-focused meal planner. Generate exactly ${count} high-protein meal suggestions.

User profile:
- Daily calorie goal: ${calorieGoal} kcal
- Daily protein goal: ${proteinGoal}g
- Meals per day: ${mealsPerDay}
- Cooking skill: ${cookingSkill}
- Max prep time: ${maxPrepMinutes} minutes
- Dietary restrictions: ${restrictions}${dislikesLine}${dislikedMealsLine}${likedMealsLine}

Available pantry ingredients:
${ingredients.join(', ')}

Rules:
- Each meal should use primarily ingredients from the pantry list
- Each meal should be high protein (at least ${Math.round(proteinGoal / mealsPerDay)}g protein)
- Calories per meal should be around ${Math.round(calorieGoal / mealsPerDay)} kcal
- Keep prep time under ${maxPrepMinutes} minutes
- For each ingredient include both a visual portion size (e.g. "1 palm", "1 fist", "2 tbsp") AND a gram/ml weight (e.g. "120g", "185g", "30ml")
- No repeated meals

Respond ONLY with a JSON array, no markdown, no explanation:
[
  {
    "id": "1",
    "name": "meal name",
    "prepTime": 15,
    "calories": 500,
    "protein": 45,
    "carbs": 40,
    "fat": 12,
    "ingredients": [
      { "name": "chicken breast", "visual": "1 palm-sized piece", "grams": "120g" }
    ],
    "steps": [
      "Step 1 instruction",
      "Step 2 instruction"
    ]
  }
]`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    max_tokens: 2000,
  })

  const text = response.choices[0].message.content || '[]'
  const clean = text.replace(/```json|```/g, '').trim()
  const meals = JSON.parse(clean)

  return meals.map((m: any) => ({ ...m, image: null }))
}
