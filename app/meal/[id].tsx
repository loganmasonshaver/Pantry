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
  Keyboard,
} from 'react-native'
let Haptics: any = null
try { Haptics = require('expo-haptics') } catch {}
const hapticSelection = () => Haptics?.selectionAsync?.().catch?.(() => {})
const hapticImpact = () => Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Medium).catch?.(() => {})
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Utensils, Clock, Pencil, Check, X, ShoppingCart, ThumbsUp, ThumbsDown, User, Instagram, Youtube, Plus } from 'lucide-react-native'
import PressableScale from '../../components/PressableScale'
import RecipeFormModal from '@/components/RecipeFormModal'
import CreatorRecipeModal from '@/components/CreatorRecipeModal'
import { MealImage } from '@/components/MealImage'
import { LinearGradient } from 'expo-linear-gradient'
import { COLORS } from '@/constants/colors'
import { isAssumedStaple, dietExcludedStaples } from '@/constants/staples'
import { escapeLike } from '@/lib/sqlLike'
import { todayStr } from '@/lib/localDate'
import { categorizeItem } from '@/lib/categories'
import { MealDetail } from '@/constants/mock'
import { templates as recipeTemplates } from '@/lib/recipeTemplates'
import { GeneratedMeal } from '../../lib/meals'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePremium } from '../../context/SuperwallContext'
import { useSuperwall, useSuperwallEvents } from 'expo-superwall'
import { trackMealViewed, trackMealSaved, trackMealSaveBlocked, trackMealLogged, trackUpgradePromptShown } from '../../lib/analytics'
import { trackMealSavedEngagement } from '../../lib/engagement'

const screenWidth = Dimensions.get('window').width

// "Measured" = grams + tbsp/cups (needs a scale or measuring spoon).
// "Eyeball"  = whole-unit count + descriptors like "a drizzle", "a handful"
//              (no measuring tools needed). Templates store grams + visual fields;
//              the toEyeball() helper transforms measurement units to descriptors
//              on the fly based on ingredient name.
type PortionMode = 'Eyeball' | 'Measured'

