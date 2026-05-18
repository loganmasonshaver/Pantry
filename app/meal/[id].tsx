import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  Dimensions,
  Image,
  Animated,
  Linking,
} from 'react-native'
let Haptics: any = null
try { Haptics = require('expo-haptics') } catch {}
const hapticSelection = () => Haptics?.selectionAsync?.().catch?.(() => {})
const hapticImpact = () => Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Medium).catch?.(() => {})
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Utensils, Clock, Pencil, Check, X, ShoppingCart, ThumbsUp, ThumbsDown, User, Instagram, Youtube } from 'lucide-react-native'
import RecipeFormModal from '@/components/RecipeFormModal'
import CreatorRecipeModal from '@/components/CreatorRecipeModal'
import { LinearGradient } from 'expo-linear-gradient'
import { COLORS } from '@/constants/colors'
import { autoCategoryMatches } from '@/lib/categories'
import { MOCK_MEAL_DETAILS, MealDetail } from '@/constants/mock'
import { templates as recipeTemplates } from '@/lib/recipeTemplates'
import { GeneratedMeal } from '../../lib/meals'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePremium } from '../../context/SuperwallContext'
import { useSuperwall } from 'expo-superwall'
import { trackMealViewed, trackMealSaved, trackMealSaveBlocked, trackMealLogged, trackUpgradePromptShown } from '../../lib/analytics'

const screenWidth = Dimensions.get('window').width

// "Measured" = grams + tbsp/cups (needs a scale or measuring spoon).
// "Eyeball"  = whole-unit count + descriptors like "a drizzle", "a handful"
//              (no measuring tools needed). Templates store grams + visual fields;
//              the toEyeball() helper transforms measurement units to descriptors
//              on the fly based on ingredient name.
type PortionMode = 'Eyeball' | 'Measured'

// Common cooking basics that everyone has — don't count as "missing"
const COOKING_BASICS = new Set(['salt', 'pepper', 'black pepper', 'water', 'cooking spray'])

function cleanIngredientName(name: string): string {
  return name
    .replace(/\s*\*\s*$/, '')          // strip trailing asterisk
    .replace(/^\d+[\s/.-]*/g, '')       // strip leading numbers ("4 eggs" → "eggs")
    .replace(/^[\d½¼¾⅓⅔]+\s*/g, '')   // strip unicode fractions
    .trim()
}

// Strips quantities, units, and articles from any ingredient string for image lookup.
// "1/2 an avocado" → "avocado", "200g chicken breast" → "chicken breast"
function extractFoodName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s*\*\s*$/, '')
    // leading number + optional fraction + optional unit
    .replace(/^\d+\s*\/\s*\d+\s*/g, '')   // "1/2 "
    .replace(/^\d+[\s.,-]*/g, '')          // "200 ", "2. "
    .replace(/^[\d½¼¾⅓⅔]+\s*/g, '')       // unicode fractions
    // measurement units
    .replace(/^(kg|g|oz|lb|lbs|ml|l|cup|cups|tbsp|tsp|tablespoon|teaspoon|handful|pinch|dash|slice|slices|piece|pieces|clove|cloves|can|bunch|sprig|sprigs|stalk|stalks|head|heads|sheet|sheets)\s+(of\s+)?/gi, '')
    // leading articles and quantity words
    .replace(/^(a|an|the|half|quarter|some|few)\s+(of\s+)?(an?\s+)?/gi, '')
    .trim()
}

function isNeedToBuy(name: string): boolean {
  return name.trim().endsWith('*')
}

// Strip cooking adjectives for better matching
const COOKING_ADJECTIVES = ['grilled', 'baked', 'fried', 'roasted', 'steamed', 'sauteed', 'sautéed', 'boiled', 'raw', 'fresh', 'dried', 'diced', 'chopped', 'sliced', 'minced', 'shredded', 'cooked', 'uncooked', 'whole', 'boneless', 'skinless']

// Foods that should display as a whole-unit COUNT rather than grams.
// Recipe scaling produces awkward weights ("233g eggs" = 4.66 eggs) — this
// converts them back to natural cooking units. Weights from USDA averages.
// Regex matches the food noun (singular/plural) so adjectives in the source
// name ("large eggs", "ripe avocado") survive and can be rendered alongside.
const WHOLE_UNIT_FOODS: Array<{ match: RegExp; weight: number; singular: string; plural: string }> = [
  { match: /\beggs?\b/i,            weight: 50,  singular: 'egg',         plural: 'eggs' },
  { match: /\bbananas?\b/i,         weight: 120, singular: 'banana',      plural: 'bananas' },
  { match: /\bapples?\b/i,          weight: 180, singular: 'apple',       plural: 'apples' },
  { match: /\blemons?\b/i,          weight: 60,  singular: 'lemon',       plural: 'lemons' },
  { match: /\blimes?\b/i,           weight: 67,  singular: 'lime',        plural: 'limes' },
  { match: /\bavocados?\b/i,        weight: 200, singular: 'avocado',     plural: 'avocados' },
  { match: /\bcloves?\b/i,          weight: 5,   singular: 'garlic clove', plural: 'garlic cloves' },
  { match: /\btortillas?\b/i,       weight: 60,  singular: 'tortilla',    plural: 'tortillas' },
]

// Returns { count, name } when the ingredient is a whole-unit food (so the
// render can show "5" + "large eggs" without doubling up the noun), or null
// to fall back to the standard portion + ing.name pair.
function getWholeUnitDisplay(name: string, gramsStr: string | undefined): { count: string; name: string } | null {
  if (!gramsStr) return null
  const grams = parseFloat(String(gramsStr).replace(/[^0-9.]/g, '')) || 0
  if (grams <= 0) return null

  // Special case: bread. Unit ("slice") differs from food ("bread") so the
  // standard "{adj} {noun}" format produces awkward word order. Render as
  // "3 slices of whole grain bread" instead.
  if (/\bbread\b/i.test(name)) {
    const c = Math.max(1, Math.round(grams / 30))
    const adj = name.replace(/\bbread\b/i, '').trim().replace(/\s+/g, ' ')
    const unit = c === 1 ? 'slice' : 'slices'
    return {
      count: String(c),
      name: adj ? `${unit} of ${adj} bread` : `${unit} of bread`,
    }
  }

  const match = WHOLE_UNIT_FOODS.find(w => w.match.test(name))
  if (!match) return null
  const c = Math.max(1, Math.round(grams / match.weight))
  const noun = c === 1 ? match.singular : match.plural
  // Strip the matched noun (e.g., "eggs") from the original name to get the
  // adjective ("large"). If the noun match consumed the whole name, just show
  // the noun by itself ("3 garlic cloves" with name="cloves" → name has no adj).
  const adj = name.replace(match.match, '').trim().replace(/\s+/g, ' ')
  return {
    count: String(c),
    name: adj ? `${adj} ${noun}` : noun,
  }
}

