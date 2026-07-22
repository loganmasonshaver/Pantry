# PLAN — Goal- & Diet-Personalized Pantry Insight

Replace the pantry "Stock Level" banner (a shallow item **count**) with a single, actionable,
**goal- and diet-aware** insight about what to stock next — plus a one-tap "Add to grocery" CTA.

Status: PLANNING. Rule-based v1, no AI, no cap cost. AI "deep dive" is a possible v2.

---

## 1. Why

Current banner: `totalItems >= 50 → "Optimal"`, `>= 25 → "Stocked"`, … It judges **quantity only**.
For a nutrition app that's backwards: 50 items of processed food = "Optimal"; 12 well-chosen lean
proteins + veg for a cut = "Low". It rewards hoarding and ignores the user's goal and diet.

New banner answers: **"Given MY goal and MY diet, what's the most useful thing to stock next?"**

---

## 2. Verified data model (checked in code — do NOT assume)

Persisted on `profiles` (confirmed via onboarding upsert @ app/onboarding/index.tsx and
generate-meals reads):

| Column | Values | Notes |
|---|---|---|
| `fitness_goal` | `lose` \| `maintain` \| `gain` | onboarding "Maximize Muscle" (`build`) → stored as **`gain`**; "Body Recomp" → `maintain`. NOT a `goal` column. |
| `diet_type` | `Classic` \| `Pescatarian` \| `Vegetarian` \| `Vegan` | **separate column** from restrictions |
| `dietary_restrictions` | text[] of `Dairy-free`,`Gluten-free`,`Nut-free`,`Shellfish-free` | allergy/avoidance filters |
| `food_dislikes` | text[] free-form | hard exclusions |
| `calorie_goal`,`protein_goal`,`carbs_goal`,`fat_goal` | ints | all four exist |
| `cuisine_preferences` | text[] | used by meal-gen |

**Corrections this verification caught:** (1) goal column is `fitness_goal` (lose/maintain/gain),
not `goal`; (2) diet style is `diet_type`, distinct from the allergy list; (3) there is **NO
keto/paleo/low-carb** — only 4 diet types. Any rule referencing those would never fire.

**Consistency rule:** read the SAME fields meal-gen uses, so pantry advice never contradicts the
meals the app suggests.

---

## 3. Research: the mistakes we're actually catching (cited)

The rules are grounded in the most common real nutrition mistakes, not vibes.

**Everyone / foundational:**
- **~90% are fiber-deficient; most already get ENOUGH protein.** The dominant real gap is
  produce/fiber/whole foods — NOT protein. (Harvard Nutrition Source; CSPI; Mayo Clinic on fiber.)
  → Foundational produce/fiber gap is TOP priority. Do not default to a protein nag.
- Ultra-processed-heavy pantry = low fiber, high sat-fat/sugar/salt → nudge toward whole foods.

**Losing weight (`lose`):** too-low protein (hunger + muscle loss); **not enough fiber** (the #1
satiety mistake); over-restricting carbs/fat (performance + hormones); "healthy" ≠ low-calorie;
over-reliance on protein bars/UPFs vs whole foods. (Healthline; AOL/dietitians; Studio Fit U.)

**Gaining muscle (`gain`):** **dirty bulking** (junk → fat not muscle); low nutrient quality hurts
recovery; **undereating from fear of fat gain** lowers muscle protein synthesis; needs complex
carbs to fuel + healthy fats; ~30/40/30 P/C/F. (Cleveland Clinic; NASM; Fitness Volt.)

**Maintain / recomp (`maintain`):** cutting calories too aggressively → muscle catabolism; cutting
fat too low → hormone disruption; neglecting vegetables & quality carbs (fiber/micros for recovery
+ satiety); needs adequate protein + balance. (Naked Nutrition; Compound; Capital Strength.)

**Vegan:** protein is fine IF adequate plant sources (legumes, soy/tofu/tempeh, quinoa, seeds).
Real risks: **B12 (needs fortified foods/supplement), iron (non-heme — pair with vitamin C),
omega-3 (algae/flax/chia), calcium, vitamin D, zinc, iodine.** "Junk vegan" is a thing. (PubMed
review 39936826; DR.VEGAN; MDPI.)

**Vegetarian / Pescatarian:** over-reliance on **refined carbs**; **replacing meat with cheese**
(high-fat dairy); insufficient **protein variety** (beans/lentils/tofu/tempeh/eggs); pescatarians
need actual fish/eggs/dairy or they miss the same nutrients. Plate: ½ veg, ¼ protein, ¼ whole
grains. (Healthline; WeightWatchers; Cleveland Clinic.)

