// Allergen and diet tagging for a recipe, split out of generate-trending-meals so it can be
// unit-tested and re-run over stored rows.
//
// These tags are a SAFETY surface, not a convenience one: compatible_diets decides which meals a
// vegan is shown, and is_dairy_free === true is treated downstream as safe to serve.

export const TAG_MEAT = ['chicken', 'beef', 'steak', 'pork', 'turkey', 'bacon', 'sausage', 'lamb', 'veal', 'prosciutto', 'pepperoni', 'salami', 'chorizo', 'carnitas', 'ribeye', 'sirloin', 'brisket', 'pastrami', 'jerky', 'duck', 'venison', 'bison', 'meatball', 'ground meat']
const TAG_SEAFOOD = ['salmon', 'tuna', 'shrimp', 'prawn', 'crab', 'lobster', 'cod', 'tilapia', 'fish', 'anchovy', 'sardine', 'scallop', 'mussel', 'clam', 'oyster', 'squid']
// 'butter' handled separately so nut butters don't read as dairy.
// COMPOUND FOODS are the second failure mode, and the one that scanning more text cannot fix.
// The first mode was the extractor dropping an ingredient (parmesan missing from a dish literally
// named "Parmesan-Crusted Chicken") — solved by widening the haystack. This one is different: the
// ingredient IS present, but its NAME contains no allergen keyword. "Pesto" is not in a dairy list,
// so a pesto dish read as dairy-free and nut-free; "gnocchi" and "teriyaki" read as gluten-free.
// Four live rows were mis-tagged this way, one of them wrong on all three axes.
//
// The list below can never be complete — regional dishes, brand products and "house sauce" are
// unbounded — which is exactly why the LLM's own allergen judgement is ANDed with it downstream.
const COMPOUND_DAIRY = ['pesto', 'ranch', 'caesar', 'alfredo', 'tzatziki', 'naan', 'brioche', 'croissant', 'carbonara', 'stroganoff', 'au gratin', 'bechamel', 'tiramisu', 'ice cream', 'custard', 'butterscotch', 'milk chocolate']
const COMPOUND_GLUTEN = ['gnocchi', 'teriyaki', 'hoisin', 'orzo', 'farro', 'bulgur', 'semolina', 'graham', 'pretzel', 'brioche', 'croissant', 'naan', 'roux', 'tempura', 'panzanella', 'miso', 'malt']
const COMPOUND_NUTS = ['pesto', 'satay', 'marzipan', 'praline', 'nutella', 'baklava', 'romesco', 'gianduja']

// NON-ANGLO AND ALTERNATE-SPELLING DAIRY is the third failure mode, after dropped ingredients and
// compound dishes — and it shipped seven mis-tagged rows. The list held 'yogurt' but not the
// British 'yoghurt', so "Greek yoghurt (Skyr)" read as vegan. It had no 'curd' (Indian dairy, in
// three bad rows), no 'skyr' (in a dish literally NAMED "Skyr Pancakes" and tagged dairy-free),
// and no 'quark'. A dairy vocabulary that only speaks American English mis-tags every cuisine that
// does not.
const TAG_DAIRY = ['milk', 'cheese', 'cream', 'yogurt', 'yoghurt', 'whey', 'ghee', 'mozzarella', 'cheddar',
  'parmesan', 'ricotta', 'brie', 'feta', 'paneer', 'queso', 'casein',
  'curd', 'dahi', 'skyr', 'quark', 'kefir', 'labneh', 'lassi', 'malai', 'khoya', 'mascarpone',
  'halloumi', 'burrata', 'provolone', 'gouda', 'gruyere', 'camembert', 'buttermilk', 'clotted',
  'creme fraiche', 'crème fraîche', 'gelato', ...COMPOUND_DAIRY]
// 'cake' is deliberately absent — rice cakes, fish cakes and crab cakes are not wheat, and a
// blanket match would strip the tag from meals that legitimately carry it.
const TAG_GLUTEN = ['bread', 'pasta', 'flour', 'wheat', 'barley', 'rye', 'soy sauce', 'breadcrumb',
  'panko', 'crouton', 'tortilla', 'noodle', 'ramen', 'udon', 'couscous', 'cracker', 'bun', 'pita',
  'bagel', 'wrap', 'seitan', 'spelt', 'durum', 'freekeh', 'einkorn', 'biscoff', 'biscuit', 'cookie',
  'oreo', 'pastry', 'phyllo', 'filo', 'matzo', 'roti', 'chapati', 'paratha', 'sourdough',
  'focaccia', 'baguette', ...COMPOUND_GLUTEN]
