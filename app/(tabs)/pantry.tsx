import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  SectionList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Keyboard,
} from 'react-native'
import Reanimated from 'react-native-reanimated'
import { STATE_FADE } from '@/lib/motion'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { perfMark } from '@/lib/perf'
import { Plus, X, Search, ScanLine, Package, Camera, Receipt, Apple, Wheat, Beef, Egg, Snowflake, Cookie, Coffee, Droplet, Bean, Nut, CakeSlice, Soup, Croissant, Flame, Ham } from 'lucide-react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { COLORS } from '@/constants/colors'
import { todayStr } from '@/lib/localDate'
import { useAuth } from '@/context/AuthContext'
import { usePremium } from '@/context/SuperwallContext'
import { useAIConsent } from '@/context/AIConsentContext'
import { supabase } from '@/lib/supabase'
import { haptic } from '@/lib/haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { STORE_CATEGORIES, autoCategoryMatches, categorizeItem } from '@/lib/categories'
import { buildInsight, type FitnessGoal, type DietType, type LogStats } from '@/lib/pantryProfile'
import { ageLabelLong, isPerishable, isStale } from '@/lib/pantryAge'
import { groupPantryRows, type PantryRow } from '@/lib/pantryGroup'
import { pantryMirrorKey as pantryCacheKey } from '@/lib/pantryMirror'
import PantryScanModal from '@/components/PantryScanModal'
import ReceiptScanModal from '@/components/ReceiptScanModal'
import PressableScale from '@/components/PressableScale'
import PantryGroceryTabs from '@/components/PantryGroceryTabs'

// ── Types ──────────────────────────────────────────────────────────────

type Ingredient = {
  id: string
  name: string
  inStock: boolean
  // When it was added or last confirmed still there — the grey age beside the row, and the
  // stale nudge at 21 days. ISO string; lib/pantryAge does the arithmetic.
  since: string
}

type Category = {
  id: string
  icon: React.ElementType
  iconColor: string
  name: string
  ingredients: Ingredient[]
}

// What the list renders: each aisle's rows, Out rows last as of the last load. catId keeps toggle
// and delete pointed at the category.
type PantryRowData = Ingredient & { catId: string }
type PantrySection = { id: string; name: string; data: PantryRowData[] }

// ── Category config ────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  'Produce': '#4ADE80',
  'Bakery': '#F5A623',
  'Meat & Fish': '#FF6B6B',
  'Dairy & Eggs': '#E2E8F0',
  'Frozen': '#60A5FA',
  'Grains & Pasta': '#F5A623',
  'Legumes': '#A78BFA',
  'Canned & Jarred': '#C084FC',
  'Nuts & Seeds': '#D4A76A',
  'Snacks': '#FFB020',
  'Sauces & Condiments': '#F472B6',
  'Spices & Seasonings': '#FB923C',
  'Oils & Vinegars': '#FBBF24',
  'Baking': '#F9A8D4',
  'Beverages': '#00C9A7',
  'Other': '#888888',
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  'Produce': Apple,
  'Bakery': Croissant,
  'Meat & Fish': Beef,
  'Dairy & Eggs': Egg,
  'Frozen': Snowflake,
  'Grains & Pasta': Wheat,
  'Legumes': Bean,
  'Canned & Jarred': Soup,
  'Nuts & Seeds': Nut,
  'Snacks': Cookie,
  'Sauces & Condiments': Ham,
  'Spices & Seasonings': Flame,
  'Oils & Vinegars': Droplet,
  'Baking': CakeSlice,
  'Beverages': Coffee,
  'Other': Package,
}

// The pantry reads in COOK order, the grocery list in STORE order — the same sixteen aisles. The
// protein source leads here because it is what a meal is built around and the first thing Cook
// Tonight checks; in a store it is at the back, which is where Grocery keeps it.
const PANTRY_ORDER = ['Meat & Fish', ...STORE_CATEGORIES.filter(c => c !== 'Meat & Fish')]
const CATEGORY_CONFIG = PANTRY_ORDER.map(name => ({
  id: name.toLowerCase().replace(/[^a-z]/g, ''),
  name,
  icon: CATEGORY_ICONS[name] ?? Package,
  iconColor: CATEGORY_COLORS[name] ?? '#888888',
}))

const INSIGHT_ROTATION_KEY = 'pantry_insight_rotation' // visit counter → rotates the insight headline (Step D)
// The pantry list, mirrored per user so the tab paints before the query answers. Same shape as the
// query's rows, so one grouping function serves both.
const categoryConfigByName = Object.fromEntries(CATEGORY_CONFIG.map(c => [c.name, c]))
const categoryConfigById   = Object.fromEntries(CATEGORY_CONFIG.map(c => [c.id,   c]))