// Approximate g/tsp for powdered spices (paprika, cumin, etc.). Salt is denser
// (~6g/tsp) and gets a special case. Good enough for cooking; not lab-grade.
function gramsToSpiceTsp(name: string, grams: number): string {
  const gPerTsp = /\bsalt\b/i.test(name) ? 6 : 2
  const tsp = grams / gPerTsp
  if (tsp <= 0.18) return '1/8 tsp'
  if (tsp <= 0.37) return '1/4 tsp'
  if (tsp <= 0.62) return '1/2 tsp'
  if (tsp <= 0.87) return '3/4 tsp'
  if (tsp <= 1.25) return '1 tsp'
  if (tsp <= 1.75) return '1 1/2 tsp'
  if (tsp <= 2.5)  return '2 tsp'
  if (tsp <= 3.5)  return '1 tbsp'
  return `${Math.round(tsp / 3 * 2) / 2} tbsp`
}

// For Measured mode: oils, sauces, seasonings, spices etc. are universally
// measured in tbsp/tsp/cups, not grams. Three-tier resolution:
//   1. Volume-measured ingredient + visual has a real unit → use visual
//   2. Seasoning with no usable visual → convert grams to tsp (gramsToSpiceTsp)
//   3. Fall back to grams (or visual as a last resort)
function getMeasuredDisplay(name: string, gramsStr: string | undefined, visualStr: string | undefined): string {
  const n = name.toLowerCase()
  const isLiquid = /\b(oil|vinegar|sauce|dressing|honey|syrup|extract|juice|milk|broth|stock|wine|tahini|mayo|mustard|cream)\b/.test(n)
  const isSeasoning = /\b(salt|pepper|paprika|cumin|cinnamon|turmeric|oregano|thyme|basil|rosemary|parsley|cilantro|dill|chili|spice|powder|seasoning|flakes?|herbs?|sweetener|stevia|sugar)\b/.test(n)

  // Tier 1: prefer template visual if it has a real measurement unit
  // (NOT "pinch"/"dash" — those are descriptors that belong in Eyeball).
  if ((isLiquid || isSeasoning) && visualStr && /(tbsp|tablespoons?|tsp|teaspoons?|cups?|ml|oz|ounces?)/i.test(visualStr)) {
    return visualStr
  }

  // Tier 2: seasoning fell through tier 1 (template likely has "a pinch" or
  // similar). Compute a tsp/tbsp from grams so Measured stays measurement-y.
  if (isSeasoning && gramsStr) {
    const grams = parseFloat(String(gramsStr).replace(/[^0-9.]/g, '')) || 0
    if (grams > 0) return gramsToSpiceTsp(name, grams)
  }

  // Tier 3: fall back to grams (or visual if no grams).
  return gramsStr || visualStr || ''
}

// Eyeball mode: convert measurement-unit visuals (1 tbsp, 1/2 cup) into
// no-tool descriptors based on what the ingredient is. Eggs/avocado/etc.
// are handled by getWholeUnitDisplay above; this covers everything else.
// Imperfect — a runtime heuristic, not human-curated copy — but enough that
// "Eyeball" mode doesn't tell users to pull out a measuring spoon.
function toEyeball(visualStr: string | undefined, ingredientName: string): string {
  if (!visualStr) return ''
  const v = visualStr.trim()
  const n = ingredientName.toLowerCase()

  // Already no-tool — counts of slices, cloves, pieces, etc.
  if (/^\d+(\.\d+)?\s*(slices?|cloves?|pieces?|sticks?|stalks?|sprigs?|leaves?|cubes?|wedges?)/i.test(v)) return v
  // "small/medium/large X" — already descriptive
  if (/^(a|an|small|medium|large|big|tiny)\b/i.test(v)) return v

  // tablespoons
  if (/\btbsp\b|\btablespoons?\b/i.test(v)) {
    if (/oil|honey|syrup|sauce|dressing|vinegar|juice|milk|cream/.test(n)) return 'a drizzle'
    if (/salt|pepper|cinnamon|paprika|cumin|turmeric|spice|seasoning/.test(n)) return 'a pinch'
    if (/butter|jam|tahini|hummus|pesto|mayo|mustard|peanut butter/.test(n)) return 'a dollop'
    if (/seeds|nuts|chia|flax/.test(n)) return 'a sprinkle'
    if (/sugar|sweetener|maple/.test(n)) return 'a small drizzle'
    return 'a small spoonful'
  }

  // teaspoons
  if (/\btsp\b|\bteaspoons?\b/i.test(v)) {
    if (/salt|pepper|cinnamon|paprika|cumin|turmeric|spice|seasoning|powder/.test(n)) return 'a pinch'
    if (/extract|vanilla/.test(n)) return 'a tiny splash'
    if (/oil|honey|syrup|sauce/.test(n)) return 'a small drizzle'
    return 'a tiny spoonful'
  }

  // cups
  if (/\bcups?\b|\bcup\b/i.test(v)) {
    if (/spinach|kale|lettuce|arugula|greens|herbs?|cilantro|parsley|basil/.test(n)) return 'a couple of handfuls'
    if (/rice|quinoa|pasta|noodle|grain|oats?|couscous/.test(n)) return 'a fist-sized portion'
    if (/yogurt|cottage cheese/.test(n)) return 'a generous scoop'
    if (/berries|fruit|grapes/.test(n)) return 'a big handful'
    if (/milk|broth|water|stock|juice/.test(n)) return 'a small glass'
    if (/cheese|nuts/.test(n)) return 'a handful'
    if (/beans|chickpeas|lentils/.test(n)) return 'a cupped handful'
    return 'a cupped handful'
  }

  // ounces (occasional in templates)
  if (/\boz\b|\bounces?\b/i.test(v)) {
    if (/chicken|beef|turkey|pork|salmon|tuna|cod|fish|tofu|tempeh/.test(n)) return 'palm-sized piece'
    return 'a small handful'
  }

  // raw grams — convert to body-part metaphor by ingredient type
  const grams = parseFloat(v) || 0
  if (grams > 0 && /^\d+(\.\d+)?\s*g\b/i.test(v)) {
    if (/chicken|beef|turkey|pork|salmon|tuna|cod|fish|tofu|tempeh|lamb|shrimp|scallop/.test(n)) {
      return grams < 150 ? 'small palm-sized piece' : grams > 220 ? 'large palm-sized piece' : 'palm-sized piece'
    }
    if (/rice|quinoa|pasta|noodle|grain|oats?|couscous/.test(n)) return 'a fist-sized portion'
    if (/spinach|kale|lettuce|arugula|greens|herbs?/.test(n)) return grams < 50 ? 'a small handful' : 'a couple of handfuls'
    if (/cheese|nuts|seeds/.test(n)) return 'a small handful'
    if (/berries|fruit/.test(n)) return 'a handful'
    if (/oil|butter|honey|syrup/.test(n)) return 'a drizzle'
  }

  // Fallback: leave as-is. Better than producing nonsense.
  return v
}

function stripAdjectives(name: string): string {
  let result = name.toLowerCase()
  for (const adj of COOKING_ADJECTIVES) {
    result = result.replace(new RegExp(`\\b${adj}\\b`, 'g'), '').trim()
  }
  return result.replace(/\s+/g, ' ').trim()
}

