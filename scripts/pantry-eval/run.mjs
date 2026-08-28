#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────────────────
// Pantry-scan model A/B harness
//
// Sends each photo in ./images through GPT-4o, Gemini 3.1 Pro, and Gemini 3.1
// Flash-Lite using the EXACT production first-pass scan prompt, then prints a
// side-by-side recall matrix so you can judge: which model misses the fewest
// real items (and which over-invents) on YOUR photos — not on a benchmark.
//
// Why this exists: MMMU/benchmark scores don't measure "read a cluttered fridge."
// The only dataset that matters is yours. Ship the cheapest model that matches
// GPT-4o's item recall.
//
// Run:
//   OPENAI_API_KEY=sk-...  GOOGLE_AI_KEY=AIza...  node scripts/pantry-eval/run.mjs
//
// Drop 15–20 varied pantry/fridge photos (jpg/jpeg/png/webp) into
// scripts/pantry-eval/images/ first. Missing a key → that model is skipped.
// ───────────────────────────────────────────────────────────────────────────

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const IMAGES_DIR = path.join(__dirname, 'images')
// Per-request timeout in seconds — override with TIMEOUT_S=180 to give slow models more rope.
const TIMEOUT_MS = (Number(process.env.TIMEOUT_S) || 90) * 1000

// Models under test. Adjust ids here if Google/OpenAI rename them — these are the
// current (June 2026) ids; verify against the provider docs if a call 404s.
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions'

const OPENAI = 'https://api.openai.com/v1/chat/completions'

// Model lineup for the recall+cost A/B. gpt-4o REMOVED — deprecated, API 404s since 2026-02-16.
// priceIn/priceOut = USD per 1M tokens, verified on the OpenAI pricing page (July 2026); the run
// multiplies REAL measured usage tokens by these so the cost column is actual, not estimated.
//   detail — tile models (gpt-4.1) support only 'high'; patch models (gpt-5.x) accept 'original'
//     for full-resolution reads (the whole point for small-label OCR). gpt-4.1 downscales the
//     shortest side to 768px, which is why it can't read the fine print your labels need.
//   tokenParam/noTemp — gpt-5.x are newer-gen; they take max_completion_tokens and some variants
//     reject non-default temperature, so we omit it for them (A/B ranks recall+cost, not
//     determinism; the floor SWEEP handles temp on whichever model you pick).
const MODELS = [
  {
    label: 'GPT-4.1 (old incumbent)',
    endpoint: OPENAI, model: 'gpt-4.1', apiKey: process.env.OPENAI_API_KEY,
    detail: 'high', priceIn: 2.00, priceOut: 8.00,
  },
  {
    label: 'GPT-5.4-mini',
    endpoint: OPENAI, model: 'gpt-5.4-mini', apiKey: process.env.OPENAI_API_KEY,
    // 'original', not 'high'. It was 'high' while production gpt-5.4 runs 'original', so a loss
    // could have been the model OR the resolution and the row could not tell you which. Same
    // detail setting across every patch-generation row makes the model the only variable.
    detail: 'original', tokenParam: 'max_completion_tokens', noTemp: true, priceIn: 0.75, priceOut: 4.50,
  },
  {
    label: 'GPT-5.4 (PRODUCTION)',
    endpoint: OPENAI, model: 'gpt-5.4', apiKey: process.env.OPENAI_API_KEY,
    detail: 'original', tokenParam: 'max_completion_tokens', noTemp: true, priceIn: 2.50, priceOut: 15.00,
  },
  // ---- Aug 2026 challengers. Prices re-verified against the OpenAI pricing page on 2026-08-28.
  // These IDs are NOT confirmed callable: if one 404s, that row prints the error and the rest of
  // the sweep still completes — a 404 is a real answer (model not available to this account), not
  // a broken run. Same reason `detail: 'original'` is assumed for the 5.6 family: they are patch-
  // generation like 5.4, but if a row errors on the param that is the finding, not a bug.
  {
    // Newer AND cheaper than production on both sides — the single most interesting row here.
    label: 'GPT-5.6-terra',
    endpoint: OPENAI, model: 'gpt-5.6-terra', apiKey: process.env.OPENAI_API_KEY,
    detail: 'original', tokenParam: 'max_completion_tokens', noTemp: true, priceIn: 2.00, priceOut: 12.00,
  },
  {
    // 92% cheaper in / 88% out than production. Only worth anything if recall holds — the whole
    // reason 5.4 won last time was full-res patches reading small labels, and a cheap model that
    // downsamples will look fine on item COUNT while quietly missing the fine print.
    label: 'GPT-5.6-luna',
    endpoint: OPENAI, model: 'gpt-5.6-luna', apiKey: process.env.OPENAI_API_KEY,
    detail: 'original', tokenParam: 'max_completion_tokens', noTemp: true, priceIn: 0.20, priceOut: 1.20,
  },
  // gpt-5.4-nano dropped: $0.20/$1.25 against gpt-5.6-luna's $0.20/$1.20 — same input price,
  // older generation, so luna dominates it on paper. Two near-identical cheap rows would split
  // attention without answering a different question. Re-add only if luna is unavailable.
  // gpt-5.5 dropped from the A/B — 5× the cost for a label-OCR task; revisit only if 5.4 can't read the fine print.
  {
    label: 'Gemini 3.1 Flash-Lite (fallback)',
    endpoint: GEMINI, model: 'gemini-3.1-flash-lite', apiKey: process.env.GOOGLE_AI_KEY,
    detail: 'high',
  },
  // Qwen dropped: malformed JSON + hallucinations + OpenRouter gateway = not scale-safe.
  // Kept as an OPTIONAL reference row — only appears if OPENROUTER_API_KEY is set.
  ...(process.env.OPENROUTER_API_KEY ? [{
    label: 'Qwen3-VL 30B-a3b (OR)',
    endpoint: OPENROUTER,
    model: 'qwen/qwen3-vl-30b-a3b-instruct',
    apiKey: process.env.OPENROUTER_API_KEY,
    maxTokens: 8000,
    extra: { provider: { require_parameters: true } },
  }] : []),
]