// ── One ingredient row ─────────────────────────────────────────────────
//
// Every item is visible under its section header — the accordions hid the list behind a tap and
// a count badge, on the tab whose whole job is "what do I have". Tap = in/out of stock, swipe =
// delete. An out-of-stock row stays in its aisle — crossed off, faded, tagged "Out" — and sinks to
// the bottom of the card on the next load. It must NOT leave the card: a separate OUT OF STOCK
// section at the end of the list was tried, and Logan's call was that a row vanishing on tap,
// beside swipe-to-delete on the same row, reads as a delete.
function PantryRow({ ingredient, first, last, onDelete, onToggle }: {
  ingredient: Ingredient
  first: boolean
  last: boolean
  onDelete: () => void
  onToggle: () => void
}) {
  return (
    <Swipeable
      renderRightActions={() => (
        <TouchableOpacity style={[styles.deleteAction, last && styles.deleteActionLast]} onPress={onDelete} activeOpacity={0.85}>
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      )}
      friction={2}
      overshootRight={false}
    >
      {/* Opaque, so the red action stays hidden behind the row until it is swiped open. */}
      <TouchableOpacity style={[styles.row, first && styles.rowFirst, last && styles.rowLast]} onPress={onToggle} activeOpacity={0.7}>
        {/* Inset hairline, the iOS grouped-list divider: starts at the text, not the card edge. */}
        {!first && <View style={styles.rowHairline} pointerEvents="none" />}
        {/* Faded with opacity, not a dimmer colour, so the change can be a CSS transition: the
            render that flips inStock already happens, and the fade adds nothing to it. */}
        <Reanimated.Text style={[styles.rowName, STATE_FADE, { opacity: ingredient.inStock ? 1 : 0.35 }, !ingredient.inStock && styles.rowNameOut]} numberOfLines={1}>{ingredient.name}</Reanimated.Text>
        {/* No age on the right — a batch scan stamps one date on every line, so it read "7w"
            fifty times; the notice line carries the count and the review sheet the per-item age.
            The "Out" tag is the one legible thing on a faded row, which is the point of it. It is
            always mounted and fades with the name; pinned over the row's right edge so showing it
            never reflows the name. */}
        <Reanimated.View
          pointerEvents="none"
          accessibilityElementsHidden={ingredient.inStock}
          style={[styles.outPillPin, STATE_FADE, { opacity: ingredient.inStock ? 0 : 1 }]}
        >
          <View style={styles.outPill}><Text style={styles.outPillText}>Out</Text></View>
        </Reanimated.View>
      </TouchableOpacity>
    </Swipeable>
  )
}

// ── Pantry screen ──────────────────────────────────────────────────────

