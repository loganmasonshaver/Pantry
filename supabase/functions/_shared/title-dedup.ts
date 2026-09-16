// Title-level repeat filter for generate-trending-meals, run on the candidate list BEFORE the
// model sees it.
//
// Half of the model's raw output on 2026-09-16 was dishes already in the pool, from other
// creators' videos (Cottage Cheese Flatbread three times in one run). The post-LLM name gate
// rejected every one at Jaccard 1.00 — correct, and each was a wasted pick. Naming the pool's
// dishes in the prompt as do-not-pick changed nothing: the model returned the same five. So the
// repeats come out of its reach instead.
//
// The match is CONTAINMENT, not Jaccard: every content word of the pool name must appear in the
// title. Titles carry junk a name does not ("😍 High Protein Lunch Idea!"), so Jaccard between the
// two sits at 0.5-0.6 for a plain repeat and never reaches the 0.7 the name gate uses. A candidate
// removed here would have been rejected downstream anyway; one wrongly kept is the status quo.

// The post-LLM STOPWORDS plus what YouTube titles add around a dish name. Deliberately does NOT
// include cuisine or diet words (vegan, keto, korean): those change the dish.
const TITLE_STOPWORDS = new Set([
  'high', 'protein', 'recipe', 'recipes', 'easy', 'quick', 'best', 'the', 'a', 'an', 'with', 'and', 'of', 'for', 'low',
  'macro', 'friendly', 'healthy', 'how', 'to', 'make', 'made', 'making', 'this', 'that', 'these', 'you', 'your', 'my',
  'in', 'on', 'at', 'is', 'it', 'are', 'be', 'viral', 'tiktok', 'shorts', 'short', 'ultimate', 'perfect', 'insane',
  'crazy', 'delicious', 'simple', 'only', 'just', 'one', 'minute', 'minutes', 'min', 'mins', 'calorie', 'calories',
  'cal', 'kcal', 'gram', 'grams', 'ingredient', 'ingredients', 'meal', 'prep', 'idea', 'ideas', 'lunch', 'dinner',
  'breakfast', 'snack', 'snacks', 'dessert', 'ever', 'need', 'try', 'better', 'than', 'new', 'way', 'homemade',
  'no', 'without', 'free', 'style', 'version', 'hack', 'under', 'over', 'per', 'serving', 'fitness', 'gym',
  'most',
])

// Form words the model swaps freely when it renames a dish it was told is in the pool: "Tiramisu
// Protein Balls" came back as "Tiramisu Snack Balls" and then "Tiramisu Bites". One word for the
// family, applied after singularising.
const CANON: Record<string, string> = { ball: 'bite', truffle: 'bite', bliss: 'bite' }

// Same idea as recipe-integrity's singular(): both sides go through it, so only consistency
// matters, not linguistic correctness.
function singular(w: string): string {
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (w.endsWith('oes') && w.length > 4) return w.slice(0, -2)
  if (/(?:s|x|z|ch|sh)es$/.test(w) && w.length > 4) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1)
  return w
}

// Content words of a title or a name: latin letters only (so "40g" and emoji vanish), lowercased,
// singularised, stopwords and two-letter fragments dropped.
export function contentWords(s: string): Set<string> {
  const out = new Set<string>()
  // Hashtags off first: "#highprotein #tiramisu" glue words together and count as content.
  for (const raw of (s ?? '').toLowerCase().replace(/#\S+/g, ' ').match(/[a-zà-ɏ]+/g) ?? []) {
    const w0 = singular(raw)
    const w = CANON[w0] ?? w0
    if (w.length > 2 && !TITLE_STOPWORDS.has(w) && !TITLE_STOPWORDS.has(raw)) out.add(w)
  }
  return out
}

export type PoolName = { name: string; words: Set<string> }

export function preparePool(names: string[]): PoolName[] {
  return names.map(name => ({ name, words: contentWords(name) })).filter(p => p.words.size >= 2)
}

// The pool name this title repeats, or null. Three or more name words: all must be in the title.
// Two: both must be, and the title may carry at most one more content word — "Chicken Rice" must
// not claim "Chicken Fried Rice with Egg".
export function findTitleRepeat(title: string, pool: PoolName[]): string | null {
  const tw = contentWords(title)
  if (tw.size === 0) return null
  for (const p of pool) {
    let all = true
    for (const w of p.words) if (!tw.has(w)) { all = false; break }
    if (!all) continue
    if (p.words.size >= 3 || tw.size <= 3) return p.name
  }
  return null
}

// Two dish NAMES (not a title): the candidate carries every word of a known name of two or more
// words and at most one word of its own. "Creamy Paneer Pasta" is "Paneer Pasta" — Jaccard puts
// that at 0.67, under the 0.7 gate, and the model produces exactly this shape when it is told a
// dish is already in the pool ("Tiramisu Snack Balls" for "Tiramisu Protein Balls").
export function nameContains(cand: Set<string>, known: Set<string>): boolean {
  if (known.size < 2 || cand.size > known.size + 1) return false
  for (const w of known) if (!cand.has(w)) return false
  return true
}

// If the filter would remove more than this share of the list, something is wrong with the
// list or the pool (not with the day), and a thin day is worse than a wasted pick.
export const MAX_DROP_SHARE = 0.4

export type TitleRepeat = { title: string; matched: string }

export function filterTitleRepeats<V extends { title: string }>(
  videos: V[], poolNames: string[],
): { kept: V[]; dropped: TitleRepeat[]; skipped: boolean } {
  const pool = preparePool(poolNames)
  const kept: V[] = []
  const dropped: TitleRepeat[] = []
  for (const v of videos) {
    const matched = findTitleRepeat(v.title, pool)
    if (matched) dropped.push({ title: v.title, matched })
    else kept.push(v)
  }
  if (videos.length > 0 && dropped.length / videos.length > MAX_DROP_SHARE) {
    return { kept: videos, dropped, skipped: true }
  }
  return { kept, dropped, skipped: false }
}
