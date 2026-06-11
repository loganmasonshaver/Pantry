import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { verifyUser, unauthorizedResponse } from '../_shared/auth.ts'
import { rateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const jsonCors = { ...corsHeaders, "Content-Type": "application/json" }

// Loops API base — https://loops.so/docs/api-reference/intro
// Auth: Bearer token via LOOPS_API_KEY secret (created in Loops dashboard).
const LOOPS_API_BASE = "https://app.loops.so/api/v1"
const loopsApiKey = Deno.env.get("LOOPS_API_KEY")
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const db = createClient(supabaseUrl, supabaseServiceKey)

// ── Helpers ───────────────────────────────────────────────────────────────

// Apple Hide-My-Email private-relay addresses must NEVER receive marketing
// emails. They get only transactional / account messages.
function isApplePrivateRelay(email: string | null | undefined): boolean {
  if (!email) return false
  return email.toLowerCase().endsWith("@privaterelay.appleid.com")
}

// Build a Loops contact-property payload from a profile row.
// Properties prefixed with `pantry_` keep them isolated from any other
// Loops integrations in case Logan ever uses Loops for a second product.
function profileToLoopsProps(profile: any) {
  return {
    firstName: (profile.full_name ?? "").split(" ")[0] || null,
    // Custom contact properties — used by sequence conditions in Loops.
    pantry_marketing_opt_in: !!profile.marketing_email_opt_in,
    pantry_is_apple_private_relay: isApplePrivateRelay(profile.email),
    pantry_cook_tonight_used_count: profile.cook_tonight_used_count ?? 0,
    pantry_meals_saved_count: profile.meals_saved_count ?? 0,
    pantry_goals_customized: !!profile.goals_customized,
    pantry_last_active_at: profile.last_active_at ?? null,
    pantry_trial_started_at: profile.trial_started_at ?? null,
    pantry_trial_ended_at: profile.trial_ended_at ?? null,
    pantry_subscribed_at: profile.subscribed_at ?? null,
    pantry_churned_at: profile.churned_at ?? null,
    // Engaged = used Cook Tonight at least once AND saved at least one meal AND customized goals.
    // Loops sequences use this single flag to "skip day 3 email if engaged."
    pantry_is_engaged:
      (profile.cook_tonight_used_count ?? 0) >= 1 &&
      (profile.meals_saved_count ?? 0) >= 1 &&
      !!profile.goals_customized,
  }
}

// Upsert (create or update) a contact in Loops.
async function loopsUpsertContact(email: string, userId: string, props: Record<string, any>) {
  const res = await fetch(`${LOOPS_API_BASE}/contacts/update`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${loopsApiKey}`,
    },
    body: JSON.stringify({ email, userId, ...props }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Loops upsert failed: ${res.status} ${text}`)
  }
  return res.json()
}

