import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  Linking,
  AppState,
  RefreshControl,
  Dimensions,
} from 'react-native'
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { Flame, Compass, Utensils, Plus } from 'lucide-react-native'
import { LinearGradient } from 'expo-linear-gradient'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { COLORS } from '@/constants/colors'
import { trackMealViewed, trackMealImpressions, MealSource } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import { MealImage, prefetchMealImages } from '@/components/MealImage'
import { useAuth } from '@/context/AuthContext'
import { usePremium } from '@/context/SuperwallContext'
import CreatorRecipeModal from '@/components/CreatorRecipeModal'
import PressableScale from '../../components/PressableScale'

// Two-column browse grid. Cell width is computed rather than a percentage so the cards land on the
// same ~170pt as the rail cards — the pill row was measured against that width and wraps below it.
const { width: SCREEN_W } = Dimensions.get('window')

// Creator recipes aren't being used until after launch, and a shelf reading "No creator recipes
// yet" makes the tab look broken rather than inviting. It only ever appeared for promo/creator
// accounts, which is why it was visible in testing and not to normal users. Flip to true to
// restore the shelf and its "+ post a recipe" entry point.
const CREATOR_SHELF_ENABLED = false

const GRID_CELL_W = Math.floor((SCREEN_W - 40 - 14) / 2)

const TRENDING_FETCH_LIMIT = 600
// 6 per section, not 30. This is what makes an all-grid page work at scale: eight sections at 30
// would be 240 cards of scrolling, while eight at 6 is ~48 with everything one tap from expanding.
// It buys rail-like compactness without hiding anything behind a sideways gesture nobody performs.
const GRID_PAGE = 6

// Estimated rendered width of a small pill row, used to decide whether the "CAL" suffix fits.
// Constants match the small-pill style: fontSize 10 bold (~6.2px/char) + letterSpacing 0.4,
// paddingHorizontal 6 each side, 1px border each side, and a 3px gap between pills.
// Measured against the NARROWER of the two surfaces (the 169pt grid cell, not the 175pt rail)
// so one rule holds on both. The -4 margin on the row itself buys back 8px.
const PILL_ROW_AVAIL = GRID_CELL_W - 20 + 8
function fitsPillRow(labels: string[]): boolean {
  const w = labels.reduce((acc, l) => acc + l.length * 6.6 + 14, 0) + (labels.length - 1) * 3
  return w <= PILL_ROW_AVAIL
}

// Lifecycle filters mirror the home-tab logic so Discover shows the same trending
// pool. They live here as a temporary duplicate; Phase 3b moves Trending out of
// Home entirely and these become the single source of truth.
// Creator recipes get a longer shelf life than YouTube (14d guaranteed, up to 30d if
// engagement is strong) — creators earn revenue share, so we honor their content longer.
function isCreatorRecipeVisible(m: any): boolean {
  const ageDays = (Date.now() - new Date(m.generated_at).getTime()) / 86400000 // ms → days
  if (ageDays <= 14) return true
  if (ageDays <= 30 && ((m.vote_score ?? 0) >= 3 || (m.log_count ?? 0) >= 10)) return true
  return false
}
// MUST match RETENTION_DAYS in supabase/functions/generate-trending-meals — if they drift, either
// the feed hides rows that exist or the pipeline deletes rows the feed wanted. Was 7; freshness is
// now conveyed by the "New today" section rather than by throwing meals away, which is what kept
// the browsable pool tiny.
const YOUTUBE_VISIBLE_DAYS = 30
function isYouTubeRecipeVisible(m: any): boolean {
  const ageDays = (Date.now() - new Date(m.generated_at).getTime()) / 86400000
  return ageDays <= YOUTUBE_VISIBLE_DAYS
}
function filterTrendingByLifecycle(rows: any[]): any[] {
  return rows.filter(m => {
    if (m.trend_source === 'creator' || m.creators) return isCreatorRecipeVisible(m)
    return isYouTubeRecipeVisible(m)
  })
}

// Mirrors the pipeline's PROTEIN_KEYWORDS — order matters (specific first).
const DISCOVER_PROTEIN_KEYWORDS = [
  'chicken', 'turkey', 'beef', 'pork', 'lamb', 'bacon', 'ham',
  'salmon', 'tuna', 'shrimp', 'crab', 'lobster', 'cod', 'tilapia', 'fish',
  'cottage cheese', 'paneer', 'greek yogurt', 'skyr', 'feta', 'ricotta', 'mozzarella',
  'tofu', 'tempeh', 'seitan',
  'lentil', 'chickpea', 'black bean', 'kidney bean', 'edamame', 'soy',
  'protein powder', 'whey',
  'egg',
]
// Only check first 3 ingredients — GPT lists them in order of prominence, so the
// "primary" protein is essentially always in the first few. Cheaper than scanning all
// ingredients and avoids false matches like "splash of cream" being tagged as dairy.
// Deterministic per-key offset so sections don't all rotate in lockstep — without it every
// section would advance by one together and the page would still feel like a single ordering.
const hashKey = (k: string) => { let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0; return Math.abs(h) }
// Advances a full PAGE per day, not one item. Stepping by 1 technically rotates but is invisible:
// a 96-meal section would surface only ~36 distinct meals on page 1 across a week and take two
// months to cycle. Stepping by GRID_PAGE gives a genuinely different first page each day and cycles
// even a large section in a few days.
const rotateByDay = <T,>(arr: T[], day: number, key: string, stride: number): T[] => {
  if (arr.length < 2) return arr
  const n = (day * stride + hashKey(key)) % arr.length
  return [...arr.slice(n), ...arr.slice(0, n)]
}

// How many of a meal's ingredients the user doesn't already have. Substring both ways so
// "chicken breast" in a recipe matches a pantry entry of "chicken", and vice versa — pantry names
// are free text and will never match a recipe's phrasing exactly.
function missingCount(meal: DiscoverMeal, pantry: Set<string>): number {
  const ings = (meal.ingredients || []).map((i: any) => String(i?.name ?? i ?? '').toLowerCase().trim()).filter(Boolean)
  if (ings.length === 0) return 99
  return ings.filter(ing => {
    for (const have of pantry) if (ing.includes(have) || have.includes(ing)) return false
    return true
  }).length
}

