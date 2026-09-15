// "The user just logged something" — shared between the screens that write a meal log and Home,
// which decides whether crossing the calorie goal deserves a success haptic.
//
// Home rebuilds the day from the network on focus, on app resume and on pull-to-refresh, so a total
// can cross the goal with no touch at all: a log synced from another device, or a refetch after the
// app sat in the background. A haptic there is a buzz out of nowhere. It should mark the log the
// user just made, which may have happened on another screen (meal detail) before Home refetched.
//
// Module state, not React context: the writers and Home never share a render tree moment, and the
// only thing that matters is when the last log happened.

let lastLogAt = 0

export function markLogged(now = Date.now()): void {
  lastLogAt = now
}

// Long enough to cover logging on the meal screen, going back, and Home's refetch landing on a slow
// network; short enough that a later background refetch does not count.
export const RECENT_LOG_MS = 60_000

export function loggedRecently(now = Date.now(), withinMs = RECENT_LOG_MS): boolean {
  return lastLogAt > 0 && now - lastLogAt < withinMs
}