export default function PantryScreen() {
  // Dev-only screen trace. Black frames were reported ONLY on transitions between
  // Pantry/Discover/Saved and never on any pair involving Home; this prints mount and
  // unmount so the next repro shows whether a screen is being torn down on tab switch
  // (it should not be) rather than producing another hypothesis.
  useEffect(() => {
    perfMark('Pantry MOUNT')
    return () => perfMark('Pantry UNMOUNT')
  }, [])
  // MOUNT/UNMOUNT alone was not enough: a tab switch does not remount a screen, so the
  // first trace stayed silent through a whole reproduction and proved only that nothing
  // is being torn down. FOCUS/BLUR is what actually fires on a switch — and a BLUR with
  // no following FOCUS, or a FOCUS with no render after it, localises the black frame.
  useFocusEffect(useCallback(() => {
    perfMark('Pantry FOCUS')
    return () => perfMark('Pantry BLUR')
  }, []))

  const { user } = useAuth()
  const router = useRouter()
  const { isPremium } = usePremium()
  const [categories, setCategories] = useState<Category[]>([])
  const [loaded, setLoaded] = useState(false) // gate the empty state until the first fetch lands, so "your pantry is empty" doesn't flash before items arrive
  const [searchQuery, setSearchQuery] = useState('')
  const [showScanModal, setShowScanModal] = useState(false)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const { requestConsent } = useAIConsent()
  // Consent must be gathered BEFORE the scan modal opens: two native iOS modals can't stack,
  // so a consent prompt fired from inside the open scan modal gets queued behind it and only
  // surfaces after the user exits (and the scan hangs waiting on it). Gate it at the tap.
  const openScanWithConsent = async () => { if (await requestConsent()) setShowScanModal(true) }
  const openReceiptWithConsent = async () => { if (await requestConsent()) setShowReceiptModal(true) }

  // The stale-items review sheet ("still have these?").
  const [reviewOpen, setReviewOpen] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newIngredientName, setNewIngredientName] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const addingRef = useRef(false) // synchronous in-flight guard for addIngredient (double-tap)
  const [disambigChoices, setDisambigChoices] = useState<string[]>([])
  const searchRef = useRef<TextInput>(null)
  // "Add items by hand" from a capped scanner lands here with the keyboard up. The delay lets the
  // scan modal finish sliding away first; a focus requested under a dismissing modal is dropped.
  const focusAddField = useCallback(() => { setTimeout(() => searchRef.current?.focus(), 500) }, [])
  const { add: addParam } = useLocalSearchParams<{ add?: string }>()
  useFocusEffect(useCallback(() => {
    if (addParam !== '1') return
    focusAddField()
    router.setParams({ add: '' }) // consumed — returning to the tab later must not pop the keyboard again
  }, [addParam, focusAddField]))



  // Goal/diet fields for the personalized pantry insight (see lib/pantryProfile + PLAN.md).
  const [insightProfile, setInsightProfile] = useState<{ goal: FitnessGoal | null; diet: DietType | null; restrictions: string[]; dislikes: string[]; cuisines: string[]; cookingSkill: string | null; maxPrep: number | null } | null>(null)
  // Weekly meal-log rollup for the protein-intake nudge (Step E). null = no data / not loaded yet.
  const [logStats, setLogStats] = useState<LogStats | null>(null)
  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('dietary_restrictions, fitness_goal, diet_type, food_dislikes, cuisine_preferences, cooking_skill, max_prep_minutes, protein_goal').eq('id', user.id).single()
      .then(({ data }) => {
        setInsightProfile({
          goal: (data?.fitness_goal as FitnessGoal) ?? null,
          diet: (data?.diet_type as DietType) ?? null,
          restrictions: data?.dietary_restrictions ?? [],
          dislikes: data?.food_dislikes ?? [],
          cuisines: data?.cuisine_preferences ?? [],
          cookingSkill: data?.cooking_skill ?? null,
          maxPrep: data?.max_prep_minutes ?? null,
        })

        // Weekly protein average, computed over DAYS WITH LOGS (not calendar days). logged_at is a
        // DATE column (the day a meal counts for); created_at is insert time — use logged_at here.
        const proteinGoal = data?.protein_goal ?? 0
        if (proteinGoal > 0) {
          const sevenDaysAgo = todayStr(new Date(Date.now() - 7 * 86400000))
          supabase.from('meal_logs').select('protein, logged_at').eq('user_id', user.id).gte('logged_at', sevenDaysAgo)
            .then(({ data: logs }) => {
              if (!logs?.length) return
              const totalProtein = logs.reduce((s, r) => s + (r.protein ?? 0), 0)
              const daysLogged = new Set(logs.map(r => r.logged_at)).size
              setLogStats({ avgDailyProtein: totalProtein / daysLogged, proteinGoal, daysLogged })
            })
        }
      })
  }, [user])

  // Visit counter → rotates the insight headline among the top gaps (Step D). Advanced once per
  // screen focus in the focus effect below; stable within a visit so the banner doesn't flip mid-view.
  const [insightRotation, setInsightRotation] = useState(0)

  // Personalized "what to stock next" insight — replaces the old item-count "Stock Level".
  // In-stock items only; keyed on the item's real store category (Produce, Meat & Fish, …).
  const pantryInsight = useMemo(() => {
    const items = categories.flatMap(c => c.ingredients.filter(i => i.inStock).map(i => ({ name: i.name, category: c.name })))
    return buildInsight(items, insightProfile?.goal, insightProfile?.diet, insightProfile?.restrictions ?? [], insightProfile?.dislikes ?? [], insightProfile?.cuisines ?? [], insightProfile?.cookingSkill ?? null, insightProfile?.maxPrep ?? null, insightRotation, logStats)
  }, [categories, insightProfile, insightRotation, logStats])

  // One-tap "Add to grocery" for the insight's suggestions (categorized, deduped by the DB flow).
  const [insightAdded, setInsightAdded] = useState(false)
  const addInsightToGrocery = async () => {
    if (!user || pantryInsight.suggestedItems.length === 0 || insightAdded) return
    setInsightAdded(true) // optimistic; the banner will re-evaluate on next pantry change
    haptic.light() // the link's text flips to "Added" at the same moment
    const rows = await Promise.all(pantryInsight.suggestedItems.map(async name => ({
      user_id: user.id, name, category: await categorizeItem(name), checked: false,
    })))
    await supabase.from('grocery_items').insert(rows)
  }
  useEffect(() => { setInsightAdded(false) }, [pantryInsight.headline]) // reset the CTA when the insight changes


  // Rows → the screen's Category[]. Out rows sink to the bottom of their aisle HERE, when the list
  // loads, never on the tap that marks them Out (see groupPantryRows). Section order is
  // PANTRY_ORDER, fixed in code: the drag-reorder that used to live here went with the accordions,
  // and a device-local order nobody set was one more way for two screens to disagree.
  const toCategories = useCallback((rows: PantryRow[]): Category[] => (
    groupPantryRows(rows, PANTRY_ORDER).map(g => {
      const cfg = categoryConfigByName[g.name]
      return cfg
        ? { ...cfg, ingredients: g.ingredients }
        : { id: g.name.toLowerCase(), name: g.name, icon: Package, iconColor: '#888888', ingredients: g.ingredients }
    })
  ), [])

  // Painted from the network at least once. Guards the disk hydration below, which must never
  // overwrite fresher rows if the disk read happens to land second.
  const fetchedRef = useRef(false)

  const fetchItems = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('pantry_items')
      .select('id, name, category, in_stock, created_at, last_confirmed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    if (!data) return
    perfMark(`Pantry items from network (${data.length})`)
    fetchedRef.current = true
    setCategories(toCategories(data))
    setLoaded(true)
  }, [user?.id, toCategories])

  // PAINT FROM DISK FIRST. The tab had no local copy of the list at all: every open asked Supabase
  // and showed an empty list until the answer came back, which is the wait Logan asked about. The
  // rows are mirrored below on every change, so a cold open paints the last known pantry instantly
  // and the fetch on focus corrects it a moment later. A stale row can show for that moment — the
  // same trade Home already makes for the day's log.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    AsyncStorage.getItem(pantryCacheKey(user.id)).then(raw => {
      if (cancelled || !raw || fetchedRef.current) return
      const rows = JSON.parse(raw)
      if (!Array.isArray(rows) || rows.length === 0) return
      perfMark(`Pantry items from disk (${rows.length})`)
      setCategories(toCategories(rows))
      setLoaded(true)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [user?.id, toCategories])

  // Mirror to disk on every change, not only after a fetch: a toggle, a delete, an add and Clear
  // pantry all edit state directly, and a cache written only by the fetch would hand the next cold
  // open a list the user had already changed.
  useEffect(() => {
    if (!user || !loaded) return
    const rows: PantryRow[] = categories.flatMap(c => c.ingredients.map(i => ({
      id: i.id, name: i.name, category: c.name, in_stock: i.inStock, last_confirmed_at: i.since, created_at: i.since,
    })))
    AsyncStorage.setItem(pantryCacheKey(user.id), JSON.stringify(rows)).catch(() => {})
  }, [categories, loaded, user?.id])

  useFocusEffect(useCallback(() => {
    fetchItems()
    // Advance the insight rotation once per visit: use the stored index for THIS visit, persist
    // the next one. Cheap device-local counter — no server round-trip, survives app restarts.
    AsyncStorage.getItem(INSIGHT_ROTATION_KEY).then(raw => {
      const n = parseInt(raw ?? '0', 10) || 0
      setInsightRotation(n)
      AsyncStorage.setItem(INSIGHT_ROTATION_KEY, String(n + 1)).catch(() => {})
    }).catch(() => {})
  }, [fetchItems]))

  // Either direction is a confirmation: "used up" and "back in stock" both mean the user looked at
  // the shelf today, so the age resets and the stale nudge lets the item go.
  const setStock = async (categoryId: string, ingredientId: string, inStock: boolean) => {
    const now = new Date().toISOString()
    // selection: the lightest tick, for a two-state flip. Covers the row tap and the review sheet's
    // Keep / Used up, which all land here.
    haptic.selection()
    // The row stays where it is and fades to its new state (STATE_FADE in PantryRow). It sinks to
    // the bottom of its aisle on the next load — see fetchItems.
    setCategories(prev =>
      prev.map(c =>
        c.id === categoryId
          ? { ...c, ingredients: c.ingredients.map(i => i.id === ingredientId ? { ...i, inStock, since: now } : i) }
          : c
      )
    )
    await supabase.from('pantry_items').update({ in_stock: inStock, last_confirmed_at: now }).eq('id', ingredientId)
  }
  const toggleStock = (categoryId: string, ingredientId: string) => {
    const ing = categories.find(c => c.id === categoryId)?.ingredients.find(i => i.id === ingredientId)
    if (ing) setStock(categoryId, ingredientId, !ing.inStock)
  }
  // "Keep" on the review sheet: still there, so the clock restarts; nothing else changes.
  const confirmItem = async (categoryId: string, ingredientId: string) => setStock(categoryId, ingredientId, true)
  const keepAll = async () => {
    if (!user) return
    const now = new Date().toISOString()
    const ids = staleItems.map(i => i.id)
    setCategories(prev => prev.map(c => ({ ...c, ingredients: c.ingredients.map(i => ids.includes(i.id) ? { ...i, since: now } : i) })))
    haptic.success() // finishes the whole review in one tap
    setReviewOpen(false)
    await supabase.from('pantry_items').update({ last_confirmed_at: now }).in('id', ids)
  }

  const deleteIngredient = async (categoryId: string, ingredientId: string) => {
    haptic.medium() // stronger tick than a routine tap — this removes something
    // The gap closes in one frame. Reanimated's layout transitions do not reach SectionList cells,
    // and a LayoutAnimation here was a silent no-op (CLAUDE.md), so there is nothing to configure.
    setCategories(prev =>
      prev
        .map(c =>
          c.id === categoryId
            ? { ...c, ingredients: c.ingredients.filter(i => i.id !== ingredientId) }
            : c
        )
        .filter(c => c.ingredients.length > 0)
    )
    await supabase.from('pantry_items').delete().eq('id', ingredientId)
  }

  // Wipe the whole pantry. Confirmed because it's bulk + irreversible (the usual no-confirm
  // rule is for routine actions; this isn't). Optimistic clear, refetch to restore on error.
  const clearPantry = () => {
    if (!user || totalItems === 0) return
    Alert.alert(
      'Clear pantry?',
      `This removes all ${totalItems} ingredient${totalItems !== 1 ? 's' : ''}. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear', style: 'destructive', onPress: async () => {
            haptic.warning() // heavier notification for a bulk, irreversible wipe
            setCategories([])
            const { error } = await supabase.from('pantry_items').delete().eq('user_id', user.id)
            if (error) { Alert.alert("Couldn't clear pantry", error.message); fetchItems() }
          },
        },
      ],
    )
  }

  const addIngredient = async (overrideCategory?: string) => {
    const name = newIngredientName.trim()
    if (!name || !user) return

    // Two-pass categorization: first try the fast local keyword matcher. If it returns
    // ≥2 candidates (e.g. "cream" → Dairy + Sauces & Condiments), surface a disambig
    // picker instead of guessing. overrideCategory short-circuits this on second call
    // after the user picks from the picker.
    if (!overrideCategory) {
      const matches = autoCategoryMatches(name)
      if (matches.length > 1) {
        setDisambigChoices(matches)
        return
      }
    }

    // Ref guard (not the addSaving state, which updates async) so a fast double-tap can't
    // slip a second insert through the categorizeItem await before the first completes.
    if (addingRef.current) return
    addingRef.current = true
    setAddSaving(true)
    // Falls back to async categorizeItem (LLM-backed) when local matcher returned exactly 0 or 1.
    // Always single category at this point — disambig case already handled above.
    const category = overrideCategory || (await categorizeItem(name))
    setDisambigChoices([])
    const { data, error } = await supabase
      .from('pantry_items')
      .insert({ user_id: user.id, name, category, in_stock: true })
      .select('id, name, category, in_stock, created_at, last_confirmed_at')
      .single()
    setAddSaving(false)
    addingRef.current = false
    if (error || !data) return
    haptic.light() // after the insert, so a failed add never ticks

    const newIng: Ingredient = { id: data.id, name: data.name, inStock: data.in_stock, since: data.last_confirmed_at ?? data.created_at ?? new Date().toISOString() }
    setCategories(prev => {
      const existing = prev.find(c => c.name === category)
      if (existing) {
        return prev.map(c => c.name === category ? { ...c, ingredients: [...c.ingredients, newIng] } : c)
      }
      const cfg = categoryConfigByName[category] ?? { id: category.toLowerCase(), name: category, icon: Package, iconColor: '#888888' }
      return [...prev, { ...cfg, ingredients: [newIng] }]
    })
    setNewIngredientName('')
    setShowAddModal(false)
  }

  const isSearching = searchQuery.trim().length > 0
  // An exact (case-insensitive) name hides the footer's "Add" row; a partial match ("Kimchi
  // Paste" for "kimchi") still offers it, so a shorter name is never unaddable.
  const hasExactMatch = isSearching && categories.some(c => c.ingredients.some(i => i.name.toLowerCase() === searchQuery.trim().toLowerCase()))
  const openAddFromSearch = () => {
    searchRef.current?.blur() // one focused input at a time; the sheet's own field autofocuses
    setNewIngredientName(searchQuery.trim())
    setDisambigChoices([])
    setShowAddModal(true)
  }
  // The query is trimmed — iOS leaves a trailing space after a word, and "rice " would never
  // substring-match "cooked rice", showing a false "No matches". It filters both halves.
  const q = searchQuery.trim().toLowerCase()
  const sections: PantrySection[] = []
  for (const c of categories) {
    // In stored order: fetchItems already put Out rows last. Re-splitting here would move a row the
    // moment it is tapped.
    const rows: PantryRowData[] = []
    for (const i of c.ingredients) {
      if (q && !i.name.toLowerCase().includes(q)) continue
      rows.push({ ...i, catId: c.id })
    }
    if (rows.length > 0) sections.push({ id: c.id, name: c.name, data: rows })
  }

  const totalItems = categories.reduce((s, c) => s + c.ingredients.length, 0)
  // Perishables the app last had evidence of 3+ weeks ago — a scan, a receipt, a grocery check-off
  // or a tap all reset the clock. Staples are never asked about: "untouched" says nothing about a
  // jar of cumin that gets used and rebought without the app hearing of it. The question keeps
  // meal generation honest, since a ghost ingredient costs a real recipe.
  const staleItems = categories.flatMap(c => isPerishable(c.name) ? c.ingredients.filter(i => isStale(i.since, i.inStock)).map(i => ({ ...i, catId: c.id })) : [])
  useEffect(() => { if (staleItems.length === 0) setReviewOpen(false) }, [staleItems.length])


  perfMark('Pantry RENDER')
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header (fixed) ── */}
      <View style={styles.header}>
        {/* No ✚. Typing a name into the search field is how an item is added by hand: the header
            has held a white "Manual Entry" pill, then an icon, and each was a third add path beside
            two scan buttons on a screen whose search field already takes the name. */}
        <PantryGroceryTabs active="pantry" />
      </View>

      {/* ── The pantry, as a grouped list ── */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 }}
        ListEmptyComponent={
          !loaded ? null : isSearching ? (
            // The footer's "Add" row follows this line, so the text only has to say no.
            <Text style={styles.noMatches}>No matches</Text>
          ) : (
            <View style={styles.emptyStateInline}>
              <View style={styles.emptyIconCircle}>
                <Camera size={28} stroke="#4ADE80" strokeWidth={1.8} />
              </View>
              <Text style={styles.emptyTitle}>Your pantry is empty</Text>
              <Text style={styles.emptySub}>Scan a shelf or your fridge and we'll fill this in for you.</Text>
              <PressableScale style={styles.emptyScanBtn} onPress={openScanWithConsent}>
                <ScanLine size={18} stroke="#000" strokeWidth={2.5} />
                <Text style={styles.emptyScanBtnText}>Scan pantry</Text>
              </PressableScale>
            </View>
          )
        }
        ListHeaderComponent={
          <>
            {/* Scan row. Two pills, no line art, no "AI" badges: the illustrations existed to fill
                cards that had nothing to say, and the badge is the tell. Scan pantry is the white
                primary and wider — it is the acquisition hook; a receipt is the follow-up. It is
                also the one bright shape above the list, which is why everything else up here is
                a field or a line of text. */}
            <View style={styles.scanRow}>
              {/* No haptics on these: they only open a scanner. Capture and results carry the feedback. */}
              <PressableScale style={styles.scanPrimary} onPress={openScanWithConsent}>
                <ScanLine size={18} stroke="#000000" strokeWidth={2.4} />
                <Text style={styles.scanPrimaryText}>Scan pantry</Text>
              </PressableScale>
              <PressableScale style={styles.scanSecondary} onPress={openReceiptWithConsent}>
                <Receipt size={17} stroke={COLORS.textWhite} strokeWidth={2} />
                <Text style={styles.scanSecondaryText}>Scan receipt</Text>
              </PressableScale>
            </View>

            {/* Search doubles as manual add — a name with no exact match puts an "Add" row in the
                footer. Styled as a field, not a card: it had the notice strip's padding, border and
                radius and read as one more surface in a stack of four above the first ingredient. */}
            <View style={styles.searchBar}>
              <Search size={16} stroke={COLORS.textMuted} strokeWidth={1.8} />
              <TextInput ref={searchRef} style={styles.searchInput} placeholder="Search or add…" placeholderTextColor="rgba(255,255,255,0.35)" value={searchQuery} onChangeText={setSearchQuery} returnKeyType="search" blurOnSubmit />
              {isSearching && (
                <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7} hitSlop={8}>
                  <X size={16} stroke={COLORS.textMuted} strokeWidth={2} />
                </TouchableOpacity>
              )}
            </View>

            {/* Notices — one line of text each, only when there is something to ACT on, and directly
                above the list they describe. They were cards above the scan row, where a review
                prompt outranked the primary action; the photo banner before that graded the pantry
                ("Dialed in", four ticks) and took ~200pt to do it. The whole line is the tap
                target. Hidden while searching so the results start at the top. */}
            {!isSearching && pantryInsight.tone === 'gap' && (
              <TouchableOpacity style={styles.notice} onPress={addInsightToGrocery} disabled={insightAdded || pantryInsight.suggestedItems.length === 0} activeOpacity={0.7}>
                <Text style={styles.noticeText} numberOfLines={2}>
                  {pantryInsight.headline}
                  {pantryInsight.suggestedItems.length > 0 && (
                    <Text style={styles.noticeLink}> · {insightAdded ? 'Added' : 'Add to grocery'}</Text>
                  )}
                </Text>
              </TouchableOpacity>
            )}
            {/* Perishables in stock with no evidence for three weeks — a question, not a grade.
                Answers land on pantry_items.last_confirmed_at / in_stock. */}
            {!isSearching && staleItems.length > 0 && (
              <TouchableOpacity style={styles.notice} onPress={() => setReviewOpen(true)} activeOpacity={0.7}>
                <Text style={styles.noticeText} numberOfLines={1}>
                  {staleItems.length} perishable{staleItems.length === 1 ? '' : 's'} from 3+ weeks ago
                  <Text style={styles.noticeLink}> · Review</Text>
                </Text>
              </TouchableOpacity>
            )}
          </>
        }
        ListFooterComponent={
          isSearching ? (
            // The typed name, offered as the row it would become. It disappears once an exact
            // match exists, which is also the feedback that the add landed.
            hasExactMatch ? null : (
              <TouchableOpacity style={styles.addRow} onPress={openAddFromSearch} activeOpacity={0.7}>
                <Plus size={16} stroke={COLORS.textWhite} strokeWidth={2.5} />
                <Text style={styles.addRowText} numberOfLines={1}>Add "{searchQuery.trim()}"</Text>
              </TouchableOpacity>
            )
          ) : totalItems > 0 ? (
            <View style={styles.footerWrap}>
              {/* Clear pantry stays as quiet text: destructive and irreversible, so it keeps its
                  confirmation and loses its red button. */}
              <Text style={styles.footerCount}>{totalItems} ingredient{totalItems !== 1 ? 's' : ''}</Text>
              <TouchableOpacity onPress={clearPantry} activeOpacity={0.7} hitSlop={8}>
                <Text style={styles.clearLink}>Clear pantry</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        // Sticky, so the section you are in stays named while its rows scroll under it.
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            {/* No aisle-colour dot: sixteen colours down one scroll read as noise, the sticky name
                does the wayfinding, and Grocery's headers never had one. */}
            <Text style={styles.sectionTitle}>{section.name.toUpperCase()}</Text>
            <Text style={styles.sectionCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <PantryRow
            ingredient={item}
            first={index === 0}
            last={index === section.data.length - 1}
            onDelete={() => deleteIngredient(item.catId, item.id)}
            onToggle={() => toggleStock(item.catId, item.id)}
          />
        )}
      />

      {/* ── Scan Modal ── */}
      <PantryScanModal
        visible={showScanModal}
        onClose={() => setShowScanModal(false)}
        onItemsAdded={() => fetchItems()}
        // The modal owns the post-save flow (first scan auto-reveals; later scans offer a
        // choice). onSeeMeals is the cook-reveal payoff. Pushed IMMEDIATELY, while the modal is
        // still fully presented; the modal dismisses itself ~500 ms later onto the mounted reveal.
        // (The old order — close, then push 400 ms later — showed this tab in the gap. The defer
        // existed because UIKit drops a push that starts mid-dismissal.)
        onSeeMeals={() => router.push('/cook-reveal' as any)}
        onAddByHand={focusAddField}
      />

      {/* ── Receipt Scan Modal ── */}
      <ReceiptScanModal
        visible={showReceiptModal}
        onClose={() => setShowReceiptModal(false)}
        onItemsAdded={fetchItems}
      />

      {/* ── Add Ingredient Modal ── */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Ingredient</Text>
                <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowAddModal(false)}>
                  <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.addInput}
                placeholder="Ingredient name"
                placeholderTextColor={COLORS.textMuted}
                value={newIngredientName}
                onChangeText={(t) => { setNewIngredientName(t); setDisambigChoices([]) }}
                autoFocus
              />

              {disambigChoices.length > 0 ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.pickerLabel}>Which section?</Text>
                  <View style={styles.categoryPicker}>
                    {disambigChoices.map(cat => (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.categoryChip, styles.categoryChipActive]}
                        onPress={() => addIngredient(cat)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.categoryChipText, styles.categoryChipTextActive]}>{cat}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : (
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => { if (Keyboard.isVisible()) { Keyboard.dismiss(); return } setNewIngredientName(''); setDisambigChoices([]); setShowAddModal(false) }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addBtn, (!newIngredientName.trim() || addSaving) && { opacity: 0.5 }]}
                    onPress={() => addIngredient()}
                    activeOpacity={0.85}
                    disabled={!newIngredientName.trim() || addSaving}
                >
                  <Text style={styles.addBtnText}>{addSaving ? 'Adding...' : 'Add'}</Text>
                </TouchableOpacity>
              </View>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── "Still have these?" — the stale-items review ── */}
      <Modal visible={reviewOpen} transparent animationType="slide" onRequestClose={() => setReviewOpen(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setReviewOpen(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Still have these?</Text>
              <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setReviewOpen(false)}>
                <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <Text style={styles.reviewHint}>
              Last seen 3+ weeks ago — by a scan, a receipt or a tap. Tonight's meals are built from what's here, so a ghost ingredient costs a real recipe.
            </Text>
            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              {staleItems.map(i => (
                <View key={i.id} style={styles.reviewRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{i.name}</Text>
                    <Text style={styles.rowAge}>{ageLabelLong(i.since)}</Text>
                  </View>
                  <TouchableOpacity style={styles.reviewBtn} onPress={() => setStock(i.catId, i.id, false)} activeOpacity={0.7}>
                    <Text style={styles.reviewBtnText}>Used up</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.reviewBtn, styles.reviewBtnKeep]} onPress={() => confirmItem(i.catId, i.id)} activeOpacity={0.7}>
                    <Text style={[styles.reviewBtnText, { color: '#000000' }]}>Keep</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.reviewKeepAll} onPress={keepAll} activeOpacity={0.7}>
              <Text style={styles.reviewKeepAllText}>Keep all</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },

  // Notice lines — text, not cards. Green is spent here and nowhere else on this screen: white is
  // the action, grey is information, green is the one soft link, red only on a swipe.
  notice: { paddingVertical: 6, paddingHorizontal: 2 },
  noticeText: { fontSize: 13, color: COLORS.textMuted, lineHeight: 18 },
  noticeLink: { color: COLORS.accentGreen, fontWeight: '600' },

  // Scan row
  scanRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 10 },
  scanPrimary: { flex: 1.6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.textWhite, borderRadius: 30, paddingVertical: 12 },
  scanPrimaryText: { fontSize: 15, fontWeight: '700', color: '#000000' },
  scanSecondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: COLORS.cardElevated, borderRadius: 30, paddingVertical: 12 },
  scanSecondaryText: { fontSize: 14, fontWeight: '600', color: COLORS.textWhite },

  // Grouped list
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 8, paddingHorizontal: 2, backgroundColor: COLORS.background },
  sectionTitle: { flex: 1, fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.2 },
  sectionCount: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)' }, // a step under the title, so the name leads
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: '#141414', paddingHorizontal: 14, paddingVertical: 12 },
  rowFirst: { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  rowLast: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  rowHairline: { position: 'absolute', top: 0, left: 14, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  rowName: { flex: 1, fontSize: 16, color: COLORS.textWhite, fontWeight: '500' },
  // Crossed off — Grocery's treatment for a checked item. The fade is opacity on the row (see
  // PantryRow); marginRight clears the pinned Out tag so a long name truncates before it.
  rowNameOut: { textDecorationLine: 'line-through', marginRight: 46 },
  rowAge: { fontSize: 12, color: COLORS.textMuted, fontWeight: '500' },
  // Pinned to the row's right edge, vertically centred, so the tag's fade never reflows the name.
  outPillPin: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
  // Legible on purpose: the tag is what a faded, struck-through row still says clearly.
  outPill: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  outPillText: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted },
  // The typed name as the row it would become, under the search results.
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#141414', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginTop: 12 },
  addRowText: { flex: 1, fontSize: 16, color: COLORS.textWhite, fontWeight: '500' },
  noMatches: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', paddingTop: 28 },
  deleteActionLast: { borderBottomRightRadius: 14 },

  // Review sheet
  reviewHint: { fontSize: 13, color: COLORS.textMuted, lineHeight: 18, marginBottom: 12 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  reviewBtn: { borderRadius: 30, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: COLORS.cardElevated },
  reviewBtnKeep: { backgroundColor: '#4ADE80' },
  reviewBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite },
  reviewKeepAll: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  reviewKeepAllText: { fontSize: 14, fontWeight: '600', color: '#4ADE80' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  // A field, not a card: fixed 38pt, filled, no border.
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    marginBottom: 8,
    backgroundColor: '#141414',
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15, color: COLORS.textWhite, padding: 0 },





  deleteAction: {
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  deleteText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  emptyScanBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  emptyScanBtnText: { color: '#000000', fontSize: 16, fontWeight: '700' },
  emptyStateInline: {
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 32,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(74,222,128,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.3 },
  emptySub: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20, maxWidth: 280 },

  footerWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 18, paddingBottom: 28 },
  footerCount: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500', letterSpacing: 0.3 },
  clearLink: { fontSize: 13, fontWeight: '600', color: '#EF4444' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: COLORS.cardElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.4 },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },

  addInput: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.textWhite,
    marginBottom: 20,
  },
  pickerLabel: { fontSize: 13, color: COLORS.textDim, fontWeight: '600', marginBottom: 12 },
  categoryPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 28 },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
  },
  categoryChipActive: { backgroundColor: COLORS.textWhite },
  categoryChipText: { fontSize: 13, color: COLORS.textDim, fontWeight: '500' },
  categoryChipTextActive: { color: '#000000' },

  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
  },
  cancelBtnText: { color: COLORS.textDim, fontSize: 15, fontWeight: '600' },
  addBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: COLORS.textWhite,
  },
  addBtnText: { color: '#000000', fontSize: 15, fontWeight: '700' },

})
