// When to point a user who keeps regenerating Cook Tonight toward Discover instead.
//
// Every regeneration is a GPT-4o call returning ten full recipes plus up to three images, and the
// daily cap exists to bound that spend — but a hard wall is the only thing a cap can do on its own,
// and hitting one reads as the app running out. Discover costs nothing per user: its pool is
// generated once a day and shared, so its cost scales with days, not users. A user refreshing
// again and again is telling us the deck isn't landing, and Discover is the one surface that can
// answer that for free.
//
// Kept pure and separate from useMealSuggestions because that hook constructs a Supabase client
// at module load and cannot run under a plain node test.

// Counted in GENERATIONS, not redos, because that is what the server records — and the first one
// of the day is automatic. Three generations is two deliberate refreshes: the point where "not
// this" has been said twice.
export const DISCOVER_NUDGE_AFTER = 3

export type DiscoverNudge = 'none' | 'redo' | 'capped'

export function discoverNudge(genUsedToday: number | null, capPerDay: number): DiscoverNudge {
  // Unknown must never nag. The count is read from the server and can fail; a user who has
  // refreshed once should not be told they are refreshing too much because a read errored.
  if (genUsedToday === null || !Number.isFinite(genUsedToday)) return 'none'
  // Checked before the threshold so the order stays right even if the cap is ever set at or
  // below it — at the cap, Discover is the only action left, not a suggestion.
  if (genUsedToday >= capPerDay) return 'capped'
  if (genUsedToday >= DISCOVER_NUDGE_AFTER) return 'redo'
  return 'none'
}