// Check if an item is already covered by existing names
function isAlreadyInList(itemName: string, existingNames: Set<string>): boolean {
  const lower = cleanIngredientName(itemName).toLowerCase()
  const stripped = stripAdjectives(lower)
  for (const existing of existingNames) {
    if (lower === existing || stripped === existing) return true
    if (lower.includes(existing) || existing.includes(lower)) return true
    if (stripped.includes(existing) || existing.includes(stripped)) return true
  }
  return false
}

// Strips creator-pasted leading numbers ("1.", "01)", "Step 1:") so they don't double up with the rendered step badge.
function stripStepNumber(text: string): string {
  return text
    .replace(/^step\s*\d+\s*[:.)]?\s*/i, '')
    .replace(/^\d+\s*[.):\-]+\s*/, '')
    .trim()
}

function renderStepContent(step: string | { title: string; detail: string }) {
  if (typeof step === 'object' && step.title) {
    return (
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>{stripStepNumber(step.title)}</Text>
        <Text style={{ fontSize: 14, color: '#F5F5F5', lineHeight: 22 }}>{step.detail}</Text>
      </View>
    )
  }
  const cleaned = stripStepNumber(typeof step === 'string' ? step : '')
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 14, color: '#F5F5F5', lineHeight: 22 }}>{cleaned}</Text>
    </View>
  )
}

