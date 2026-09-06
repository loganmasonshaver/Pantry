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
// Known limit: nothing watches this watcher. If THIS cron stops firing, the result is silence, and
// silence is also what healthy looks like. One level is the right trade for a solo pre-launch app —
// revisit with a real uptime monitor if Discover ever becomes load-bearing for revenue.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const OPS_USER_ID = Deno.env.get("OPS_USER_ID") ?? ""
// STORE_CAP is 18 and the LLM yield varies run to run (16 is normal), so 12 leaves room for a
// slightly thin day while still catching a genuinely degraded batch.
const MIN_EXPECTED = parseInt(Deno.env.get("TRENDING_MIN_EXPECTED") ?? "12", 10)

const db = createClient(supabaseUrl, supabaseServiceKey)
const today = () => new Date().toISOString().split('T')[0]

async function pushToOps(title: string, body: string): Promise<string> {
  if (!OPS_USER_ID) return "skipped: OPS_USER_ID not set"
  const { data: profile } = await db
    .from('profiles').select('expo_push_token').eq('id', OPS_USER_ID).maybeSingle()
  const token = profile?.expo_push_token
  // A missing token is itself worth surfacing in the logs — otherwise a silently-unregistered
  // device turns this whole alert into a no-op that still looks healthy.
  if (!token) return "FAILED: ops user has no expo_push_token"
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ to: token, title, body, sound: "default", priority: "high" }),
    })
    return res.ok ? "sent" : `FAILED: expo returned ${res.status}`
  } catch (e) {
    return `FAILED: ${(e as Error).message}`
  }
}

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

  let alert = "not needed"
  if (!healthy) {
    alert = await pushToOps("Pantry: Discover didn't generate", problems.join(' • '))
    console.log(`[health] alert: ${alert}`)
  }

  // PERSIST THE RESULT. Both of this function's reporting channels were dead, and it has been
  // running on a cron reporting to nobody since 20260812002000_schedule_trending_health_check.sql:
  //
  //   1. pushToOps needs profiles.expo_push_token, and getExpoPushTokenAsync() has been failing
  //      with 'No "projectId" found' — app.json has an empty `extra`, so the app is not linked to
  //      an EAS project and no token was ever written. (Fix is `eas login` + `eas init`, which
  //      needs Logan's credentials.)
  //   2. The Response below goes to pg_net, which abandons the request before it completes. That
  //      is the exact reason pipeline_runs was created for generate-trending-meals — this function
  //      never got the same treatment.
  //
  // A row in pipeline_runs depends on nothing external: no EAS project, no device, no notification
  // permission. Push stays as the nice-to-have on top. Read the last check with:
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
