import { supabase } from './supabase'

// Warm the pantry read from the tab layout so Home isn't the first thing to ask for it.
//
// The cost this removes is a SERIAL HOP, not a slow query. Home fetched the pantry itself purely
// to decide whether there was anything to cook from, and useMealSuggestions stayed disabled until
// that landed — so the generation pipeline could not start until Home had mounted, rendered, and
// completed a round trip. The layout mounts with the tab bar, before any screen, so starting the
// same read there means the answer is usually already in hand by the time Home asks.
//
// Deliberately NOT a generation prefetch. Generating needs the AI-consent gate, which is React
// context and cannot run out here, and a generation costs real money against a daily cap — firing
// one from a layout that mounts on every launch is not a latency optimisation, it is a bill.
// This only warms the input that was gating it.
let inflight: Promise<Set<string>> | null = null
let inflightUser: string | null = null

async function query(userId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('pantry_items')
    .select('name')
    .eq('user_id', userId)
    .eq('in_stock', true)
    .limit(500) // matches Home's own bound; in-stock pantry never realistically exceeds this
  return new Set((data ?? []).map(i => String(i.name ?? '').toLowerCase()))
}

// Start the read. Safe to call repeatedly — one in flight at a time, as with prefetchDiscover.
export function prefetchPantryNames(userId: string | undefined): void {
  if (!userId || (inflight && inflightUser === userId)) return
  inflightUser = userId
  inflight = query(userId).catch(() => new Set<string>()) // never reject: a failure just means Home queries itself
}

// Consume it ONCE. Cleared on read so every later refresh — the one after a scan adds items, in
// particular — goes to the network rather than replaying a snapshot taken before the scan.
export function takePantryNames(userId: string): Promise<Set<string>> | null {
  if (!inflight || inflightUser !== userId) return null
  const p = inflight
  inflight = null
  inflightUser = null
  return p
}