export default function MealDetailScreen() {
  const { id, mealData } = useLocalSearchParams<{ id: string; mealData?: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const { isPremium, triggerUpgrade } = usePremium()
  const { registerPlacement } = useSuperwall()
  const SLOT_OPTIONS = ['Breakfast', 'Lunch', 'Dinner', 'Snack']
  const ITEM_HEIGHT = 50
  const getDefaultSlotIndex = () => {
    const h = new Date().getHours()
    if (h < 11) return 0
    if (h < 15) return 1
    if (h < 21) return 2
    return 3
  }
  const [showSlotPicker, setShowSlotPicker] = useState(false)
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(getDefaultSlotIndex())
  const [customSlotName, setCustomSlotName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logging, setLogging] = useState(false)
  const [logged, setLogged] = useState(false)
  const [userRating, setUserRating] = useState<1 | -1 | null>(null)
  const [ratingToast, setRatingToast] = useState<string | null>(null)
  const ratingToastOpacity = useRef(new Animated.Value(0)).current
  const [showEditForm, setShowEditForm] = useState(false)
  const [showCreatorEdit, setShowCreatorEdit] = useState(false)
  const [portionMode, setPortionMode] = useState<PortionMode>('Measured')
  const [addedToGrocery, setAddedToGrocery] = useState<Set<string>>(new Set())
  const [pantryNames, setPantryNames] = useState<Set<string>>(new Set())
  const [groceryNames, setGroceryNames] = useState<Set<string>>(new Set())
  const [ingredientImages, setIngredientImages] = useState<Record<string, string>>({})
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const slideAnim = useRef(new Animated.Value(0)).current // 0 = thumbnail, 1 = AI image

  // Normalize ambiguous ingredient names for image lookup
  const IMAGE_ALIASES: Record<string, string> = {
    'pepper': 'pepper',
    'oil': 'olive oil',
    'sugar': 'sugar',
    'flour': 'flour',
    'rice': 'rice',
    'cream': 'heavy cream',
    // Variations → cached image
    'broccoli florets': 'broccoli',
    'sweet potatoes': 'sweet potato',
    'lamb chops': 'lamb',
    'red kidney beans': 'kidney beans',
    'lemon juice': 'lemon',
    'lemon zest': 'lemon',
    'lime juice': 'lime',
    'lime zest': 'lime',
    'lean ground beef': 'ground beef',
    'extra lean ground beef': 'ground beef',
    'baby kale': 'kale',
    'baby spinach': 'spinach',
    'chopped spinach': 'spinach',
    'frozen spinach': 'spinach',
    'sauteed spinach': 'spinach',
    'persian cucumber': 'cucumber',
    'english cucumber': 'cucumber',
    'scallions': 'green onion',
    'spring onions': 'green onion',
    'fresh mint': 'mint',
    'fresh basil': 'basil',
    'fresh cilantro': 'cilantro',
    'fresh parsley': 'parsley',
    'fresh dill': 'dill',
    'fresh thyme': 'thyme',
    'fresh rosemary': 'rosemary',
    'fresh ginger': 'ginger',
    'cooked chicken': 'chicken breast',
    'cooked chicken breast': 'chicken breast',
    'shredded chicken': 'chicken breast',
    'rotisserie chicken': 'chicken breast',
    'grilled chicken': 'chicken breast',
    'plain greek yogurt': 'greek yogurt',
    'nonfat greek yogurt': 'greek yogurt',
    'low fat greek yogurt': 'greek yogurt',
    'vanilla greek yogurt': 'greek yogurt',
    'pickle juice': 'pickles',
    'chicken thighs': 'chicken thigh',
    'chicken breasts': 'chicken breast',
    'pork chops': 'pork chop',
    'salmon fillet': 'salmon',
    'salmon fillets': 'salmon',
    'red bell pepper': 'bell pepper',
    'green bell pepper': 'bell pepper',
    'yellow bell pepper': 'bell pepper',
    'cherry tomatoes': 'tomato',
    'roma tomatoes': 'tomato',
    'grape tomatoes': 'tomato',
    'diced tomatoes': 'tomato',
    'crushed tomatoes': 'tomato sauce',
    'white rice': 'rice',
    'jasmine rice': 'rice',
    'basmati rice': 'rice',
    'whole wheat pasta': 'pasta',
    'spaghetti': 'pasta',
    'penne': 'pasta',
    'rotini': 'pasta',
    'black pepper': 'pepper',
    'ground cumin': 'cumin',
    'ground cinnamon': 'cinnamon',
    'ground turmeric': 'turmeric',
    'smoked paprika': 'paprika',
    'extra virgin olive oil': 'olive oil',
    'evoo': 'olive oil',
    'low sodium soy sauce': 'soy sauce',
    'dijon mustard': 'mustard',
    'yellow mustard': 'mustard',
    'sea salt': 'salt',
    'kosher salt': 'salt',
    'garlic cloves': 'garlic',
    'minced garlic': 'garlic',
  }
  const normalizeForImage = (name: string) => {
    const lower = name.toLowerCase()
    if (IMAGE_ALIASES[lower]) return IMAGE_ALIASES[lower]
    // Fuzzy match: check if any alias key is contained in the name
    for (const [key, value] of Object.entries(IMAGE_ALIASES)) {
      if (lower.includes(key)) return value
    }
    return lower
  }

  // Fetch ingredient images from library + generate missing ones on-demand
  useEffect(() => {
    if (!meal) return
    const names = meal.ingredients.map(i => normalizeForImage(extractFoodName(i.name)))

    // Fetch existing images
    supabase.from('ingredient_images').select('name, image_url').in('name', names)
      .then(({ data }) => {
        const imageMap: Record<string, string> = {}
        data?.forEach(row => { imageMap[row.name] = row.image_url })
        setIngredientImages(imageMap)

        // Find ingredients not in library — generate on-demand
        const missing = names.filter(n => !data?.some(d => d.name === n))
        if (missing.length > 0) {
          generateMissingIngredientImages(missing)
        }
      })
  }, [meal?.name])

  const generateMissingIngredientImages = async (names: string[]) => {
    const failed: string[] = []
    for (const name of names) {
      try {
        const res = await supabase.functions.invoke('generate-ingredient-images', {
          body: { single: name },
        })
        if (res.data?.url) {
          setIngredientImages(prev => ({ ...prev, [name]: res.data.url }))
        } else {
          failed.push(name)
        }
      } catch { failed.push(name) }
      await new Promise(r => setTimeout(r, 500))
    }
    // Retry failed ones after a delay
    if (failed.length > 0) {
      await new Promise(r => setTimeout(r, 3000))
      for (const name of failed) {
        try {
          const res = await supabase.functions.invoke('generate-ingredient-images', {
            body: { single: name },
          })
          if (res.data?.url) {
            setIngredientImages(prev => ({ ...prev, [name]: res.data.url }))
          }
        } catch {}
        await new Promise(r => setTimeout(r, 500))
      }
    }
  }

  useEffect(() => {
    if (!user) return
    supabase.from('pantry_items').select('name').eq('user_id', user.id).eq('in_stock', true)
      .then(({ data }) => setPantryNames(new Set(data?.map(i => i.name.toLowerCase()) ?? [])))
    supabase.from('grocery_items').select('name').eq('user_id', user.id)
      .then(({ data }) => setGroceryNames(new Set(data?.map(i => i.name.toLowerCase()) ?? [])))
  }, [user])

  // Fetch this meal's existing rating so the UI reflects current state
  useEffect(() => {
    if (!user || !meal?.name) return
    supabase.from('meal_ratings').select('rating').eq('user_id', user.id).eq('meal_name', meal.name).maybeSingle()
      .then(({ data }) => setUserRating((data?.rating as 1 | -1 | undefined) ?? null))
  }, [user, mealData, id])

  const showRatingToast = (message: string) => {
    setRatingToast(message)
    Animated.sequence([
      Animated.timing(ratingToastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(ratingToastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setRatingToast(null))
  }

  const rateMeal = async (rating: 1 | -1) => {
    if (!user || !meal) return
    const prev = userRating
    const next = prev === rating ? null : rating
    setUserRating(next)
    if (next === null) {
      await supabase.from('meal_ratings').delete()
        .eq('user_id', user.id).eq('meal_name', meal.name)
    } else {
      await supabase.from('meal_ratings').upsert({
        user_id: user.id,
        meal_name: meal.name,
        rating: next,
      }, { onConflict: 'user_id,meal_name' })
      showRatingToast(next === 1 ? "Got it — we'll suggest more like this" : "Noted — we'll skip this kind of meal")
    }
    // Update vote_score on trending meals for creator recipes
    if ((meal as any).trend_source === 'creator' && id && !id.startsWith('mock')) {
      const delta = next === null ? -(prev ?? 0) : next - (prev ?? 0)
      if (delta !== 0) {
        supabase.rpc('increment_vote_score', { meal_id: id, delta }).then(() => {}, () => {})
      }
    }
  }

  // Auto-generate AI meal image if none provided (trending meals)
  useEffect(() => {
    if (!meal || meal.image || generatedImage) return
    const ingredientNames = meal.ingredients.map(i => i.name)

    const tryGenerate = (attempt = 0) => {
      supabase.functions.invoke('generate-meal-image', {
        body: { mealName: meal.name, ingredients: ingredientNames },
      }).then(({ data }) => {
        if (data?.image) {
          Image.prefetch(data.image).then(() => {
            setGeneratedImage(data.image)
            setTimeout(() => {
              Animated.timing(slideAnim, {
                toValue: 1,
                duration: 1400,
                useNativeDriver: true,
                easing: require('react-native').Easing.bezier(0.25, 0.1, 0.25, 1),
              }).start()
            }, 2000)
          }).catch(() => {
            setGeneratedImage(data.image)
          })
        } else if (attempt < 2) {
          setTimeout(() => tryGenerate(attempt + 1), 3000)
        }
      }).catch(() => {
        if (attempt < 2) setTimeout(() => tryGenerate(attempt + 1), 3000)
      })
    }
    tryGenerate()
  }, [meal?.name])

  const addToGrocery = async (ingredientName: string) => {
    if (!user || addedToGrocery.has(ingredientName)) return
    setAddedToGrocery(prev => new Set(prev).add(ingredientName))
    await supabase.from('grocery_items').insert({
      user_id: user.id,
      name: ingredientName,
      meal: meal?.name ?? '',
      category: autoCategoryMatches(ingredientName)[0] || 'Other',
      checked: false,
    })
  }

  const removeFromGrocery = async (ingredientName: string) => {
    if (!user) return
    setAddedToGrocery(prev => { const n = new Set(prev); n.delete(ingredientName); return n })
    // Only remove items linked to this meal, so we don't nuke items added from elsewhere
    await supabase.from('grocery_items')
      .delete()
      .eq('user_id', user.id)
      .ilike('name', ingredientName)
      .eq('meal', meal?.name ?? '')
      .eq('checked', false)
  }

  const toggleGrocery = (ingredientName: string) => {
    if (addedToGrocery.has(ingredientName)) removeFromGrocery(ingredientName)
    else addToGrocery(ingredientName)
  }

  const addToPantry = async (ingredientName: string) => {
    if (!user) return
    setPantryNames(prev => { const n = new Set(prev); n.add(ingredientName.toLowerCase()); return n })
    const { data: existing } = await supabase.from('pantry_items').select('id').eq('user_id', user.id).ilike('name', ingredientName).limit(1)
    if (existing && existing.length > 0) {
      await supabase.from('pantry_items').update({ in_stock: true }).eq('id', existing[0].id)
    } else {
      await supabase.from('pantry_items').insert({ user_id: user.id, name: ingredientName, category: autoCategoryMatches(ingredientName)[0] || 'Other', in_stock: true })
    }
  }

  const removeFromPantry = async (ingredientName: string) => {
    if (!user) return
    setPantryNames(prev => { const n = new Set(prev); n.delete(ingredientName.toLowerCase()); return n })
    await supabase.from('pantry_items').update({ in_stock: false }).eq('user_id', user.id).ilike('name', ingredientName)
  }

  const toggleHaveIt = (ingredientName: string) => {
    const inPantry = pantryNames.has(ingredientName.toLowerCase())
    if (inPantry) removeFromPantry(ingredientName)
    else addToPantry(ingredientName)
  }

  // Fallback DB lookup: when callers route via `{ id }` only (e.g. the home
  // "Your plan is ready" card), fetch the full row from saved_meals so we can
  // render without requiring serialized mealData on every tap path.
  const [fetchedMealData, setFetchedMealData] = useState<string | null>(null)
  const [fetchingMeal, setFetchingMeal] = useState(false)
  useEffect(() => {
    if (mealData || !id || !user) return
    let cancelled = false
    setFetchingMeal(true)
    supabase.from('saved_meals').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data) setFetchedMealData(JSON.stringify(data))
        setFetchingMeal(false)
      })
    return () => { cancelled = true }
  }, [id, mealData, user])
  const effectiveMealData = mealData || fetchedMealData

  let meal: MealDetail | null = null
  let isUserCreated = false
  if (effectiveMealData) {
    try {
      const generated: any = JSON.parse(effectiveMealData)
      isUserCreated = generated.is_user_created === true
      let rawIngredients: any[] = generated.ingredients ?? []
      let rawSteps: any[] = generated.steps ?? []
      // Backfill from recipe template if the saved row is missing recipe data
      // (legacy/broken meals from before the SPlanReveal scaling fix landed).
      // Scale ingredient grams to match the saved row's calorie count so portions
      // stay consistent with the macros the user already sees on the card.
      const needsBackfill = rawIngredients.length === 0 || rawSteps.length === 0
      const template = needsBackfill ? recipeTemplates[generated.name] : null
      if (template) {
        const savedCal = Number(generated.calories) || template.calories
        const scale = savedCal / (template.calories || savedCal)
        if (rawIngredients.length === 0) {
          rawIngredients = template.ingredients.map(ing => {
            const baseGrams = parseFloat(String(ing.grams).replace(/[^0-9.]/g, '')) || 0
            const unit = String(ing.grams).replace(/[0-9. ]/g, '') || 'g'
            return { name: ing.name, visual: ing.visual, grams: `${Math.round(baseGrams * scale)}${unit}` }
          })
        }
        if (rawSteps.length === 0) rawSteps = template.steps
        // Also backfill macros that may have been saved as 0 (carbs/fat in the
        // first batch of onboarding meals before the fix shipped).
        if (!generated.carbs) generated.carbs = Math.round((template.carbs || 0) * scale)
        if (!generated.fat) generated.fat = Math.round((template.fat || 0) * scale)
      }
      meal = {
        ...generated,
        carbs: generated.carbs,
        fat: generated.fat,
        steps: rawSteps,
        ingredients: rawIngredients.map((ing, i) => {
          // Plain strings (creator recipes) carry the full "1/2 avocado" text — preserve as-is.
          // Objects (AI-generated meals) have quantity in .visual/.grams, so clean the name.
          const isPlainString = typeof ing === 'string'
          const raw = isPlainString ? ing : (ing.name ?? '')
          return {
            id: String(i),
            visual: isPlainString ? undefined : ing.visual,
            grams: isPlainString ? undefined : ing.grams,
            name: isPlainString ? raw.replace(/\s*\*\s*$/, '').trim() : cleanIngredientName(raw),
            inPantry: true,
            needToBuy: isNeedToBuy(raw),
          }
        }),
      }
    } catch {
      meal = MOCK_MEAL_DETAILS[id ?? ''] ?? null
    }
  } else {
    meal = MOCK_MEAL_DETAILS[id ?? ''] ?? null
  }

  const creator = (meal as any)?.creator ?? null
  const isCreatorOwner = !!(creator?.user_id && creator.user_id === user?.id)
  const canEditMeal = isUserCreated || isCreatorOwner

  const missingIngredients = meal?.ingredients.filter(
    i => !isAlreadyInList(i.name, pantryNames) && !COOKING_BASICS.has(i.name.toLowerCase())
  ) ?? []
  const missingNotInGrocery = missingIngredients.filter(
    i => !isAlreadyInList(i.name, new Set([...groceryNames, ...[...addedToGrocery].map(n => n.toLowerCase())]))
  )

  const addAllMissingToGrocery = async () => {
    if (!user || !meal) return
    const alreadyAdded = new Set([...groceryNames, ...[...addedToGrocery].map(n => n.toLowerCase())])
    const toAdd = missingIngredients.filter(i => !isAlreadyInList(i.name, alreadyAdded))
    if (toAdd.length === 0) {
      Alert.alert('Already on your list', 'All missing ingredients are already in your grocery list.')
      return
    }
    setAddedToGrocery(prev => {
      const next = new Set(prev)
      toAdd.forEach(i => next.add(i.name))
      return next
    })
    setGroceryNames(prev => {
      const next = new Set(prev)
      toAdd.forEach(i => next.add(i.name.toLowerCase()))
      return next
    })
    await supabase.from('grocery_items').insert(
      toAdd.map(i => ({
        user_id: user.id,
        name: i.name,
        meal: meal.name,
        category: autoCategoryMatches(i.name)[0] || 'Other',
        checked: false,
      }))
    )
    Alert.alert('Added to grocery list', `${toAdd.length} item${toAdd.length !== 1 ? 's' : ''} added`)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (meal) trackMealViewed(meal.name) }, [mealData, id])

  // Slot-picker state — declared before any early returns to keep hook order stable.
  // Previously these lived below `handleSave` / `logToSlot` and crashed with
  // "rendered more hooks than during the previous render" when meal loaded async.
  const [showCustomInput, setShowCustomInput] = useState(false)
  const slotScrollRef = useRef<ScrollView>(null)
  const lastHapticIndex = useRef(-1)
  const onSlotScroll = useCallback((e: any) => {
    const y = e.nativeEvent.contentOffset.y
    const index = Math.round(y / ITEM_HEIGHT)
    const clamped = Math.max(0, Math.min(index, SLOT_OPTIONS.length - 1))
    if (clamped !== lastHapticIndex.current) {
      lastHapticIndex.current = clamped
      setSelectedSlotIndex(clamped)
      hapticSelection()
    }
  }, [])

  if (!meal) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.notFound}>{fetchingMeal ? 'Loading…' : 'Meal not found.'}</Text>
      </SafeAreaView>
    )
  }

  async function handleSave() {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in to save meals.')
      return
    }
    if (saved) return

    if (!isPremium) {
      const { count } = await supabase
        .from('saved_meals')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .then(r => ({ count: r.count ?? 0 }))
      if (count >= 3) {
        trackUpgradePromptShown('meal_save_limit')
        trackMealSaveBlocked()
        Alert.alert(
          'Upgrade to Premium',
          'Free accounts can save up to 3 meals. Upgrade for unlimited saves.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Upgrade', onPress: () => {
              triggerUpgrade('meal_save_limit')
            }},
          ]
        )
        return
      }
    }

    setSaving(true)
    // Persist the image so saved meals show the same photo as the original card
    // (prevents re-generation with a different prompt for trending meals)
    const imageToSave = meal!.image || generatedImage || null
    const { error } = await supabase.rpc('insert_saved_meal', {
      p_user_id: user.id,
      p_name: meal!.name,
      p_calories: meal!.calories,
      p_protein: meal!.protein,
      p_carbs: meal!.carbs,
      p_fat: meal!.fat,
      p_prep_time: meal!.prepTime ?? null,
      p_ingredients: meal!.ingredients,
      p_steps: meal!.steps,
      p_image_url: imageToSave,
    })
    setSaving(false)
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      setSaved(true)
      trackMealSaved(meal!.name, meal!.calories, meal!.protein)
    }
  }

  const logToSlot = async (slot: string) => {
    if (!user || !meal) return
    setLogging(true)
    const today = new Date().toISOString().split('T')[0]

    // Try to get cached image if we don't have one yet
    let mealImage = meal.image || generatedImage || null
    if (!mealImage) {
      const cacheKey = meal.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
      const { data: cached } = await supabase.from('image_cache').select('image_url').eq('meal_key', cacheKey).single()
      if (cached?.image_url) mealImage = cached.image_url
    }

    const { error } = await supabase.from('meal_logs').insert({
      user_id: user.id,
      meal_name: meal.name,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs ?? 0,
      fat: meal.fat ?? 0,
      slot,
      logged_at: today,
      meal_data: {
        name: meal.name,
        calories: meal.calories,
        protein: meal.protein,
        carbs: meal.carbs ?? 0,
        fat: meal.fat ?? 0,
        prepTime: meal.prepTime,
        ingredients: meal.ingredients,
        steps: meal.steps,
        image: mealImage,
      },
    })
    setLogging(false)
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      setLogged(true)
      trackMealLogged(slot, meal.calories, meal.protein)
      setTimeout(() => router.back(), 800)
    }
  }

  const handleLog = () => {
    if (!meal || logged) return
    const defaultIdx = getDefaultSlotIndex()
    setSelectedSlotIndex(defaultIdx)
    setShowCustomInput(false)
    setCustomSlotName('')
    lastHapticIndex.current = -1
    setShowSlotPicker(true)
    setTimeout(() => slotScrollRef.current?.scrollTo({ y: defaultIdx * ITEM_HEIGHT, animated: false }), 50)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <ChevronLeft size={24} stroke={COLORS.textWhite} strokeWidth={2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        {canEditMeal && (
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => (isCreatorOwner ? setShowCreatorEdit(true) : setShowEditForm(true))}
            activeOpacity={0.7}
          >
            <Pencil size={18} stroke={COLORS.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero image ── */}
        {(meal as any).thumbnailImage && !meal.image ? (
          /* Sliding hero: YouTube thumbnail slides out, AI image slides in */
          <View style={styles.heroContainer}>
            {/* AI image behind */}
            {generatedImage && (
              <Animated.View style={[StyleSheet.absoluteFill, {
                transform: [{ translateX: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [screenWidth, 0] }) }],
              }]}>
                <Image source={{ uri: generatedImage }} style={styles.heroImage} resizeMode="cover" />
              </Animated.View>
            )}
            {/* YouTube thumbnail on top, slides out */}
            <Animated.View style={[StyleSheet.absoluteFill, {
              transform: [{ translateX: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -screenWidth] }) }],
            }]}>
              <Image source={{ uri: (meal as any).thumbnailImage }} style={styles.heroImage} resizeMode="cover" />
            </Animated.View>
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.6)', '#000000']}
              locations={[0.3, 0.7, 1]}
              style={styles.heroGradient}
            />
          </View>
        ) : (meal.image || generatedImage) ? (
          <View style={styles.heroContainer}>
            <Image source={{ uri: meal.image || generatedImage! }} style={styles.heroImage} resizeMode="cover" />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.6)', '#000000']}
              locations={[0.3, 0.7, 1]}
              style={styles.heroGradient}
            />
          </View>
        ) : (
          <View style={styles.hero}>
            <Utensils size={40} stroke="#555555" strokeWidth={1.5} />
          </View>
        )}

        {/* ── Meal title + meta ── */}
        <View style={[styles.mealTitleSection, !(meal.image || generatedImage || (meal as any).thumbnailImage) && { marginTop: 16 }]}>
          <Text style={styles.mealTitleText}>{meal.name}</Text>
          <View style={styles.mealMetaRow}>
            {meal.prepTime != null && meal.prepTime > 0 && (
              <View style={styles.mealMetaPill}>
                <Clock size={14} stroke="#4ADE80" strokeWidth={2} />
                <Text style={styles.mealMetaPillText}>{meal.prepTime} min</Text>
              </View>
            )}
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={[styles.inlineRatingBtn, userRating === 1 && styles.inlineRatingBtnUp]}
              onPress={() => rateMeal(1)}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <ThumbsUp size={15} stroke={userRating === 1 ? '#4ADE80' : COLORS.textMuted} strokeWidth={2.2} fill={userRating === 1 ? 'rgba(74,222,128,0.2)' : 'none'} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.inlineRatingBtn, userRating === -1 && styles.inlineRatingBtnDown]}
              onPress={() => rateMeal(-1)}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <ThumbsDown size={15} stroke={userRating === -1 ? '#EF4444' : COLORS.textMuted} strokeWidth={2.2} fill={userRating === -1 ? 'rgba(239,68,68,0.2)' : 'none'} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Creator attribution ── */}
        {creator && (() => {
          const c = creator
          const socials: Array<{ key: string; url: string; bg: string; icon: JSX.Element }> = []
          if (c.instagram_url) socials.push({
            key: 'ig', url: c.instagram_url, bg: '#E1306C',
            icon: <Instagram size={15} stroke="#fff" strokeWidth={2.4} />,
          })
          if (c.tiktok_url) socials.push({
            key: 'tt', url: c.tiktok_url, bg: '#000',
            icon: <Text style={{ color: '#fff', fontSize: 17, fontWeight: '900', lineHeight: 19 }}>♪</Text>,
          })
          if (c.youtube_url) socials.push({
            key: 'yt', url: c.youtube_url, bg: '#FF0000',
            icon: <Youtube size={15} stroke="#fff" strokeWidth={2.4} fill="#fff" />,
          })
          const primarySocial = socials[0]?.url
          return (
            <View style={styles.creatorRow}>
              <TouchableOpacity
                style={styles.creatorIdentity}
                onPress={() => primarySocial && Linking.openURL(primarySocial)}
                disabled={!primarySocial}
                activeOpacity={primarySocial ? 0.7 : 1}
              >
                {c.avatar_url ? (
                  <Image source={{ uri: c.avatar_url }} style={styles.creatorAvatar} />
                ) : (
                  <View style={styles.creatorAvatarFallback}>
                    <User size={16} stroke="#888" strokeWidth={2.2} />
                  </View>
                )}
                <Text style={styles.creatorByText} numberOfLines={1}>
                  Recipe by <Text style={styles.creatorHandle}>@{c.handle}</Text>
                  {(meal as any).log_count >= 10 && (
                    <Text style={styles.creatorByText}> · {(meal as any).log_count} cooked</Text>
                  )}
                </Text>
              </TouchableOpacity>

              {socials.length > 0 && (
                <View style={styles.creatorSocialGroup}>
                  {socials.map(s => (
                    <TouchableOpacity
                      key={s.key}
                      onPress={() => Linking.openURL(s.url)}
                      style={[styles.creatorSocialBtn, { backgroundColor: s.bg }]}
                      activeOpacity={0.75}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      {s.icon}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )
        })()}

        {/* ── Macro bar ── */}
        {(() => {
          const correctedCal = meal.calories
          return (
            <View style={styles.macroBar}>
              {[
                { label: 'Kcal', value: String(correctedCal), color: '#4ADE80' },
                { label: 'Protein',  value: `${meal.protein}g`,   color: '#4ADE80' },
                { label: 'Carbs',    value: `${meal.carbs}g`,     color: '#F59E0B' },
                { label: 'Fat',      value: `${meal.fat}g`,       color: '#60A5FA' },
              ].map((stat, i, arr) => (
                <View key={stat.label} style={[styles.macroStat, i < arr.length - 1 && styles.macroStatBorder]}>
                  <Text style={[styles.macroValue, stat.label === 'Kcal' && { color: '#4ADE80' }]}>{stat.value}</Text>
                  <Text style={styles.macroLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>
          )
        })()}

        {/* Prep time shown in title section above */}

        {/* ── Ingredients ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Ingredients</Text>
            <View style={styles.pillToggle}>
              {(['Measured', 'Eyeball'] as PortionMode[]).map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.pillOption, portionMode === mode && styles.pillOptionActive]}
                  onPress={() => setPortionMode(mode)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.pillOptionText, portionMode === mode && styles.pillOptionTextActive]}>
                    {mode}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.ingredientList}>
            {meal.ingredients.map((ing, i) => {
              const inPantry = isAlreadyInList(ing.name, pantryNames)
              // Whole-unit foods (eggs, avocado, etc.) always display as count
              // regardless of mode — "233g eggs" reads weird in both modes.
              // Returns split count + adjectivized name so render shows
              // "5  large eggs" instead of redundant "5 eggs  large eggs".
              const wholeUnit = getWholeUnitDisplay(ing.name, ing.grams)
              const portion = wholeUnit
                ? wholeUnit.count
                : (portionMode === 'Eyeball'
                    ? toEyeball(ing.visual ?? ing.grams, ing.name)
                    : getMeasuredDisplay(ing.name, ing.grams, ing.visual))
              const displayName = wholeUnit ? wholeUnit.name : ing.name
              return (
                <View key={ing.id} style={styles.ingredientRow}>
                  {ingredientImages[normalizeForImage(extractFoodName(ing.name))] ? (
                    <Image source={{ uri: ingredientImages[normalizeForImage(extractFoodName(ing.name))] }} style={styles.ingredientThumb} />
                  ) : (
                    <View style={styles.ingredientThumbPlaceholder}>
                      <Text style={styles.ingredientThumbInitial}>{ing.name.charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <Text style={styles.ingredientLine} numberOfLines={1}>
                    <Text style={styles.ingredientPortionInline}>{portion}</Text>
                    <Text>  </Text>
                    <Text style={styles.ingredientNameInline}>{displayName}</Text>
                  </Text>
                  <View style={styles.ingredientActions}>
                    <TouchableOpacity
                      style={[styles.ingredientIconBtnSmall, inPantry && styles.ingredientIconBtnActiveBg]}
                      onPress={() => toggleHaveIt(ing.name)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                    >
                      <Check size={14} stroke={inPantry ? '#4ADE80' : '#888'} strokeWidth={2.2} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.ingredientIconBtnSmall, addedToGrocery.has(ing.name) && styles.ingredientIconBtnActive]}
                      onPress={() => toggleGrocery(ing.name)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                    >
                      <ShoppingCart size={14} stroke={addedToGrocery.has(ing.name) ? '#4ADE80' : '#888'} strokeWidth={2.2} />
                    </TouchableOpacity>
                  </View>
                </View>
              )
            })}
          </View>

        </View>

        {/* ── Steps ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { marginBottom: 16 }]}>Instructions</Text>
          <View style={styles.stepList}>
            {meal.steps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{i + 1}</Text>
                </View>
                {renderStepContent(step)}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* ── Rating feedback toast ── */}
      {ratingToast && (
        <Animated.View style={[styles.ratingToast, { opacity: ratingToastOpacity }]} pointerEvents="none">
          <Text style={styles.ratingToastText}>{ratingToast}</Text>
        </Animated.View>
      )}

      {/* ── Fixed bottom buttons ── */}
      <View style={styles.bottomBar}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            style={[styles.logButton, (logged || logging) && styles.logButtonDone]}
            activeOpacity={0.85}
            onPress={handleLog}
            disabled={logged || logging}
          >
            <Text style={styles.logButtonText}>
              {logging ? 'Logging…' : logged ? 'Logged ✓' : 'Log Meal'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveButton, (saved || saving) && styles.saveButtonDone]}
            activeOpacity={0.85}
            onPress={handleSave}
            disabled={saved || saving}
          >
            <Text style={styles.saveButtonText}>
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Slot picker modal ── */}
      <Modal visible={showSlotPicker} transparent animationType="slide" onRequestClose={() => setShowSlotPicker(false)}>
        <TouchableOpacity style={styles.slotOverlay} activeOpacity={1} onPress={() => setShowSlotPicker(false)}>
          <View style={styles.slotCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.slotTitle}>Log to which meal?</Text>

            <View style={{ gap: 10, marginVertical: 8 }}>
              {SLOT_OPTIONS.map(slot => (
                <TouchableOpacity
                  key={slot}
                  style={[styles.slotOptionBtn, selectedSlotIndex === SLOT_OPTIONS.indexOf(slot) && styles.slotOptionBtnActive]}
                  onPress={() => {
                    hapticImpact()
                    setShowSlotPicker(false)
                    logToSlot(slot)
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.slotOptionText, selectedSlotIndex === SLOT_OPTIONS.indexOf(slot) && styles.slotOptionTextActive]}>{slot}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Custom option */}
            {showCustomInput ? (
              <View style={styles.slotCustomRow}>
                <TextInput
                  style={styles.slotCustomInput}
                  placeholder="e.g. Post-workout"
                  placeholderTextColor={COLORS.textMuted}
                  value={customSlotName}
                  onChangeText={setCustomSlotName}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (customSlotName.trim()) {
                      setShowSlotPicker(false)
                      logToSlot(customSlotName.trim())
                      setCustomSlotName('')
                    }
                  }}
                />
                <TouchableOpacity
                  style={[styles.slotCustomBtn, !customSlotName.trim() && { opacity: 0.4 }]}
                  disabled={!customSlotName.trim()}
                  onPress={() => {
                    setShowSlotPicker(false)
                    logToSlot(customSlotName.trim())
                    setCustomSlotName('')
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.slotCustomBtnText}>Log</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setShowCustomInput(true)} activeOpacity={0.7}>
                <Text style={styles.slotCustomLink}>+ Custom meal</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {isUserCreated && meal && (
        <RecipeFormModal
          visible={showEditForm}
          onClose={() => setShowEditForm(false)}
          onSaved={async () => {
            setShowEditForm(false)
            // Refresh meal data from DB
            if (user && meal.id) {
              const { data } = await supabase.from('saved_meals')
                .select('name, prep_time, calories, protein, carbs, fat, ingredients, steps')
                .eq('id', meal.id)
                .single()
              if (data) {
                // Force re-render by replacing the route with updated data
                router.replace({
                  pathname: '/meal/[id]',
                  params: {
                    id: meal.id,
                    mealData: JSON.stringify({
                      ...data,
                      id: meal.id,
                      prepTime: data.prep_time,
                      image: meal.image,
                      is_user_created: true,
                    }),
                  },
                })
              }
            }
          }}
          editMeal={{
            id: meal.id ?? id ?? '',
            name: meal.name,
            prep_time: meal.prepTime,
            calories: meal.calories,
            protein: meal.protein,
            carbs: meal.carbs,
            fat: meal.fat,
            ingredients: meal.ingredients,
            steps: meal.steps,
          }}
        />
      )}
      <CreatorRecipeModal
        visible={showCreatorEdit}
        mealToEdit={meal ? { id: meal.id ?? id ?? '', name: meal.name, calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat, prepTime: meal.prepTime, ingredients: meal.ingredients, steps: meal.steps, image: meal.image } : null}
        onClose={() => setShowCreatorEdit(false)}
        onSubmitted={() => {
          setShowCreatorEdit(false)
          // Navigate back so home screen re-fetches with updated meal
          router.back()
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  notFound: {
    color: COLORS.textWhite,
    textAlign: 'center',
    marginTop: 40,
    fontSize: 16,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(38,38,38,0.6)',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
    marginHorizontal: 4,
  },

  // Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },

  // Hero
  hero: {
    height: 120,
    width: '100%',
    backgroundColor: COLORS.cardElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  heroContainer: {
    position: 'relative',
    height: 340,
    overflow: 'hidden',
  },
  heroImage: {
    height: 340,
    width: '100%',
  },
  heroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 180,
  },

  // Meal title
  mealTitleSection: {
    paddingHorizontal: 20,
    marginTop: -24,
    marginBottom: 4,
  },
  mealTitleText: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.5,
    lineHeight: 34,
    marginBottom: 10,
  },
  mealMetaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  mealMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#191919',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  mealMetaPillText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMuted,
  },

  // Creator attribution
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: 6,
  },
  creatorIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  creatorAvatar: { width: 30, height: 30, borderRadius: 15 },
  creatorAvatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorByText: { color: '#888', fontSize: 13, flexShrink: 1 },
  creatorHandle: { color: '#4ADE80', fontWeight: '600' },
  creatorSocialGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 12,
  },
  creatorSocialBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Macro bar
  macroBar: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 20,
    gap: 8,
  },
  macroStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    backgroundColor: COLORS.cardElevated,
    borderRadius: 20,
    gap: 4,
  },
  macroStatBorder: {},
  macroDotIndicator: {
    width: 0,
    height: 0,
  },
  macroValue: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  macroLabel: {
    fontSize: 9,
    color: COLORS.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },

  // Prep time
  prepTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  prepTimeText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },

  // Sections
  section: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4ADE80',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // Portion pill toggle
  pillToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.cardElevated,
    borderRadius: 20,
    padding: 3,
  },
  pillOption: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 17,
  },
  pillOptionActive: {
    backgroundColor: COLORS.textWhite,
  },
  pillOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textDim,
  },
  pillOptionTextActive: {
    color: '#000000',
  },

  // Ingredients
  ingredientList: {
    gap: 4,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 12,
    backgroundColor: '#191919',
    borderRadius: 12,
  },
  ingredientBorder: {},
  ingredientThumb: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#262626',
  },
  ingredientThumbPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ingredientThumbInitial: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  ingredientLine: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  ingredientPortionInline: {
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  ingredientNameInline: {
    color: COLORS.textWhite,
    fontWeight: '500',
  },
  ingredientPortion: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginTop: 2,
  },
  ingredientRight: {
    flex: 1,
    gap: 0,
  },
  ingredientIconBtnSmall: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ingredientIconBtnActiveBg: {
    backgroundColor: 'rgba(74,222,128,0.16)',
  },
  ingredientNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  missingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FF4444',
  },
  ingredientName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textWhite,
    flex: 1,
  },
  addToGrocery: {
    fontSize: 12,
    color: COLORS.accent,
    fontWeight: '500',
  },
  addToGroceryDone: {
    color: COLORS.textMuted,
  },
  nudgeBanner: {
    backgroundColor: 'rgba(0,201,167,0.08)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,201,167,0.25)',
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nudgeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textWhite,
  },
  nudgeActionBtn: {
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,201,167,0.3)',
    backgroundColor: 'rgba(0,201,167,0.08)',
  },
  nudgeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#00C9A7',
  },
  inPantryLabel: {
    fontSize: 11,
    color: '#4ADE80',
    fontWeight: '600',
  },
  basicLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  needToBuyLabel: {
    fontSize: 11,
    color: '#F59E0B',
    fontWeight: '600',
  },
  ingredientActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ingredientIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ingredientIconBtnActive: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(74,222,128,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ingredientPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: '#2E2E2E',
  },
  ingredientPillActive: {
    backgroundColor: 'rgba(74,222,128,0.16)',
  },
  ingredientPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C8C8C8',
  },
  ingredientPillTextActive: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4ADE80',
  },
  inPantryAction: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4ADE80',
  },
  groceryAction: {
    fontSize: 11,
    fontWeight: '600',
    color: '#00C9A7',
  },

  // Slot picker
  slotOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  slotCard: {
    backgroundColor: COLORS.cardElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  slotTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textWhite,
    textAlign: 'center',
  },
  wheelHighlight: {
    position: 'absolute',
    top: 75,
    left: 0,
    right: 0,
    height: 50,
    backgroundColor: 'rgba(74,222,128,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.25)',
    zIndex: 1,
  },
  wheelItem: {
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelItemText: {
    fontSize: 18,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.3)',
  },
  wheelItemTextActive: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textWhite,
  },
  slotOptionBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#111111',
    alignItems: 'center',
  },
  slotOptionBtnActive: {
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
  },
  slotOptionText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.textWhite,
  },
  slotOptionTextActive: {
    color: '#4ADE80',
  },
  slotCustomLink: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4ADE80',
    textAlign: 'center',
  },
  slotCustomRow: {
    flexDirection: 'row',
    gap: 8,
  },
  slotCustomInput: {
    flex: 1,
    backgroundColor: '#2A2A2A',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: COLORS.textWhite,
  },
  slotCustomBtn: {
    backgroundColor: '#4ADE80',
    borderRadius: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotCustomBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
  },
  slotConfirmBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
  },
  slotConfirmText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },

  // Steps
  stepList: {
    gap: 10,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: '#141414',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  stepNumber: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexShrink: 0,
    marginTop: 1,
    backgroundColor: 'transparent',
    borderRadius: 0,
    height: 'auto',
  },
  stepNumberText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#4ADE80',
  },
  // Bottom bar
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  inlineRatingBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  inlineRatingBtnUp: {
    backgroundColor: 'rgba(74,222,128,0.15)',
  },
  inlineRatingBtnDown: {
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
  ratingToast: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 10,
    zIndex: 100,
  },
  ratingToastText: {
    color: '#4ADE80',
    fontSize: 14,
    fontWeight: '600',
  },
  logButton: {
    flex: 2,
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logButtonDone: {
    backgroundColor: 'rgba(74,222,128,0.15)',
  },
  logButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
  },
  saveButton: {
    flex: 1,
    backgroundColor: COLORS.cardElevated,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.trackDark,
  },
  saveButtonDone: {
    backgroundColor: 'rgba(74,222,128,0.1)',
    borderColor: 'rgba(74,222,128,0.3)',
  },
  saveButtonText: {
    color: COLORS.textWhite,
    fontSize: 15,
    fontWeight: '700',
  },
})
