// Step text the extractor copied in the creator's language, and the pass that translates it.
//
// The extraction prompt says to translate everything, and for names, ingredients and step TITLES it
// does. Step DETAIL is where it fails: 6 of 219 stored recipes (all German) had English titles over
// German method text — "Sauté: Zwiebel und Paprika in Ölspray anbraten". The same prompt also says
// FAITHFULLY, VERBATIM and "PRESERVE THE PREPARATION METHOD exactly as described", and for a method
// the model resolves that conflict by copying. A prompt line alone already failed six times, so this
// is enforced in code: detect, translate in a separate call, verify, and never store what is left.

// Words that are common in German / Spanish / Polish recipe prose and essentially never appear in
// English recipe prose. Accents alone are NOT a signal — "Jalapeño" is English on a menu.
const MARKERS = new Set([
  // German
  'und', 'mit', 'dann', 'oder', 'für', 'zugeben', 'minuten', 'backen', 'mischen', 'geben', 'etwa', 'bei',
  'grad', 'esslöffel', 'teelöffel', 'verrühren', 'hinzufügen', 'schneiden', 'kochen', 'servieren', 'den',
  'das', 'der', 'eine', 'einen', 'alles', 'anschließend', 'kurz', 'zutaten', 'schüssel', 'nach', 'auf',
  // Spanish
  'con', 'minutos', 'huevos', 'mezclar', 'añadir', 'hornear', 'cucharada', 'taza', 'servir', 'los', 'las',
  'hasta', 'luego', 'durante', 'agregar',
  // Polish
  'minut', 'dodaj', 'wymieszaj', 'piekarnika', 'łyżka', 'szklanka', 'jajka', 'oraz', 'następnie',
])

// The TITLE as a language signal. YouTube's language field is usually absent, and on 2026-09-17
// an Italian gelato sandwich shipped with "yogurt greco 0%, biscotti secchi, latte scremato" —
// no language, and the ingredient-list check found "yogurt" and called it English. The title
// ("Biscotto gelato proteico: per chi non sa cucinare") had said Italian all along. Tokens that
// are also English or menu words (per, non, la, di, con, gelato) are left out on purpose.
// Folded: lowercase with diacritics removed, on both sides. Turkish İ lowercases to i + a
// combining dot in JS, so "PROTEİNLİ" would never equal "proteinli" without this.
const fold = (s: string) => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
const TITLE_MARKERS = new Set([...MARKERS,
  'chi', 'che', 'senza', 'come', 'della', 'delle', 'dello', 'degli', 'gli', 'ricetta', 'ricette', 'cucina', 'cucinare',
  'proteico', 'proteica', 'proteici', 'proteiche', 'minuti', 'veloce', 'facile', 'sano', 'sana', 'biscotto', 'biscotti',
  'tarifi', 'tarif', 'için', 'yapımı', 'kolay', 'pratik', 'yüksek', 'proteinli',
  'receita', 'receitas', 'sem', 'rápida', 'rápido', 'fácil', 'saudável', 'proteína',
  'recette', 'sans', 'rapide', 'protéiné', 'protéinée', 'protéines',
  'rezept', 'rezepte', 'proteinreich', 'proteinreiche', 'proteinreiches', 'schnell', 'schnelle', 'schnelles', 'schneller', 'einfach', 'einfache', 'einfaches', 'gesund', 'gesunde', 'gesundes', 'lecker', 'leckere', 'leckeres', 'auflauf', 'ohne', 'zucker', 'kalorien',
  'receta', 'rápida', 'saludable', 'proteína', 'proteínas', 'fácil',
].map(fold))
export function titleLooksNonEnglish(title: string): boolean {
  const words = fold(title).match(/\p{L}+/gu) ?? []
  return new Set(words.filter(w => TITLE_MARKERS.has(w))).size >= 2
}