**HARD GUARDRAIL:** we only recommend **foods to stock**. We do NOT diagnose deficiencies, and we
do NOT prescribe supplements or dosages (that's medical advice). For vegans we can *suggest
B12-fortified foods / iron-rich plants + a vitamin-C pairing* as FOOD suggestions, framed as
"good to keep on hand," never "you are deficient, take X mcg."

---

## 4. Pantry classification (buckets)

`classify(items)` → counts per bucket via keyword matching (reuse/extend `lib/categories`):

- `leanProtein` — chicken/turkey breast, white fish, tuna, egg whites, shrimp, lean beef, tofu,
  tempeh, edamame, lentils, beans, chickpeas, greek yogurt, cottage cheese, protein powder
- `fattyOrProcessedProtein` — bacon, sausage, deli/processed meat, fried items
- `complexCarb` — oats, brown rice, quinoa, sweet potato, whole-grain bread/pasta, beans
- `refinedCarb` — white bread, white pasta, sugary cereal, crackers, chips
- `healthyFat` — avocado, olive oil, nuts, nut butter, seeds (chia/flax), fatty fish, olives
- `produce` — any vegetable or fruit (fiber + micros)
- `snackyProcessed` — candy, soda, packaged snacks, desserts

Also derive booleans the rules read: `hasProduce`, `hasProteinSource(dietSafe)`, `hasHealthyFat`,
`processedRatio`, `refinedCarbRatio`, `veg vs fruit split`.

---

## 5. Personalization: four filters, applied in order (never suggest a forbidden food)

1. **`diet_type` → allowed sources**
   | Diet | Protein pool |
   |---|---|
   | Classic | meat, poultry, fish, eggs, dairy, plant |
   | Pescatarian | fish/seafood, eggs, dairy, plant (NO meat/poultry) |
   | Vegetarian | eggs, dairy, tofu, tempeh, legumes (NO meat/fish) |
   | Vegan | tofu, tempeh, seitan, legumes, edamame, plant protein (NO animal) |
2. **Allergy filters** (`dietary_restrictions`): Dairy-free → drop dairy; Gluten-free → carbs =
   rice/potato/quinoa/GF-oats; Nut-free → fats = avocado/olive-oil/seeds; Shellfish-free → drop shrimp/shellfish.
3. **`food_dislikes`** → drop any matching suggestion.
4. **Already-have** → don't suggest what the pantry is already full of.

Every candidate item in the catalog is tagged `{ contains: [animal|meat|fish|egg|dairy|gluten|nut|shellfish], … }`
so filtering is DATA-DRIVEN, not branch-per-diet. If a pool empties after filtering, fall back to
a universally-safe suggestion (produce).

---

## 6. Rule engine (priority-ordered, mistake-informed)

Show the **single highest-priority** insight. Foundational gaps beat goal fine-tuning.

**Tier 1 — Foundational (goal-agnostic, diet-adjusted):**
1. `!hasProduce` → **"Add fruits & veg — fiber, micros, and recovery."** (research: fiber is the #1
   deficiency across everyone) → suggest diet-safe produce (goal-adjusted: `lose` → non-starchy veg
   + berries; `gain` → include denser fruit/starchy veg).
2. `!hasProteinSource(dietSafe)` → **"Add a protein source"** → diet-appropriate pool. (Only when
   genuinely ABSENT — do not nag when protein already present; most people have enough.)
3. `!hasHealthyFat` → **"You're light on healthy fats"** → avocado/olive oil/(nuts if allowed)/(fatty fish if diet allows).

**Tier 2 — Goal tuning (only if Tier 1 satisfied):**
- `gain`: if `complexCarb` low → "Fuel your gains — add complex carbs (oats, rice, potatoes)"; if
  pantry is `snackyProcessed`-heavy → "Bulk on quality, not junk — swap in whole foods" (anti dirty-bulk).
- `lose`: if `refinedCarb`/`snackyProcessed` high & produce/lean low → "Stock veg & lean protein to
  stay full on fewer calories" (POSITIVE framing, never "too much junk").
- `maintain`: if protein OK but produce/fiber thin → "Round it out with more veg & fiber for recovery."

**Tier 3 — Diet-specific nudges (food-only, no medical claims):**
- Vegan: if legumes/soy/plant-protein variety thin → "Add plant-protein variety (tofu, tempeh,
  lentils)"; if no leafy greens/legumes → "Keep iron-rich plants + a vitamin-C source on hand"
  (FOOD framing, no diagnosis); optional gentle: "Fortified foods are a handy B12 source."
