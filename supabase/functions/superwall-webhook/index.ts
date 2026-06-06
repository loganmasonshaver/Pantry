import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Superwall delivers webhooks via Svix (Standard Webhooks spec). We verify the
// signature manually against the RAW body — DO NOT parse/modify the body first or
// the byte representation changes and verification fails.
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
// The signing secret from the webhook details in the Superwall dashboard ("whsec_...").
const signingSecret = Deno.env.get("SUPERWALL_WEBHOOK_SECRET") ?? ""
const db = createClient(supabaseUrl, supabaseServiceKey)

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Constant-time string compare to avoid leaking the signature via timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function verifySvix(req: Request, rawBody: string): Promise<boolean> {
  const id = req.headers.get("svix-id")
  const ts = req.headers.get("svix-timestamp")
  const sigHeader = req.headers.get("svix-signature")
  if (!id || !ts || !sigHeader || !signingSecret) return false

  // Reject stale deliveries (replay protection) — 5-minute window per the spec.
  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false

  // Secret is "whsec_<base64>" — sign with the decoded bytes after the prefix.
  const secretB64 = signingSecret.includes("_") ? signingSecret.split("_")[1] : signingSecret
  const key = await crypto.subtle.importKey(
    "raw", b64decode(secretB64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  )
  const signedContent = `${id}.${ts}.${rawBody}`
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent))
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))

  // svix-signature is a space-separated list of "v1,<sig>" entries; any match passes.
  for (const part of sigHeader.split(" ")) {
    const comma = part.indexOf(",")
    const sig = comma >= 0 ? part.slice(comma + 1) : part
    if (safeEqual(sig, expected)) return true
  }
  return false
}

// Map a Superwall event type to the resulting is_premium value.
// null = leave unchanged (e.g. cancellation keeps access until expiration; a billing
// issue enters Apple's grace period and shouldn't revoke immediately).
function premiumFor(type: string, data: any): boolean | null {
  switch (type) {
    case "initial_purchase":
    case "renewal":
    case "uncancellation":
      return true
    case "expiration":
      return false
    case "cancellation":
    case "billing_issue":
      return null
    default:
      // Refunds are signalled by a negative price on a transaction event.
      if (typeof data?.price === "number" && data.price < 0) return false
      return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 })
  }

  const rawBody = await req.text()
  if (!(await verifySvix(req, rawBody))) {
    return new Response(JSON.stringify({ error: "invalid_signature" }), { status: 401 })
  }

  let evt: any
  try { evt = JSON.parse(rawBody) } catch { return new Response("ok", { status: 200 }) }

  const type: string = evt?.type ?? ""
  const data = evt?.data ?? {}
  // We identify users to Superwall with their Supabase id (superwallIdentify(user.id)),
  // so originalAppUserId is the Supabase id for SDK 4.5.2+. Fall back to the custom
  // userAttributes.supabaseUserId we also set, for older/legacy events.
  const userId: string | null = data?.userAttributes?.supabaseUserId ?? data?.originalAppUserId ?? null

  const premium = premiumFor(type, data)
  // Only valid UUIDs map to a profile; anything else (anon Superwall ids) no-ops harmlessly.
  const isUuid = typeof userId === "string" && /^[0-9a-f-]{36}$/i.test(userId)

  if (premium !== null && isUuid) {
    await db.from("profiles").update({
      is_premium: premium,
      premium_updated_at: new Date().toISOString(),
      premium_source: `superwall:${type}`,
    }).eq("id", userId).then(() => {}, () => {})
  }

  // Always 200 quickly so Svix doesn't retry a delivery we've accepted.
  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  })
})