// SHELF TAGS. One per meal, assigned by the model at extraction (trending_meals.shelf_tag).
//
// This replaced regex-over-names, which failed structurally: it matched PROPERTIES, and properties
// overlap. On the live pool most meals satisfied 3-5 rules at once ("Burger Bowl" matched five), so
// membership was decided by the daily rotation — effectively random, and different every day.
// Character doesn't overlap that way: a dish is one thing.
//
// Titles are written as an invitation, not a label. "Indian night" is a plan; "Indian" is a filter.
// Rows created before shelf_tag existed carry null, and with 30-day retention that's up to a month
// where every tag shelf would be empty and the whole page would collapse into the catch-all. This
// derives a tag from the name so old meals still shelve; new ones use the model's judgement.
const FALLBACK_TAG: [RegExp, string][] = [
  [/\b(masala|paneer|dal|chana|tikka|curry|chilla|dosa|naan|biryani|peri peri|soya chunk)\b/i, 'indian'],
  [/\b(taco|fajita|burrito|quesadilla|enchilada|salsa|chipotle)\b/i, 'mexican'],
  [/\b(gnocchi|pesto|pasta|parmesan|marinara|caprese|risotto|alfredo)\b/i, 'italian'],
  [/\b(teriyaki|fried rice|stir[- ]fry|ramen|noodle|katsu|poke|hoisin)\b/i, 'asian'],
  [/\b(mediterranean|kebab|shawarma|falafel|tzatziki|hummus|adana)\b/i, 'mediterranean'],
  [/\b(burger|buffalo|bbq|hot pocket|mac and cheese|philly|pulled pork)\b/i, 'american-comfort'],
  [/\b(pancake|toast|bagel|omelet|scramble|granola|oats|breakfast)\b/i, 'breakfast'],
]
const shelfTagOf = (m: DiscoverMeal): string | null => {
  if (m.shelf_tag) return m.shelf_tag
  const hit = FALLBACK_TAG.find(([re]) => re.test(m.name))
  if (hit) return hit[1]
  if ((m as any).category === 'dessert') return 'sweet-treat'
  if ((m as any).category === 'snack') return 'high-protein-snack'
  return null
}

const SHELF_TITLES: Record<string, string> = {
  'mexican': 'Mexican night',
  'indian': 'Indian night',
  'asian': 'Asian-inspired',
  'italian': 'Italian comfort',
  'mediterranean': 'Mediterranean table',
  'american-comfort': 'Comfort food, minus the guilt',
  'sweet-treat': 'Sweet, and it still fits',
  'high-protein-snack': 'Protein snacks',
  'breakfast': 'Breakfast, sorted',
}

// Kept as regex because these are genuinely FACTS about a meal, not interpretations — the thing a
// regex is actually good at. "Five ingredients or fewer" was deleted rather than kept: it matched
// 24 of 38 meals only because the extractor was dropping ingredients, so it measured our own bug.
type FactShelf = { key: string; title: string; match: (m: DiscoverMeal) => boolean }
const FACT_SHELVES: FactShelf[] = [
  // 15, not 20 — at 20 it matched over half the catalog, and a shelf holding most things is not a
  // reason to tap.
  { key: 'quick', title: 'Ready in 15', match: m => m.prepTime > 0 && m.prepTime <= 15 },
  { key: 'batch', title: 'Cook once, eat all week', match: m => ((m as any).servings ?? 1) > 1 },
]

const titleCase = (s: string) => s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

function detectPrimaryProtein(meal: any): string {
  const ings = (meal.ingredients || []).slice(0, 3).map((i: any) => i.name ?? '').join(' ')
  const haystack = `${meal.name ?? ''} ${ings}`.toLowerCase()
  for (const kw of DISCOVER_PROTEIN_KEYWORDS) {
    if (haystack.includes(kw)) return kw
  }
  return 'other'
}

// NOTE: applyVarietyFill and MAX_PER_PROTEIN lived here and were removed with the horizontal rail
// — they capped each protein source within a short curated shelf, which the grid doesn't need.
// detectPrimaryProtein above is still used, but only for "Because you cooked X" similarity now,
// not for grouping.

type DiscoverMeal = {
  id: string
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  prepTime: number
  servings: number
  shelf_tag: string | null
  source_verified: boolean
  ingredients: any[]
  steps: any[]
  image: string | null
  trend_source: string | null
  creator: any | null
  vote_score: number
  log_count: number
  generated_at: string
  compatible_diets: string[] | null
  is_dairy_free: boolean | null
  is_gluten_free: boolean | null
  is_nut_free: boolean | null
}

// Filter chips narrow the trending pool against derived signals. "All" is a no-op.
const FILTERS = ['All', 'Breakfast', 'Lunch', 'Dinner', 'High Protein', 'Quick', 'Desserts', 'Vegetarian'] as const
type FilterKey = typeof FILTERS[number]

// Keyword heuristics — fast, no extra columns required. Dessert reclassification is
// the same fix flagged in the handoff (LLM mis-tags "Cottage Cheese Brownie Bake" as
// meal). Vegetarian uses a deny-list because the trending pool doesn't carry a tag.
// Meal-time classification. Trending meals carry no `slot` (unlike generated cook-now meals), so
// it's derived from the name — same approach as Desserts/Vegetarian below.
//
// Breakfast has strong, unambiguous keywords. Lunch vs dinner genuinely does not: a chicken bowl or
// a salad is legitimately either. So DINNER_ONLY covers dishes nobody eats at 8am, and anything
// that's neither breakfast nor dessert stays eligible for BOTH lunch and dinner — showing a
// reasonable meal in both beats hiding it from the one the user picked.
const BREAKFAST_KEYWORDS = [
  'oat', 'oatmeal', 'overnight oats', 'pancake', 'waffle', 'french toast', 'omelet', 'omelette',
  'scramble', 'frittata', 'benedict', 'breakfast', 'granola', 'cereal', 'parfait', 'yogurt bowl',
  'smoothie', 'bagel', 'english muffin', 'hash brown', 'chia pudding', 'avocado toast', 'porridge',
]
const DINNER_ONLY_KEYWORDS = [
  'roast', 'steak', 'casserole', 'lasagna', 'stew', 'braise', 'chili', 'curry', 'pot pie',
  'meatloaf', 'sheet pan', 'ribs', 'brisket', 'risotto', 'shepherd', 'pot roast',
]

const DESSERT_KEYWORDS = [
  'brownie', 'cake', 'cheesecake', 'cookie', 'donut', 'doughnut', 'muffin',
  'pudding', 'pie', 'ice cream', 'mousse', 'parfait', 'tart', 'scone',
  'cupcake', 'tiramisu', 'custard', 'frosting', 'truffle',
]
const MEAT_KEYWORDS = [
  'chicken', 'beef', 'pork', 'turkey', 'bacon', 'sausage', 'lamb', 'veal',
  'salmon', 'tuna', 'shrimp', 'crab', 'lobster', 'fish', 'anchovy',
  'prosciutto', 'pepperoni', 'salami', 'ham', 'meat',
]


// Food dislikes are arbitrary user strings (can't be precomputed), so they stay a
// runtime substring check. Diet identity + allergens now use the meal's precomputed
// tags (see passesDietTags) instead of the old substring keyword scan.
function passesDietary(meal: DiscoverMeal, dislikes: string[]): boolean {
  const ingredientNames = (meal.ingredients || []).map((i: any) => (i.name ?? '').toLowerCase())
  const nameLower = meal.name.toLowerCase()
  for (const dislike of dislikes) {
    const d = dislike.toLowerCase().trim()
    if (!d) continue
    if (ingredientNames.some(n => n.includes(d)) || nameLower.includes(d)) return false
  }
  return true
}