// The production first-pass prompt, verbatim, parameterized on photo count.
// (Copied from supabase/functions/scan-pantry/index.ts — keep in sync if that changes.)
function buildPrompt(n) {
  return `These are ${n} photo(s) of a kitchen (fridge, pantry shelves, counter), numbered 0 to ${n - 1} in the order shown. Identify every visible food ingredient or grocery item.

You are a kitchen inventory scanner. Be EXHAUSTIVE — your job is to spot every single edible item in these photos, even ones that are small, partially hidden, in clear containers, on shelf edges, or at the very top/bottom/back of the frame. Better to over-include with a best-guess name than to silently miss something.

Use these 3 detection strategies on every item:
1. VISUAL RECOGNITION — identify foods by their appearance, shape, color, container type
2. BRAND/LOGO READING — if you can see a brand name, logo, or product label, use it to determine the exact product variant (e.g. "Non-Fat Greek Yogurt" instead of just "Greek Yogurt")
3. NUTRITION LABEL / INGREDIENT LIST — if a product is turned showing its back label, read any visible nutrition facts or ingredient lists to help identify the specific product (e.g. seeing "Whole Wheat" in ingredients → "Whole Wheat Bread" not just "Bread")

EXHAUSTIVENESS RULES (these matter more than naming precision):
- Scan EVERY zone in the image — don't focus on the obvious centerpiece items and skip the rest
- Common misses to actively look for: spices in small jars, condiment bottles on fridge doors, sauces, oils, items in CLEAR or SEMI-TRANSPARENT containers (you can see contents through the plastic), back-row items partially hidden behind front items, frozen drawer contents, items on the very top shelf, items on the bottom that may look like packaging trash
- For items in clear containers (Tupperware, glass jars, ziplock bags), identify the CONTENTS not the container
- If you see something edible but can't ID it precisely, use a best-guess generic name (e.g. "leafy greens" if you can't tell spinach from kale, "white sauce" if you can't ID it specifically) — DO NOT skip it
- If a single product is duplicated (3 cans of beans), list it ONCE — but don't skip a real second item because it "looks similar" to another
- Partial labels still count — if you can see part of a label that suggests a product, include it with your best inference

SCAN METHOD — work systematically so cluttered/back areas don't get skimmed:
- Go shelf by shelf. For EACH shelf sweep front→back AND left→right. The BACK ROW behind the front items is where most misses happen — actively look past the front items for caps, lids, and label edges poking out behind or between them. A jar behind a jar, a tub behind a carton — each is a separate item.
- Scan the DOOR shelves and built-in trays separately: condiments, butter/cheese compartments, and EGG TRAYS. Loose eggs sit in molded trays or on door shelves and blend into the tray shape — look for the rounded egg shapes and count them ("eggs").
- Scan each DRAWER (produce, deli) separately — items there are dim and easy to skip.
- If you can see even a SLIVER of something — a corner, a cap, an edge of a label peeking out — it counts. Include it with a best-guess name.
- Stacked or nested items each count separately, even if mostly hidden.

COUNT CHECK before you finish: a full fridge/pantry typically holds 20-40 distinct items. If your list looks short for a full scene, you've skipped back-row and small items — go back to the back rows, door shelves, and shelf edges and look again before returning. (Only include items that are actually visible — never invent — but don't stop early.)

ONE PHYSICAL ITEM = ONE ENTRY (do not over-split or pad the list):
- If you can see only ONE container, list it exactly ONCE with your single best name. NEVER output multiple near-synonyms or alternate guesses for the same object (e.g. don't list both "Tomato Soup" and "Tomato Rice Soup" for one can, or "Protein Powder" + "Whey Protein Isolate" for one tub).
- Name each item at the generic product-type level — do NOT invent finer sub-variants you're only guessing at. When unsure of the exact variant, use the single broader generic name.

EXCLUDE — these are NOT food and must NEVER appear in the list:
- Pet food and pet treats (cat food, dog food, kibble)
- Non-edible household goods: cleaning supplies, paper towels, napkins, tissues, foil/wrap, dish soap, sponges, trash bags, batteries, toiletries, nail polish
- Dishware, cookware, and kitchen tools: plates, bowls, cups, mugs, glasses, utensils, cutting boards, pots, pans, kettles, trays
- Small appliances (coffee makers, toasters, blenders), cookbooks, and any container that is clearly EMPTY
Apart from these exclusions, EVERY actual human food or drink item still follows the exhaustiveness rules above — when unsure whether a FOOD item is X or Y, still include it with a best-guess name. Never drop a real food/drink just because you're unsure what it is.

Return a JSON object with this structure:
{
  "layout": "shelves" | "horizontal",
  "zones": [
    {
      "zone": "Top Shelf",
      "items": [
        { "name": "Non-Fat Greek Yogurt", "category": "Dairy", "photo": 0, "confidence": 95 },
        { "name": "Whole Wheat Pasta", "category": "Carbs", "photo": 1, "confidence": 45 }
      ]
    }
  ]
}

Zone detection rules:
- First, look for VERTICAL layers (shelves, racks, rows stacked top to bottom). If you detect 2+ distinct horizontal layers, use layout "shelves" with zones like: "Top Shelf", "Upper Shelf", "Middle Shelf", "Lower Shelf", "Bottom Shelf", "Drawer", "Door"
- If the image is a single flat surface (countertop, single shelf, table), use layout "horizontal" with zones like: "Left Side", "Center", "Right Side"
- Only include zones that actually contain items
- Order zones top-to-bottom for shelves, left-to-right for horizontal

Item rules:
- "name" must be a GENERIC ingredient name — NEVER a brand or product name. Before writing each name, STRIP the brand to its generic type: "A1" → "Steak Sauce", "Quest Bars" → "Protein Bars", "Babybel" → "Cheese", "Hamburger Helper" → "Pasta Dinner Kit", "Campbell's Cream of Mushroom Soup" → "Cream of Mushroom Soup", "Uncle Ben's Rice" → "Rice", "Chobani" → "Greek Yogurt". A brand in the name creates duplicate entries. Use the brand/label only as CONTEXT to make the GENERIC name more specific (e.g. "Non-Fat Plain Greek Yogurt", not just "Yogurt").
- "photo" — 0-based index of which photo this item came from. Required for downstream density analysis. If you genuinely can't tell, use 0.
- "confidence" — REQUIRED integer 0-100: how sure you are this exact item is really present and correctly named. 90-100 = clearly readable label or unmistakable shape; 60-85 = confident on the type but guessing the variant; 35-55 = partly hidden/blurry/ambiguous; 0-30 = a genuine guess at a blob or opaque/unmarked container. Don't inflate — low scores get filtered out as noise.
- Categories must be one of: Protein, Carbs, Produce, Condiments, Dairy, Pantry Staples, Other
  - Protein: meat, fish, eggs, beans, tofu
  - Carbs: bread, pasta, rice, cereals, flour
  - Produce: fruits, vegetables, herbs
  - Condiments: sauces, oils, spices, dressings
  - Dairy: milk, cheese, yogurt, butter
  - Pantry Staples: canned goods, broth, baking items
  - Other: anything else

Return ONLY the raw JSON object, no markdown, no explanation.`
}

// Normalize an item name for cross-model matching in the recall matrix.
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// Normalize `confidence` to a 0-100 number — mirrors confScore() in the production scan-pantry
// function so the sweep tests the exact cutoff logic prod will apply. Tolerates the old
// string form and omission (absent → 100, i.e. never floor-dropped).
function confScore(c) {
  if (typeof c === 'number' && isFinite(c)) return c
  if (c === 'low') return 30
  if (c === 'high') return 90
  return 100
}

