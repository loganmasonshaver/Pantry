// Which stored rows lost an ingredient to the old 90-character parser cap?
//
// This exists as an EDGE FUNCTION rather than a local script because the answer needs two things
// that cannot be brought together on a laptop: the stored rows (database) and the creator's
// original description (YouTube). YOUTUBE_API_KEY is a Supabase Edge Function secret, and those are
// WRITE-ONLY — `secrets list` returns a SHA-256 digest, never the value — so a local script could
// only run if the key were re-obtained from Google, and it is not in that account either. Running
// here means the key never leaves the platform that holds it.
//
// Invoke exactly like the cron, reading CRON_SECRET from the Vault so nothing is ever pasted:
//   select net.http_post(
//     url := '.../functions/v1/audit-ingredient-lines',
//     headers := jsonb_build_object('Content-Type','application/json','Authorization',
//       'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_service_role_key' limit 1)),
//     body := '{}'::jsonb);
//
// pg_net abandons the request long before this finishes, so results are WRITTEN to pipeline_runs
// (provider='audit-ingredient-lines') rather than returned. Read them back with SQL.
//
// Quota: videos.list bills 1 unit per call and accepts 50 ids, so the whole pool costs ~4 units
// against 10,000/day. This is nothing like a pipeline run and can be re-run freely.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { parseIngredientBlock } from "../_shared/ingredient-parse.ts"

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
const YT = Deno.env.get("YOUTUBE_API_KEY") ?? ""
const OLD_CAP = 90   // the value that dropped a real 90-char line; see MAX_INGREDIENT_LINE

// Re-parse under the OLD rule by removing >=90-char lines before the parser sees them — exactly
// what the old `line.length >= 90` check did.
const asOldCap = (desc: string) =>
  parseIngredientBlock(desc.split("\n").filter(l => l.trim().length < OLD_CAP).join("\n"))

Deno.serve(async (req) => {
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? ""
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!((CRON_SECRET && token === CRON_SECRET) || (SERVICE && token === SERVICE))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
  }
  if (!YT) return new Response(JSON.stringify({ error: "YOUTUBE_API_KEY not configured" }), { status: 500 })

  const { data: rows } = await db.from("trending_meals")
    .select("id, name, video_id, ingredients").not("video_id", "is", null)
  const list = rows ?? []

  const desc = new Map<string, string>()
  for (let i = 0; i < list.length; i += 50) {
    const ids = list.slice(i, i + 50).map((r: any) => r.video_id).join(",")
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids}&key=${YT}`)
    const j = await r.json()
    if (j.error) return new Response(JSON.stringify({ error: j.error.message }), { status: 502 })
    for (const it of j.items ?? []) desc.set(it.id, it.snippet?.description ?? "")
  }

  let checked = 0, noList = 0
  const affected: any[] = []
  for (const row of list as any[]) {
    const d = desc.get(row.video_id)
    if (!d) { noList++; continue }
    const now = parseIngredientBlock(d)
    if (now.length === 0) { noList++; continue }
    checked++
    const old = asOldCap(d)
    if (now.length > old.length) {
      affected.push({
        id: row.id, name: row.name, video_id: row.video_id,
        stored: Array.isArray(row.ingredients) ? row.ingredients.length : null,
        parsed_now: now.length, parsed_old: old.length,
        lost: now.filter(l => !old.includes(l)),
      })
    }
  }

  const funnel = {
    audit: "dropped-ingredient-lines", old_cap: OLD_CAP,
    rows_with_video: list.length, descriptions_fetched: desc.size,
    rows_with_parseable_list: checked, rows_without_parseable_list: noList,
    rows_that_lost_a_line: affected.length, affected,
  }
  await db.from("pipeline_runs").insert({
    dry_run: true, provider: "audit-ingredient-lines", stored: affected.length, funnel,
  })
  return new Response(JSON.stringify(funnel), { headers: { "Content-Type": "application/json" } })
})
