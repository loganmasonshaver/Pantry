// The daily meal cache is keyed by LOCAL calendar date, and every reader and writer must agree
// on how that string is produced.
//
// toISOString() is UTC, so it names a different day than the user is living in for part of every
// day: after ~7pm US Central it is already tomorrow in UTC, and before 9am in Tokyo it is still
// yesterday. A UTC-stamped cache entry therefore misses immediately (the meals the user just got
// are thrown away and regenerated), then hits for the whole of the WRONG day afterwards.
//
// This was already fixed once inside useMealSuggestions, but the helper was copied rather than
// shared, and the two onboarding writers kept stamping UTC into the same cache. One definition.
export function todayStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
