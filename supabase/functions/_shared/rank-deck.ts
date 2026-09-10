// Which of the surviving Cook Tonight candidates reach the screen, and in what order.
//
// Order: a savory clash sorts below everything; then TIER (complete AND over the protein floor);
// then fresh before repeat; then macro fit. Tier moved ahead of freshness on Logan's call after
// run 48, where seven of ten candidates were repeats: freshness-first had no choice left to make,
// so the three fresh dishes shipped whatever they were — one at 24g against a 40g target, over
// seven dishes that met the floor. On a finite pantry the "fresh" dishes are the model's oddest
// recombinations, because the sensible dinners are the ones already shown.
//
// Then SLOT COVERAGE. The deck is generated once and shown all day, and the Pantry tab floats the
// meal that fits the current hour — which only works if the deck HAS one. Run 48 asked the model
// for a spread, got five dinners among ten candidates, and the sort discarded all five as repeats:
// three breakfast-ish dishes at 6pm with chicken and ground beef in the pantry.

export type Candidate = {
  name?: unknown
  slot?: unknown
  _clash?: boolean
  _tier?: number
  _repeat?: boolean
  _fitScore?: number
}

export function compareCandidates(a: Candidate, b: Candidate): number {
  if (!!a._clash !== !!b._clash) return a._clash ? 1 : -1
  const ta = Number(a._tier) || 0, tb = Number(b._tier) || 0
  if (ta !== tb) return ta - tb
  if (!!a._repeat !== !!b._repeat) return a._repeat ? 1 : -1
  return (Number(a._fitScore) || 0) - (Number(b._fitScore) || 0)
}

// Words that make a dish breakfast or snack in character whatever the model tagged it. Its tags
// are loose: the served history has "Egg White Scramble with Salsa and Plantain Chips" tagged
// "lunch", and counting it as the lunch/dinner option would satisfy coverage with a second
// breakfast. Only unambiguous words — a "cottage cheese and pineapple bowl" tagged lunch still
// passes, because no name rule separates that from a real lunch bowl.
const LIGHT_NAME = /\b(breakfast|pancakes?|crepes?|waffles?|parfaits?|oats|oatmeal|porridge|granola|cereal|smoothies?|shakes?|muffins?|french toast|scrambles?)\b/i

/** A lunch or dinner in character: tagged so, and not named like a breakfast. */
export function isSubstantial(m: Candidate): boolean {
  const slot = String(m?.slot ?? '').toLowerCase()
  return (slot === 'lunch' || slot === 'dinner') && !LIGHT_NAME.test(String(m?.name ?? ''))
}

const NEEDS: ReadonlyArray<(m: Candidate) => boolean> = [isSubstantial, m => !isSubstantial(m)]

/**
 * The best `n` by compareCandidates, then patched so the deck holds at least one lunch/dinner and
 * one lighter meal whenever the candidates allow it. A patch evicts the lowest-ranked pick whose
 * loss leaves the other need met, and never promotes a clash — protein powder whisked into a soup
 * is worse than a missing dinner. `promoted` names what coverage pulled in, for the funnel.
 */
export function selectDeck<T extends Candidate>(candidates: T[], n: number): { deck: T[]; promoted: string[] } {
  const sorted = [...candidates].sort(compareCandidates)
  const deck = sorted.slice(0, n)
  const promoted: string[] = []
  if (n < 2) return { deck, promoted }
  for (const need of NEEDS) {
    if (deck.some(need)) continue
    const pick = sorted.find(m => !deck.includes(m) && need(m) && !m._clash)
    if (!pick) continue
    for (let i = deck.length - 1; i >= 0; i--) {
      const rest = deck.filter((_, j) => j !== i)
      if (NEEDS.every(r => r === need || !deck.some(r) || rest.some(r))) {
        deck[i] = pick
        promoted.push(String(pick.name ?? ''))
        break
      }
    }
  }
  return { deck: deck.sort(compareCandidates), promoted }
}
