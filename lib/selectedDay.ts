import { todayStr } from './localDate'

// THE DAY THE USER IS WORKING ON — one value, app-wide.
//
// Home has a date picker; the meal detail screen does not, and it was hardcoding `todayStr()` into
// `logged_at`. So browsing to Sep 2, opening a meal and logging it wrote the entry to TODAY. Not an
// annoyance — it silently corrupts the history the whole app is built to report on.
//
// Threading it through navigation params was the obvious alternative and it is worse here: Home
// alone pushes to /meal/[id] from SEVEN places, and the eighth added later would silently revert to
// today with nothing to catch it. A single shared value cannot be half-wired.
//
// The staleness this trades for is bounded and visible:
//   - Home initialises selectedDate to today on mount, so a cold start is always today.
//   - Within a session the date persists while the user is working on that day, which is how
//     MyFitnessPal's diary behaves — the date is app state, and logging follows it.
//   - The meal screen NAMES the day on its own button whenever it is not today, so a log can never
//     land somewhere the user did not read first. That is the part the convention does not give
//     you for free: MFP's diary header is always on screen, ours is a separate screen.
let current: string | null = null

export function setSelectedDay(day: string) { current = day }

// Falls back to today rather than to a stale value, so a screen reached before Home has ever
// rendered (deep link, share intent) logs to now.
export function getSelectedDay(): string { return current ?? todayStr() }
