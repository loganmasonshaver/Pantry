import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Daily verification that the trending batch actually landed.
//
// Deliberately a SEPARATE job from generate-trending-meals rather than a check bolted onto the end
// of it. A self-check can only report failures it survives to report: it cannot fire when the cron
// never runs, when the function times out, or when the worker dies mid-run. This checks the OUTCOME
// (does today have meals?) instead of the event, so every one of those failure modes is caught.
//
// Real case this exists for: on 2026-08-11 the batch built 16 recipes and then lost all of them to
// a single decimal macro failing an int4 insert. The run returned 500, nothing was stored, and it
// went unnoticed until someone manually checked the table a day later.
//
// It no longer pushes. The SQL-only daily_ops_report() sends Logan ONE notification a day whose first
// line is Discover's health, read straight from trending_meals — so it also watches this watcher,
// and needs no edge function or CRON_SECRET that a single auth failure could silence along with it.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
// STORE_CAP is 18 and the LLM yield varies run to run (16 is normal), so 12 leaves room for a
// slightly thin day while still catching a genuinely degraded batch.
const MIN_EXPECTED = parseInt(Deno.env.get("TRENDING_MIN_EXPECTED") ?? "12", 10)

const db = createClient(supabaseUrl, supabaseServiceKey)
const today = () => new Date().toISOString().split('T')[0]

Deno.serve(async (req: Request) => {
  // Ops-only endpoint — no user auth path at all. Same cron auth the generator uses.
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? ""
  const authToken = (req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "").trim()
  const authorized =
    (CRON_SECRET !== "" && authToken === CRON_SECRET) ||
    (supabaseServiceKey !== "" && authToken === supabaseServiceKey)
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    })
  }

  const date = today()
  const { data: rows, error } = await db
    .from('trending_meals')
    .select('id, name, image')
    .eq('generated_at', date)
    .eq('trend_source', 'YouTube trending')

  const problems: string[] = []

  if (error) {
    // Can't tell "no meals" from "couldn't ask" — treat the ambiguity as a problem rather than
    // assuming health, since assuming health is exactly the failure this job exists to prevent.
    problems.push(`could not read trending_meals: ${error.message}`)
  } else {
    const count = rows?.length ?? 0
    if (count === 0) problems.push(`NO meals generated for ${date}`)
    else if (count < MIN_EXPECTED) problems.push(`only ${count} meals for ${date} (expected >= ${MIN_EXPECTED})`)

    // Meals with no image render as blank cards, so a batch that "succeeded" can still be broken.
    const noImage = (rows ?? []).filter(r => !r.image || !String(r.image).startsWith('http'))
    if (count > 0 && noImage.length > 0) {
      problems.push(`${noImage.length}/${count} missing images (${noImage.slice(0, 3).map(r => r.name).join(', ')}${noImage.length > 3 ? '…' : ''})`)
    }
  }

  const healthy = problems.length === 0
  const summary = healthy
    ? `Discover healthy for ${date}: ${rows?.length ?? 0} meals, all imaged`
    : `Discover PROBLEM for ${date} — ${problems.join(' | ')}`
  console.log(`[health] ${summary}`)

  // Kept in the log row so old and new rows read the same; the 9am daily report is the alert now.
  const alert = "none (daily report carries it)"

  // PERSIST THE RESULT. The Response below goes to pg_net, which abandons the request before it
  // completes, so the response body alone is not a record — the reason pipeline_runs exists for
  // generate-trending-meals too. A row here depends on nothing external. Read the last check with:
  //   select created_at, funnel from pipeline_runs where provider = 'health-check'
  //   order by id desc limit 7;
  try {
    const { error: logErr } = await db.from('pipeline_runs').insert({
      dry_run: true, provider: 'health-check', stored: rows?.length ?? 0,
      // utc_hour is recorded because this check is only MEANINGFUL after the pipeline has run.
      // The crons are 08:00 UTC (generate) and 08:20 UTC (this). Triggered manually before 08:00 it
      // reports "NO meals generated for <today UTC>" — which is true and not a problem, because the
      // day's run has not happened yet. I raised exactly that false alarm running it at 01:13 UTC.
      // A row with utc_hour well below 8 is an off-window manual run; ignore its verdict.
      funnel: { healthy, date, count: rows?.length ?? 0, problems, alert, utc_hour: new Date().getUTCHours() },
    })
    // Read the error rather than assume it: supabase-js returns a refused write, it does not throw,
    // so a bare try/catch around .insert() catches nothing. Three call sites failed silently this way.
    if (logErr) console.log(`[health] pipeline_runs insert REFUSED: ${logErr.message}`)
  } catch (e) { console.log(`[health] pipeline_runs insert threw (ignored): ${(e as Error).message}`) }

  return new Response(JSON.stringify({ healthy, date, count: rows?.length ?? 0, problems, alert }), {
    // Always 200 — this endpoint reports health, it doesn't have health. A 500 here would make the
    // cron's own error logs indistinguishable from the outage it's reporting.
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
