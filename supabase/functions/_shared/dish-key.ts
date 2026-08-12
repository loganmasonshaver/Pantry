// Repeat detection for meal generation.
//
// Lives here rather than inline in generate-meals so it can be unit-tested without booting the
// edge runtime — the exact-string matching it replaces shipped untested and let a reworded repeat
// ("Fried Rice with Chicken" the day after "Chicken Fried Rice") slip straight through.

// How many past meal names we remember per user. 30 ≈ 10 generations, so a heavy day (1 auto-fire
// + 3 rerolls = 12 names) can no longer flush the entire window and resurrect yesterday's dinner.
export const RECENT_MEMORY = 30

// Words that change a title's wording but not the dish. Deliberately short — over-stripping would
// collapse genuinely different meals (a "bowl" and a "salad" are not the same dinner).
const TITLE_NOISE = new Set([
  "with", "and", "the", "a", "an", "of", "in", "on", "over", "topped", "served",
  "style", "homemade", "easy", "quick", "simple", "fresh", "classic", "your",
])

// Order-insensitive dish fingerprint: "Chicken Fried Rice" and "Fried Rice with Chicken" are the
// same meal to a user, but exact-string matching treats them as different. Sorting the significant
// tokens catches the reworded repeat, which is the form repeats usually take.
export function dishKey(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w && !TITLE_NOISE.has(w))
    // Crude singularization so "Beef Tacos" and "Beef Taco" collide. The ss/us/is endings are
    // excluded because they're overwhelmingly singular in food words — couscous, hummus,
    // asparagus, swiss — and chopping them invites a false collision with an unrelated word.
    .map(w => (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w))
    .sort()
    .join(" ")
}
