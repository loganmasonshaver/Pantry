// Server-side premium gate for paid endpoints. Reads the trustworthy is_premium /
// promo_active flags (written only by the Superwall webhook + redeem RPC, never the client).
//
// Kill switch: set PREMIUM_ENFORCEMENT=on to enforce, anything else to disable instantly
// without a redeploy. Default OFF so the wiring can ship dormant until verified (Stage B).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
)
const ENFORCE = (Deno.env.get("PREMIUM_ENFORCEMENT") ?? "off").toLowerCase() === "on"

/**
 * True if the user has an active subscription or promo grant.
 * FAILS OPEN on any read error / missing row — we never block a possible paying
 * customer over a transient DB issue; the per-user daily caps still bound abuse.
 */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("profiles")
      .select("is_premium, promo_active")
      .eq("id", userId)
      .single()
    if (error || !data) return true
    return !!(data.is_premium || data.promo_active)
  } catch {
    return true
  }
}

/**
 * Returns a 403 Response if the user must be blocked, or null to proceed.
 * No-ops (returns null) unless PREMIUM_ENFORCEMENT is 'on'.
 */
export async function requirePremium(userId: string): Promise<Response | null> {
  if (!ENFORCE) return null
  if (await hasActiveSubscription(userId)) return null
  return new Response(
    JSON.stringify({ error: "subscription_required" }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  )
}