// ── Ground truth: hand-verified list of the REAL distinct items in a photo, so we can
// score actual RECALL (% of true items caught) instead of eyeballing raw counts. Only for
// photos whose contents are clearly enumerable (clear labeled goods). Each entry has match
// keywords — a model "caught" the item if any of its names contains a keyword. Approximate
// by nature (keyword overlap), but far more objective than counting.
const GROUNDTRUTH = {
  // ---- Added 2026-08-28. DRAFTED BY READING THE PHOTOS, NOT VERIFIED BY LOGAN.
  // Only items whose label is legible enough to be confident about are listed. Ground truth that
  // is WRONG is worse than ground truth that is short: a mislabelled item punishes the model that
  // read the shelf correctly. Deliberately conservative — add what is missing, delete what is
  // wrong, and every deletion makes the recall number more honest rather than less.
  // `keys` are lowercase substrings; a detection matches if any key appears in its name.
  'pantry-closet.jpg': [
    { name: 'Honey Smacks cereal',      keys: ['honey smack'] },
    { name: 'Frosted Flakes',           keys: ['frosted flake'] },
    { name: 'Rice Crisps',              keys: ['rice crisp'] },
    { name: 'Campbell\'s soup',         keys: ['campbell'] },
    { name: 'Progresso soup',           keys: ['progresso'] },
    { name: 'Tomato paste',             keys: ['tomato paste'] },
    { name: 'Sweet peas',               keys: ['sweet pea', 'peas'] },
    { name: 'Zatarain\'s',              keys: ['zatarain'] },
    { name: 'Ragu pasta sauce',         keys: ['ragu'] },
    { name: 'Pasta shells',             keys: ['shell'] },
    { name: 'Elbow macaroni',           keys: ['elbow', 'macaroni'] },
    { name: 'Chunky salsa',             keys: ['salsa'] },
    { name: 'Black olives',             keys: ['olive'] },
    { name: 'Planters mixed nuts',      keys: ['planters', 'mixed nut'] },
    { name: 'Club crackers',            keys: ['club cracker'] },
    { name: 'Ritz crackers',            keys: ['ritz'] },
    { name: 'Tastykake cupcakes',       keys: ['tastykake', 'cupcake'] },
    { name: 'Brownies',                 keys: ['brownie'] },
    { name: 'Peanut butter',            keys: ['peanut butter'] },
    { name: 'Grits',                    keys: ['grits'] },
    { name: 'Oats',                     keys: ['oat'] },
    { name: 'Mayonnaise',               keys: ['mayo'] },
    { name: 'Honey Nut Cheerios',       keys: ['cheerio', 'honey nut'] },
    { name: 'Coffee',                   keys: ['coffee', 'folgers'] },
  ],
  'pantry-walkin.jpg': [
    { name: 'Cashews',                  keys: ['cashew'] },
    { name: 'Protein powder',           keys: ['protein powder', 'protein'] },
    { name: 'Pancake & waffle mix',     keys: ['pancake', 'waffle'] },
    { name: 'Flour',                    keys: ['flour'] },
    { name: 'Cocoa powder',             keys: ['cocoa', 'cacao'] },
    { name: 'Corn starch',              keys: ['corn starch', 'cornstarch'] },
    { name: 'Granulated sugar',         keys: ['granulated sugar', 'sugar'] },
    { name: 'Organic cane sugar',       keys: ['cane sugar'] },
    { name: 'Skittles',                 keys: ['skittles'] },
    { name: 'Kosher sea salt',          keys: ['sea salt', 'kosher'] },
    { name: 'Coconut oil',              keys: ['coconut oil'] },
    { name: 'Olive oil',                keys: ['olive oil'] },
    { name: 'Vinegar',                  keys: ['vinegar'] },
    { name: 'Hot sauce',                keys: ['hot sauce'] },
    { name: 'Dried beans',              keys: ['bean'] },
    { name: 'Dried pasta',              keys: ['pasta', 'al dente'] },
    { name: 'Basmati rice',             keys: ['basmati', 'rice'] },
    { name: 'Aluminum foil',            keys: ['aluminum foil', 'foil'] },
    { name: 'Chex Mix',                 keys: ['chex'] },
    { name: 'Pretzels',                 keys: ['pretzel'] },
    { name: 'Baking soda',              keys: ['baking soda'] },
  ],
  'fridge.jpg': [
    { name: 'Fage Greek yogurt',        keys: ['fage', 'greek yogurt', 'yogurt'] },
    { name: 'Daisy cottage cheese',     keys: ['cottage cheese', 'daisy'] },
    { name: 'Mozzarella',               keys: ['mozzarella'] },
    { name: 'Eggs',                     keys: ['egg'] },
    { name: 'Apples',                   keys: ['apple'] },
    { name: 'Cherry tomatoes',          keys: ['tomato'] },
    { name: 'Lettuce / greens',         keys: ['lettuce', 'greens', 'spinach'] },
    { name: 'Bell pepper',              keys: ['bell pepper', 'pepper'] },
    { name: 'Avocado',                  keys: ['avocado'] },
    { name: 'Grapes',                   keys: ['grape'] },
    { name: 'La Colombe oat latte',     keys: ['la colombe', 'latte'] },
    { name: 'Berries',                  keys: ['berry', 'berries', 'strawberr'] },
  ],

  '18A13327-8F43-44F3-98A3-49E2B97B7B51.jpeg': [
    { name: 'Baked Beans', keys: ['baked bean'] },
    { name: 'Canned Chili', keys: ['chili'] },
    { name: 'Tomato Sauce', keys: ['tomato sauce'] },
    { name: 'Tomato Soup', keys: ['tomato soup'] },
    { name: 'Tomato Rice Soup', keys: ['tomato rice', 'rice soup'] },
    { name: 'Cream of Mushroom Soup', keys: ['mushroom soup', 'cream of mushroom'] },
    { name: 'French Onion Soup', keys: ['french onion'] },
    { name: 'Chicken Soup', keys: ['chicken soup', 'chicken noodle'] },
    { name: 'Chicken Broth', keys: ['chicken broth'] },
    { name: 'Beef Broth', keys: ['beef broth'] },
    { name: 'Cashews', keys: ['cashew'] },
    { name: 'Ketchup', keys: ['ketchup'] },
    { name: 'Onion Soup Mix', keys: ['onion soup'] },
    { name: 'Spiced Cider Mix', keys: ['cider'] },
    { name: 'Crackers', keys: ['cracker'] },
    { name: 'Stuffing', keys: ['stuffing'] },
    { name: 'Pecans', keys: ['pecan'] },
    { name: 'Rice', keys: ['rice'] },
    { name: 'Pasta Sauce', keys: ['pasta sauce', 'spaghetti sauce'] },
    { name: 'Olive/Cooking Oil', keys: ['oil'] },
    { name: 'Potato Chips', keys: ['chip'] },
  ],
  // ── Below: hand-verified by reading each photo at full resolution (rotated upright + region
  // crops for the dense ones). Conservative on purpose — only items whose label/shape I could
  // actually READ. Recall then measures the thing that matters: "does raising the floor start
  // killing REAL food." Dense photos have many more items than listed; those show as
  // "unverified" and that's expected, not a truth error.

  // Logan's counter-spread (IMG_3577). NOTE: what looked like "chocolate syrup" in a shrunk
  // thumbnail is actually the Premier Protein tub — corrected after reading the upright crop.
  'IMG_3577.jpg': [
    { name: 'Protein Powder', keys: ['protein powder', 'whey', 'protein isolate', 'protein shake'] }, // Premier + Dymatize ISO100
    { name: 'Hot Cocoa Mix', keys: ['cocoa', 'hot chocolate'] }, // Swiss Miss
    { name: 'Cereal', keys: ['cereal'] }, // "CHOCOLATE" bfast box
    { name: 'Granola', keys: ['granola'] }, // glass jar
    { name: 'Flour', keys: ['flour'] }, // Trader Joe's all-purpose
    { name: 'Onions', keys: ['onion'] }, // yellow, mesh bag
    { name: 'Potatoes', keys: ['potato'] }, // red mesh bag w/ "BOIL" tag
    { name: 'Protein Bars', keys: ['protein bar', 'quest'] },
    { name: 'Eggs', keys: ['eggs'] }, // brown eggs in the clear bin
    { name: 'Garlic', keys: ['garlic'] }, // McCormick jar
    { name: 'Italian Seasoning', keys: ['italian seasoning', 'seasoning'] },
    { name: 'Pecans', keys: ['pecan'] },
    { name: 'Tortilla Chips', keys: ['tortilla chip', 'chips'] }, // green gluten-free "baked never fried" bag
  ],

  // Logan's french-door fridge (IMG_3579). Doors + interior only — the frosted crisper drawers
  // and foil-covered leftovers are genuinely unidentifiable, so they're (correctly) omitted.
  'IMG_3579.jpg': [
    { name: 'Mustard', keys: ['mustard', 'dijon'] },
    { name: 'Asian Sauce', keys: ['oyster sauce', 'soy sauce'] }, // Lee Kum Kee panda
    { name: 'BBQ Sauce', keys: ['bbq', 'barbecue', 'baby ray'] }, // Sweet Baby Ray's
    { name: 'Ranch Dressing', keys: ['ranch', 'dressing'] },
    { name: 'Cranberry Juice', keys: ['cranberry'] }, // H-E-B
    { name: 'Whipping Cream', keys: ['whipping cream', 'heavy cream'] }, // Great Value
    { name: 'Milk', keys: ['milk', 'fairlife'] },
    { name: 'Yogurt', keys: ['yogurt'] }, // :ratio protein
    { name: 'Cottage Cheese', keys: ['cottage cheese'] },
    { name: 'Energy Drink', keys: ['energy drink', 'alani'] },
  ],

  // Second, well-organized fridge (IMG_5144) — highly legible, so a strong recall test.
  'IMG_5144.jpeg': [
    { name: 'Almond Milk', keys: ['almond milk'] }, // Almond Breeze
    { name: 'Oat Milk', keys: ['oat milk', 'oatmilk'] }, // Planet Oat
    { name: 'Milk', keys: ['whole milk', '2% milk', 'dairy milk'] }, // gallon
    { name: 'Yogurt', keys: ['yogurt'] }, // Kalona plain, Stonyfield Greek, White Mountain
    { name: 'Egg Whites', keys: ['egg white'] }, // Kirkland
    { name: 'Maple Syrup', keys: ['maple syrup'] }, // Kirkland
    { name: 'Salsa', keys: ['salsa'] }, // Kirkland
    { name: 'Peanut Butter', keys: ['peanut butter'] }, // Smucker's
    { name: 'Pickles', keys: ['pickle'] }, // Grillo's
    { name: 'Relish', keys: ['relish'] }, // Vlasic
    { name: 'Cottage Cheese', keys: ['cottage cheese'] }, // Daisy
    { name: 'Eggs', keys: ['eggs'] }, // brown eggs in door tray
    { name: 'Orange Juice', keys: ['orange juice'] },
    { name: 'Ground Beef', keys: ['ground beef', 'ground meat'] }, // raw on tray
    { name: 'Cinnamon Rolls', keys: ['cinnamon roll'] }, // Annie's
  ],

  // Food-bank pantry (stock photo) — shelf-labeled and label-rich, a dense category recall test.
  '1_c_ii-Food-Bank-1024x768.jpg': [
    { name: 'Hamburger Helper', keys: ['hamburger helper'] },
    { name: 'Macaroni & Cheese', keys: ['macaroni and cheese', 'mac and cheese', 'mac & cheese', 'macaroni cheese'] },
    { name: 'Chicken Noodle Soup', keys: ['chicken noodle'] },
    { name: 'Tomato Soup', keys: ['tomato soup'] },
    { name: 'Pancake Mix', keys: ['pancake'] },
    { name: 'Syrup', keys: ['syrup'] },
    { name: 'Applesauce', keys: ['applesauce', 'apple sauce'] },
    { name: 'Green Beans', keys: ['green bean'] },
    { name: 'Corn', keys: ['corn'] },
    { name: 'Mixed Vegetables', keys: ['mixed vegetable'] },
    { name: 'Grape Jelly', keys: ['jelly', 'jam'] },
    { name: 'Peanut Butter', keys: ['peanut butter'] }, // Skippy
    { name: 'Pudding', keys: ['pudding'] },
    { name: 'Instant Potatoes', keys: ['instant potato', 'mashed potato'] },
    { name: 'Canned Pears', keys: ['pear'] },
    { name: 'Fruit Cocktail', keys: ['fruit cocktail'] },
    { name: 'Canned Peaches', keys: ['peach'] },
    { name: 'Pineapple', keys: ['pineapple'] },
    { name: 'Spam', keys: ['spam'] },
    { name: 'Canned Chicken', keys: ['canned chicken', 'chicken breast', 'chunk chicken'] },
    { name: 'Dry Pasta', keys: ['penne', 'spaghetti', 'rigatoni', 'dry pasta', 'pasta shells'] },
    { name: 'Pasta Sauce', keys: ['pasta sauce', 'marinara', 'spaghetti sauce'] },
  ],

  // VECELO cabinet (product photo) — densely styled, mixed Western + Asian packaged goods.
  'VECELO-35.4"-Kitchen-Pantry-Storage-Cabinet-Freestanding-Bathroom-Storage-Cabinets-Small-Food-Pantry-Cabinet-for-Dining-Room.jpg.webp': [
    { name: 'Ketchup', keys: ['ketchup'] }, // Heinz
    { name: 'Steak Sauce', keys: ['steak sauce'] }, // A1 + Kühne
    { name: 'Olive Oil', keys: ['olive oil'] },
    { name: 'Orange Juice', keys: ['orange juice'] },
    { name: 'Pepsi', keys: ['pepsi'] },
    { name: 'Fanta', keys: ['fanta'] },
    { name: 'Peanut Butter', keys: ['peanut butter'] },
    { name: 'Cookies', keys: ['cookie'] },
    { name: 'Cup Noodles', keys: ['cup noodle', 'instant noodle', 'ramen'] },
    { name: 'Rice Crackers', keys: ['rice cracker'] },
    { name: 'Pink Salt', keys: ['pink salt', 'himalayan salt', 'sea salt'] },
    { name: 'Mung Beans', keys: ['mung bean'] },
    { name: 'Red Beans', keys: ['red bean', 'adzuki'] },
    { name: 'Lemon Tea', keys: ['lemon tea'] },
    { name: 'Hot Sauce', keys: ['hot sauce', 'peri peri'] }, // Nando's
    { name: 'Gummy Candy', keys: ['gummy'] },
  ],
}

