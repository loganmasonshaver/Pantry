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
    const { base64 } = await req.json()
    if (!base64) {
      return new Response(JSON.stringify({ error: "No image provided" }), { status: 400 })
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "high" },
              },
              {
                type: "text",
                text: `This is a grocery receipt. Extract every food or grocery item purchased.
For each item, return a JSON array with objects: { "name": string, "category": string }

CRITICAL — Name format rules:
- Always use the GENERIC ingredient name, never the brand name.
  ✓ "Whole Milk" not "Horizon Whole Milk"
  ✓ "Chicken Breast" not "Perdue Chicken Breast"
  ✓ "Greek Yogurt" not "Chobani Greek Yogurt"
  ✓ "Pasta" not "Barilla Pasta"
  ✓ "Cheddar Cheese" not "Tillamook Cheddar Cheese"
- Strip all brand names, store names, and retailer prefixes.
- Strip size/weight info and item codes.
- Use plain descriptive names (e.g. "Sliced Bread", "Brown Rice", "Baby Spinach").

Categories must be one of: Protein, Carbs, Produce, Condiments, Dairy, Pantry Staples, Other.
- Protein: meat, fish, eggs, beans, tofu
- Carbs: bread, pasta, rice, cereals, flour
- Produce: fruits, vegetables, herbs
- Condiments: sauces, oils, spices, dressings
- Dairy: milk, cheese, yogurt, butter
- Pantry Staples: canned goods, broth, baking items
- Other: anything else that doesn't fit

Only include actual food/grocery items. Skip non-food items, fees, taxes, and totals.
Return ONLY the raw JSON array, no markdown, no explanation.`,
              },
            ],
          },
        ],
      }),
    })

    const data = await response.json()
    const text = data.choices[0]?.message?.content?.trim() ?? "[]"
    const clean = text.replace(/```json|```/g, "").trim()
    const items = JSON.parse(clean)

    return new Response(JSON.stringify(items), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
})