- Vegetarian: if cheese-heavy & legumes thin → "Vary your protein beyond cheese — beans, lentils, tofu, eggs."
- Pescatarian: if no fish/seafood stocked → "Keep some fish on hand (salmon, tuna) for protein + omega-3."

**Tier 4 — Positive affirmation (nothing to flag):**
- "Your pantry's dialed in for {goalPhrase} 💪" — reward a well-rounded pantry; do not invent a problem.

**Empty/low pantry:** "Scan your pantry to get picks tailored to your goal."

`goalPhrase`: lose→"your cut" / gain→"building muscle" / maintain→"your recomp".

---

## 7. Suggestion catalog (diet-tagged, illustrative)

Each entry: `{ name, buckets, contains }`. Filter by §5. Examples:

- leanProtein: chicken breast `{meat,animal}`, salmon `{fish,animal}`, tuna `{fish,animal}`,
  egg whites `{egg,animal}`, greek yogurt `{dairy,animal}`, cottage cheese `{dairy,animal}`,
  tofu `{}`, tempeh `{}`, lentils `{}`, chickpeas `{}`, edamame `{}`, pea protein `{}`
- healthyFat: avocado `{}`, olive oil `{}`, almonds `{nut}`, peanut butter `{nut}`, chia seeds `{}`,
  flax `{}`, walnuts `{nut}`, salmon `{fish,animal}`, olives `{}`
- complexCarb: oats `{gluten?}`, brown rice `{}`, quinoa `{}`, sweet potato `{}`,
  whole-grain bread `{gluten}`, black beans `{}`
- produce: spinach `{}`, broccoli `{}`, bell pepper `{}`, berries `{}`, banana `{}`, apple `{}`,
  carrots `{}`, mixed greens `{}`

(Full catalog authored in `lib/pantryProfile.ts`.)

---

## 8. UI

- Swap the `heroBanner` content (`app/(tabs)/pantry.tsx` ~L534) from "Stock Level" label+value to:
  headline + one-line detail + a **"Add to grocery"** button that inserts `suggestedItems`
  (categorized via `categorizeItem`) into `grocery_items`, then confirms subtly (existing pattern).
- Keep the hero image; recolor accents per macro/COLORS tokens where relevant.
- One insight at a time. Tapping "Add" adds the suggestions; banner can then re-evaluate (next gap
  or affirmation).

---

## 9. Data-flow / implementation steps

1. `lib/pantryProfile.ts` — `classify(items)`, `SUGGESTION_CATALOG`, `filterSuggestions(pool, diet_type,
   restrictions, dislikes, alreadyHave)`, `buildInsight(buckets, fitness_goal, diet_type, restrictions,
   dislikes) → { headline, detail, suggestedItems, tone }`. Pure + unit-testable, no I/O.
2. `pantry.tsx` — fetch `fitness_goal, diet_type, dietary_restrictions, food_dislikes, *_goal`; compute
   insight from `categories`; render new banner + "Add to grocery".
3. Unit tests for `buildInsight` across the matrix (see §11).
4. No edge-function/deploy needed (all client-side + a grocery insert that already exists).

---

## 10. Guardrails

- **No medical advice / no diagnosis / no supplement dosages.** Food suggestions only.
- **Never name a diet-forbidden food.** Filtering is enforced in code, not just prose.
- **Positive, non-shaming tone** — especially for `lose` (body-image sensitivity). "Add X to make
  it easier," never "you eat too much junk."
- **One calm insight, not a nag.** No repeated scolding; affirm when good.
- **Don't over-flag protein** — research says most people have enough; only flag genuine absence.
- **Fallbacks** for missing goal/diet (default maintain + Classic) and empty pools (→ produce).

---

## 11. Test matrix (author as unit tests + manual)

Cross goal × diet × pantry-state; assert (a) no forbidden food suggested, (b) correct tier fires,
(c) tone positive.

- Vegan + gain + no plant protein → suggests tofu/tempeh/lentils, NEVER meat/dairy/egg.
- Vegan + Nut-free (stacked) + no fats → suggests avocado/olive oil/seeds, NEVER nuts.
- Vegetarian + cheese-heavy + few legumes → "vary beyond cheese", suggests beans/tofu/eggs (eggs OK).
- Pescatarian + no fish → suggests salmon/tuna, NEVER meat.
- Classic + lose + junk-heavy, no veg → produce first (Tier 1), positive framing, no shaming.
- Classic + gain + no complex carbs → carbs suggestion (Tier 2), anti-dirty-bulk if snacky-heavy.
- Any + Gluten-free + needs carbs → rice/potato/quinoa, NEVER bread/pasta.
- Any + Dairy-free + needs protein → NEVER greek yogurt/cottage cheese.
- food_dislikes includes the top suggestion → next valid item chosen.
- Well-rounded pantry → affirmation, no invented gap.
- Empty pantry → "scan to get tailored picks".
- Missing fitness_goal / diet_type → maintain + Classic defaults, still safe.
- Protein already present → does NOT nag to add more protein.