// Score one model's items against a photo's ground truth → caught / missed / extra.
function scoreAgainstTruth(truth, modelNames) {
  const normed = modelNames.map(norm)
  const caught = [], missed = []
  const matchedKeys = new Set()
  for (const t of truth) {
    const hitName = normed.find((n) => t.keys.some((k) => n.includes(k)))
    if (hitName) { caught.push(t.name); t.keys.forEach((k) => matchedKeys.add(k)) }
    else missed.push(t.name)
  }
  // "extra" = model items that matched NO ground-truth keyword (candidate junk OR a real
  // item not in our list — interpret with care, our truth isn't guaranteed exhaustive).
  const extra = modelNames.filter((orig) => !truth.some((t) => t.keys.some((k) => norm(orig).includes(k))))
  return { caught, missed, extra }
}

// ── Post-answer non-food filter ───────────────────────────────────────────
// Deterministic safety net: strip obvious non-food the model hallucinated (nail polish,
// dishes, cookware, pet food). Two matchers, both portable to production scan-pantry:
//  • EXACT — bare ambiguous words (so we DON'T nuke "pudding cups", "ramen bowl", "pot pie")
//  • CONTAINS — multiword terms that never appear inside a food name
const NONFOOD_EXACT = new Set([
  'plate', 'plates', 'dinner plate', 'dinner plates', 'bowl', 'bowls', 'cup', 'cups',
  'mug', 'mugs', 'glass', 'glasses', 'pot', 'pots', 'pan', 'pans', 'skillet', 'kettle',
  'tray', 'trays', 'utensil', 'utensils', 'fork', 'knife', 'spoon', 'spatula',
  'container', 'containers', 'plastic container', 'plastic food container', 'food container',
  'prepared food container', 'toaster', 'blender', 'coffee maker', 'appliance', 'sponge',
  'sponges', 'napkin', 'napkins', 'foil', 'aluminum foil', 'battery', 'batteries',
  'cookbook', 'cookbooks',
])
const NONFOOD_CONTAINS = [
  'nail polish', 'dish soap', 'hand soap', 'paper towel', 'cutting board', 'trash bag',
  'garbage bag', 'dog food', 'dog biscuit', 'dog treat', 'cat food', 'cat treat', 'kibble',
  'toothpaste', 'shampoo', 'toiletr', 'dishware', 'cookware', 'kitchenware', 'plastic wrap',
  'tissue', 'napkin', 'q-tip', 'cotton',
]
function isNonFood(name) {
  const n = norm(name)
  if (NONFOOD_EXACT.has(n)) return true
  return NONFOOD_CONTAINS.some((t) => n.includes(t))
}

