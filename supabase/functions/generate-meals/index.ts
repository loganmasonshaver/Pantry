import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const openaiApiKey = Deno.env.get("OPENAI_API_KEY")

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    })
  }

  try {
    const {
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
    } = await req.json()

    const count = Math.min(mealsPerDay, 3)
    const restrictions = dietaryRestrictions.filter((d: string) => d !== "None").join(", ") || "none"
    const dislikesLine = foodDislikes.length > 0
      ? `\nThe user dislikes these ingredients — never include them: ${foodDislikes.join(", ")}.`
      : ""
    const dislikedMealsLine = dislikedMeals.length > 0
      ? `\nThe user rated these meals poorly — do NOT suggest them or anything similar: ${dislikedMeals.join(", ")}.`
      : ""
    const likedMealsLine = likedMeals.length > 0
      ? `\nThe user loved these meals — suggest meals with a similar style or ingredients: ${likedMeals.join(", ")}.`
      : ""

    const prompt = `You are a nutrition-focused meal planner. Generate exactly ${count} high-protein meal suggestions.

User profile:
- Daily calorie goal: ${calorieGoal} kcal
- Daily protein goal: ${proteinGoal}g
- Meals per day: ${mealsPerDay}
- Cooking skill: ${cookingSkill}
- Max prep time: ${maxPrepMinutes} minutes
- Dietary restrictions: ${restrictions}${dislikesLine}${dislikedMealsLine}${likedMealsLine}

Available pantry ingredients:
${ingredients.join(", ")}

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

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        max_tokens: 2000,
      }),
    })

    const data = await response.json()
    const text = data.choices[0].message.content || "[]"
    const clean = text.replace(/```json|```/g, "").trim()
    const meals = JSON.parse(clean)

    return new Response(JSON.stringify(meals.map((m: any) => ({ ...m, image: null }))), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
