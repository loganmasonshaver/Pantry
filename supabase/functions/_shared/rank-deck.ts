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

import { isSameDish } from './dish-key.ts'

export type Candidate = {
  name?: unknown
  slot?: unknown
  _clash?: boolean
  _tier?: number
  _repeat?: boolean
  _notCookable?: boolean
  _fitScore?: number
}

export function compareCandidates(a: Candidate, b: Candidate): number {
  if (!!a._clash !== !!b._clash) return a._clash ? 1 : -1
  // A meal needing food the pantry lacks is kept only because the cookability gate is floored — it
  // exists to stop a short deck, not to lead one. It had no rank of its own, so on a thin pantry a
  // dish requiring chicken the user does not own could be shown FIRST, above one they could cook
  // (measured on the carb-heavy sweep case, 2026-09-12). "Cook Tonight" is the whole promise.
  if (!!a._notCookable !== !!b._notCookable) return a._notCookable ? 1 : -1
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
export function selectDeck<T extends Candidate>(candidates: T[], n: number): { deck: T[]; promoted: string[]; duplicates: string[] } {
  const sorted = [...candidates].sort(compareCandidates)
  // Two spellings of one dish in the same deck is one idea shown twice — the sweep produced
  // "Savory Spaghetti with Garlic and Beans" beside "Spaghetti with Savory Tomato and Bean Sauce".
  // Near-duplicates are skipped while anything else is left, and only backfilled when the
  // alternative is a short deck, which this file's every other rule already treats as worse.
  const deck: T[] = []
  const duplicates: string[] = []
  for (const m of sorted) {
    if (deck.length >= n) break
    if (deck.some(d => isSameDish(String(d.name ?? ''), String(m.name ?? '')))) continue
    deck.push(m)
  }
  for (const m of sorted) {
    if (deck.length >= n) break
    if (deck.includes(m)) continue
    duplicates.push(String(m.name ?? ''))
    deck.push(m)
  }
  const promoted: string[] = []
  if (n < 2) return { deck, promoted, duplicates }
  for (const need of NEEDS) {
    if (deck.some(need)) continue
    // Coverage may not DEGRADE the deck. On the asian pantry it pulled a 30g tofu scramble in over
    // 43g stir-fries purely because the deck held no light meal — against a 47g target, that trade
    // is not worth making. A spread the user can eat all day is worth less than every meal hitting
    // their macros, so a promotion only happens at a tier the deck already contains.
    const worstTier = Math.max(...deck.map(m => Number(m._tier) || 0), 0)
    const pick = sorted.find(m => !deck.includes(m) && need(m) && !m._clash && !m._notCookable
      && (Number(m._tier) || 0) <= worstTier)
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
  return { deck: deck.sort(compareCandidates), promoted, duplicates }
}