// Balance unclosed brackets so we can still read items from a model that stopped without
// closing its JSON (small Qwen models do this). NOTE: needing this is itself a reliability
// red flag — a production model should return valid JSON every time.
function repairJson(s) {
  const stack = []
  let inStr = false, esc = false
  for (const ch of s) {
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }
  let out = inStr ? s + '"' : s
  out = out.replace(/,\s*$/, '')
  while (stack.length) out += stack.pop() === '{' ? '}' : ']'
  return out
}

function flattenItems(raw) {
  let clean = String(raw).replace(/```json|```/g, '').trim()
  // Extract the JSON object if the model wrapped it in prose — first { to last }.
  const first = clean.indexOf('{'), last = clean.lastIndexOf('}')
  if (first >= 0 && last > first) clean = clean.slice(first, last + 1)
  let parsed
  try { parsed = JSON.parse(clean) }
  catch {
    try { parsed = JSON.parse(repairJson(clean)) } // salvage a model that forgot to close brackets
    catch {
      return { names: [], removed: [], collapsed: 0,
        error: `JSON parse failed (len ${clean.length}) — tail: "...${clean.slice(-90).replace(/\s+/g, ' ')}"` }
    }
  }
  const zones = parsed.zones ?? []
  // Carry {name, confidence} through — the sweep needs the score, the matrix needs the name.
  const all = []
  for (const z of zones) for (const it of (z.items ?? [])) if (it?.name) all.push({ name: it.name, confidence: confScore(it.confidence) })
  const removed = all.filter((it) => isNonFood(it.name)).map((it) => it.name) // non-food hallucinations the filter caught
  const food = all.filter((it) => !isNonFood(it.name))

  // De-over-split: strip parenthetical qualifiers ("Hot Sauce (Red Cap)" → "Hot Sauce")
  // then collapse exact duplicates. Fixes the cap-color/can-color over-splitting. Does NOT
  // touch semantic dupes ("Protein Powder" vs "Whey Protein Isolate") — that needs fuzzy
  // matching which risks merging genuinely distinct items.
  const seen = new Set()
  const items = []
  let collapsed = 0
  for (const it of food) {
    const canon = it.name.replace(/\s*\([^)]*\)/g, '').trim()
    const key = norm(canon)
    if (!key) continue
    if (seen.has(key)) { collapsed++; continue }
    seen.add(key)
    items.push({ name: canon, confidence: it.confidence })
  }
  const names = items.map((i) => i.name)
  return { names, items, removed, collapsed, error: null }
}

// Detect the REAL image type from magic bytes, not the extension — internet/phone
// downloads routinely mislabel files (a webp named .jpg, a HEIC named .jpeg). Returns
// the correct mime, or null for formats the vision APIs don't accept (HEIC/DNG/etc).
function sniffMime(buf) {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif'
  return null // unsupported (HEIC, DNG raw, etc.)
}