// Names the model copied from a source line unchanged: every word of the name (two or more) sits
// in one source line. Word-based rather than an exact match because the source line carries the
// quantity and a preposition the name does not ("150 g di yogurt greco 0%" → "yogurt greco 0%").
// On its own this is nothing — "cottage cheese" copies "cottage cheese" from any English list —
// so callers pair it with a language signal, exactly like looksUntranslated.
const words = (s: string) => new Set(fold(s).replace(/\(.*?\)/g, ' ').match(/\p{L}+/gu) ?? [])
export function namesCopiedFromSource(names: string[], srcLines: string[]): number {
  const src = srcLines.map(words)
  return names.filter(n => {
    const w = words(n)
    return w.size >= 2 && src.some(s => [...w].every(t => s.has(t)))
  }).length
}

export const translateNamesPrompt = (names: string[]) => `Translate each ingredient name below into English.
Keep the SAME number of entries in the same order. Translate the FOOD; keep brand names as they are. Do not add amounts, notes or anything else.

Respond ONLY with a JSON array of ${names.length} strings, no markdown.

${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}`

// Same contract as translateSteps: null when the answer is unusable, so the caller drops the
// recipe rather than ship a list that is still Italian.
export async function translateIngredientNames(names: string[], complete: (prompt: string) => Promise<string>): Promise<string[] | null> {
  if (!Array.isArray(names) || names.length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(String(await complete(translateNamesPrompt(names))).replace(/```json|```/g, '').trim())
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length !== names.length) return null
  if (parsed.some(t => typeof t !== 'string' || !t.trim())) return null
  return parsed as string[]
}

type Step = string | { title?: string; detail?: string }

export function stepDetails(steps: unknown): string[] {
  return (Array.isArray(steps) ? steps : []).map((s: Step) =>
    typeof s === 'string' ? s : String(s?.detail ?? ''))
}

// Three marker hits from at least two distinct words — one stray "con" or "auf" is not a language.
// Distinct from recipe-integrity's looksUntranslated, which judges the INGREDIENT list and only
// when YouTube says the source is foreign; all 6 German rows passed it — their ingredients were
// translated. Nothing looked at the steps until this.
export function stepsLookUntranslated(steps: unknown): boolean {
  const words = stepDetails(steps).join(' ').toLowerCase().match(/\p{L}+/gu) ?? []
  let hits = 0
  const distinct = new Set<string>()
  for (const w of words) if (MARKERS.has(w)) { hits++; distinct.add(w) }
  return hits >= 3 && distinct.size >= 2
}

export const translatePrompt = (details: string[]) => `Translate each cooking step below into natural English.
Keep the SAME number of steps in the same order. Keep every action, cut, quantity, time and temperature exactly — translate, do not rewrite, add, merge or drop anything. Keep brand names as they are ("Buko Balance", "ESN Flexpresso"). Write temperatures as °C, and "Umluft" as "fan".

Respond ONLY with a JSON array of ${details.length} strings, no markdown.

${details.map((d, i) => `${i + 1}. ${d}`).join('\n')}`

/**
 * Translate a recipe's step details, keeping titles and structure. Returns null when the answer is
 * unusable — wrong count, an empty step, or text that STILL reads as untranslated — so the caller
 * can drop the recipe rather than ship half-German steps. `complete` is the caller's model call.
 */
export async function translateSteps(steps: unknown, complete: (prompt: string) => Promise<string>): Promise<Step[] | null> {
  if (!Array.isArray(steps) || steps.length === 0) return null
  const details = stepDetails(steps)
  let parsed: unknown
  try {
    parsed = JSON.parse(String(await complete(translatePrompt(details))).replace(/```json|```/g, '').trim())
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length !== details.length) return null
  if (parsed.some(t => typeof t !== 'string' || !t.trim())) return null
  const out: Step[] = (steps as Step[]).map((s, i) =>
    typeof s === 'string' ? (parsed as string[])[i] : { ...s, detail: (parsed as string[])[i] })
  return stepsLookUntranslated(out) ? null : out
}
