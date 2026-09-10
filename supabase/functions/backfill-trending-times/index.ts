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
// Internal only (CRON_SECRET). POST { dryRun?: boolean, limit?: number, mode?: 'phases' }. dryRun returns the proposed
// times without writing, so a batch can be read before anything changes. Picks up rows whose
// rest_time is NULL — the migration's "not yet split" marker — so it is resumable and never redoes
// a row it has already written.
//
// mode 'phases' orders the EXISTING totals into cooking-order phases (time_phases) for rows that have
// none. The totals are handed to the model as fixed — they were split and checked already — so this
// only adds order. An answer that does not add up is stored as [] ("tried, no valid order"), which
// the client treats as absent and which stops the resumable loop retrying it forever.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { TIME_RULES, PHASE_RULES, normaliseTimes, normalisePhases, type TimePhase } from '../_shared/meal-times.ts'

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

type PhaseRow = { id: string; name: string; prep_time: number; cook_time: number; rest_time: number; steps: unknown }

async function askModel(prompt: string): Promise<unknown> {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${googleAiKey}` },
    body: JSON.stringify({ model: "gemini-3.1-flash-lite", messages: [{ role: "user", content: prompt }], temperature: 0, max_tokens: 6000 }),
  })
  if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return JSON.parse(String(data?.choices?.[0]?.message?.content ?? '').replace(/```json|```/g, '').trim())
}

async function phaseBatch(rows: PhaseRow[]): Promise<Map<string, TimePhase[] | null>> {
  const listing = rows.map((r, i) =>
    `RECIPE ${i + 1}: "${r.name}" — FIXED totals: prepTime ${r.prep_time}, cookTime ${r.cook_time}, restTime ${r.rest_time}\n${stepText(r.steps)}`,
  ).join('\n\n')
  const prompt = `You are ordering recipe times. Each recipe's three totals below are FIXED and already correct — do not change them. Read the STEPS and return the same minutes as timePhases in the order the cook does them, adding up exactly to those totals.

${PHASE_RULES}

Respond ONLY with a JSON array, no markdown, one object per recipe in order:
[{"recipe": 1, "timePhases": [{"kind": "prep", "label": "prep", "minutes": 10}]}]

${listing}`
  const parsed = await askModel(prompt)
  const out = new Map<string, TimePhase[] | null>()
  for (const item of Array.isArray(parsed) ? parsed : []) {
    const row = rows[Number((item as any)?.recipe) - 1]
    if (row) out.set(row.id, normalisePhases((item as any)?.timePhases,
      { prepTime: row.prep_time ?? 0, cookTime: row.cook_time ?? 0, restTime: row.rest_time ?? 0 }))
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

  if (body?.mode === 'phases') {
    const { data: rows, error } = await db.from('trending_meals')
      .select('id, name, prep_time, cook_time, rest_time, steps')
      .is('time_phases', null).not('rest_time', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return json({ error: error.message }, 500)
    const results: Array<Record<string, unknown>> = []
    const failures: string[] = []
    for (let i = 0; i < (rows ?? []).length; i += BATCH) {
      const batch = (rows as PhaseRow[]).slice(i, i + BATCH)
      try {
        const phased = await phaseBatch(batch)
        for (const r of batch) {
          if (!phased.has(r.id)) { failures.push(`${r.name}: no answer`); continue }
          const phases = phased.get(r.id) ?? null
          results.push({ name: r.name, prep: r.prep_time, cook: r.cook_time, rest: r.rest_time, phases })
          if (!dryRun) {
            const { error: upErr } = await db.from('trending_meals').update({ time_phases: phases ?? [] }).eq('id', r.id)
            if (upErr) failures.push(`${r.name}: ${upErr.message}`)
          }
        }
      } catch (e) {
        failures.push(`batch at ${i}: ${(e as Error).message}`)
      }
    }
    const { count: remaining } = await db.from('trending_meals')
      .select('id', { count: 'exact', head: true }).is('time_phases', null)
    return json({ mode: 'phases', dryRun, processed: results.length, valid: results.filter(r => r.phases).length, remaining, failures, results })
  }

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