async function callModel(m, base64, mime) {
  const t0 = Date.now()
  // Per-request timeout — without it, one hung/queued model (e.g. a big model cold-starting
  // on OpenRouter) blocks the whole run forever, since each photo awaits ALL models. 90s is
  // generous; anything slower is disqualified for a scan anyway.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(m.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m.apiKey}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: m.model,
        // Computed key: gpt-5.x take max_completion_tokens; older/gemini take max_tokens.
        [m.tokenParam ?? 'max_tokens']: m.maxTokens ?? 12000, // headroom so a model's reasoning doesn't starve the answer
        ...(m.noTemp ? {} : { temperature: 0 }), // omit for gpt-5.x (some reject non-default temp)
        ...(m.extra ?? {}), // per-model knobs (e.g. Pro's reasoning_effort)
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: m.detail ?? 'high' } },
            { type: 'text', text: buildPrompt(1) },
          ],
        }],
      }),
    })
  } catch (e) {
    return { names: [], removed: [], collapsed: 0, ms: Date.now() - t0,
      error: e.name === 'AbortError' ? `TIMED OUT (>${TIMEOUT_MS / 1000}s) — too slow for a scan` : `request failed: ${e.message}` }
  } finally {
    clearTimeout(timer)
  }
  const ms = Date.now() - t0
  const data = await res.json()
  // Google sometimes returns errors as an ARRAY ([{error:...}]) — check both shapes.
  const errObj = Array.isArray(data) ? data[0]?.error : data.error
  if (errObj) return { names: [], removed: [], collapsed: 0, ms, error: errObj.message ?? JSON.stringify(errObj) }
  const choice = data.choices?.[0]
  const content = choice?.message?.content ?? ''
  // Diagnose empty output (the Pro problem): dump finish_reason, which fields the message
  // actually carries (output might be in a 'reasoning'/'reasoning_content' field), and a raw peek.
  if (!content || !String(content).trim()) {
    const fr = choice?.finish_reason ?? '(no choice)'
    const mkeys = choice?.message ? Object.keys(choice.message).join(',') : '(no message)'
    const rawPeek = JSON.stringify(data).slice(0, 240)
    return { names: [], removed: [], collapsed: 0, ms, error: `EMPTY content — finish_reason=${fr}, message fields=[${mkeys}]\n      raw: ${rawPeek}` }
  }
  const { names, items, removed, collapsed, error } = flattenItems(content)
  // If parsing failed, append finish_reason + output token count — finish=length means the
  // provider truncated (token cap); finish=stop means the model itself ended early/malformed.
  const augErr = error
    ? `${error}  [finish=${choice?.finish_reason ?? '?'}, out_tokens=${data.usage?.completion_tokens ?? '?'}]`
    : error
  // Real measured cost from the provider's usage report × this model's per-1M prices. For gpt-5.x
  // reasoning models, completion_tokens INCLUDES reasoning tokens, so this captures true spend.
  const usage = data.usage ?? {}
  const inTok = usage.prompt_tokens ?? usage.input_tokens ?? 0
  const outTok = usage.completion_tokens ?? usage.output_tokens ?? 0
  const cost = (m.priceIn != null && m.priceOut != null) ? (inTok * m.priceIn + outTok * m.priceOut) / 1e6 : null
  return { names, items: items ?? [], removed, collapsed, ms, inTok, outTok, cost, error: augErr }
}

