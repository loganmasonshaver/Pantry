// Server-side premium gate for paid endpoints. Reads the trustworthy is_premium /
// promo_active flags (written only by the Superwall webhook + redeem RPC, never the client).
//
// Kill switch: set PREMIUM_ENFORCEMENT=off to disable 403s instantly without a redeploy.
// Default is OFF until Stage B wiring is confirmed — flip to 'on' to enforce.
const ENFORCE = (Deno.env.get('PREMIUM_ENFORCEMENT') ?? 'off').toLowerCase() === 'on'

/**
 * True if the user has an active subscription or promo grant.
 * FAILS OPEN on any read error / missing row — we never block a possible paying
 * customer over a transient DB issue; the per-user daily caps still bound abuse.
 */
export async function hasActiveSubscription(db: any, userId: string): Promise<boolean> {
  try {
    const { data, error } = await db
      .from('profiles')
      .select('is_premium, promo_active')
      .eq('id', userId)
      .single()
    if (error || !data) return true
    return !!(data.is_premium || data.promo_active)
  } catch {
    return true
  }
}

/**
 * Returns a 403 Response if the user must be blocked, or null to proceed.
 * No-ops (returns null) when PREMIUM_ENFORCEMENT is not 'on'.
 */
export async function requirePremium(db: any, userId: string): Promise<Response | null> {
  if (!ENFORCE) return null
  const ok = await hasActiveSubscription(db, userId)
  if (ok) return null
  return new Response(
    JSON.stringify({ error: 'subscription_required' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  )
}
