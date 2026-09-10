// Which of the prompt's four flavour axes a meal reaches, read from its ingredients (and, for a
// technique like browned butter, its steps).
//
// MEASURED, NOT ENFORCED. generate-meals has asked for "at least TWO of the four flavor axes" as a
// prompt line, and Cook Tonight run 48 shipped three meals reaching 0, 0 and 1 — no salt in any of
// them, while the pantry held lime, pickles, salsa, hot sauce, soy sauce, garlic and pesto. Every
// gate in that file started as a counter first, so this does too; ranking on it waits for numbers.
//
// The word lists follow the prompt's own examples so the count means what the model was asked for,
// plus the blends and cooked-tomato sauces creators actually list: the first measurement read Chicken
// Fajita Bowls and a Pepperoni Pizza Skillet from the Discover pool as zero-axis dishes.
// Black pepper is a heat axis because the prompt says so — which is why "salt and pepper alone"
// reaches exactly one.

export type Axis = 'acid' | 'heat' | 'umami' | 'aromatic'

const ACID = /\b(lemons?|limes?|vinegar|pickles?|pickled|relish|salsa|pico de gallo|citrus|capers?|kimchi|sauerkraut|sumac|tamarind|bbq|barbecue|mustard)\b/i
// Bell and roasted red peppers are sweet, so "pepper" only counts in its black/ground/flaked forms.
const HEAT = /\b(chil(?:i|e|li)|chillies|chilis|hot sauce|sriracha|jalape[nñ]os?|cayenne|chipotle|gochujang|harissa|black pepper|ground pepper|white pepper|peppercorns?|pepper flakes|crushed red pepper|ginger|wasabi|horseradish|buffalo|cajun|creole|jerk|fajita|taco seasoning|curry (?:powder|paste)|garam masala|peri[- ]?peri|piri[- ]?piri|sambal)\b/i
const BARE_PEPPER = /^(salt\s*(and|&)\s*)?pepper$/i
const UMAMI = /\b(soy sauce|soya sauce|tamari|fish sauce|oyster sauce|worcestershire|miso|parmesan|parmigiano|pecorino|mushrooms?|nutritional yeast|tomato (?:paste|sauce|pur[ée]e)|passata|marinara|pizza sauce|bolognese|(?:crushed|chopped|diced|canned|sun-dried) tomatoes|anchov(y|ies)|pad thai sauce|teriyaki|hoisin|coconut aminos|pesto|dashi|bacon|pepperoni|salami|chorizo|prosciutto|smoked salmon)\b/i
// Aromatic fat: a fat that carries an aromatic, or a product/technique that already is one.
const AROMATIC_FAT = /\b(sesame oil|chil(?:i|li) oil|pesto|garlic butter|ghee)\b/i
const AROMATIC_TECHNIQUE = /\bbrown(?:ed)?\s+(?:the\s+)?butter\b/i
const FAT = /\b(oil|butter|ghee|lard|tallow)\b/i
const AROMATIC = /\b(garlic|ginger|shallots?|scallions?|green onions?|onions?|leeks?|rosemary|thyme|sage|basil|cilantro|coriander leaves|parsley|dill|chives|lemongrass|curry leaves|cumin seeds?|mustard seeds?)\b/i
// A dried powder is not bloomed in the fat the way the prompt's "garlic in oil" means.
const POWDER = /\b(powder|granules|dried)\b/i

export function flavourAxes(meal: { ingredients?: unknown; steps?: unknown } | null | undefined): Axis[] {
  const lines = (Array.isArray(meal?.ingredients) ? meal!.ingredients as unknown[] : [])
    .map(i => String((i as any)?.name ?? i ?? '').toLowerCase().trim())
    .filter(Boolean)
  const steps = (Array.isArray(meal?.steps) ? meal!.steps as unknown[] : [])
    .map(s => (typeof s === 'string' ? s : `${(s as any)?.title ?? ''} ${(s as any)?.detail ?? ''}`))
    .join(' ')
  const has = (re: RegExp) => lines.some(l => re.test(l))
  const out: Axis[] = []
  if (has(ACID)) out.push('acid')
  if (has(HEAT) || lines.some(l => BARE_PEPPER.test(l))) out.push('heat')
  if (has(UMAMI)) out.push('umami')
  const aromaticInFat = has(FAT) && lines.some(l => AROMATIC.test(l) && !POWDER.test(l))
  if (has(AROMATIC_FAT) || AROMATIC_TECHNIQUE.test(steps) || aromaticInFat) out.push('aromatic')
  return out
}
