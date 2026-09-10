// Ingredients that are INVISIBLE in a finished dish and whose NAMES mislead an image model, and the
// colour (if any) they genuinely add. Extracted from generate-meal-image so it can be tested: this
// is the third silent bug in the same dozen lines, and the first two are documented below.
//
// Telling the description writer not to draw these was not enough: "Jello" regenerated under that
// rule on 2026-09-04 and Flux still produced diced fruit, because "fruit flavored zero sugar water
// drink enhancer" was in the list at all and the word survives into the pipeline. The reliable fix
// is to never hand these to the model — a word that is not in the prompt cannot be rendered.
//
// Every entry here dissolves completely: extracts, essences, flavour drops and syrups, drink
// enhancers, sweeteners, food colouring. Deliberately NOT "powder" on its own, which would strip
// cocoa powder and baking powder; and not gelatin, which IS the dish in the case that motivated it.
export const INVISIBLE_INGREDIENT = /(extract|essence|drink enhancer|water enhancer|sweetener|food colou?ring|flavou?r(?:ing|ed)?\s*(?:drops?|syrup|enhancer|concentrate))/i

// Non-nutritive sweeteners, which are colourless whatever they are called. Checked BEFORE any
// colour rule, and that ordering is the whole fix for bug #3 below.
const COLOURLESS_SWEETENER = /sweeten|monk\s*fruit|stevia|erythritol|allulose|sucralose|xylitol|aspartame|splenda/

/**
 * The colour a dissolving flavouring genuinely tints a dish, or null when it adds none.
 *
 * Why a colour at all: removing these outright over-corrected. With the enhancer gone, "Protein
 * Jello" rendered as PLAIN GELATIN — clear and colourless — when the real dish is orange. A flavour
 * concentrate is invisible as a SOLID and highly visible as COLOUR. Naming the colour rather than
 * "a bright colour" matters too: a vague tint produced a pale cream jelly on 2026-09-05, because the
 * model fell back to the base ingredient's own colour.
 *
 * Three silent bugs, all of them the wrong rule matching first:
 *   1. Bare `red` matched INSIDE "flavoured", so every "fruit flavored ..." came back red. Every short
 *      colour word is now \b-bounded.
 *   2. A catch-all "a distinctly coloured tone" over-claimed for vanilla extract and sweetener, which
 *      are colourless — and asserting a colour is how a plain gelatin gets painted for no reason.
 *   3. "monk fruit sweetener" contains the word "fruit", hit the fruit-punch fallback, and a
 *      CHOCOLATE Oreo McFlurry was described — and rendered — as "vivid red-orange throughout"
 *      (2026-09-10). Stevia came back colourless only because its name has no fruit in it.
 */
export function flavourColour(text: string): string | null {
  const t = String(text ?? '').toLowerCase()
  if (COLOURLESS_SWEETENER.test(t)) return null
  if (/blue\s*raspberry|blueberr/.test(t)) return 'a deep blue-purple'
  if (/strawberr|raspberr|cherry|watermelon|\bred\b/.test(t)) return 'a vivid red'
  if (/orange|mango|peach|apricot|papaya/.test(t)) return 'a bright orange'
  if (/lemon|pineapple|banana|\byellow\b/.test(t)) return 'a bright yellow'
  if (/\blime\b|apple|\bgreen\b|kiwi|melon/.test(t)) return 'a bright green'
  if (/grape|blackcurrant|berry|\bpurple\b/.test(t)) return 'a deep purple'
  if (/cola|coffee|caramel|chocolate/.test(t)) return 'a deep brown'
  // "fruit flavoured" naming no fruit — the fruit-punch default, and far closer than cream.
  if (/\bfruit\b|punch|tropical/.test(t)) return 'a vivid red-orange'
  return null // vanilla, plain flavourings, salt-like ones: no colour to claim
}

/**
 * Rewrite the ingredient list Stage 1 describes from: strip the food NOUN from anything invisible
 * and keep only the truth about it — that it dissolves, and what colour (if any) it leaves. The
 * description writer then carries everything real about the ingredient and contains no food word
 * Flux can render as a chunk.
 */
export function rewriteInvisibleIngredients(ingredients: readonly unknown[]): string[] {
  return (ingredients ?? []).map(i => {
    const text = String(i ?? '')
    if (!INVISIBLE_INGREDIENT.test(text)) return text
    const colour = flavourColour(text)
    return colour
      ? `flavouring concentrate (dissolves completely — tints the whole dish ${colour} throughout, contributes NO solid pieces or chunks)`
      : 'flavouring (dissolves completely — adds no colour and NO solid pieces or chunks)'
  })
}