import {
  cleanIngredientName, isNeedToBuy, getWholeUnitDisplay, getMeasuredDisplay, toEyeball,
  stripAdjectives, isAlreadyInList, stripStepNumber, scaleVisual,
} from '@/lib/ingredientDisplay'

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
  // Attribution passed in by whichever surface opened this screen (see openMeal in discover.tsx).
  // Stamped onto meal_logs below so a cook can be traced to the shelf that produced it.
  const { id, mealData, source, shelfKey, position } = useLocalSearchParams<{
    id: string; mealData?: string; source?: string; shelfKey?: string; position?: string
  }>()
  const router = useRouter()
  const { user } = useAuth()
  const { isPremium, triggerUpgrade } = usePremium()
  const { registerPlacement } = useSuperwall()
  // Tracks a subscription made DURING a gate paywall so a user who pays continues the action
  // (save / log) they just unlocked instead of having to tap again.
  const purchasedRef = useRef(false)
  useSuperwallEvents({
    onSubscriptionStatusChange: (status) => { if (status?.status === 'ACTIVE') purchasedRef.current = true },
  })
  const SLOT_OPTIONS = ['Breakfast', 'Lunch', 'Dinner', 'Snack']
  const ITEM_HEIGHT = 50
  // Time-of-day default for the meal slot picker so users tapping "Log Meal"
  // at 8am land on Breakfast, lunch lands on Lunch, etc.
  // <11am Breakfast, <3pm Lunch, <9pm Dinner, else Snack.
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
  const loggingRef = useRef(false) // synchronous double-log guard (slot picker → insert)
  const [logged, setLogged] = useState(false)
  const [userRating, setUserRating] = useState<1 | -1 | null>(null)
  const [ratingToast, setRatingToast] = useState<string | null>(null)
  const ratingToastOpacity = useRef(new Animated.Value(0)).current
  // Undo toast for the "I don't keep this" staple opt-out — the opt-out is one-tap and
  // persistent, so a mistaken tap needs an immediate way back. { norm } is what we restore.
  const [stapleUndo, setStapleUndo] = useState<{ norm: string; label: string } | null>(null)
  const stapleToastOpacity = useRef(new Animated.Value(0)).current
  const stapleUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showEditForm, setShowEditForm] = useState(false)
  const [showCreatorEdit, setShowCreatorEdit] = useState(false)
  const [portionMode, setPortionMode] = useState<PortionMode>('Measured')
  const [addedToGrocery, setAddedToGrocery] = useState<Set<string>>(new Set())
  const [pantryNames, setPantryNames] = useState<Set<string>>(new Set())
  const [groceryNames, setGroceryNames] = useState<Set<string>>(new Set())
  // Basics the user has opted out of assuming (normalized names). Drives the "we assumed" tier —
  // an excluded staple stops being shown as assumed and moves to "you'll need".
  const [restrictions, setRestrictions] = useState<string[]>([])
  const [excludedStaples, setExcludedStaples] = useState<Set<string>>(new Set())
  // Only the user's MANUAL opt-outs persist back to the profile — diet-derived exclusions are
  // recomputed from dietary_restrictions each load, never written into staples_excluded.
  const manualExcludedRef = useRef<string[]>([])
  // Tagged with the meal name it was fetched for — this screen is reused across recipes, so an
  // untagged URL here is what let one recipe's photo render under another's title.
  const [generatedImage, setGeneratedImage] = useState<{ name: string; uri: string } | null>(null)
  const generatedForRef = useRef<string | null>(null)
  // Trending meals show a YouTube thumbnail (instant) until the AI image arrives,
  // then crossfade-slide to it. 0 = thumbnail visible, 1 = AI image visible.
  const slideAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!user) return
    supabase.from('pantry_items').select('name').eq('user_id', user.id).eq('in_stock', true)
      // .trim() matters: Discover trims its pantry set and this one didn't, so a row stored with
      // stray whitespace matched there and never here — a third way the two screens disagreed.
      .then(({ data }) => setPantryNames(new Set(data?.map(i => i.name.toLowerCase().trim()) ?? [])))
    supabase.from('grocery_items').select('name').eq('user_id', user.id)
      .then(({ data }) => setGroceryNames(new Set(data?.map(i => i.name.toLowerCase()) ?? [])))
    // Excluded set = the user's manual opt-outs PLUS diet-conflicting basics (butter for vegan,
    // flour for gluten-free), so the "we assumed" tier never shows a basic their diet rules out.
    supabase.from('profiles').select('staples_excluded, dietary_restrictions').eq('id', user.id).single()
      .then(({ data }) => {
        const manual = (data?.staples_excluded ?? []).map((s: string) => s.toLowerCase())
        manualExcludedRef.current = manual
        setExcludedStaples(new Set([...manual, ...dietExcludedStaples(data?.dietary_restrictions ?? [])]))
        setRestrictions((data?.dietary_restrictions ?? []).filter((r: string) => r && r !== 'None'))
      })
  }, [user])

  const showStapleToast = () => {
    Animated.timing(stapleToastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start()
    if (stapleUndoTimer.current) clearTimeout(stapleUndoTimer.current)
    stapleUndoTimer.current = setTimeout(() => {
      Animated.timing(stapleToastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setStapleUndo(null))
    }, 4000) // 4s undo window — matches the Saved-tab unsave toast
  }

  // Tap an assumed-basic row → "I don't keep this". Persist to profile so meal generation stops
  // assuming it too, and move the row to "you'll need". Optimistic: update state before the write.
  const excludeStaple = async (name: string) => {
    if (!user) return
    const norm = name.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, ' ').trim()
    if (excludedStaples.has(norm)) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    setExcludedStaples(prev => new Set(prev).add(norm))
    const nextManual = Array.from(new Set([...manualExcludedRef.current, norm])) // persist only manual opt-outs
    manualExcludedRef.current = nextManual
    setStapleUndo({ norm, label: name })
    showStapleToast()
    await supabase.from('profiles').update({ staples_excluded: nextManual }).eq('id', user.id)
  }

  // Undo half of excludeStaple — restores an accidentally opted-out basic. Removes it from BOTH
  // the local set and the persisted staples_excluded, so it goes back to being assumed everywhere.
  const restoreStaple = async () => {
    if (!user || !stapleUndo) return
    if (stapleUndoTimer.current) clearTimeout(stapleUndoTimer.current)
    const { norm } = stapleUndo
    setExcludedStaples(prev => { const n = new Set(prev); n.delete(norm); return n })
    const nextManual = manualExcludedRef.current.filter(s => s !== norm)
    manualExcludedRef.current = nextManual
    Animated.timing(stapleToastOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setStapleUndo(null))
    await supabase.from('profiles').update({ staples_excluded: nextManual }).eq('id', user.id)
  }

  // Clear the undo timer on unmount so it never fires setStapleUndo on a gone component.
  useEffect(() => () => { if (stapleUndoTimer.current) clearTimeout(stapleUndoTimer.current) }, [])

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
    // Tapping the same rating again clears it (toggle behavior).
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
    // For creator-uploaded recipes (not AI-generated), the rating also moves a
    // global vote_score that drives the trending feed for everyone. Delta math
    // covers all transitions (up→down, clear, etc) in one increment_vote_score call.
    if ((meal as any).trend_source === 'creator' && id && !id.startsWith('mock')) {
      const delta = next === null ? -(prev ?? 0) : next - (prev ?? 0)
      if (delta !== 0) {
        supabase.rpc('increment_vote_score', { meal_id: id, delta }).then(() => {}, () => {})
      }
    }
  }

  // NOTE: the AI-image generation effect used to live here, above `let meal`. Its dependency
  // array read `meal?.name` before the declaration, so the dep was always undefined and the
  // effect never re-ran when you opened a different recipe — leaving the previous recipe's
  // photo in state to slide in over the new hero. It now lives below `meal`. See there.

  const addToGrocery = async (ingredientName: string) => {
    if (!user || addedToGrocery.has(ingredientName)) return
    setAddedToGrocery(prev => new Set(prev).add(ingredientName))
    const category = await categorizeItem(ingredientName)
    await supabase.from('grocery_items').insert({
      user_id: user.id,
      name: ingredientName,
      meal: meal?.name ?? '',
      category,
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
      .ilike('name', escapeLike(ingredientName)) // raw name would be a LIKE pattern — this is a DELETE
      .eq('meal', meal?.name ?? '')
      .eq('checked', false)
  }

  const toggleGrocery = (ingredientName: string) => {
    if (addedToGrocery.has(ingredientName)) removeFromGrocery(ingredientName)
    else addToGrocery(ingredientName)
  }
  // Pantry edits (add/remove in_stock) used to happen via a whole-row tap here, but that
  // silently wrote to pantry_items on a stray tap while the user was trying to add to grocery.
  // Pantry corrections now live in the Pantry tab; this screen only shops + the basics opt-out.

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
            // Scale visual with grams — they describe the same amount (see scaleVisual).
            return { name: ing.name, visual: scaleVisual(ing.visual, scale), grams: `${Math.round(baseGrams * scale)}${unit}` }
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
        // saved_meals DB column is `image_url`; URL-param mealData uses `image`.
        // Normalize so downstream rendering (meal.image) works for both paths.
        image: generated.image || generated.image_url || null,
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
      meal = null
    }
  } else {
    meal = null
  }

  const creator = (meal as any)?.creator ?? null
  const isCreatorOwner = !!(creator?.user_id && creator.user_id === user?.id)
  const canEditMeal = isUserCreated || isCreatorOwner

  // Auto-generate an AI photo when the meal has none — trending meals arrive carrying only a
  // YouTube thumbnail. Deliberately placed BELOW `meal`: while this sat above the declaration
  // its dep array read `meal` in the TDZ, so the dep was undefined on every render, the effect
  // fired once per mount, and a stale photo slid in over the next recipe's hero.
  useEffect(() => {
    const name = meal?.name
    if (!name) return
    // Expo Router reuses this screen across recipes, so state survives navigation. Drop the
    // previous recipe's photo and rewind the swap before anything can paint.
    if (generatedForRef.current !== name) {
      generatedForRef.current = name
      setGeneratedImage(null)
      slideAnim.setValue(0)
    }
    if (meal?.image) return

    const ingredientNames = meal!.ingredients.map(i => i.name)
    const steps = meal!.steps ?? []
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []

    // Every write carries the meal it was fetched for, so a request that resolves after the
    // user has moved on is dropped at render instead of overwriting the new hero.
    const apply = (uri: string, animate: boolean) => {
      if (cancelled) return
      setGeneratedImage({ name, uri })
      if (!animate) return
      // Beat on the thumbnail first so the swap reads as intentional, not as a late load.
      timers.push(setTimeout(() => {
        if (cancelled) return
        Animated.timing(slideAnim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
          easing: require('react-native').Easing.bezier(0.25, 0.1, 0.25, 1),
        }).start()
      }, 2000))
    }

    const tryGenerate = (attempt = 0) => {
      supabase.functions.invoke('generate-meal-image', {
        body: { mealName: name, ingredients: ingredientNames, steps },
      }).then(({ data }) => {
        if (cancelled) return
        if (data?.image) {
          Image.prefetch(data.image).then(() => apply(data.image, true)).catch(() => apply(data.image, false))
        } else if (attempt < 2) {
          timers.push(setTimeout(() => tryGenerate(attempt + 1), 3000))
        }
      }).catch(() => {
        if (cancelled || attempt >= 2) return
        timers.push(setTimeout(() => tryGenerate(attempt + 1), 3000))
      })
    }
    tryGenerate()

    return () => {
      cancelled = true
      timers.forEach(clearTimeout) // retries outlived the screen and fired against the next recipe
    }
  }, [meal?.name, meal?.image])

  // Only honour a generated photo that belongs to the recipe currently on screen. Everything
  // downstream reads this, never `generatedImage`, so a mismatched tag simply renders nothing.
  const heroGenerated = generatedImage && generatedImage.name === meal?.name ? generatedImage.uri : null

  // Bulk "Add all missing to grocery" was removed — it overlapped the per-row "+ Add" (redundant
  // CTAs). Per-row adding is the single, flexible way to build the grocery list now.

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (meal) trackMealViewed(meal.name) }, [mealData, id])

  // Slot-picker state — declared before any early returns to keep hook order stable.
  // Previously these lived below `handleSave` / `logToSlot` and crashed with
  // "rendered more hooks than during the previous render" when meal loaded async.
  const [showCustomInput, setShowCustomInput] = useState(false)
  const insets = useSafeAreaInsets()
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
        <Text style={styles.notFound}>{fetchingMeal ? 'Getting your recipe…' : "We couldn't find that meal."}</Text>
      </SafeAreaView>
    )
  }

  async function handleSave() {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in to save meals.')
      return
    }
    if (saved) return

    // Premium-only model: non-subscribers can't save at all — paywall opens
    // immediately, no "save 3 then upgrade" preview.
    if (!isPremium) {
      trackUpgradePromptShown('meal_save_limit')
      trackMealSaveBlocked()
      await triggerUpgrade('meal_save_limit')
      // If they subscribed at the gate, continue the save they just unlocked.
      await new Promise(r => setTimeout(r, 400)) // let subscription-status event settle
      if (!purchasedRef.current) return // dismissed without subscribing
    }

    setSaving(true)
    // Persist the image so saved meals show the same photo as the original card
    // (prevents re-generation with a different prompt for trending meals)
    const imageToSave = meal!.image || heroGenerated || null
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
      // Analytics (PostHog) and ENGAGEMENT (profiles counter + Loops) are different systems and
      // only the first was wired — meals_saved_count sat at 0 for every user while 32 saved meals
      // existed in the table.
      trackMealSavedEngagement(user.id)
    }
  }

  const logToSlot = async (slot: string) => {
    if (!user || !meal) return
    if (loggingRef.current) return // ignore a second slot tap while the first insert is in flight
    loggingRef.current = true
    setShowSlotPicker(false) // close immediately so a second slot can't be tapped mid-insert
    setLogging(true)
    const today = todayStr() // LOCAL day — logged_at is the day a meal COUNTS for

    // Fallback to the shared image_cache (populated by other users who've already
    // generated this meal) so meal logs render with an image even if this user
    // tapped Log before the local generate-meal-image call resolved.
    let mealImage = meal.image || heroGenerated || null
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
      // Null rather than a guessed default when the opener didn't pass attribution — an unknown
      // source must stay unknown, not get misfiled into a bucket it never came from.
      source: source ?? null,
      shelf_key: shelfKey ?? null,
      shelf_position: position !== undefined ? parseInt(position, 10) : null,
      // trending_meals ids are uuids; the pantry/generated meals use other id shapes, so only
      // stamp it when this screen was opened from a Discover surface.
      trending_meal_id: source?.startsWith('discover') ? id : null,
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
    loggingRef.current = false
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      setLogged(true)
      trackMealLogged(slot, meal.calories, meal.protein, {
        source: source as any, shelfKey, position: position !== undefined ? parseInt(position, 10) : undefined,
      })
      setTimeout(() => router.back(), 800)
    }
  }

  const handleLog = async () => {
    if (!meal || logged) return
    // Premium-only model: non-subscribers can't log meals. Logging is a direct DB insert
    // (not an edge function), so this client gate is the only gate — open the paywall instead
    // of the slot picker. logToSlot is only reachable through this picker, so gating here covers it.
    if (!isPremium) {
      trackUpgradePromptShown('meal_log_limit')
      await triggerUpgrade('meal_log_limit')
      // If they subscribed at the gate, continue into the slot picker they just unlocked.
      await new Promise(r => setTimeout(r, 400)) // let subscription-status event settle
      if (!purchasedRef.current) return // dismissed without subscribing
    }
    const defaultIdx = getDefaultSlotIndex()
    setSelectedSlotIndex(defaultIdx)
    setShowCustomInput(false)
    setCustomSlotName('')
    lastHapticIndex.current = -1
    setShowSlotPicker(true)
    setTimeout(() => slotScrollRef.current?.scrollTo({ y: defaultIdx * ITEM_HEIGHT, animated: false }), 50)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* ── Header — floats over the full-bleed hero so the photo fills to the very
          top of the screen (status bar included), pulling the rest of the content up. ── */}
      <View style={[styles.header, { top: insets.top }]}>
        <PressableScale style={styles.headerBtn} onPress={() => router.back()}>
          <ChevronLeft size={24} stroke={COLORS.textWhite} strokeWidth={2} />
        </PressableScale>
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
            {heroGenerated && (
              <Animated.View style={[StyleSheet.absoluteFill, {
                transform: [{ translateX: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [screenWidth, 0] }) }],
              }]}>
                <Image source={{ uri: heroGenerated }} style={styles.heroImage} resizeMode="cover" />
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
        ) : (meal.image || heroGenerated) ? (
          <View style={styles.heroContainer}>
            <MealImage uri={(meal.image || heroGenerated) as string} style={styles.heroImage} priority="high" />
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
        <View style={[styles.mealTitleSection, !(meal.image || heroGenerated || (meal as any).thumbnailImage) && { marginTop: 16 }]}>
          <Text style={styles.mealTitleText}>{meal.name}</Text>
          <View style={styles.mealMetaRow}>
            {meal.prepTime != null && meal.prepTime > 0 && (
              <View style={styles.mealMetaPill}>
                <Clock size={14} stroke={COLORS.macroPrep} strokeWidth={2} />
                <Text style={[styles.mealMetaPillText, { color: COLORS.macroPrep }]}>{meal.prepTime} min</Text>
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
                // Color-coded to match the Discover pills: cals white, protein green, prep amber;
                // carbs blue, fat violet added here.
                { label: 'Kcal',    value: String(correctedCal), color: COLORS.textWhite },
                { label: 'Protein', value: `${meal.protein}g`,    color: COLORS.macroProtein },
                { label: 'Carbs',   value: `${meal.carbs}g`,      color: COLORS.macroCarbs },
                { label: 'Fat',     value: `${meal.fat}g`,        color: COLORS.macroFat },
              ].map((stat, i, arr) => (
                <View key={stat.label} style={[styles.macroStat, i < arr.length - 1 && styles.macroStatBorder]}>
                  <Text style={[styles.macroValue, { color: stat.color }]}>{stat.value}</Text>
                  <Text style={styles.macroLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>
          )
        })()}

        {/* Prep time shown in title section above */}

        {/* ── Ingredients ── */}
        <View style={styles.section}>
          {/* The title and the portion toggle share a row; the NOTES deliberately do not.
              They used to sit in an unstyled <View> beside the pill, and an unstyled flex child
              defaults to flexShrink: 0 — so neither side would give way, the row overflowed, and
              the pill printed on top of "Makes N servings · macros are per serving". Full-width
              notes cannot collide with anything and read better besides: the allergen line is a
              sentence, and it was being squeezed into the ~170pt left over beside the pill. */}
          <View style={styles.sectionHeaderBlock}>
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
              {/* Quantities are the creator's FULL BATCH, while the macros above are per serving.
                  Without this line a 4-egg cheesecake next to "278 cal" reads as a lie — it's the
                  label that makes the two numbers reconcilable. Hidden at 1 serving, where the
                  distinction doesn't exist. */}
            {(meal as any)?.servings > 1 && (
              <Text style={styles.servingsNote}>Makes {(meal as any).servings} servings · macros are per serving</Text>
              )}
              {/* States what was CHECKED, never that the dish is safe. These tags are derived from
                  an LLM's reading of a video description, and both failure modes have happened in
                  production: an ingredient dropped during extraction, and a compound ingredient
                  ("pesto") whose name hides its allergens. "Dairy-free" is a promise we can't keep;
                  "no dairy in the listed ingredients" is exactly true even when the list is short.
                  Only shown to users who set the restriction — nobody else needs the caveat. */}
              {restrictions.length > 0 && (
                <Text style={styles.allergenNote}>
                  {restrictions.map(r => {
                    const k = r.toLowerCase()
                    const flag = k.includes('dairy') ? (meal as any)?.is_dairy_free
                      : k.includes('gluten') ? (meal as any)?.is_gluten_free
                      : k.includes('nut') ? (meal as any)?.is_nut_free : undefined
                    if (flag === undefined) return null
                    const word = k.includes('dairy') ? 'dairy' : k.includes('gluten') ? 'gluten' : 'nuts'
                    // null is a THIRD state — the classifier never ran on this row. It used to fall
                    // through to the falsy branch and print "Contains nuts", which is a fabricated
                    // claim in the other direction. Say what is actually true: we don't know.
                    if (flag === null) return `We haven't verified ${word} for this recipe.`
                    return flag ? `No ${word} in the listed ingredients.` : `Contains ${word}.`
                  }).filter(Boolean).join(' ')}
                  {' '}Always check the full recipe before cooking.
                </Text>
              )}
          </View>

          {/* Split ingredients into NEED / HAVE buckets so the eye lands on what the user
              needs to act on. "Have" = explicitly in pantry OR a cooking basic (salt, oil, etc.)
              that everyone is assumed to have. */}
          {(() => {
            const inPantry = (ing: any) => isAlreadyInList(ing.name, pantryNames)
            const isBasic = (ing: any) => !inPantry(ing) && isAssumedStaple(ing.name, excludedStaples)
            const haveRows = meal.ingredients.filter(inPantry)
            const basicRows = meal.ingredients.filter(isBasic)
            const needRows = meal.ingredients.filter(i => !inPantry(i) && !isBasic(i))

            // Renders one ingredient row. Tap does ONE thing per section, and never writes to
            // the pantry by accident (the old whole-row "I have this" tap silently inserted
            // pantry_items on a mis-tap):
            //   NEED  → add/remove this item to the grocery list (the screen's whole job)
            //   BASIC → "I don't keep this" staple opt-out (low-stakes preference write)
            //   HAVE  → read-only; you already have it. Pantry corrections live in the Pantry tab.
            const renderRow = (ing: any, kind: 'need' | 'have' | 'basic') => {
              // Whole-unit foods (eggs, avocado, etc.) always display as count regardless of
              // portion mode — "233g eggs" reads weird in both Measured and Eyeball.
              const wholeUnit = getWholeUnitDisplay(ing.name, ing.grams, ing.visual)
              const portion = wholeUnit
                ? wholeUnit.count
                : (portionMode === 'Eyeball'
                    ? toEyeball(ing.visual ?? ing.grams, ing.name)
                    : getMeasuredDisplay(ing.name, ing.grams, ing.visual))
              const displayName = wholeUnit ? wholeUnit.name : ing.name
              const isAdded = addedToGrocery.has(ing.name)
              // 'have' (in pantry) and 'basic' (assumed) both render muted vs the actionable NEED rows.
              const isHaveRow = kind !== 'need'
              // NEED taps toggle the grocery list. HAVE and BASIC rows are inert at the row level —
              // the basic opt-out now lives ONLY on the "assumed" pill (a precise, deliberate target),
              // so a stray row tap never opts a staple out.
              const onRowPress =
                kind === 'need' ? () => toggleGrocery(ing.name)
                : undefined
              return (
                <PressableScale
                  key={ing.id}
                  style={[styles.ingredientRow, isHaveRow && styles.ingredientRowHave]}
                  onPress={onRowPress}
                  disabled={!onRowPress}
                  haptic={kind === 'need'}
                >
                  {/* Bullet dot replaces the per-ingredient thumbnail. AI-generated thumbs
                      had a ~5-10% misgeneration rate (wrong food shown) — every comparable
                      recipe app (Yummly, Paprika, Mealime, NYT Cooking) ships text-only
                      ingredient lists, so we follow that convention. */}
                  <View style={[styles.ingredientBullet, isHaveRow && styles.ingredientBulletHave]} />
                  <Text
                    style={[styles.ingredientLine, isHaveRow && styles.ingredientLineHave]}
                    numberOfLines={1}
                  >
                    <Text style={[styles.ingredientPortionInline, isHaveRow && styles.ingredientPortionHave]}>{portion}</Text>
                    <Text>  </Text>
                    <Text style={[styles.ingredientNameInline, isHaveRow && styles.ingredientNameHave]}>{displayName}</Text>
                  </Text>
                  {kind === 'have' ? (
                    // HAVE row: just a quiet green check confirming state — no shopping action
                    // because buying something you already have is the whole bug we're fixing.
                    <View style={styles.haveIndicator}>
                      <Check size={15} stroke="#4ADE80" strokeWidth={2.4} />
                    </View>
                  ) : kind === 'basic' ? (
                    // Assumed basic: a small muted asterisk (lighter than a tag) marks this as a
                    // GUESS (salt/oil/etc.) vs a confirmed item's green check. The "*" is the ONLY
                    // tap target — tapping it opts the staple out. Big hitSlop since the glyph is
                    // tiny; excludeStaple fires its own Light haptic, so no `haptic` prop here.
                    <PressableScale
                      style={styles.assumedStar}
                      onPress={() => excludeStaple(ing.name)}
                      hitSlop={{ top: 14, bottom: 14, left: 16, right: 16 }}
                      accessibilityLabel={`${displayName} is an assumed basic — tap to remove`}
                    >
                      <Text style={styles.assumedStarText}>*</Text>
                    </PressableScale>
                  ) : (
                    // NEED: a LABELED chip, not a bare "+" — the word says it adds to grocery
                    // (a lone + reads ambiguously), and "Added" is the state feedback without a
                    // success popup. Added state uses a CART (grocery), NOT a check — the green
                    // check means "in your pantry" on HAVE rows, so a check here would read as
                    // "you now have it" instead of "it's on your shopping list". Whole row = tap.
                    <View style={[styles.addChip, isAdded && styles.addChipAdded]}>
                      {isAdded
                        ? <ShoppingCart size={13} stroke="#000" strokeWidth={2.6} />
                        : <Plus size={14} stroke={COLORS.accent} strokeWidth={3} />}
                      <Text style={[styles.addChipText, isAdded && styles.addChipTextAdded]}>
                        {isAdded ? 'Added' : 'Add'}
                      </Text>
                    </View>
                  )}
                </PressableScale>
              )
            }

            return (
              <>
                {needRows.length > 0 && (
                  <>
                    <Text style={styles.ingredientGroupLabel}>YOU'LL NEED</Text>
                    <View style={styles.ingredientList}>
                      {needRows.map(ing => renderRow(ing, 'need'))}
                    </View>
                    {/* Teaches that the whole row is tappable — the +/✓ is now just a status glyph. */}
                    <Text style={styles.ingredientHint}>Tap an item to add it to your grocery list.</Text>
                  </>
                )}
                {/* IN YOUR PANTRY = confirmed items + assumed basics in ONE section (both mean
                    "don't buy"). Confirmed rows show a green check; assumed rows show a muted
                    "assumed" tag and sit after the confirmed ones for soft grouping. */}
                {(haveRows.length > 0 || basicRows.length > 0) && (
                  <>
                    <Text style={[styles.ingredientGroupLabel, needRows.length > 0 && styles.ingredientGroupLabelSpaced]}>IN YOUR PANTRY</Text>
                    <View style={styles.ingredientList}>
                      {haveRows.map(ing => renderRow(ing, 'have'))}
                      {basicRows.map(ing => renderRow(ing, 'basic'))}
                    </View>
                    {basicRows.length > 0 && (
                      <Text style={styles.ingredientHint}><Text style={styles.hintStar}>*</Text> a basic we assume you keep (salt, oil…). Tap the <Text style={styles.hintStar}>*</Text> on anything you don't have and we'll stop assuming it.</Text>
                    )}
                  </>
                )}
              </>
            )
          })()}

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

      {/* ── Staple opt-out undo toast — reverses an accidental "I don't keep this" tap ── */}
      {stapleUndo && (
        <Animated.View style={[styles.stapleToast, { opacity: stapleToastOpacity }]}>
          <Text style={styles.stapleToastText} numberOfLines={1}>Won't assume {stapleUndo.label.toLowerCase()}</Text>
          <PressableScale onPress={restoreStaple} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.stapleToastUndo}>Undo</Text>
          </PressableScale>
        </Animated.View>
      )}

      {/* ── Fixed bottom buttons ── */}
      <View style={styles.bottomBar}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <PressableScale
            style={[styles.logButton, (logged || logging) && styles.logButtonDone]}
            haptic
            onPress={handleLog}
            disabled={logged || logging}
          >
            <Text style={styles.logButtonText}>
              {logging ? 'Logging…' : logged ? 'Logged ✓' : 'Log Meal'}
            </Text>
          </PressableScale>
          <PressableScale
            style={[styles.saveButton, (saved || saving) && styles.saveButtonDone]}
            haptic
            onPress={handleSave}
            disabled={saved || saving}
          >
            <Text style={styles.saveButtonText}>
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
            </Text>
          </PressableScale>
        </View>
      </View>

      {/* ── Slot picker modal ── */}
      <Modal visible={showSlotPicker} transparent animationType="slide" onRequestClose={() => setShowSlotPicker(false)}>
        <TouchableOpacity style={styles.slotOverlay} activeOpacity={1} onPress={() => { if (Keyboard.isVisible()) { Keyboard.dismiss(); return } setShowSlotPicker(false) }}>
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

  // Header — absolute overlay so the hero image can run full-bleed behind it.
  // `top` is set inline to the safe-area inset so the buttons clear the notch.
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
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
    height: 500,
    overflow: 'hidden',
  },
  heroImage: {
    height: 500,
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
  // The block owns the spacing below the whole header; the ROW only lays out title + toggle.
  sectionHeaderBlock: { marginBottom: 12 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // gap + flexShrink are belt-and-braces: with only a short title beside the pill there is
    // room to spare, but an unstyled flex child defaults to flexShrink: 0, which is exactly how
    // the previous layout printed the toggle on top of the servings line.
    gap: 12,
  },
  allergenNote: { fontSize: 12, color: COLORS.textMuted, fontWeight: '500', marginTop: 4, lineHeight: 17 },
  servingsNote: { fontSize: 12, color: COLORS.textMuted, fontWeight: '500', marginTop: 2 },
  sectionTitle: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
    color: '#4ADE80',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // Portion pill toggle
  pillToggle: {
    flexShrink: 0,
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
  // Small caps label that segments the list — drives the eye to NEED first, HAVE second.
  ingredientGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  // Adds extra top space when this label follows a previous section.
  ingredientGroupLabelSpaced: {
    marginTop: 20,
  },
  // One-shot hint under the lists explaining the override gesture. Italic + dim so it's
  // findable but doesn't shout.
  ingredientHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 12,
  },
  // Primary action that lives above the lists — white pill so it reads as the dominant
  // affordance over any per-row + button.
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: '#191919',
    borderRadius: 12,
  },
  // HAVE rows fade back so NEED rows pop. Lower bg + dimmed contents.
  ingredientRowHave: {
    backgroundColor: '#121212',
  },
  // Tiny dot that replaces the per-row thumbnail — pure visual list-marker, no
  // semantic meaning. Teal on NEED rows so it ties to the + button's palette.
  ingredientBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.accent,
    marginLeft: 4,
  },
  ingredientBulletHave: {
    backgroundColor: COLORS.textMuted,
    opacity: 0.5,
  },
  ingredientLineHave: {
    // HAVE rows are de-emphasized with opacity + a trailing checkmark — no
    // strikethrough, which made the text hard to read.
  },
  ingredientPortionHave: {
    opacity: 0.9,
  },
  ingredientNameHave: {
    opacity: 0.9,
  },
  // Quiet trailing checkmark on HAVE rows — confirms state, no tap target needed.
  haveIndicator: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Small muted asterisk on assumed-basic rows — a low-confidence "we're guessing" marker,
  // deliberately lighter than the confirmed green check. Sized/positioned to match the check's
  // 30px slot so rows stay aligned; the "*" glyph sits high, so nudge it down to center.
  // Tappability comes from SHAPE (a subtle round button), not color — teal read as tappable but
  // collided with the green "have it" check. Neutral grey keeps it clearly distinct from confirmed
  // items; the faint circle says "pressable".
  assumedStar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  assumedStarText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textMuted,
    lineHeight: 18,
    marginTop: 6, // asterisk renders top-aligned in its line box; pull it toward vertical center
  },
  hintStar: {
    fontWeight: '800',
    color: '#B0B0B0', // brighter than the hint text so the "*" reads as the referenced marker
  },
  // NEED row's "Add" chip. Labeled (not a bare +) so it self-explains as an add-to-grocery
  // action; muted teal so it doesn't shout over the white bulk CTA. Flips to solid teal +
  // "Added" once on the list, which is the state feedback (no success popup, per UX rules).
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 9,
    paddingRight: 11,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.accentDim,
  },
  addChipAdded: {
    backgroundColor: COLORS.accent,
  },
  addChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.accent,
  },
  addChipTextAdded: {
    color: '#000', // black on solid teal — high contrast, matches the app's filled-button convention
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
  // Sits above the fixed Log/Save bar (~bottom 96) so the Undo target isn't hidden behind it.
  stapleToast: {
    position: 'absolute',
    bottom: 96,
    left: 20,
    right: 20,
    backgroundColor: '#1A1A1A',
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 100,
  },
  stapleToastText: {
    fontSize: 14,
    color: COLORS.textWhite,
    fontWeight: '500',
    flex: 1,
    marginRight: 12,
  },
  stapleToastUndo: {
    fontSize: 14,
    color: '#4ADE80',
    fontWeight: '700',
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
