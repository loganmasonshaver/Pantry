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

// Restrict CORS to our own web origin (not '*') on this destructive endpoint. The native
// app doesn't enforce CORS so it's unaffected; this stops a browser on any other site from
// invoking account deletion cross-origin with a stolen JWT (e.g. via XSS elsewhere).
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://heypantry.app',
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

    // Delete all user-owned rows and COLLECT errors instead of swallowing them. If any
    // child delete fails we must NOT delete the auth row — doing so would orphan that data
    // permanently (auth.users is the FK target), a GDPR erasure failure. These tables all
    // exist, so a delete error is transient (pool/network) and the caller can safely retry.
    const childTables = [
      'saved_meals', 'meal_logs', 'meal_ratings', 'grocery_items',
      'pantry_items', 'weight_logs', 'macro_overrides', 'scan_usage', 'creators',
    ]
    const results = await Promise.all(
      childTables.map(t => adminClient.from(t).delete().eq('user_id', user.id))
    )
    // Profile last — other tables may FK to it.
    const profileRes = await adminClient.from('profiles').delete().eq('id', user.id)

    const failed = [...results, profileRes].filter(r => r.error)
    if (failed.length) {
      const detail = failed.map(r => r.error!.message).join('; ')
      console.log('[delete-account] child cleanup failed, aborting before auth delete:', detail)
      return new Response(
        JSON.stringify({ error: 'Could not fully delete your data. Please try again.', detail }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
  } catch (e) {
    console.log('[delete-account] cleanup threw, aborting before auth delete:', (e as Error).message)
    return new Response(
      JSON.stringify({ error: 'Could not fully delete your data. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // GDPR: remove the user's email from Loops before deleting the auth row so
  // we still have the email available. Non-fatal — won't block deletion.
  if (user.email) {
    await deleteLoopsContact(user.email)
  }

  // Now delete the auth.users row itself.
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('[delete-account] deleteUser error:', deleteError.message) // detail server-side only
    return new Response(JSON.stringify({ error: "Account deletion failed" }), { // generic
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
