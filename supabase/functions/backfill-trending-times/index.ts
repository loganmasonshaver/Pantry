// One-off repair: split every stored Discover recipe's single prep_time into prep / cook / rest.
//
// trending_meals held ONE undefined prep_time until 2026-09-10, and the pool holds both ways the
// model got it wrong — a 16-hour freeze DROPPED ("Chocolate Oreo Protein McFlurry", 10 min) and a
// 16-hour freeze COUNTED AS WORK ("Brownie Batter Protein Ice Cream", 1020 min). New rows are split
// at extraction; this repairs the ones already stored, which otherwise stay wrong for up to 30 days.
//
// A MODEL does this, not a keyword scan. Keyword matching was measured against the live pool first
// and was wrong on dozens of rows: "chillies" matches "chill", so Paneer Manchurian read as a chilled
// dessert, and storage tips ("fridge reheat 1:30") read as waits. Telling a real wait from a mention
// of one is judgement.
//
// Internal only (CRON_SECRET). POST { dryRun?: boolean, limit?: number }. dryRun returns the proposed
// times without writing, so a batch can be read before anything changes. Picks up rows whose
// rest_time is NULL — the migration's "not yet split" marker — so it is resumable and never redoes
// a row it has already written.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { TIME_RULES, normaliseTimes } from '../_shared/meal-times.ts'

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const googleAiKey = Deno.env.get("GOOGLE_AI_KEY") ?? ""
const db = createClient(supabaseUrl, supabaseServiceKey)

// Small batches: each recipe carries its full step text, and a malformed reply loses the batch.
const BATCH = 12

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

type Row = { id: string; name: string; prep_time: number | null; steps: unknown }

const stepText = (steps: unknown): string =>
  (Array.isArray(steps) ? steps : [])
    .map((s: any, i: number) => `${i + 1}. ${typeof s === 'string' ? s : `${s?.title ?? ''}: ${s?.detail ?? ''}`}`)
    .join('\n')

async function splitBatch(rows: Row[]): Promise<Map<string, { prepTime: number; cookTime: number; restTime: number }>> {
  const listing = rows.map((r, i) =>
    `RECIPE ${i + 1}: "${r.name}" (the stored single time was ${r.prep_time ?? 'unknown'} minutes and may be wrong in either direction)\n${stepText(r.steps)}`,
  ).join('\n\n')
  const prompt = `You are splitting recipe times. For each recipe below, read the STEPS and return how long it takes.

${TIME_RULES}

The stored single time is only a hint — it was produced without these rules, so it sometimes includes a freeze and sometimes leaves it out. Trust the steps.

Respond ONLY with a JSON array, no markdown, one object per recipe in order:
[{"recipe": 1, "prepTime": 10, "cookTime": 0, "restTime": 960}]

${listing}`

  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${googleAiKey}` },
    body: JSON.stringify({
      model: "gemini-3.1-flash-lite",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 4000,
    }),
  })
  if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const text = String(data?.choices?.[0]?.message?.content ?? '').replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(text)
  const out = new Map<string, { prepTime: number; cookTime: number; restTime: number }>()
  for (const item of Array.isArray(parsed) ? parsed : []) {
    const row = rows[Number(item?.recipe) - 1]
    if (row) out.set(row.id, normaliseTimes(item))
  }
  return out
}

Deno.serve(async (req: Request) => {
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? ""
  const authToken = (req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "").trim()
  if (!(CRON_SECRET !== "" && authToken === CRON_SECRET)) return json({ error: "Unauthorized" }, 401)
  if (!googleAiKey) return json({ error: "GOOGLE_AI_KEY not set" }, 500)

  const body = await req.json().catch(() => ({}))
  const dryRun = body?.dryRun !== false // default TRUE: writing is the thing you have to ask for
  const limit = Math.min(Math.max(Number(body?.limit) || BATCH, 1), 250)

  const { data: rows, error } = await db.from('trending_meals')
    .select('id, name, prep_time, steps')
    .is('rest_time', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return json({ error: error.message }, 500)

  const results: Array<Record<string, unknown>> = []
  const failures: string[] = []
  for (let i = 0; i < (rows ?? []).length; i += BATCH) {
    const batch = (rows as Row[]).slice(i, i + BATCH)
    try {
      const split = await splitBatch(batch)
      for (const r of batch) {
        const t = split.get(r.id)
        if (!t) { failures.push(`${r.name}: no answer`); continue }
        results.push({ name: r.name, before: r.prep_time, ...t })
        if (!dryRun) {
          const { error: upErr } = await db.from('trending_meals')
            .update({ prep_time: t.prepTime, cook_time: t.cookTime, rest_time: t.restTime })
            .eq('id', r.id)
          if (upErr) failures.push(`${r.name}: ${upErr.message}`)
        }
      }
    } catch (e) {
      // One bad batch must not lose the rest; its rows keep rest_time NULL and are retried next call.
      failures.push(`batch at ${i}: ${(e as Error).message}`)
    }
  }
  const { count: remaining } = await db.from('trending_meals')
    .select('id', { count: 'exact', head: true }).is('rest_time', null)
  return json({ dryRun, processed: results.length, remaining, failures, results })
})
