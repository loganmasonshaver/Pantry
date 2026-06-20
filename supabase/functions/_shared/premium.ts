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
 * Fails OPEN on genuine infra errors (transient DB hiccup) so we never block a paying
 * customer — but a "no row found" result is treated as NOT premium, not a free pass.
 * Otherwise any token whose id has no profile row (or a deleted profile) would be granted
 * access; the per-user daily caps remain the backstop on the fail-open path.
 */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  try {
    // The profiles read has NO built-in timeout. A stalled DB connection would otherwise hang
    // the whole edge function to Supabase's ~150s wall-clock kill (observed: 2+ min scans that
    // never logged past auth). Cap it and fail OPEN on timeout — same as a real read error —
    // so a slow DB never blocks a paying customer. Per-user weekly cap is the backstop.
    const query = db
      .from("profiles")
      .select("is_premium, promo_active")
      .eq("id", userId)
      .maybeSingle() // returns data=null (no error) when the row is absent → not premium
    const { data, error } = await Promise.race([
      query,
      new Promise<{ data: null; error: Error }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error("premium check timed out") }), 6000)
      ),
    ])
    if (error) return true        // real read error OR timeout → fail open
    if (!data) return false       // no profile row → NOT premium (don't grant on a miss)
    return !!(data.is_premium || data.promo_active)
  } catch {
    return true                   // transient/network exception → fail open
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
