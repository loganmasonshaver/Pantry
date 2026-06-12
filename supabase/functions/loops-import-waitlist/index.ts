import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Bulk-import the existing waitlist (from heypantry.app form) into Loops.
// One-shot operation — invoke this once after Loops account is set up.
//
// Requires a magic admin token to invoke (set in IMPORT_ADMIN_TOKEN secret)
// so this can't be triggered by random requests.

const LOOPS_API_BASE = "https://app.loops.so/api/v1"
const loopsApiKey = Deno.env.get("LOOPS_API_KEY")
const adminToken = Deno.env.get("IMPORT_ADMIN_TOKEN")
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const db = createClient(supabaseUrl, supabaseServiceKey)

// Constant-time secret compare (same pattern as admin-creator). A plain !== leaks how many
// leading chars matched via timing — on an endpoint that can export the whole waitlist table,
// that's worth closing. Hashing to fixed-length digests makes the XOR loop length-independent.
async function tokenMatches(provided: string | null): Promise<boolean> {
  if (!adminToken || typeof provided !== "string") return false
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(adminToken)),
  ])
  const x = new Uint8Array(a), y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } })

  // Admin gate — header must match the secret (constant-time)
  if (!(await tokenMatches(req.headers.get("x-admin-token")))) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })
  }

  if (!loopsApiKey) {
    return new Response(JSON.stringify({ error: "LOOPS_API_KEY not configured" }), { status: 500 })
  }

  try {
    // Resumable batching: at ~8 req/sec (Loops rate limit) a large waitlist would blow
    // past the edge function timeout in a single pass. Process a bounded batch per
    // invocation and hand back nextOffset so the caller loops until it comes back null.
    // Offset pagination is safe here because the waitlist is frozen during a one-shot import.
    const body = await req.json().catch(() => ({})) as { offset?: number; limit?: number }
    const offset = Math.max(0, body.offset ?? 0)
    const limit = Math.min(800, Math.max(1, body.limit ?? 500)) // ~500 @ 8/sec ≈ 62s, inside the timeout

    const { data: rows, error } = await db
      .from("waitlist")
      .select("email, source, created_at")
      .order("created_at", { ascending: true })
      .order("email", { ascending: true }) // deterministic tie-break so offsets don't skip/repeat
      .range(offset, offset + limit - 1)

    if (error) throw error
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, imported: 0, nextOffset: null }), { headers: { "Content-Type": "application/json" } })
    }

    let imported = 0
    let skipped = 0
    const errors: Array<{ email: string; message: string }> = []

    for (const row of rows) {
      try {
        const res = await fetch(`${LOOPS_API_BASE}/contacts/update`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${loopsApiKey}`,
          },
          body: JSON.stringify({
            email: row.email,
            source: "waitlist",
            // Custom property — flags these contacts as pre-launch waitlist signups
            pantry_is_waitlist: true,
            pantry_waitlist_signed_up_at: row.created_at,
            pantry_waitlist_source: row.source,
            // Waitlist signups counted as explicit marketing opt-in (they actively gave their email for product updates)
            pantry_marketing_opt_in: true,
            userGroup: "waitlist",
          }),
        })
        if (res.ok) imported++
        else {
          skipped++
          errors.push({ email: row.email, message: `HTTP ${res.status}` })
        }
      } catch (e) {
        skipped++
        errors.push({ email: row.email, message: (e as Error).message })
      }
      // Loops rate limit is 10 req/sec — 120ms gap ≈ 8 req/sec leaves headroom for retries
      // and Cloudflare jitter without hitting the cap and getting throttled mid-import.
      await new Promise(r => setTimeout(r, 120))
    }

    // A full batch means more rows may remain — tell the caller where to resume.
    // A short batch means we reached the end.
    const nextOffset = rows.length === limit ? offset + limit : null

    return new Response(JSON.stringify({ ok: true, imported, skipped, nextOffset, errors: errors.slice(0, 20) }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 })
  }
})