// Diet identity (Classic/Pescatarian/Vegetarian/Vegan) + allergen restrictions,
// matched against the generation-time tags. Classic matches everything. Legacy
// rows with null tags pass permissively so nothing vanishes during rollout.
function passesDietTags(meal: DiscoverMeal, dietType: string, restrictions: string[]): boolean {
  if (dietType && dietType !== 'Classic' && meal.compatible_diets) {
    if (!meal.compatible_diets.includes(dietType)) return false
  }
  // ALLERGENS FAIL SAFE, unlike the diet identity above. `!== true` not `=== false`: the column
  // has three states, and an untagged meal (null) is "nobody ever checked", not "checked and
  // clean". The old `=== false` let unknown through, so a row the classifier never saw was served
  // to someone who explicitly asked to avoid nuts — the one error this filter exists to prevent.
  //
  // The permissive fallback was there to stop legacy untagged rows vanishing during rollout. That
  // rollout is over: all 118 rows in trending_meals carry all three tags (0 null, measured against
  // prod before this change), so failing safe costs nothing today. If a future migration adds
  // untagged rows they will correctly hide from restricted users until the classifier runs.
  for (const r of restrictions) {
    const key = r.toLowerCase()
    if (key === 'dairy-free' && meal.is_dairy_free !== true) return false
    if (key === 'gluten-free' && meal.is_gluten_free !== true) return false
    if (key === 'nut-free' && meal.is_nut_free !== true) return false
  }
  return true
}

