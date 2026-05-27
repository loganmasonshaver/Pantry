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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } })

  // Admin gate — header must match the secret
  const providedToken = req.headers.get("x-admin-token")
  if (!adminToken || providedToken !== adminToken) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })
  }

  if (!loopsApiKey) {
    return new Response(JSON.stringify({ error: "LOOPS_API_KEY not configured" }), { status: 500 })
  }

  try {
    const { data: rows, error } = await db
      .from("waitlist")
      .select("email, source, created_at")
      .order("created_at", { ascending: true })

    if (error) throw error
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, imported: 0 }), { headers: { "Content-Type": "application/json" } })
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

    return new Response(JSON.stringify({ ok: true, imported, skipped, errors: errors.slice(0, 20) }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 })
  }
})
