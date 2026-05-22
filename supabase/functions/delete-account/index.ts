// Edge function: delete-account
// Apple Guideline 5.1.1(v): apps that allow account creation MUST allow
// account deletion in-app. Called from Profile → Delete Account.
//
// Authenticates the caller via their JWT (supabase-js attaches it as the
// Authorization header), then uses the service role to wipe the user from
// auth.users — which cascades to profile rows + RLS-owned data via the
// foreign keys already in the schema.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!
const loopsApiKey = Deno.env.get("LOOPS_API_KEY")

// GDPR Article 17: when a user deletes their account, their email must also
// be removed from our email-marketing processor (Loops). Direct API call here
// — simpler than chaining edge functions and survives even if loops-sync is
// down. Failure is non-fatal so account deletion always completes.
async function deleteLoopsContact(email: string): Promise<void> {
  if (!loopsApiKey || !email) return
  try {
    const res = await fetch("https://app.loops.so/api/v1/contacts/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${loopsApiKey}`,
      },
      body: JSON.stringify({ email }),
    })
    if (!res.ok && res.status !== 404) {
      console.log(`[delete-account] Loops delete failed: ${res.status}`)
    }
  } catch (e) {
    console.log("[delete-account] Loops delete threw (non-fatal):", e)
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Resolve the caller's user via the JWT in the Authorization header.
  // Using the anon key client + the user's JWT scopes the call to that user.
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Service-role client for the destructive operations.
  const adminClient = createClient(supabaseUrl, supabaseServiceKey)

  // Manually clear child rows first. auth.admin.deleteUser() fails if any FK
  // points to the user row WITHOUT ON DELETE CASCADE, and our schema didn't
  // declare cascades on these tables. Mirror what Profile → Reset Onboarding
  // does client-side, but with service-role privileges so RLS doesn't block.
  //
  // Order matters for trending_meals: it FKs creators(id), so wipe trending
  // rows for this user's creator first, then delete the creator row.
  try {
    const { data: creatorRow } = await adminClient
      .from('creators')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (creatorRow?.id) {
      await adminClient.from('trending_meals').delete().eq('creator_id', creatorRow.id)
    }

    // Parallel-delete all user-owned rows. .then() with empty callbacks swallow
    // table-missing errors so a single absent table doesn't block the whole flow.
    await Promise.all([
      adminClient.from('saved_meals').delete().eq('user_id', user.id).then(() => {}, () => {}),
      adminClient.from('meal_logs').delete().eq('user_id', user.id).then(() => {}, () => {}),
      adminClient.from('meal_ratings').delete().eq('user_id', user.id).then(() => {}, () => {}),
      adminClient.from('grocery_items').delete().eq('user_id', user.id).then(() => {}, () => {}),
      adminClient.from('pantry_items').delete().eq('user_id', user.id).then(() => {}, () => {}),
      adminClient.from('weight_logs').delete().eq('user_id', user.id).then(() => {}, () => {}),
      adminClient.from('macro_overrides').delete().eq('user_id', user.id).then(() => {}, () => {}),
      adminClient.from('creators').delete().eq('user_id', user.id).then(() => {}, () => {}),
    ])

    // Profile last — other tables may FK to it.
    await adminClient.from('profiles').delete().eq('id', user.id).then(() => {}, () => {})
  } catch (e) {
    console.log('Child row cleanup partial failure (continuing to auth delete):', (e as Error).message)
    // Don't bail — even if cleanup partially fails, attempt the auth.users delete.
    // The user can re-run if it errors and we'll have at least made progress.
  }

  // GDPR: remove the user's email from Loops before deleting the auth row so
  // we still have the email available. Non-fatal — won't block deletion.
  if (user.email) {
    await deleteLoopsContact(user.email)
  }

  // Now delete the auth.users row itself.
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id)
  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