// Fire a custom event in Loops — this is what triggers sequences.
// Common eventNames: "user_signed_up", "trial_started", "trial_ended_no_paid",
// "subscribed", "churned", "user_reengaged".
async function loopsFireEvent(email: string, userId: string, eventName: string, props: Record<string, any> = {}) {
  const res = await fetch(`${LOOPS_API_BASE}/events/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${loopsApiKey}`,
    },
    body: JSON.stringify({ email, userId, eventName, eventProperties: props }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Loops event ${eventName} failed: ${res.status} ${text}`)
  }
  return res.json()
}

// Delete a contact entirely (used for GDPR deletion / account delete).
// 404 is treated as success — if the contact doesn't exist in Loops, the deletion goal
// is already satisfied. Treating it as an error would block account-delete flows.
async function loopsDeleteContact(email: string) {
  const res = await fetch(`${LOOPS_API_BASE}/contacts/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${loopsApiKey}`,
    },
    body: JSON.stringify({ email }),
  })
  if (!res.ok && res.status !== 404) {
    const text = await res.text()
    throw new Error(`Loops delete failed: ${res.status} ${text}`)
  }
  return { ok: true }
}

// ── Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (!loopsApiKey) {
    return new Response(JSON.stringify({ error: "LOOPS_API_KEY not configured" }), {
      status: 500, headers: jsonCors,
    })
  }

  // AUTH GATE — verify the caller's JWT and require them to be operating on
  // their own user_id. Without this, anyone with the function URL could spam
  // Loops events against other users' accounts.
  const callerUser = await verifyUser(req)
  if (!callerUser) return unauthorizedResponse()

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  const { allowed } = rateLimit(ip, 30, 60000)
  if (!allowed) return rateLimitResponse()

  try {
    // Expected payload from in-app call. Three shapes accepted:
    //
    //   { action: "sync_profile", userId: "..." }       — re-mirror profile to Loops
    //   { action: "event", userId: "...", eventName: "trial_started", eventProperties: {...} }
    //   { action: "delete", userId: "..." }              — used by delete-account flow
    const body = await req.json()
    const action = body.action ?? "sync_profile"

    if (action === "delete") {
      // Self-delete only — caller's userId must match. Resolve email from auth
      // since the profile may already be deleted by the time this is called.
      if (body.userId && body.userId !== callerUser.id) {
        return new Response(JSON.stringify({ error: "cannot delete other users" }), { status: 403, headers: jsonCors })
      }
      // Always the verified caller's OWN email — never a caller-supplied body.email, which
      // would let any authenticated user delete ANY contact from the Loops list.
      const email = callerUser.email
      if (!email) return new Response(JSON.stringify({ error: "no email to delete" }), { status: 400, headers: jsonCors })
      await loopsDeleteContact(email)
      return new Response(JSON.stringify({ ok: true }), { headers: jsonCors })
    }

    if (!body.userId) {
      return new Response(JSON.stringify({ error: "userId required" }), { status: 400, headers: jsonCors })
    }

    // Enforce that the caller is operating on their own user record.
    if (body.userId !== callerUser.id) {
      return new Response(JSON.stringify({ error: "userId mismatch" }), { status: 403, headers: jsonCors })
    }

    // Pull the latest profile state so the Loops contact properties stay fresh
    const { data: profile, error: profileErr } = await db
      .from("profiles")
      .select("id, email, full_name, marketing_email_opt_in, marketing_consent_at, last_active_at, cook_tonight_used_count, meals_saved_count, goals_customized, trial_started_at, trial_ended_at, subscribed_at, churned_at")
      .eq("id", body.userId)
      .single()

    if (profileErr || !profile) {
      return new Response(JSON.stringify({ error: profileErr?.message ?? "profile not found" }), { status: 404, headers: jsonCors })
    }

    // Only sync contacts who exist with an email (fallback: pull from auth if profile.email is empty)
    let email: string | null = profile.email
    if (!email) {
      const { data: authUser } = await db.auth.admin.getUserById(body.userId)
      email = authUser?.user?.email ?? null
    }
    if (!email) {
      return new Response(JSON.stringify({ ok: false, skipped: "no email" }), { headers: jsonCors })
    }

    // Upsert the contact first so event triggers see fresh properties. But DON'T let an
    // upsert failure abort the request: the lifecycle event below (trial_started,
    // subscribed, churned, …) is the part that actually drives Loops sequences, and
    // events/send auto-creates/updates the contact anyway. Losing a property refresh is
    // recoverable on the next sync; silently dropping a lifecycle event is not.
    const props = profileToLoopsProps({ ...profile, email })
    let upsertFailed: string | null = null
    try {
      await loopsUpsertContact(email, body.userId, props)
      // Only stamp the sync marker on a real success.
      await db.from("profiles").update({ loops_contact_synced_at: new Date().toISOString() }).eq("id", body.userId)
    } catch (e) {
      upsertFailed = (e as Error).message
      console.log(`[loops-sync] contact upsert failed (continuing to event): ${upsertFailed}`)
    }

    if (action === "event") {
      const eventName = body.eventName
      const eventProperties = body.eventProperties ?? {}
      if (!eventName) {
        return new Response(JSON.stringify({ error: "eventName required for action=event" }), { status: 400, headers: jsonCors })
      }
      // Marketing events only fire if user has opted in. Transactional events
      // (e.g., trial_started, password_reset) always fire regardless.
      const TRANSACTIONAL = new Set([
        "user_signed_up",
        "trial_started",
        "trial_ended_no_paid",
        "subscribed",
        "churned",
        "trial_ending_in_2_days",
      ])
      const isTransactional = TRANSACTIONAL.has(eventName)
      if (!isTransactional && !props.pantry_marketing_opt_in) {
        return new Response(JSON.stringify({ ok: false, skipped: "no marketing opt-in" }), { headers: jsonCors })
      }
      // Apple private-relay → never send marketing events. Transactional only.
      if (!isTransactional && props.pantry_is_apple_private_relay) {
        return new Response(JSON.stringify({ ok: false, skipped: "apple private relay" }), { headers: jsonCors })
      }

      await loopsFireEvent(email, body.userId, eventName, eventProperties)
    }

    // Surface a degraded upsert (event still fired) so it's visible rather than silent.
    return new Response(JSON.stringify({ ok: true, ...(upsertFailed ? { upsertFailed } : {}) }), { headers: jsonCors })
  } catch (err) {
    console.log("[loops-sync] error:", err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: jsonCors,
    })
  }
})
