// What prep, cook and rest time MEAN, for recipes taken from creators.
//
// One definition shared by the Discover pipeline and the backfill, so the two can never disagree
// about a recipe. It mirrors the rules generate-meals gives Cook Tonight, minus the user's time
// budget, which Discover does not have.
//
// Why it exists: trending_meals used to store a single prep_time with no definition, and the model
// guessed per recipe — a 16-hour Ninja Creami freeze was dropped from one ("10 min") and counted as
// hands-on work in another ("1020 min").

export const TIME_RULES = `TIME — three separate numbers in minutes, because they answer different questions:
- "prepTime": HANDS-ON minutes the cook is actively working — chopping, mixing, blending, assembling.
- "cookTime": UNATTENDED minutes the cook must still be there for — an oven bake, a simmer, a roast, an air-fry, a Ninja Creami spin cycle. The food is cooking and they are waiting on it.
- "restTime": DETACHABLE minutes where the cook can walk away entirely and come back later or tomorrow — freezing, chilling, setting, soaking, marinating, rising. A Ninja Creami base frozen "at least 16 hours" is restTime 960. "Overnight" is 480. "Refrigerate 24 hours" is 1440. Use 0 when the dish is ready as soon as the work is done.
Ask of every wait: could the cook leave the house? Then it is restTime. Must they stay by the oven or the machine? Then it is cookTime.
NEVER fold a freeze or a chill into prepTime — a 10-minute blend with a 16-hour freeze is prepTime 10 and restTime 960, never prepTime 970. And NEVER drop it — the reader must know the dish is for tomorrow.
When the creator gives a range ("freeze 3-4 hours", "chill 1 to 2 hours"), use the LOWER bound — the earliest the dish can be eaten.
A MANDATORY step with NO stated duration still takes time — estimate a realistic one, never 0: "bake until golden brown" is cookTime about 35, "cook until tender" about 20, "chill until set" or "cool and chill before serving" restTime about 120, "freeze until solid" about 240, a Ninja Creami base about 960. 0 is only for no wait at all, or an OPTIONAL one ("eat immediately or freeze 5 more minutes").
These are NOT restTime: storage and reheating notes ("keeps 5 days", "reheat 90 seconds"), optional steps ("or chill for a thicker texture", "serve immediately or chill"), and a marinade or set the creator caps at under 30 minutes ("set aside 15-20 minutes, no longer") — that last one belongs in prepTime.`

export type MealTimes = { prepTime: number; cookTime: number; restTime: number }

// Upper bounds that catch a unit slip rather than police the model. 3 days of rest covers every real
// cure or ferment in this pool; an hour-for-minute mistake (prepTime 1020 meaning 17 hours of chopping)
// is exactly what this is here to reject.
const MAX_ACTIVE = 360
const MAX_REST = 4320

const toMinutes = (v: unknown): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Coerce a model's time answer into three sane integers.
 *
 * Hands-on or unattended time over MAX_ACTIVE is treated as a wait that was mis-filed as work — a
 * 1020-minute prep is a freeze, not seventeen hours at the counter — and is MOVED into restTime
 * rather than discarded, so the fact that the dish takes a day survives the correction. The
 * counterpart direction (a wait dropped entirely) cannot be repaired here: there is no number left
 * to move, which is why TIME_RULES forbids it at the source.
 */
export function normaliseTimes(raw: { prepTime?: unknown; cookTime?: unknown; restTime?: unknown }): MealTimes {
  let prepTime = toMinutes(raw?.prepTime)
  let cookTime = toMinutes(raw?.cookTime)
  let restTime = toMinutes(raw?.restTime)
  if (prepTime > MAX_ACTIVE) { restTime = Math.max(restTime, prepTime); prepTime = 0 }
  if (cookTime > MAX_ACTIVE) { restTime = Math.max(restTime, cookTime); cookTime = 0 }
  restTime = Math.min(restTime, MAX_REST)
  return { prepTime, cookTime, restTime }
}
