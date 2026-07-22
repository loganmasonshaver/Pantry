// Per-user daily scan cap. Enforced server-side via a SECURITY DEFINER RPC so the
// client can't bypass it. Backs the abuse/cost ceiling on GPT-4o vision calls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!

function authHeaderOf(req: Request) {
  return req.headers.get("Authorization") ?? req.headers.get("authorization") ?? ""
}

// Build a client bound to the caller's JWT so auth.uid() resolves inside the RPC
// to the real user — the cap can't be spoofed onto another account.
function userClient(req: Request) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeaderOf(req) } },
  })
}

// In-memory backstop used ONLY on the fail-open path. If the DB cap check errors, we still
// let the caller through (a transient hiccup shouldn't block a paying user) — but without
// a limit, a DB outage would remove the cost ceiling entirely and let abusers burn unlimited
// OpenAI/FAL spend until it recovers. This caps fail-open grants per caller+type per hour.
// Per-isolate (not global), which is fine: it only needs to blunt a single abuser's burst.
const FAIL_OPEN_MAX = 15
const FAIL_OPEN_WINDOW_MS = 3_600_000
const failOpenHits = new Map<string, number[]>()

function failOpenAllowed(req: Request, scanType: string): boolean {
  const key = `${authHeaderOf(req)}:${scanType}`
  const now = Date.now()
  const recent = (failOpenHits.get(key) ?? []).filter(t => now - t < FAIL_OPEN_WINDOW_MS)
  if (recent.length >= FAIL_OPEN_MAX) {
    failOpenHits.set(key, recent)
    return false
  }
  recent.push(now)
  failOpenHits.set(key, recent)
  if (failOpenHits.size > 5000) failOpenHits.delete(failOpenHits.keys().next().value) // crude eviction
  return true
}

export async function checkScanCap(
  req: Request,
  scanType: string,
  cap: number,
): Promise<{ allowed: boolean; used: number }> {
  const { data, error } = await userClient(req)
    .rpc("check_and_increment_scan", { p_scan_type: scanType, p_cap: cap })
  // Fail OPEN on infra error: a transient DB hiccup shouldn't block a paying
  // user from scanning. The in-memory IP rate-limit still backstops burst abuse,
  // and this is a cost ceiling, not a data-security boundary.
  if (error || !data?.[0]) {
    const allowed = failOpenAllowed(req, scanType) // bounded fail-open, not unlimited
    console.log(`[scan-cap] rpc error, fail-open ${allowed ? 'ALLOW' : 'DENY (backstop)'}: ${error?.message ?? "no row"}`)
    return { allowed, used: 0 }
  }
  return { allowed: data[0].allowed, used: data[0].used }
}

// Rolling-window variant (e.g. cap=7 over days=7). Same atomic guarantees + fail-open
// behavior as checkScanCap; backs the weekly ceiling on the pricey GPT-4o vision scans.
export async function checkScanCapWindow(
  req: Request,
  scanType: string,
  cap: number,
  days: number,
): Promise<{ allowed: boolean; used: number }> {
  // Cap the RPC — like the premium read, it has no built-in timeout, and a stalled DB call
  // here would hang the function to the ~150s edge wall-clock kill. A timeout resolves into
  // the error shape below, routing to the bounded fail-open path (allow, don't block a user).
  const { data, error } = await Promise.race([
    userClient(req)
      .rpc("check_and_increment_scan_window", { p_scan_type: scanType, p_cap: cap, p_days: days }),
    new Promise<{ data: null; error: Error }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error("scan-cap rpc timed out") }), 6000)
    ),
  ])
  if (error || !data?.[0]) {
    const allowed = failOpenAllowed(req, scanType) // bounded fail-open, not unlimited
    console.log(`[scan-cap] window rpc error, fail-open ${allowed ? 'ALLOW' : 'DENY (backstop)'}: ${error?.message ?? "no row"}`)
    return { allowed, used: 0 }
  }
  return { allowed: data[0].allowed, used: data[0].used }
}

// Best-effort: give the slot back after a transient OpenAI failure. Never throws.
export async function refundScan(req: Request, scanType: string): Promise<void> {
  try {
    await userClient(req).rpc("refund_scan", { p_scan_type: scanType })
  } catch (e) {
    console.log(`[scan-cap] refund failed (ignored): ${(e as Error).message}`)
  }
}

export function scanCapResponse(cap: number, period: "day" | "week" = "day"): Response {
  const retry = period === "week" ? "in a few days" : "tomorrow"
  return new Response(
    JSON.stringify({
      // Warm, non-punitive, and no advertised number — the cap is an invisible abuse backstop most
      // users never hit, so a rare cap-hit reads as "you've been busy", not "you're rate-limited".
      error: `You've done a lot of scanning this ${period} — your scans refresh ${retry}.`,
      code: "scan_cap_reached",
    }),
    { status: 429, headers: { "Content-Type": "application/json" } },
  )
}