const TAG_NUTS = ['peanut', 'almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut',
  'macadamia', 'pine nut', 'nut butter', 'brazil nut', ...COMPOUND_NUTS]
// SAFETY: scans the NAME and STEPS as well as the ingredient list.
//
// Scanning ingredients alone made these tags only as trustworthy as the extractor's completeness,
// and the extractor drops things. Three live rows proved it: "Parmesan-Crusted Chicken Sheet Pan"
// was tagged DAIRY-FREE because parmesan never made it into the ingredients array — despite being
// in the dish's own name — and "Stuffed Chicken Caesar Sourdough" was tagged GLUTEN-FREE the same
// way. passesDietTags treats is_dairy_free === true as safe, so those were being served to users
// who had asked to avoid exactly that.
//
// Widening the haystack fails SAFE: a stray mention costs one meal its "free" tag, while a missed
// one hands an allergen to someone avoiding it. Those errors are not equivalent, so the false
// positives are the correct trade.
export function classifyDietTags(
  ingredients: any[],
  name = '',
  steps: any[] = [],
): { compatible_diets: string[]; is_dairy_free: boolean; is_gluten_free: boolean; is_nut_free: boolean } {
  const stepText = (steps || [])
    .map((st: any) => typeof st === 'string' ? st : `${st?.title ?? ''} ${st?.detail ?? ''}`)
    .join(' | ')
  const hay = [
    // Accepts BOTH shapes. Creator recipes store ingredients as plain strings and AI ones as
    // objects; reading only i.name made the entire ingredient list invisible for the string form,
    // so the allergen scan silently ran on the dish name and steps alone. A stored brownie listing
    // "1 large egg" and "1 tbsp butter, melted" came out dairy-free, gluten-free and nut-free.
    (ingredients || []).map((i: any) => (typeof i === 'string' ? i : (i?.name ?? ''))).join(' | '),
    name,
    stepText,
  ].join(' | ').toLowerCase()
  const has = (arr: string[]) => arr.some(k => hay.includes(k))
  const hasMeat = has(TAG_MEAT) || /\bham\b/.test(hay)   // \bham\b avoids "graham"
  const hasSeafood = has(TAG_SEAFOOD)
  // Dairy butter only — a nut/seed butter (peanut, almond…) is not dairy.
  const dairyButter = /\bbutter\b/.test(hay) && !/(peanut|almond|cashew|hazelnut|pecan|nut|seed|sun)[\s-]*butter/.test(hay)
  // "bean curd" / "soy curd" is TOFU, not dairy. Without this the new 'curd' keyword would strip
  // the vegan tag from tofu dishes — the precise opposite of the bug it was added to fix.
  const beanCurdOnly = /\b(bean|soy|soya)[\s-]*curd\b/.test(hay) && !/(^|[^a-z])(curd)\b(?![\s-]*)/.test(hay.replace(/\b(bean|soy|soya)[\s-]*curd\b/g, ''))
  const dairyHay = beanCurdOnly ? hay.replace(/\b(bean|soy|soya)[\s-]*curd\b/g, ' ') : hay
  const hasDairy = TAG_DAIRY.some(k => dairyHay.includes(k)) || dairyButter
  const hasEgg = /\beggs?\b/.test(hay)          // whole word — avoids "eggplant"
  const hasHoney = hay.includes('honey')
  // Nested: every meal is Classic; no land meat → Pescatarian; also no seafood →
  // Vegetarian; also no dairy/egg/honey → Vegan.
  const compatible = ['Classic']
  if (!hasMeat) compatible.push('Pescatarian')
  if (!hasMeat && !hasSeafood) compatible.push('Vegetarian')
  if (!hasMeat && !hasSeafood && !hasDairy && !hasEgg && !hasHoney) compatible.push('Vegan')
  return {
    compatible_diets: compatible,
    is_dairy_free: !hasDairy,
    is_gluten_free: !has(TAG_GLUTEN),
    is_nut_free: !has(TAG_NUTS),
  }
}
