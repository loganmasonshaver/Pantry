// One generation, every screen.
//
// useMealSuggestions is mounted TWICE — Home and Pantry each hold their own instance, and both are
// alive at once inside the tab navigator. They share the AsyncStorage cache and nothing else, so a
// regenerate on Pantry left Home showing the previous meals with no indication anything had
// happened: Home's copy of `meals` and `loading` are its own React state, and nothing re-reads the
// cache after mount. The handoff already recorded the same shape from the other direction — a
// Profile change "only appears to regenerate on the NEXT launch".
//
// Module scope rather than context, matching lib/mealPrefetch.ts's `inflight`: the coordination has
// to outlive any one screen's mount, and a provider high enough to cover both tabs would re-render
// everything under it on every state change.
import type { GeneratedMeal } from './meals'

export type GenerationEvent =
  | { type: 'begin'; key: string }
  | { type: 'end'; key: string; meals: GeneratedMeal[] | null }

const inFlight = new Set<string>()
const subscribers = new Set<(e: GenerationEvent) => void>()

/** Keyed by user AND mode: cookNow and mealPlan are different decks and must not block each other. */
export function generationKey(userId: string | null | undefined, mode: string): string {
  return `${userId ?? 'anon'}_${mode}`
}

export function isGenerating(key: string): boolean {
  return inFlight.has(key)
}

/**
 * Claim the generation. Returns false when one is ALREADY running for this key — which is the
 * cross-screen version of the in-flight lock that previously lived in a useRef, i.e. per instance.
 * A ref cannot see the other tab, so two mounted instances could each pass their own guard and
 * fire two paid generations for one user.
 */
export function beginGeneration(key: string): boolean {
  if (inFlight.has(key)) return false
  inFlight.add(key)
  emit({ type: 'begin', key })
  return true
}

/** Always call this, including on failure — `meals: null` releases the lock without publishing. */
export function endGeneration(key: string, meals: GeneratedMeal[] | null): void {
  inFlight.delete(key)
  emit({ type: 'end', key, meals })
}

export function subscribeGeneration(cb: (e: GenerationEvent) => void): () => void {
  subscribers.add(cb)
  return () => { subscribers.delete(cb) }
}

function emit(e: GenerationEvent): void {
  // A throwing subscriber must not stop the others from hearing that a generation ended, or a
  // screen is stranded on a spinner forever.
  for (const cb of [...subscribers]) { try { cb(e) } catch {} }
}

/** Tests only — module state outlives a test file otherwise. */
export function __resetGenerationBus(): void {
  inFlight.clear()
  subscribers.clear()
}