// ── LIST mode: print the Gemini models this key can actually call, then exit. ──
// Use this to find the real Pro id (gemini-3.1-pro 404'd). Run: LIST=1 GOOGLE_AI_KEY=... node ...
if (process.env.LIST) {
  const key = process.env.GOOGLE_AI_KEY
  if (!key) { console.error('Set GOOGLE_AI_KEY to list models.'); process.exit(1) }
  const data = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)).json()
  const errObj = Array.isArray(data) ? data[0]?.error : data.error
  if (errObj) { console.error('Error:', errObj.message ?? JSON.stringify(errObj)); process.exit(1) }
  const models = (data.models ?? [])
    .filter((m) => /gemini/i.test(m.name) && (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .sort()
  console.log('\nGemini models your key can call (support generateContent):\n')
  for (const m of models) console.log('  ' + m)
  console.log(`\n${models.length} models. Look for the "pro" one — that's the id to use.\n`)
  process.exit(0)
}

// ── LISTOR mode: print OpenRouter VISION models (image input), then exit. ──
// Run: LISTOR=1 OPENROUTER_API_KEY=sk-or-... node run.mjs  → get exact Qwen/Pixtral ids.
if (process.env.LISTOR) {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) { console.error('Set OPENROUTER_API_KEY to list models.'); process.exit(1) }
  const data = await (await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${key}` } })).json()
  const models = (data.data ?? [])
    .filter((m) => JSON.stringify(m.architecture ?? {}).includes('image')) // image-capable
    .map((m) => m.id)
    .filter((id) => /qwen|pixtral|mistral|llama|gemini|gpt/i.test(id))     // the families worth testing
    .sort()
  console.log('\nOpenRouter vision models (image input) worth testing:\n')
  for (const m of models) console.log('  ' + m)
  console.log(`\n${models.length} shown. Grab the qwen/pixtral ids and paste them to me.\n`)
  process.exit(0)
}

// ── SWEEP mode: confidence-floor tuning + temp-0 consistency ────────────────
// Runs the PRODUCTION model (gpt-4.1) REPEAT times per photo at temperature 0, then reports:
//  1. CONSISTENCY — how stable the item set is run-to-run (proves temp 0 fixed the "same photo,
//     different results" problem; flags which items still flicker).
//  2. THRESHOLD SWEEP — for each candidate floor, how many items survive and EXACTLY which get
//     dropped, so you can see where junk dies and (if ever) real food starts dying.
//  3. GROUND-TRUTH precision/recall — on labeled photos, real-item recall vs. unverified items
//     dropped at each floor, and a recommended SCAN_CONFIDENCE_FLOOR value.
// Run:  SWEEP=1 OPENAI_API_KEY=sk-... node scripts/pantry-eval/run.mjs
//       REPEAT=5 → 5 runs/photo (default 3);  SWEEP_MODEL=gpt-4o → sweep a different model;
//       LIMIT=1 → first photo only (cheap smoke test).
if (process.env.SWEEP) {
  const REPEAT = Math.max(1, Number(process.env.REPEAT) || 3)
  const THRESHOLDS = [0, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80]
  const wantModel = process.env.SWEEP_MODEL || 'gpt-4.1'
  const model = MODELS.find((m) => m.model === wantModel)
  if (!model) { console.error(`SWEEP_MODEL "${wantModel}" is not in the MODELS list.`); process.exit(1) }
  if (!model.apiKey) { console.error(`No API key in env for ${model.label}.`); process.exit(1) }

  const sweepFiles = (fs.existsSync(IMAGES_DIR)
    ? fs.readdirSync(IMAGES_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    : []
  ).slice(0, Number(process.env.LIMIT) || Infinity)
  if (sweepFiles.length === 0) { console.error(`No images in ${IMAGES_DIR}. Drop pantry photos there first.`); process.exit(1) }

  console.log(`\nSWEEP: ${model.label} · ${REPEAT}× per photo · temp 0 · ${sweepFiles.length} photo(s)\n`)

  // Aggregated across photos → drives the final recommendation.
  const aggByT = new Map(THRESHOLDS.map((t) => [t, { caught: 0, truthTotal: 0, unverifiedKept: 0 }]))
  let anyTruth = false

  for (const file of sweepFiles) {
    const buf = fs.readFileSync(path.join(IMAGES_DIR, file))
    const mime = sniffMime(buf)
    if (!mime) { console.log(`\n⚠️  skipping ${file} — unsupported format`); continue }
    const base64 = buf.toString('base64')
    console.log(`\n${'='.repeat(72)}\n📷 ${file}  [${mime}]\n${'='.repeat(72)}`)

    // Sequential (not parallel) — REPEAT calls on ONE key; bursting invites 429s and would
    // itself add variance we're trying to measure out.
    const runs = []
    for (let r = 0; r < REPEAT; r++) {
      const res = await callModel(model, base64, mime)
      if (res.error) { console.log(`  ✗ run ${r + 1}: ERROR ${res.error}`); continue }
      runs.push(res)
      console.log(`  ✓ run ${r + 1}: ${res.items.length} items (${(res.ms / 1000).toFixed(1)}s)`)
    }
    if (runs.length === 0) { console.log('  (all runs errored — skipping analysis)'); continue }

    // ── Consistency across runs ──
    const setPerRun = runs.map((r) => new Set(r.items.map((i) => norm(i.name))))
    const union = new Set()
    for (const s of setPerRun) for (const k of s) union.add(k)
    const inAll = [...union].filter((k) => setPerRun.every((s) => s.has(k)))
    const flaky = [...union].filter((k) => !setPerRun.every((s) => s.has(k)))
    const counts = runs.map((r) => r.items.length)
    if (REPEAT > 1) {
      // Mean pairwise Jaccard = the headline stability number (100% = identical set every run).
      let jSum = 0, jN = 0
      for (let a = 0; a < setPerRun.length; a++) for (let b = a + 1; b < setPerRun.length; b++) {
        const A = setPerRun[a], B = setPerRun[b]
        const inter = [...A].filter((k) => B.has(k)).length
        const uni = new Set([...A, ...B]).size
        jSum += uni ? inter / uni : 1; jN++
      }
      const jac = jN ? jSum / jN : 1
      console.log(`\n  CONSISTENCY: counts ${counts.join('/')} · stable ${inAll.length}/${union.size} items · mean Jaccard ${(jac * 100).toFixed(0)}%`)
      if (flaky.length) {
        // Show flicker items WITH mean confidence — the argument is that a floor should kill
        // exactly these low-confidence stragglers, tightening consistency for free.
        const disp = flaky.map((k) => {
          let name = k, confs = []
          for (const r of runs) { const it = r.items.find((i) => norm(i.name) === k); if (it) { name = it.name; confs.push(it.confidence) } }
          const avg = confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : '?'
          return `${name}(conf ${avg}, ${confs.length}/${REPEAT}×)`
        })
        console.log(`  flicker (present in some runs, not all): ${disp.join(', ')}`)
      }
    }

    // ── Pool distinct items across runs → mean confidence per item ──
    const pool = new Map()
    for (const r of runs) for (const it of r.items) {
      const k = norm(it.name)
      if (!pool.has(k)) pool.set(k, { name: it.name, confs: [] })
      pool.get(k).confs.push(it.confidence)
    }
    const distinct = [...pool.entries()].map(([k, v]) => ({
      name: v.name,
      conf: Math.round(v.confs.reduce((a, b) => a + b, 0) / v.confs.length),
      seen: setPerRun.filter((s) => s.has(k)).length,
    })).sort((a, b) => a.conf - b.conf) // lowest first — the drop candidates are at the top

    console.log(`\n  ITEMS by mean confidence (low→high, appeared x/${REPEAT}):`)
    for (const d of distinct) console.log(`    ${String(d.conf).padStart(3)}  ${d.name}${d.seen < REPEAT ? `  (${d.seen}/${REPEAT}×)` : ''}`)

    // ── Threshold sweep ──
    console.log(`\n  THRESHOLD SWEEP (distinct items surviving each floor):`)
    for (const T of THRESHOLDS) {
      const kept = distinct.filter((d) => d.conf >= T)
      const dropped = distinct.filter((d) => d.conf < T)
      console.log(`    floor ${String(T).padStart(2)} → keep ${String(kept.length).padStart(2)}/${distinct.length}${dropped.length ? `   drops: ${dropped.map((d) => `${d.name}(${d.conf})`).join(', ')}` : ''}`)
    }

    // ── Ground-truth precision/recall per threshold (labeled photos only) ──
    const truth = GROUNDTRUTH[file]
    if (truth) {
      anyTruth = true
      console.log(`\n  📋 vs ground truth (${truth.length} known real items):`)
      for (const T of THRESHOLDS) {
        const keptNames = distinct.filter((d) => d.conf >= T).map((d) => d.name)
        const { caught, missed } = scoreAgainstTruth(truth, keptNames)
        // "unverified kept" = surviving items matching no truth keyword (junk OR real-but-unlabeled).
        const unverified = keptNames.filter((n) => !truth.some((t) => t.keys.some((k) => norm(n).includes(k)))).length
        const pct = Math.round((caught.length / truth.length) * 100)
        const agg = aggByT.get(T)
        agg.caught += caught.length; agg.truthTotal += truth.length; agg.unverifiedKept += unverified
        console.log(`    floor ${String(T).padStart(2)} → recall ${caught.length}/${truth.length} (${String(pct).padStart(3)}%) · unverified kept ${unverified}${pct < 100 && missed.length ? `  lost: ${missed.join(', ')}` : ''}${pct < 90 ? '  ⚠️ real items dying' : ''}`)
      }
    }
  }

  // ── Recommendation ──
  console.log(`\n${'='.repeat(72)}\n📊 RECOMMENDATION\n${'='.repeat(72)}`)
  if (anyTruth) {
    // Sweet spot = highest floor that keeps aggregate real-item recall ≥ 95%.
    let best = 0
    for (const T of THRESHOLDS) {
      const a = aggByT.get(T)
      if (a.truthTotal && a.caught / a.truthTotal >= 0.95) best = T
    }
    const a0 = aggByT.get(0), aB = aggByT.get(best)
    const junkCut = a0.unverifiedKept - aB.unverifiedKept
    console.log(`  Suggested SCAN_CONFIDENCE_FLOOR = ${best}`)
    console.log(`  At floor ${best}: real-item recall ${Math.round((aB.caught / aB.truthTotal) * 100)}% · unverified items cut ${junkCut} vs floor 0.`)
    console.log(`  (Based on ${Object.keys(GROUNDTRUTH).length} labeled photo(s) — add more GROUNDTRUTH entries for a firmer number.)`)
  } else {
    console.log(`  No ground-truth photos labeled. Read the per-photo THRESHOLD SWEEP above and pick the`)
    console.log(`  highest floor whose "drops" are still all junk (blobs, mystery containers) and no real`)
    console.log(`  food. Add a GROUNDTRUTH entry (see the example near the top of this file) to auto-recommend.`)
  }
  console.log(`  Then set it in Supabase: SCAN_CONFIDENCE_FLOOR=<value>, and redeploy scan-pantry.\n`)
  process.exit(0)
}

// ── Run ──────────────────────────────────────────────────────────────────
const active = MODELS.filter((m) => {
  if (!m.apiKey) { console.log(`⚠️  skipping ${m.label} — no API key in env`); return false }
  return true
})
if (active.length === 0) { console.error('No API keys set. Provide OPENAI_API_KEY and/or GOOGLE_AI_KEY.'); process.exit(1) }

const files = (fs.existsSync(IMAGES_DIR)
  ? fs.readdirSync(IMAGES_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  : []
).slice(0, Number(process.env.LIMIT) || Infinity) // LIMIT=1 → just the first photo, for fast debug runs
if (files.length === 0) { console.error(`No images in ${IMAGES_DIR}. Drop some pantry photos there first.`); process.exit(1) }

console.log(`\nTesting ${files.length} photo(s) across ${active.length} model(s): ${active.map((m) => m.label).join(', ')}\n`)

const totals = Object.fromEntries(active.map((m) => [m.label, { items: 0, ms: 0, errors: 0, removed: 0, collapsed: 0, cost: 0, inTok: 0, outTok: 0, caught: 0, truthTotal: 0 }]))

for (const file of files) {
  const buf = fs.readFileSync(path.join(IMAGES_DIR, file))
  const mime = sniffMime(buf)
  if (!mime) { console.log(`\n⚠️  skipping ${file} — not a jpeg/png/webp/gif (vision APIs can't read it)`); continue }
  const base64 = buf.toString('base64')
  console.log(`\n${'='.repeat(70)}\n📷 ${file}  [${mime}]\n${'='.repeat(70)}`)

  // Show which models are in flight, so a model that never prints below is the clog.
  console.log(`  ⏳ running: ${active.map((m) => m.label).join(' · ')}`)

  // Run all models concurrently, but PRINT each the instant it finishes (completion order).
  // Fast models show up immediately; the slow/hung one is whatever's still missing — that's
  // how you SEE what's clogging the run in real time.
  const results = await Promise.all(active.map(async (m) => {
    const r = await callModel(m, base64, mime)
    const t = totals[m.label]
    if (r.error) {
      t.errors++
      console.log(`  ✗ ${m.label.padEnd(24)} ERROR: ${r.error}`)
    } else {
      t.items += r.names.length; t.ms += r.ms; t.removed += (r.removed?.length ?? 0); t.collapsed += (r.collapsed ?? 0)
      t.cost += r.cost || 0; t.inTok += r.inTok || 0; t.outTok += r.outTok || 0
      const filtered = r.removed?.length ? `  🚫 ${r.removed.join(', ')}` : ''
      const merged = r.collapsed ? `  🔁 ${r.collapsed} over-splits merged` : ''
      const costStr = r.cost != null ? `  $${r.cost.toFixed(4)} (${r.inTok}+${r.outTok}tok)` : ''
      console.log(`  ✓ ${m.label.padEnd(26)} ${String(r.names.length).padStart(2)} items  (${(r.ms / 1000).toFixed(1)}s)${costStr}${merged}${filtered}`)
    }
    return { m, r }
  }))

  // Recall matrix: union of every item any model found, with ✓/· per model.
  const byModel = Object.fromEntries(results.map(({ m, r }) => [m.label, new Set(r.names.map(norm))]))
  const display = new Map() // norm -> first-seen original name
  for (const { r } of results) for (const n of r.names) if (!display.has(norm(n))) display.set(norm(n), n)

  if (display.size) {
    console.log(`\n  ${'item'.padEnd(34)} ${active.map((m) => m.label.split(' ')[0].slice(0, 6).padStart(7)).join('')}`)
    for (const [key, original] of [...display].sort((a, b) => a[1].localeCompare(b[1]))) {
      const marks = active.map((m) => (byModel[m.label]?.has(key) ? '   ✓  ' : '   ·  ').padStart(7)).join('')
      console.log(`  ${original.slice(0, 34).padEnd(34)}${marks}`)
    }
  }

  // ── Ground-truth recall scoring (only for photos with a hand-verified list) ──
  const truth = GROUNDTRUTH[file]
  if (truth) {
    console.log(`\n  📋 RECALL vs ground truth (${truth.length} known real items):`)
    for (const { m, r } of results) {
      if (r.error) continue
      const { caught, missed, extra } = scoreAgainstTruth(truth, r.names)
      totals[m.label].caught += caught.length; totals[m.label].truthTotal += truth.length // aggregate recall
      const pct = Math.round((caught.length / truth.length) * 100)
      console.log(`  ${m.label.padEnd(26)} recall ${caught.length}/${truth.length} (${pct}%)   missed: ${missed.join(', ') || 'none'}`)
      console.log(`  ${' '.repeat(26)} extra/unverified (${extra.length}): ${extra.slice(0, 12).join(', ')}${extra.length > 12 ? ' …' : ''}`)
    }
  }
}

// ── Totals ───────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}\n📊 TOTALS across ${files.length} photo(s) — recall vs $ is the decision\n${'='.repeat(70)}`)
console.log(`  ${'model'.padEnd(28)} ${'recall'.padStart(6)} ${'items'.padStart(6)} ${'$/photo'.padStart(9)} ${'~$/scan'.padStart(8)} ${'avg s'.padStart(6)} err`)
for (const m of active) {
  const t = totals[m.label]
  const n = Math.max(1, files.length - t.errors)
  const avgItems = (t.items / files.length).toFixed(1)
  const avgMs = (t.ms / n / 1000).toFixed(1)
  const recall = t.truthTotal ? `${Math.round((t.caught / t.truthTotal) * 100)}%` : '—'
  const perPhoto = t.cost ? `$${(t.cost / n).toFixed(4)}` : '—'
  // A real scan ≈ 3 photos × up to 2 passes ≈ 6 image-reads' worth. Rough projection so the
  // $ number is felt at scan scale, not per-image.
  const perScan = t.cost ? `$${((t.cost / n) * 6).toFixed(3)}` : '—'
  console.log(`  ${m.label.padEnd(28)} ${recall.padStart(6)} ${avgItems.padStart(6)} ${perPhoto.padStart(9)} ${perScan.padStart(8)} ${avgMs.padStart(6)} ${t.errors}`)
}
console.log(`
How to read this:
  • recall = % of hand-verified real items the model caught (higher = fewer misses). This is
    the quality axis — pick the CHEAPEST model whose recall matches or beats gpt-4.1.
  • $/photo is REAL measured cost (usage tokens × current price), $/scan projects it to a
    ~3-photo two-pass scan. With a 5/day cap, even the priciest model is pennies — so let
    recall decide, not cost, unless two models tie on recall.
  • gpt-4.1 downscales to 768px shortest-side; the gpt-5.x rows use 'original' detail (full
    res). If a 5.x model reads small labels your incumbent misses, that's the resolution win.
  • Watch the err column: gpt-5.x may need param tweaks (temp/max_tokens) — an error row prints
    the reason (finish_reason / message fields) so we can fix it fast.
`)
