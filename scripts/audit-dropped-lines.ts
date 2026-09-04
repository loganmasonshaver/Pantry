// How many stored rows lost an ingredient to the 90-character parser cap?
//
// Not answerable from the database: the evidence only exists in the creator's description, and the
// retention contract cannot see a line the parser never read (it compares the model's array against
// parsed.length, so a parser miss shrinks BOTH sides). So this re-fetches each source description
// and re-parses it twice — once at the old cap, once at the new one — and reports every row where
// the two disagree. Each such row is a row that silently lost an ingredient.
//
// Costs 1 YouTube quota unit per 50 videos (videos.list), so ~4 units for the whole pool. Trivial
// against the 10,000/day budget — this is nothing like a pipeline run.
//
//   npx supabase db query --linked --file scripts/dump-video-ids.sql > /tmp/ids.json
//   # extract the array (see replay-macros.ts header for the same step), then:
//   YOUTUBE_API_KEY=... node scripts/audit-dropped-lines.ts /tmp/video_ids.json
//
// The key is read from the environment on purpose — it must not be pasted into a file or a chat.
import { parseIngredientBlock } from '../supabase/functions/_shared/ingredient-parse.ts'
import { readFileSync } from 'node:fs'

const KEY = process.env.YOUTUBE_API_KEY
if (!KEY) { console.error('set YOUTUBE_API_KEY (Supabase dashboard -> Edge Functions -> Secrets)'); process.exit(1) }
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'))

// Re-parse under the OLD rule by pre-truncating: any line at/over 90 chars is removed before the
// parser sees it, which is exactly what the old `length >= 90` check did.
const asOldCap = (desc: string) =>
  parseIngredientBlock(desc.split('\n').filter(l => l.trim().length < 90).join('\n'))

const descs = new Map<string, string>()
for (let i = 0; i < rows.length; i += 50) {
  const batch = rows.slice(i, i + 50)
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${batch.map((r: any) => r.video_id).join(',')}&key=${KEY}`
  const j = await (await fetch(url)).json()
  if (j.error) { console.error('YouTube API error:', j.error.message); process.exit(1) }
  for (const item of j.items ?? []) descs.set(item.id, item.snippet?.description ?? '')
  console.error(`fetched ${descs.size}/${rows.length}…`)
}

let checked = 0, lost = 0, unparseable = 0
for (const r of rows) {
  const d = descs.get(r.video_id)
  if (!d) { unparseable++; continue }
  const nowLines = parseIngredientBlock(d)
  const oldLines = asOldCap(d)
  if (nowLines.length === 0) { unparseable++; continue }
  checked++
  if (nowLines.length > oldLines.length) {
    lost++
    const missed = nowLines.filter(l => !oldLines.includes(l))
    console.log(`${r.name.slice(0, 40).padEnd(40)} stored ${r.stored}  parsed now ${nowLines.length} vs old ${oldLines.length}`)
    missed.forEach(m => console.log(`     LOST: (${m.length} chars) ${m}`))
  }
}
console.log(`\nrows with a parseable ingredient list: ${checked}`)
console.log(`rows that LOST a line to the 90-char cap: ${lost}`)
console.log(`rows whose description has no parseable list (unaffected): ${unparseable}`)
