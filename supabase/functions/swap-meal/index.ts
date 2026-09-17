import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { RECENT_MEMORY, capByDistinctDishes } from '../_shared/dish-key.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Records a spare meal the user swapped into their deck, exactly as generate-meals records the meals
// it shows: a generated_meals history row and a place in recent_meal_names, so the anti-repeat window
// knows the user was served it. Only a spare generate-meals actually issued (meal_spares) can be
// recorded — the client names it by id and cannot supply the meal itself.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const db = createClient(supabaseUrl, supabaseServiceKey)
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    })
  }

  const user = await verifyUser(req)
  if (!user) return unauthorizedResponse()

  try {
    const { mealId, mode = "cookNow" } = await req.json()
    if (typeof mealId !== "string" || !mealId || (mode !== "cookNow" && mode !== "mealPlan")) {
      return json({ error: "mealId and mode required" }, 400)
    }

    // Claim first: the conditional update is atomic, so a double tap or a retry records the swap once.
    const { data: spare, error: claimErr } = await db
      .from("meal_spares")
      .update({ swapped_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("mode", mode).eq("meal_id", mealId).is("swapped_at", null)
      .select("name, meal_data")
      .maybeSingle()
    if (claimErr) throw claimErr
    if (!spare) return json({ recorded: false }, 404) // not issued to this user, replaced, or already recorded

    const { error: historyErr } = await db.from("generated_meals").insert({
      user_id: user.id, meal_data: spare.meal_data, name: spare.name, mode,
    })
    if (historyErr) console.log("[swap-meal] generated_meals insert failed:", historyErr.message)

    // Same window generate-meals maintains: newest first, capped by distinct dishes, not names.
    const { data: profile } = await db.from("profiles").select("recent_meal_names").eq("id", user.id).maybeSingle()
    const recent: string[] = Array.isArray(profile?.recent_meal_names) ? profile.recent_meal_names : []
    const nextRecent = capByDistinctDishes([spare.name, ...recent], RECENT_MEMORY)
    const { error: recentErr } = await db.from("profiles").update({ recent_meal_names: nextRecent }).eq("id", user.id)
    if (recentErr) console.log("[swap-meal] recent_meal_names update failed:", recentErr.message)

    return json({ recorded: true })
  } catch (error) {
    console.error("[swap-meal] error:", (error as Error).message) // detail server-side only
    return json({ recorded: false }, 500)
  }
})