---

## 12. Scope / non-goals

- v1: rule-based, client-side, food suggestions only.
- OUT for v1: micronutrient QUANTIFICATION, supplement advice, AI-generated bespoke advice
  (possible v2 "deep dive" behind the daily cap), tracking of what's actually EATEN (we only see
  the pantry, i.e. what's STOCKED).
- Boundary vs meal-gen: meal-gen = "cook what you have"; this = "what to stock next". Keep distinct.

---

## 13. Adversarial review — cracks found & resolutions

Stress-tested from every angle. These findings REFINE the sections above.

**A. Classification garbage-in is the #1 risk (was: re-keyword-match from scratch).**
The whole feature rests on classifying free-text pantry items; a miss ("courgette", "capsicum",
"chicken nuggets" as lean protein) → wrong insight → a false, embarrassing nag ("no produce" when
there IS produce). **Fix:** don't re-classify from scratch — pantry_items already carry a
`category` (assigned by `categorizeItem`: Produce, Protein, Dairy, …). Use the EXISTING category as
the PRIMARY signal, keyword buckets only as a refinement. Bias toward NOT flagging when ambiguous
(a false "you're missing X" is worse than staying quiet). Maintain a broad produce synonym list.

**B. `food_dislikes` matching is weak with tags alone.** Dislikes are free-form ("shellfish",
"mushrooms"); a suggestion "shrimp" won't substring-match "shellfish". **Fix:** filter a suggestion
out if EITHER (a) its `contains` allergen tag maps to a disliked class, OR (b) the dislike substring-
matches the item name. Map common dislike words → allergen classes (shellfish→shrimp/crab, nuts→
almond/peanut, dairy→yogurt/cheese/milk).

**C. Micronutrient callouts (B12, iron) cross the medical line — DROP for v1.** Even "keep iron-rich
plants on hand" drifts toward health advice, and B12 is genuinely a supplement issue not solved by
pantry food. **Fix:** v1 stays strictly in FOOD-GROUP land. Vegan nudge = "add plant-protein
variety (tofu, tempeh, lentils)" and "keep leafy greens + veg on hand" — NO named micronutrients,
NO supplements. (Consistent with §3's guardrail and the earlier decision to drop micros.)

**D. Tier-1 order was wrong for a no-protein pantry.** A `gain` user with ZERO protein sources
should hear "add protein" before "add veg" — you can't build a meal without protein. **Fix:** Tier-1
order = (1) no diet-safe protein source → protein; (2) no produce → produce/fiber; (3) no healthy
fat → fats. Produce still dominates the COMMON case (protein usually present), preserving the
research-backed fiber emphasis — it just yields when a whole protein source is absent.

**E. Pantry ≠ intake — never claim what they EAT.** We only see what's STOCKED. **Fix:** every
message is framed as stocking ("keep on hand", "add to your pantry", "stock some"), NEVER intake
("you're not eating enough X", "you're low on protein"). This also keeps us honest and non-
diagnostic.

**F. "Has enough" needs thresholds.** One onion ≠ "produce covered". **Fix:** a gap fires only below
a small threshold (e.g., produce gap if < 2 distinct produce items; protein gap only if 0 diet-safe
sources; fat gap if 0). Tune in tests.

**G. `lose` + junk-heavy is ED-sensitive.** **Fix:** NEVER reference the junk or count it
("you have 6 processed items"). Only ever suggest positive additions ("stock veg & lean protein to
stay full"). No shaming, no quantifying "bad" foods.

**H. Nag-wallpaper risk.** Same gap every visit → ignored. **Fix:** recompute after "Add to grocery"
(next gap or affirmation); make the banner lightly dismissible for the session; when nothing to
flag, show the positive affirmation rather than forcing a suggestion.

**I. `maintain` = Body Recomp (build muscle + lose fat), not "balance".** **Fix:** the maintain
branch leans toward protein + veg/fiber emphasis (supports both goals), not neutral balance.

**Residual risk (accepted for v1):** classification will still occasionally misfile an item. The
mitigations (existing category + ambiguous→neutral + high thresholds + suggestion-only wording)
keep failures quiet rather than wrong-and-loud, which is the right failure mode for a nutrition
nudge. Revisit with the AI "deep dive" (v2) if rule coverage proves too coarse.
