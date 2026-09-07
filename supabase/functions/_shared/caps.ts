// Per-user daily ceilings, in ONE place because they are not independent numbers.
//
// They drifted apart once and it shipped a live bug. IMAGE_GEN_DAILY_CAP was 20, and its own
// comment stated the derivation: "meal-gen is capped at 3/day server-side × up to 5 meals per Cook
// Now generation = 15 images, plus a small buffer". MEAL_GEN_CAP_PER_DAY was later raised to 6 and
// nothing recomputed the image cap — so meal generation alone could demand 18 images and a user
// ran out of photos on their seventh generation, with the cards shimmering forever because a
// capped image was indistinguishable from a pending one.
//
// Expressing the image cap as a FUNCTION of the meal cap is the fix. Raising one now moves the
// other, and neither can be edited in ignorance of the other again.

/**
 * Generations per user per day. An ABUSE ceiling, not a product limit — a normal day is one
 * automatic generation plus the occasional refresh.
 *
 * Cost is not what bounds this. At fal-ai/flux-2's $0.012 per MEGAPIXEL and Pantry's 512x512
 * (0.262 MP), one image is ~$0.0031 and a whole generation ~$0.0094, so even a user who maxes
 * this every single day costs under $2/month against a $9.99 subscription. What bounds it is that
 * endless rerolling is a worse product, and that meal names entering the anti-repeat window make
 * the NEXT generation harder.
 */
export const MEAL_GEN_CAP_PER_DAY = 6

/** Meals shown per Cook Now generation — displayCount, i.e. Math.min(mealsPerDay, 3). */
const MEALS_SHOWN_PER_GENERATION = 3

/**
 * Headroom for images that are NOT driven by meal generation: the onboarding plan reveal, and
 * meal-detail or Discover views of a dish the shared library has never generated before.
 *
 * Six, not "a small buffer". The vagueness of that phrase is how the old number stopped matching
 * its own derivation without anyone noticing.
 */
const IMAGE_BUFFER = 6

/**
 * Actual image GENERATIONS per user per day. Cache hits are exempt and always have been — images
 * are global per dish, so a popular meal costs nobody anything and the marginal user gets cheaper
 * as the shared library grows (1,443 images as of 2026-09-07).
 *
 * Hitting this never blocks a meal, only its photo — and the card now says so rather than
 * shimmering forever.
 */
export const IMAGE_GEN_DAILY_CAP =
  MEAL_GEN_CAP_PER_DAY * MEALS_SHOWN_PER_GENERATION + IMAGE_BUFFER
