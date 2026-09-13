// Postgres jsonb refuses two things a JavaScript string happily holds: a lone UTF-16 surrogate and
// U+0000. Both can arrive from YouTube descriptions — stripBullet used to split a two-glyph emoji
// bullet ("👨‍🍳 HAZIRLANIŞI") and hand the low half on — and one such string anywhere inside the
// funnel made pipeline_runs refuse the whole row. The insert swallows the error by design (a
// logging failure must never fail the run), so the record of exactly the RICH days was silently
// lost: a rich day drops more recipes, and every dropped recipe's source lines go into
// droppedDetail. Sep 5, 6, 10 and 11 stored 14, 12, 13 and 9 meals and have no funnel row at all;
// all five runs on Sep 13 lost theirs the same way. The source bug is fixed too, but a table must
// not depend on every future parser being careful — scrub before every jsonb write that carries
// description-derived text. A lone surrogate becomes U+FFFD so the line stays readable.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

export function jsonSafe<T>(value: T): T {
  if (typeof value === 'string') return value.replace(LONE_SURROGATE, '\ufffd').replace(/\u0000/g, '') as unknown as T
  if (Array.isArray(value)) return value.map(jsonSafe) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = jsonSafe(v)
    return out as T
  }
  return value
}
