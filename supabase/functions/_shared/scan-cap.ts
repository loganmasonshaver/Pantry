// Per-user daily scan cap. Enforced server-side via a SECURITY DEFINER RPC so the
// client can't bypass it. Backs the abuse/cost ceiling on GPT-4o vision calls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!

// Build a client bound to the caller's JWT so auth.uid() resolves inside the RPC
// to the real user — the cap can't be spoofed onto another account.
function userClient(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? ""
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
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
    console.log(`[scan-cap] rpc error, failing open: ${error?.message ?? "no row"}`)
    return { allowed: true, used: 0 }
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
  const { data, error } = await userClient(req)
    .rpc("check_and_increment_scan_window", { p_scan_type: scanType, p_cap: cap, p_days: days })
  if (error || !data?.[0]) {
    console.log(`[scan-cap] window rpc error, failing open: ${error?.message ?? "no row"}`)
    return { allowed: true, used: 0 }
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
      error: `Scan limit reached (${cap}/${period}). Try again ${retry}.`,
      code: "scan_cap_reached",
    }),
    { status: 429, headers: { "Content-Type": "application/json" } },
  )
}
