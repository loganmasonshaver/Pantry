import { isAssumedStaple } from '../constants/staples.ts'

// Key for the phone's own image-URL cache. It was keyed by meal name alone — the same hole the
// server closed by fingerprinting the mains — so after the server fix the phone would still have
// served the old photo for a same-name recipe. This only has to DIFFER when the mains differ; the
// server's key is the one that must be exact, so the normalisation here is deliberately coarse.
// Names only, no ingredients (onboarding's warm-up, the Saved backfill) keep the bare name, which
// is also the key those callers write under.
export function imageCacheKey(name: string, ingredientNames: readonly string[] = []): string {
  const mains: string[] = []
  for (const raw of ingredientNames) {
    // "3 eggs" from imageIngredientNames -> "eggs"
    const n = String(raw ?? '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!n || isAssumedStaple(n) || mains.includes(n)) continue
    mains.push(n)
    if (mains.length === 3) break
  }
  return mains.length ? `${name}|${mains.sort().join(',')}` : name
}