// Whole-word keyword match. Plain `includes` produced real misclassifications, because these
// lists contain short words that live inside unrelated ones: 'cake' matches "panCAKE" (so every
// pancake was tagged a dessert) and 'oat' matches "gOAT" (so Goat Cheese Salad was breakfast).
//
// The (s|es)? suffix is required, not cosmetic: the keyword lists are singular but real dish names
// are plural ("Skyr Pancakes", "Protein Brownies"), and a bare \b would match neither list — worse
// than the substring bug it replaces. Multi-word keys like 'ice cream' work unchanged.
const matchesKeyword = (nameLower: string, keywords: string[]): boolean =>
  keywords.some(k => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?\\b`, 'i').test(nameLower))

// Which eating occasion is it right now. Drives ORDERING of the "All" feed, not filtering —
// see timeOfDayRank. Dinner covers the evening through the small hours; nobody browsing at 1am
// wants pancakes surfaced first.
function currentMealTime(hour: number): 'Breakfast' | 'Lunch' | 'Dinner' {
  if (hour >= 4 && hour < 11) return 'Breakfast'
  if (hour >= 11 && hour < 16) return 'Lunch'
  return 'Dinner'
}

// Lower sorts first. Deliberately a SORT and not a filter: auto-switching the chip to Breakfast
// at 7am would show an empty feed on any day the pool happens to have no breakfast dishes,
// whereas demoting the mismatches can't ever empty it. The chips stay as explicit overrides.
function timeOfDayRank(meal: DiscoverMeal, mealTime: 'Breakfast' | 'Lunch' | 'Dinner'): number {
  const nameLower = meal.name.toLowerCase()
  const isBreakfast = matchesKeyword(nameLower, BREAKFAST_KEYWORDS)
  // Breakfast wins on genuine overlap ('parfait' is in both lists), same rule passesFilter uses.
  const isDessert = !isBreakfast && matchesKeyword(nameLower, DESSERT_KEYWORDS)
  const isDinnerOnly = matchesKeyword(nameLower, DINNER_ONLY_KEYWORDS)
  if (mealTime === 'Breakfast') {
    if (isBreakfast) return 0
    // Desserts are never wrong for the time of day, but they shouldn't lead the feed either.
    return isDessert || isDinnerOnly ? 2 : 1
  }
  // Lunch/dinner: a breakfast dish at 6pm is the mismatch worth demoting.
  if (isBreakfast) return 2
  if (isDessert) return 1
  if (mealTime === 'Lunch') return isDinnerOnly ? 1 : 0
  return 0
}

function passesFilter(meal: DiscoverMeal, filter: FilterKey): boolean {
  if (filter === 'All') return true
  const nameLower = meal.name.toLowerCase()
  if (filter === 'Quick') return meal.prepTime > 0 && meal.prepTime <= 20
  if (filter === 'High Protein') {
    // Protein density ≥ 25% of calories — same bar the trending pipeline uses.
    return meal.calories > 0 && (meal.protein * 4) / meal.calories >= 0.25
  }
  if (filter === 'Desserts') return matchesKeyword(nameLower, DESSERT_KEYWORDS)
  if (filter === 'Breakfast' || filter === 'Lunch' || filter === 'Dinner') {
    const isDessert = matchesKeyword(nameLower, DESSERT_KEYWORDS)
    const isBreakfast = matchesKeyword(nameLower, BREAKFAST_KEYWORDS)
    // Breakfast wins on overlap: "parfait" is in both lists, and a Greek yogurt parfait is
    // breakfast to most people even if a chocolate one isn't.
    if (filter === 'Breakfast') return isBreakfast
    // Lunch/dinner: exclude breakfast dishes and desserts; dinner-only mains are hidden from lunch.
    if (isBreakfast || isDessert) return false
    if (filter === 'Lunch') return !matchesKeyword(nameLower, DINNER_ONLY_KEYWORDS)
    return true
  }
  if (filter === 'Vegetarian') {
    // Deliberately substring, not whole-word, unlike the lists above. This one is a dietary
    // filter, so the two error directions aren't equal: over-matching hides a safe meal
    // (harmless), under-matching shows meat to a vegetarian. \bmeat\b would stop matching
    // "Meatballs" — exactly the miss that matters most.
    if (MEAT_KEYWORDS.some(k => nameLower.includes(k))) return false
    const ingredientNames = (meal.ingredients || []).map((i: any) => (i.name ?? '').toLowerCase())
    return !ingredientNames.some(n => MEAT_KEYWORDS.some(k => n.includes(k)))
  }
  return true
}

// Per-user cache so the rail paints instantly on tab focus / app launch (stale-while-revalidate),
// the same pattern the Saved tab uses. Without it Discover fetched trending_meals cold on every
// mount and showed a spinner each time. Capped to 60 to keep the stored payload light.
const discoverCacheKey = (uid: string) => `pantry_discover_${uid}`

export default function DiscoverScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { promoActive } = usePremium()
  const [trending, setTrending] = useState<DiscoverMeal[]>([])
  const [loading, setLoading] = useState(true)
  const hasContentRef = useRef(false) // once meals are shown (cache or fetch), refocus refetches silently
  const [activeFilter, setActiveFilter] = useState<FilterKey>('All')
  const [showCreatorModal, setShowCreatorModal] = useState(false)
  // Today's remaining budget. Powers both the context line above the hero and the "Fits what's
  // left today" section — one fetch, two surfaces. Null until loaded so neither renders a
  // placeholder number.
  const [budget, setBudget] = useState<{ calLeft: number; proLeft: number; hasLogged: boolean } | null>(null)
  const [maxPrep, setMaxPrep] = useState<number | null>(null)
  // Lowercased pantry item names, for the missing-ingredient count.
  const [pantryNames, setPantryNames] = useState<Set<string>>(new Set())
  // Most recently cooked meal. Drives the "Because you cooked X" shelf — needs only THIS user's
  // history, not a cohort, so it works from their first cook rather than at some future scale.
  const [lastCooked, setLastCooked] = useState<string | null>(null)
  const [foodDislikes, setFoodDislikes] = useState<string[]>([])
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([])
  const [dietType, setDietType] = useState<string>('Classic')

  // Pantry + last-cooked, fetched independently of the profile/budget call above. in_stock is
  // filtered here to match every other pantry reader in the app — an item marked out of stock is
  // not "in your kitchen", and counting it would overstate how cookable a recipe is.
  useEffect(() => {
    if (!user) return
    ;(async () => {
      const [{ data: pantry }, { data: recent }] = await Promise.all([
        supabase.from('pantry_items').select('name').eq('user_id', user.id).eq('in_stock', true).limit(500),
        supabase.from('meal_logs').select('meal_name, logged_at')
          .eq('user_id', user.id).order('logged_at', { ascending: false }).limit(1),
      ])
      setPantryNames(new Set((pantry ?? []).map((p: any) => String(p.name ?? '').toLowerCase().trim()).filter(Boolean)))
      if (recent?.[0]?.meal_name) setLastCooked(recent[0].meal_name)
    })()
  }, [user])

  // Profile-based dietary filters apply to every Discover view (always-on safety
  // filter — users with nut allergies should never see almond recipes regardless
  // of which chip they have selected). Chip filter narrows further on top.
  useEffect(() => {
    if (!user) return
    supabase.from('profiles')
      .select('food_dislikes, dietary_restrictions, diet_type, calorie_goal, protein_goal, max_prep_minutes')
      .eq('id', user.id)
      .single()
      .then(async ({ data }) => {
        if (data?.food_dislikes) setFoodDislikes(data.food_dislikes ?? [])
        if (data?.dietary_restrictions) {
          setDietaryRestrictions((data.dietary_restrictions ?? []).filter((r: string) => r !== 'None'))
        }
        if (data?.diet_type) setDietType(data.diet_type)
        if (data?.max_prep_minutes) setMaxPrep(data.max_prep_minutes)

        const goalCal = data?.calorie_goal ?? 0
        const goalPro = data?.protein_goal ?? 0
        // Everything past here is the calorie BUDGET, which genuinely needs goals. Pantry and
        // last-cooked are fetched separately below — they were originally inside this block, so a
        // profile without macro goals silently lost the pantry shelf too. Unrelated data should
        // never share an early return.
        if (!goalCal && !goalPro) return
        const todayStr = new Date().toISOString().split('T')[0]
        const { data: logs } = await supabase.from('meal_logs')
          .select('calories, protein').eq('user_id', user.id).eq('logged_at', todayStr)
        const eatenCal = (logs ?? []).reduce((sum, l: any) => sum + (l.calories ?? 0), 0)
        const eatenPro = (logs ?? []).reduce((sum, l: any) => sum + (l.protein ?? 0), 0)
        setBudget({
          calLeft: Math.max(0, goalCal - eatenCal),
          proLeft: Math.max(0, goalPro - eatenPro),
          // Before anything is logged, "remaining" is just the full goal and every meal trivially
          // fits — the section would be noise pretending to be personalisation. Gate on it.
          hasLogged: (logs ?? []).length > 0,
        })
      })
  }, [user])

  // Serve the in-state pool instead of re-hitting Postgres on every tab-return / foreground.
  // The trending feed only changes once a day (cron) or on a creator edit, so a 300-row +
  // creator-join round-trip per focus was pure waste. 5-min TTL still picks up the overnight
  // batch and creator edits (any return after the window refetches); rapid tab-switching skips.
  const lastFetchRef = useRef(0)
  const TRENDING_TTL_MS = 5 * 60 * 1000

  // Instant paint: hydrate the last-cached rail on mount so the tab never flashes a spinner;
  // fetchTrending below revalidates in the background and re-caches.
  useEffect(() => {
    if (!user) return
    AsyncStorage.getItem(discoverCacheKey(user.id)).then(raw => {
      if (!raw) return
      try {
        const cached = JSON.parse(raw)
        if (Array.isArray(cached) && cached.length) {
          setTrending(cached); hasContentRef.current = true; setLoading(false)
          prefetchMealImages(cached.slice(0, 8).map((m: DiscoverMeal) => m.image)) // warm the rail before scroll
        }
      } catch {}
    })
  }, [user])

  const fetchTrending = useCallback(async (force = false) => {
    if (!force && Date.now() - lastFetchRef.current < TRENDING_TTL_MS) return // fresh enough
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    // 30-day window is the absolute upper bound (creator lifecycle ceiling).
    // Lifecycle filtering below trims YouTube to YOUTUBE_VISIBLE_DAYS and creators by engagement.
    // The !creator_id syntax is PostgREST's foreign-key embed — joins one creator per meal.
    const { data } = await supabase.from('trending_meals')
      .select('*, creators!creator_id(name, handle, avatar_url, instagram_url, tiktok_url, youtube_url)')
      .gte('generated_at', thirtyDaysAgo)
      .order('generated_at', { ascending: false })
      .order('id')
      // Newest-first, capped. At ~15 meals/day and 30-day retention the pool tops out near 450, so
      // 600 leaves headroom. This is a CEILING, not pagination: if rows ever comes back equal to
      // the limit, the tail is silently unreachable and this needs a real generated_at cursor.
      // The warn below is the tripwire for that day.
      .limit(TRENDING_FETCH_LIMIT)

    if (!data) { setLoading(false); return }

    const mapped = filterTrendingByLifecycle(data)
      .map(m => ({
        id: m.id, name: m.name, calories: m.calories, protein: m.protein,
        carbs: m.carbs, fat: m.fat, prepTime: m.prep_time, servings: m.servings ?? 1, shelf_tag: m.shelf_tag ?? null, source_verified: m.source_verified === true,
        ingredients: m.ingredients, steps: m.steps, image: m.image,
        trend_source: m.trend_source,
        creator: (m as any).creators ?? null,
        vote_score: (m as any).vote_score ?? 0,
        log_count: (m as any).log_count ?? 0,
        generated_at: m.generated_at,
        compatible_diets: (m as any).compatible_diets ?? null,
        is_dairy_free: (m as any).is_dairy_free ?? null,
        is_gluten_free: (m as any).is_gluten_free ?? null,
        is_nut_free: (m as any).is_nut_free ?? null,
      }))
      // Sort by recency first (newest day → oldest), then by vote_score within each
      // day. So today's freshly-curated batch sits at the front of the rail and
      // yesterday's leftovers shift to the end.
      .sort((a, b) => {
        const dateDiff = new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
        if (dateDiff !== 0) return dateDiff
        return (b.vote_score ?? 0) - (a.vote_score ?? 0)
      })
    // Store the FULL ranked pool. Variety-fill now runs AFTER the per-user diet
    // filter (in `filtered` below) so a vegetarian's 6 are picked from the
    // diet-compatible pool with backfill — not capped to 6 before filtering.
    // Tripwire: hitting the ceiling means older meals are silently unreachable and this needs a
    // real cursor rather than a bigger number.
    if ((data?.length ?? 0) >= TRENDING_FETCH_LIMIT) {
      console.warn(`[discover] fetch hit the ${TRENDING_FETCH_LIMIT}-row ceiling — tail unreachable, add generated_at pagination`)
    }
    setTrending(mapped)
    hasContentRef.current = true
    lastFetchRef.current = Date.now() // mark fresh only on success — a failed fetch retries next focus
    setLoading(false)
    // Cache a light slice for instant paint on the next focus / app launch (stale-while-revalidate).
    if (user) AsyncStorage.setItem(discoverCacheKey(user.id), JSON.stringify(mapped.slice(0, 60))).catch(() => {})
    prefetchMealImages(mapped.slice(0, 8).map(m => m.image)) // warm the visible rail's photos
  }, [user])

  // Initial mount + every tab return: useFocusEffect already fires on first focus
  // (which for a tab screen IS mount), so a separate mount useEffect would just
  // double-fetch on cold load. This single hook covers both — plus it re-syncs
  // creator-recipe edits and overnight cron runs without a manual reload.
  useFocusEffect(useCallback(() => { fetchTrending() }, [fetchTrending]))

  // Foreground refetch: useFocusEffect doesn't re-fire when the app is backgrounded
  // and resumed (the tab is still "focused" the whole time), so without this users
  // would see yesterday's batch until they force-quit and relaunch. Mirrors the
  // pattern Home uses for its own dynamic data.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') fetchTrending()
    })
    return () => sub.remove()
  }, [fetchTrending])

  // Pull-to-refresh: manual escape hatch when the user wants to force a refetch
  // without waiting for tab-switch or app-resume. Matches Home's pull-to-refresh UX.
  const [refreshing, setRefreshing] = useState(false)
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await fetchTrending() } finally { setRefreshing(false) }
  }, [fetchTrending])

  // Two-stage filter:
  //   1. Dietary safety (profile dietary_restrictions + food_dislikes — always on).
  //   2. Active chip (All / High Protein / Quick / Desserts / Vegetarian).
  // Featured is then the top item from the combined filtered pool (already sorted by
  // vote_score); each rail excludes whatever is currently the hero. Search filtering
  // was wired in 3c but removed pre-launch — see v2 todo for restoration trigger.
  // Full diet/chip-filtered pool (NOT variety-capped here — variety-fill is applied per
  // rail below so the global cap can't starve the rails).
  // Recomputed on each focus/resume (fetchTrending re-runs), so the ordering follows the clock
  // across a session rather than freezing at whatever time the app was first opened.
  const mealTime = currentMealTime(new Date().getHours())

  // The feed has been sorting by time of day silently since the ordering work — this says it out
  // loud. Perceived personalisation comes from the label as much as the algorithm: the same meals
  // under "Tuesday evening - under 30 min - 48g protein to go" read as chosen rather than listed.
  // Every part is dropped when unknown rather than faked, so it never states something untrue.
  const contextLine = useMemo(() => {
    const day = new Date().toLocaleDateString('en-US', { weekday: 'long' })
    const partOfDay = mealTime === 'Breakfast' ? 'morning' : mealTime === 'Lunch' ? 'afternoon' : 'evening'
    const bits = [`${day} ${partOfDay}`]
    // No prep-time clause. It read well but nothing in the default feed is filtered by
    // max_prep_minutes, so "under 30 min" was asserting a constraint the list doesn't honour —
    // the same unbacked-claim problem as promising meals from a pantry that hasn't been scanned.
    // If the feed ever actually filters on prep time, put it back.
    if (budget?.hasLogged && budget.proLeft > 0) bits.push(`${budget.proLeft}g protein to go`)
    return bits.join(' · ')
  }, [mealTime, budget])
  const filtered = useMemo(
    () => trending
      .filter(m => passesDietTags(m, dietType, dietaryRestrictions))
      .filter(m => passesDietary(m, foodDislikes))
      .filter(m => passesFilter(m, activeFilter))
      // Time-of-day ordering applies only to "All". Once the user picks a chip they've stated
      // the occasion explicitly, and re-sorting under them would fight that choice.
      .sort((a, b) => activeFilter === 'All'
        ? timeOfDayRank(a, mealTime) - timeOfDayRank(b, mealTime)
        : 0),
    [trending, activeFilter, foodDislikes, dietaryRestrictions, dietType, mealTime]
  )
  const featured = filtered[0]
  // The rail is a CURATED shelf, not the whole browsing surface — that distinction is why the tab
  // felt empty. With ~110 meals retained, a single 8-item rail meant ~90% of the pool was
  // unreachable. The rail stays tight (10, protein-varied) and everything else drops into the
  // browse grid below, which is what someone who actually wants to explore is looking for.
  const RAIL_CAPS = { creator: 6 }
  // YouTube rail gets the protein-variety cap (it's the large algorithmic pool). Creators
  // are hand-submitted/curated, so they're just sliced — no protein cap dropping their posts.
  const creatorRail = useMemo(
    () => filtered.filter(m => m.id !== featured?.id && !!m.creator).slice(0, RAIL_CAPS.creator),
    [filtered, featured]
  )
  // Everything the rails didn't show. Deliberately NOT variety-capped: the protein cap exists to
  // keep a short curated shelf from being all chicken, but on a browse grid it would just hide
  // meals the user came here to find.
  const browseGrid = useMemo(() => {
    // Only the hero and the (currently disabled) creator rail are rendered outside the grid, so
    // only those may be withheld from it. The YouTube rail used to sit here too and was removed —
    // leaving it in the exclusion list would have silently swallowed 10 meals that nothing renders.
    const shown = new Set([featured?.id, ...creatorRail.map(m => m.id)])
    return filtered.filter(m => !shown.has(m.id))
  }, [filtered, featured, creatorRail])

  // Grouped, not one endless scroll. A flat grid of 400 meals is a worse version of a search
  // results page — it strips out every reason to look at any particular meal. Sections restore
  // that, using columns that already exist (generated_at, category) plus the protein classifier
  // the rails already use, so this costs no new data.
  //
  // "New today" is exclusive and comes first: it carries the freshness cue that deleting old meals
  // used to provide, which is what lets retention grow from 7 days to 30 without the feed feeling
  // stale.
  const browseSections = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0]
    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
    )

    // FIRST SHELF WINS. Each section claims meals the earlier ones didn't take, so a meal appears
    // exactly once on the page. Without this a single recipe shows up under "Almost in your
    // kitchen", "Ready in 20" and "Big plate" within three rows, which reads as a broken feed
    // rather than as thorough curation. Personalised shelves get first pick because they're the
    // most specific reason to tap.
    const taken = new Set<string>()
    const claim = (meals: DiscoverMeal[], limit: number) => {
      const out: DiscoverMeal[] = []
      for (const m of meals) {
        if (out.length >= limit) break
        if (taken.has(m.id)) continue
        taken.add(m.id)
        out.push(m)
      }
      return out
    }

    // ── Personalised: answers to "what should I eat right now" ──
    // Verified-only. This shelf's entire claim is "you have almost everything for this", and an
    // unverified recipe is missing ~half its ingredients — so it looks MORE cookable than it is and
    // ranks higher precisely because it's incomplete. That's the one place the drop bug turns into
    // an outright lie, so unverified recipes are excluded here even though they ship elsewhere.
    const nearlyRanked = pantryNames.size > 0
      ? browseGrid.filter(m => m.source_verified)
          .map(m => ({ m, missing: missingCount(m, pantryNames) }))
          .sort((a, b) => a.missing - b.missing)
      : []
    // 8, not 12. Three personalised shelves at 12 claim 36 meals before any intent shelf runs —
    // on a 35-meal pool a user with a full pantry would pull almost everything into "Almost in
    // your kitchen" and leave the rest of the page bare.
    const PERSONAL_CAP = 8
    const nearly = claim(nearlyRanked.map(x => x.m), PERSONAL_CAP)

    const cookedProtein = lastCooked ? detectPrimaryProtein({ name: lastCooked, ingredients: [] }) : null
    const because = cookedProtein && cookedProtein !== 'other'
      ? claim(browseGrid.filter(m => detectPrimaryProtein(m) === cookedProtein), PERSONAL_CAP)
      : []

    const fits = budget?.hasLogged
      ? claim(browseGrid.filter(m =>
          m.calories > 0 && m.calories <= budget.calLeft &&
          (budget.proLeft <= 0 || m.protein >= budget.proLeft * 0.4)), PERSONAL_CAP)
      : []

    // ── Today. One section, not a rail plus a leftovers grid: the rail took 10 and today's batch
    // is 8-15, so "More from today" was empty by construction and the two names described one set.
    const today = claim(browseGrid.filter(m => m.generated_at?.startsWith(todayStr)), 18)

    // ── Intent shelves ──
    // Shelf COUNT scales with the pool. Four shelves over 35 meals leaves two-item sections that
    // read as a broken feed; the same four over 450 leaves everything in the catch-all. 2 / 4 / 6.
    const shelfBudget = browseGrid.length >= 200 ? 6 : browseGrid.length >= 60 ? 4 : 2

    // Tag shelves first (they're the identity of the dish), then the factual ones. Rotated so the
    // page differs tomorrow; claims happen ONLY for shelves that render, and a shelf that comes up
    // short releases its meals back — claiming for a shelf nobody sees would orphan those meals
    // out of Everything else too.
    const tagShelves = Object.keys(SHELF_TITLES)
      .map(tag => ({ key: `tag-${tag}`, title: SHELF_TITLES[tag], match: (m: DiscoverMeal) => shelfTagOf(m) === tag }))
    const allShelves = [...tagShelves, ...FACT_SHELVES]
    const rot = dayOfYear % allShelves.length
    const rotatedOrder = [...allShelves.slice(rot), ...allShelves.slice(0, rot)]

    const intent: { key: string; title: string; meals: DiscoverMeal[] }[] = []
    for (const shelf of rotatedOrder) {
      if (intent.length >= shelfBudget) break
      const meals = claim(browseGrid.filter(shelf.match), 12)
      if (meals.length >= 2) intent.push({ key: shelf.key, title: shelf.title, meals })
      else meals.forEach(m => taken.delete(m.id))
    }

    const leftovers = browseGrid.filter(m => !taken.has(m.id))

    return [
      { key: 'nearly', title: 'Almost in your kitchen', meals: nearly, accent: true },
      { key: 'because', title: `Because you cooked ${lastCooked ?? ''}`.trim(), meals: because, accent: true },
      { key: 'fits', title: `Fits your remaining ${budget?.calLeft ?? 0} kcal`, meals: fits, accent: true },
      { key: 'today', title: "Today's picks", meals: today, accent: false },
      ...intent.map(sec => ({ ...sec, accent: false })),
      { key: 'other', title: 'Everything else', meals: leftovers, accent: false },
    ].filter(sec => sec.meals.length > 0)
  }, [browseGrid, budget, pantryNames, lastCooked])

  // Per-meal missing counts for the "Almost in your kitchen" badges. Recomputed with the same
  // inputs as the section itself so the two can't disagree.
  const missingByMeal = useMemo(() => {
    if (pantryNames.size === 0) return new Map<string, number>()
    return new Map(browseGrid.map(m => [m.id, missingCount(m, pantryNames)]))
  }, [browseGrid, pantryNames])

  // Per-section paging: each section reveals GRID_PAGE at a time. Keeps a 400-meal pool from
  // mounting 400 image cards at once, and keeps each section's header reachable by scroll.
  const [expandedSections, setExpandedSections] = useState<Record<string, number>>({})
  // "Everything else" is the browse-everything bucket, not a curated shelf — at a mature pool it
  // holds hundreds, and revealing 6 at a time would be ~66 taps to reach the end. Curated shelves
  // stay at 6 so the page remains scannable; only the remainder pages in big chunks.
  const pageSizeFor = (key: string) => (key === 'other' ? 24 : GRID_PAGE)
  // A full-width "Show 1 more" button costs a row of vertical space and a tap to reveal a single
  // card — more attention than the card is worth, and it makes two shelves of the same size look
  // inconsistent depending on whether the tail happened to land at 6 or 7. Absorb a tail of <=2
  // into the first page so the button only ever appears for a meaningful batch.
  //
  // Personalised shelves cap at 8 and page at 6, so a 7- or 8-meal shelf hit this on almost every
  // load; that is the "why does one say Show 1 more and the other doesn't" case.
  const shownCount = (key: string, total: number) => {
    const base = expandedSections[key] ?? pageSizeFor(key)
    return total - base <= 2 ? total : base
  }

  // Impression tracking. Fired on VIEWPORT ENTRY, not on render — the grid renders sections far
  // below the fold, so counting a render as a view would inflate the denominator and make every
  // shelf's CTR look worse than it is. A wrong impression count is more damaging than none.
  // Fires at most once per section per mount; re-entering a section while scrolling isn't a new
  // impression.
  const sectionRects = useRef<Record<string, { y: number; h: number }>>({})
  const firedSections = useRef<Set<string>>(new Set())
  const scrollViewH = useRef(0)
  const onDiscoverScroll = useCallback((offsetY: number) => {
    for (const [key, rect] of Object.entries(sectionRects.current)) {
      if (firedSections.current.has(key)) continue
      const visible = rect.y < offsetY + scrollViewH.current && rect.y + rect.h > offsetY
      if (!visible) continue
      const sec = browseSectionsRef.current.find(x => x.key === key)
      if (!sec) continue
      firedSections.current.add(key)
      trackMealImpressions(key, sec.meals.slice(0, shownCount(key, sec.meals.length)).map(m => m.id), 'discover_grid')
    }
  }, [expandedSections])
  // Ref mirror so the scroll handler isn't re-created on every section change.
  const browseSectionsRef = useRef<typeof browseSections>([])

  // Attribution rides along in the route params so the detail screen can stamp a log with where
  // the user actually came from. Passing it here rather than reading it on the other side is the
  // only place that knows the shelf and the rank.
  useEffect(() => { browseSectionsRef.current = browseSections }, [browseSections])

  const openMeal = (meal: DiscoverMeal, source: MealSource, shelfKey?: string, position?: number) => {
    trackMealViewed(meal.name, { source, shelfKey, position })
    router.push({
      pathname: '/meal/[id]',
      params: {
        id: meal.id,
        mealData: JSON.stringify(meal),
        source,
        ...(shelfKey ? { shelfKey } : {}),
        ...(position !== undefined ? { position: String(position) } : {}),
      },
    })
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={250}
        onLayout={e => { scrollViewH.current = e.nativeEvent.layout.height }}
        onScroll={e => onDiscoverScroll(e.nativeEvent.contentOffset.y)}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor="#4ADE80" colors={['#4ADE80']} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Discover</Text>
          <Text style={styles.contextLine}>{contextLine}</Text>
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {FILTERS.map(f => {
            const active = activeFilter === f
            return (
              <PressableScale
                key={f}
                onPress={() => setActiveFilter(f)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
              </PressableScale>
            )
          })}
        </ScrollView>

        {/* Featured hero */}
        {loading ? (
          <View style={[styles.featuredHero, styles.featuredSkeleton]}>
            <Compass size={32} stroke="#333" strokeWidth={1.5} />
          </View>
        ) : featured ? (
          <Animated.View entering={FadeIn.duration(350)}>
          <PressableScale
            style={styles.featuredHero}
            scaleTo={0.98}
            onPress={() => openMeal(featured, 'discover_featured')}
          >
            {featured.image && featured.image.startsWith('http') ? (
              <MealImage uri={featured.image} style={styles.featuredImage} recyclingKey={String(featured.id)} priority="high" />
            ) : (
              <View style={[styles.featuredImage, styles.featuredImagePlaceholder]}>
                <Utensils size={36} stroke="#444" strokeWidth={1.4} />
              </View>
            )}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.92)']}
              locations={[0.25, 0.6, 1]}
              style={styles.featuredGradient}
            />
            <View style={styles.featuredBadge}>
              <Flame size={11} stroke="#000" fill="#000" strokeWidth={2} />
              <Text style={styles.featuredBadgeText}>FEATURED</Text>
            </View>
            <View style={styles.featuredContent}>
              <Text style={styles.featuredName} numberOfLines={2}>{featured.name}</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
                {featured.prepTime > 0 && <Pill label={`${featured.prepTime} MIN`} tint="amber" />}
                <Pill label={`${featured.calories} CAL`} tint="white" />
                {featured.protein > 0 && <Pill label={`${featured.protein}P`} tint="green" />}
              </View>
            </View>
          </PressableScale>
          </Animated.View>
        ) : null}

        {/* Trending Now rail — YouTube-sourced editorial-trendy recipes */}
        {/* The "Today's picks" rail is gone — it lived here. A 10-item horizontal rail showed ~2.5
            meals and consumed the entire daily batch (8-15), leaving the grid section beneath it
            empty by construction. It's now a normal grid section like everything else, so the page
            has one scroll direction and nothing hides behind a sideways gesture. The hero above
            remains the single "display" moment. */}
        {!loading && CREATOR_SHELF_ENABLED && (creatorRail.length > 0 || promoActive) && (
          <View style={{ marginTop: 28 }}>
            <View style={styles.railHeader}>
              <Text style={styles.sectionTitle}>From Creators</Text>
              {promoActive && (
                <PressableScale onPress={() => setShowCreatorModal(true)} hitSlop={10}>
                  <Plus size={18} color="#4ADE80" strokeWidth={2.5} />
                </PressableScale>
              )}
            </View>
            {creatorRail.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}
              >
                {creatorRail.map((meal, index) => (
                  <Animated.View key={meal.id} entering={FadeInDown.duration(260).delay(Math.min(index, 8) * 40)}>
                    <RailCard meal={meal} onPress={() => openMeal(meal, 'discover_rail', 'creators', index)} />
                  </Animated.View>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.creatorRailEmpty}>No creator recipes yet — tap + to post one.</Text>
            )}
          </View>
        )}

        {/* Browse grid — everything the curated rails didn't surface. Rails answer "what should I
            look at"; a grid answers "show me everything", which is the mode someone is in when they
            open Discover to explore rather than to be told. Two columns so the image still carries
            the card, unlike a dense list. */}
        {!loading && browseSections.map(section => {
          const shown = shownCount(section.key, section.meals.length)
          const visible = section.meals.slice(0, shown)
          const remaining = section.meals.length - visible.length
          return (
            <View
              key={section.key}
              style={{ marginTop: 28 }}
              onLayout={e => { const { y, height } = e.nativeEvent.layout; sectionRects.current[section.key] = { y, h: height } }}
            >
              <View style={styles.sectionHeader}>
                {/* Hierarchy comes from the HEADER, not from switching scroll direction. The
                    personalised shelves are marked with a short accent rule rather than by
                    recolouring the whole title — one small green element per shelf instead of a
                    full line of green, which is what made three adjacent "for you" shelves shout. */}
                {(section as any).accent && <View style={styles.sectionAccentRule} />}
                <Text style={styles.sectionTitle} numberOfLines={2}>{section.title}</Text>
              </View>
              <View style={styles.browseGrid}>
                {visible.map((meal, index) => (
                  <Animated.View
                    key={meal.id}
                    style={styles.browseCell}
                    // Cap the stagger index: past ~12 the delay would make the tail of a long
                    // section visibly crawl in after the user has already scrolled to it.
                    entering={FadeInDown.duration(240).delay(Math.min(index, 12) * 30)}
                  >
                    <RailCard
                      meal={meal}
                      onPress={() => openMeal(meal, 'discover_grid', section.key, index)}
                      full
                      badge={section.key === 'nearly'
                        ? (missingByMeal.get(meal.id) === 0 ? 'Have it all' : `Missing ${missingByMeal.get(meal.id)}`)
                        : undefined}
                    />
                  </Animated.View>
                ))}
              </View>
              {remaining > 0 && (
                <PressableScale
                  style={styles.showMoreBtn}
                  scaleTo={0.98}
                  onPress={() => setExpandedSections(prev => ({ ...prev, [section.key]: shown + pageSizeFor(section.key) }))}
                >
                  <Text style={styles.showMoreText}>Show {Math.min(remaining, pageSizeFor(section.key))} more</Text>
                </PressableScale>
              )}
            </View>
          )
        })}

        {/* Empty states — distinguish "nothing trending at all" from "filter narrowed to zero" */}
        {!loading && trending.length === 0 && (
          <View style={styles.emptyState}>
            <Compass size={36} stroke={COLORS.textMuted} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No trending recipes yet</Text>
            <Text style={styles.emptySub}>Check back tomorrow — new picks drop daily.</Text>
          </View>
        )}
        {!loading && trending.length > 0 && filtered.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No {activeFilter} recipes right now</Text>
            <Text style={styles.emptySub}>Try a different filter — the daily pool changes every morning.</Text>
            <PressableScale
              onPress={() => setActiveFilter('All')}
              style={styles.emptyResetBtn}
              haptic
            >
              <Text style={styles.emptyResetText}>Show all recipes</Text>
            </PressableScale>
          </View>
        )}
      </ScrollView>

      <CreatorRecipeModal
        visible={showCreatorModal}
        mealToEdit={null}
        onClose={() => setShowCreatorModal(false)}
        onSubmitted={() => {
          setShowCreatorModal(false)
          fetchTrending()
        }}
      />
    </SafeAreaView>
  )
}

// Creator social links are user-submitted and written straight to the DB, so a
// malicious creator could store a javascript:/file:/custom-scheme URL — Linking.openURL
// on that is an injection vector. Only follow plain http(s) web links; ignore the rest.
function safeOpenSocialUrl(url: string) {
  if (/^https?:\/\//i.test(url)) Linking.openURL(url).catch(() => {})
}

// Reusable rail card — same dimensions for both Trending Now and From Creators
// rails so the two shelves visually rhyme.
function RailCard({ meal, onPress, full, badge }: { meal: DiscoverMeal; onPress: () => void; full?: boolean; badge?: string }) {
  return (
    // `full` lets the browse grid drive the width from its cell instead of the rail's fixed 175.
    <PressableScale style={[styles.railCard, full && { width: '100%' }]} scaleTo={0.98} onPress={onPress}>
      {meal.image && meal.image.startsWith('http') ? (
        <MealImage uri={meal.image} style={styles.railImage} recyclingKey={String(meal.id)} />
      ) : (
        <View style={[styles.railImage, styles.featuredImagePlaceholder]}>
          <Utensils size={28} stroke="#444" strokeWidth={1.4} />
        </View>
      )}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.92)']} locations={[0.3, 1]} style={styles.railGradient} />
      {/* Top-left badge — used by "Almost in your kitchen" to state how many ingredients are
          missing, so a card ranked 5th isn't implying you can cook it right now. */}
      {badge && (
        <View style={styles.cardBadge}><Text style={styles.cardBadgeText}>{badge}</Text></View>
      )}
      {meal.creator && (() => {
        const socialUrl = meal.creator.instagram_url || meal.creator.tiktok_url || meal.creator.youtube_url
        const badge = (
          <View style={styles.creatorBadge}>
            {meal.creator.avatar_url ? (
              <Image source={{ uri: meal.creator.avatar_url }} style={styles.creatorAvatar} />
            ) : null}
            <Text style={styles.creatorHandle}>@{meal.creator.handle}</Text>
          </View>
        )
        return socialUrl
          ? <PressableScale scaleTo={0.98} onPress={() => safeOpenSocialUrl(socialUrl)}>{badge}</PressableScale>
          : badge
      })()}
      <View style={styles.railContent}>
        <Text style={styles.railName} numberOfLines={2}>{meal.name}</Text>
        {/* "CAL" is back. Rather than shaving font size (which was already at 10 and is the last
            thing that should give), the row reclaims 8px with a negative margin — the title keeps
            its comfortable 10px inset while the pills get the card's full width — and the suffix
            is dropped ONLY when the actual numbers wouldn't fit. Normal recipes (250-600 kcal,
            2-digit protein) keep "450 CAL"; a 4-digit calorie count falls back to the bare number
            instead of wrapping. Deterministic per-recipe, so it can't wrap on an unlucky day. */}
        {(() => {
          const timeLabel = `${meal.prepTime} min`
          const protLabel = `${meal.protein}P`
          const labels = [
            ...(meal.prepTime > 0 ? [timeLabel] : []),
            ...(meal.protein > 0 ? [protLabel] : []),
          ]
          const calLabel = fitsPillRow([...labels, `${meal.calories} CAL`])
            ? `${meal.calories} CAL`
            : `${meal.calories}`
          return (
            <View style={{ flexDirection: 'row', gap: 3, marginTop: 6, marginHorizontal: -4, flexWrap: 'wrap' }}>
              {meal.prepTime > 0 && <Pill label={timeLabel} tint="amber" small />}
              <Pill label={calLabel} tint="white" small />
              {meal.protein > 0 && <Pill label={protLabel} tint="green" small />}
              {meal.log_count >= 10 && <Pill label={`${meal.log_count} cooked`} tint="teal" small />}
            </View>
          )
        })()}
      </View>
    </PressableScale>
  )
}

// Tinted pill — single component instead of inline-styling per call site.
function Pill({ label, tint, small }: { label: string; tint: 'amber' | 'green' | 'teal' | 'white'; small?: boolean }) {
  const tintMap = {
    amber: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.25)', color: '#F59E0B' },
    green: { bg: 'rgba(74,222,128,0.15)', border: 'rgba(74,222,128,0.25)', color: '#4ADE80' },
    teal:  { bg: 'rgba(0,201,167,0.15)',  border: 'rgba(0,201,167,0.25)',  color: '#00C9A7' },
    white: { bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.15)', color: COLORS.textWhite },
  }[tint]
  return (
    <View style={[
      styles.pill,
      small && { paddingHorizontal: 6 },
      { backgroundColor: tintMap.bg, borderColor: tintMap.border },
    ]}>
      <Text style={[
        styles.pillText,
        small && { letterSpacing: 0.4 },
        { color: tintMap.color },
      ]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },

  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.5,
  },

  chipsRow: {
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 18,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  chipActive: {
    backgroundColor: COLORS.textWhite,
    borderColor: COLORS.textWhite,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: -0.1,
  },
  chipTextActive: {
    color: '#000000',
  },

  featuredHero: {
    marginHorizontal: 20,
    marginTop: 4,
    height: 340,
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1A1A1A',
  },
  featuredSkeleton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  featuredImagePlaceholder: {
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 240,
  },
  featuredBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#4ADE80',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  featuredBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1.2,
  },
  featuredContent: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
  },
  featuredName: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textWhite,
    lineHeight: 26,
    letterSpacing: -0.4,
  },

  browseGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 14 },
  browseCell: { width: GRID_CELL_W },
  // Section headers read as editorial headlines, not as system labels. The previous treatment
  // (12px, ALL CAPS, letterSpacing 2, accent green) is the standard generated-UI tell: it shouts,
  // and it fights the food photography for attention. Sentence case at 22 with negative tracking
  // is how a recipe title is set in print, and it lets the images carry the colour.
  //
  // The "N meals" count that used to sit at the right is gone. It kept clipping (the flex fix was
  // correct in source but still overflowed on device), it duplicated the "Show N more" button
  // directly below, and a muted integer pinned to the right edge is dashboard furniture.
  cardBadge: {
    position: 'absolute', top: 8, left: 8, zIndex: 2, borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1, borderColor: 'rgba(74,222,128,0.35)',
  },
  cardBadgeText: { fontSize: 10, fontWeight: '800', color: COLORS.accent, letterSpacing: 0.3 },
  contextLine: { fontSize: 13, color: COLORS.accent, fontWeight: '600', marginTop: 2, letterSpacing: 0.2 },
  showMoreBtn: {
    marginHorizontal: 20, marginTop: 14, paddingVertical: 12, borderRadius: 24,
    borderWidth: 1, borderColor: COLORS.trackDark, alignItems: 'center',
  },
  showMoreText: { fontSize: 14, fontWeight: '700', color: COLORS.textWhite },

  railHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 14,
  },
  creatorRailEmpty: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sectionHeader: {
    marginHorizontal: 20,
    marginBottom: 14,
  },
  // A 24pt rule, not a recoloured title — marks the shelf as personalised using one small piece of
  // accent instead of a whole green sentence.
  sectionAccentRule: {
    width: 24,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.accent,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.5,
    lineHeight: 27,
    // No flex/marginRight needed any more: this is the only child in a column header, so there is
    // no sibling left for a long dish name to squeeze off the edge.
  },
  railCard: {
    width: 175,
    height: 225,
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1A1A1A',
  },
  railImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    opacity: 0.85,
  },
  railGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '70%',
  },
  railContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // Was 4 — squeezed down in an earlier attempt to stop the pill row wrapping, which ran the
    // title right to the card edge and still didn't fix the wrap. The pill labels themselves are
    // what got shortened instead (see RailCard), so this can go back to a normal inset.
    paddingHorizontal: 10,
    paddingVertical: 14,
  },
  railName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.2,
    lineHeight: 18,
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  creatorBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 14,
    paddingHorizontal: 7,
    paddingVertical: 3,
    zIndex: 2,
  },
  creatorAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  creatorHandle: {
    fontSize: 10,
    color: COLORS.textWhite,
    fontWeight: '700',
  },

  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  emptySub: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyResetBtn: {
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: COLORS.textWhite,
  },
  emptyResetText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000',
  },
})
