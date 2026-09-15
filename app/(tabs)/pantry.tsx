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
  LayoutAnimation,
  Keyboard,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
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
import { ageLabel, isStale } from '@/lib/pantryAge'
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

const CATEGORY_CONFIG = STORE_CATEGORIES.map(name => ({
  id: name.toLowerCase().replace(/[^a-z]/g, ''),
  name,
  icon: CATEGORY_ICONS[name] ?? Package,
  iconColor: CATEGORY_COLORS[name] ?? '#888888',
}))

const INSIGHT_ROTATION_KEY = 'pantry_insight_rotation' // visit counter → rotates the insight headline (Step D)
const categoryConfigByName = Object.fromEntries(CATEGORY_CONFIG.map(c => [c.name, c]))
const categoryConfigById   = Object.fromEntries(CATEGORY_CONFIG.map(c => [c.id,   c]))

// ── One ingredient row ─────────────────────────────────────────────────
//
// Every item is visible under its section header — the accordions hid the list behind a tap and
// a count badge, on the tab whose whole job is "what do I have". Tap = in/out of stock, swipe =
// delete; the age is the grey number on the right, and an out-of-stock row dims with an "Out" tag.
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
      <TouchableOpacity style={[styles.row, first && styles.rowFirst, last && styles.rowLast, !first && styles.rowDivider]} onPress={onToggle} activeOpacity={0.7}>
        <Text style={[styles.rowName, !ingredient.inStock && styles.rowNameOut]} numberOfLines={1}>{ingredient.name}</Text>
        {ingredient.inStock
          ? <Text style={styles.rowAge}>{ageLabel(ingredient.since)}</Text>
          : <View style={styles.outPill}><Text style={styles.outPillText}>Out</Text></View>}
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
    const rows = await Promise.all(pantryInsight.suggestedItems.map(async name => ({
      user_id: user.id, name, category: await categorizeItem(name), checked: false,
    })))
    await supabase.from('grocery_items').insert(rows)
  }
  useEffect(() => { setInsightAdded(false) }, [pantryInsight.headline]) // reset the CTA when the insight changes


  const fetchItems = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('pantry_items')
      .select('id, name, category, in_stock, created_at, last_confirmed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    if (!data) return

    // Group by category, preserving config order
    const grouped = new Map<string, Ingredient[]>()
    for (const row of data) {
      const catName = row.category || 'Other'
      if (!grouped.has(catName)) grouped.set(catName, [])
      grouped.get(catName)!.push({ id: row.id, name: row.name, inStock: row.in_stock, since: row.last_confirmed_at ?? row.created_at })
    }

    // Build ordered category list: config order first, then any unknown
    const result: Category[] = []
    for (const cfg of CATEGORY_CONFIG) {
      const ingredients = grouped.get(cfg.name) ?? []
      if (ingredients.length > 0) {
        result.push({ ...cfg, ingredients })
      }
    }
    // Any categories not in config
    for (const [catName, ingredients] of grouped) {
      if (!categoryConfigByName[catName]) {
        result.push({ id: catName.toLowerCase(), name: catName, icon: Package, iconColor: '#888888', ingredients })
      }
    }

    // Section order is the store order the grocery list already uses. The drag-reorder that
    // used to live here went with the accordions; a device-local order nobody set was one more
    // way for two screens to disagree.
    setCategories(result)
    setLoaded(true)
  }, [user?.id])

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
    setReviewOpen(false)
    await supabase.from('pantry_items').update({ last_confirmed_at: now }).in('id', ids)
  }

  const deleteIngredient = async (categoryId: string, ingredientId: string) => {
    haptic.medium() // stronger tick than a routine tap — this removes something
    // Only animate the surrounding rows/categories closing the gap. The swiped row's transform
    // is still held by gesture-handler, so a `delete` config here would fight it and glitch.
    LayoutAnimation.configureNext({
      duration: 250,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
    })
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
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
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
  const visibleCategories = isSearching
    ? categories
        .map(cat => ({
          ...cat,
          ingredients: cat.ingredients.filter(i =>
            // trim() the query — iOS leaves a trailing space after a word, and "rice " would
            // never substring-match "cooked rice", showing a false "No matches".
            i.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
          ),
        }))
        .filter(cat => cat.ingredients.length > 0)
    : categories

  const totalItems = categories.reduce((s, c) => s + c.ingredients.length, 0)
  // In stock and untouched for 3+ weeks. The pantry could only grow (every write set in_stock
  // TRUE), so meal generation cooked from ghosts; this is the question that keeps it honest.
  const staleItems = categories.flatMap(c => c.ingredients.filter(i => isStale(i.since, i.inStock)).map(i => ({ ...i, catId: c.id })))
  useEffect(() => { if (staleItems.length === 0) setReviewOpen(false) }, [staleItems.length])


  perfMark('Pantry RENDER')
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header (fixed) ── */}
      <View style={styles.header}>
        <PantryGroceryTabs active="pantry" />
        {/* The one way to type an item in. Was a solid white "Manual Entry" pill — the loudest
            control on the screen while not being its primary action — then an icon plus a second
            "Add an item" row at the end of the list; the row went, the icon is where iOS puts add. */}
        <TouchableOpacity
          style={styles.addIconBtn}
          onPress={() => setShowAddModal(true)}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Add an item to your pantry"
        >
          <Plus size={20} stroke={COLORS.textWhite} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {/* ── The pantry, as a grouped list ── */}
      <SectionList
        sections={visibleCategories.map(c => ({ ...c, data: c.ingredients }))}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 }}
        ListEmptyComponent={
          loaded ? (
            <View style={styles.emptyStateInline}>
              <View style={styles.emptyIconCircle}>
                <Camera size={28} stroke="#4ADE80" strokeWidth={1.8} />
              </View>
              <Text style={styles.emptyTitle}>
                {isSearching ? 'No matches' : 'Your pantry is empty'}
              </Text>
              <Text style={styles.emptySub}>
                {isSearching
                  ? "Try a different search — or add it as a new item."
                  : "Scan a shelf or your fridge and we'll fill this in for you."}
              </Text>
              {!isSearching && (
                <PressableScale style={styles.emptyScanBtn} haptic onPress={openScanWithConsent}>
                  <ScanLine size={18} stroke="#000" strokeWidth={2.5} />
                  <Text style={styles.emptyScanBtnText}>Scan pantry</Text>
                </PressableScale>
              )}
            </View>
          ) : null
        }
        ListHeaderComponent={
          <>
            {/* Status strips — one line each, only when there is something to ACT on. The photo
                banner that used to sit here graded the pantry ("Dialed in", four ticks) and took
                ~200pt to do it; a gap is the only insight worth a line, and it comes with its
                action. Hidden while searching so the results start at the top. */}
            {!isSearching && pantryInsight.tone === 'gap' && (
              <View style={styles.strip}>
                <View style={[styles.stripDot, { backgroundColor: COLORS.macroPrep }]} />
                <Text style={styles.stripText} numberOfLines={2}>{pantryInsight.headline}</Text>
                {pantryInsight.suggestedItems.length > 0 && (
                  <TouchableOpacity onPress={addInsightToGrocery} disabled={insightAdded} hitSlop={8} activeOpacity={0.7}>
                    <Text style={styles.stripLink}>{insightAdded ? '✓ Added' : 'Add to grocery'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {/* The check that asks a question instead of grading: items in stock and untouched for
                three weeks. Answers land on pantry_items.last_confirmed_at / in_stock. */}
            {!isSearching && staleItems.length > 0 && (
              <View style={styles.strip}>
                <View style={[styles.stripDot, { backgroundColor: COLORS.textMuted }]} />
                <Text style={styles.stripText} numberOfLines={2}>
                  {staleItems.length} item{staleItems.length === 1 ? '' : 's'} untouched for 3+ weeks
                </Text>
                <TouchableOpacity onPress={() => setReviewOpen(true)} hitSlop={8} activeOpacity={0.7}>
                  <Text style={styles.stripLink}>Still have {staleItems.length === 1 ? 'it' : 'them'}?</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Scan row. Two pills, no line art, no "AI" badges: the illustrations existed to fill
                cards that had nothing to say, and the badge is the tell. Scan pantry is the white
                primary and wider — it is the acquisition hook; a receipt is the follow-up. */}
            <View style={styles.scanRow}>
              <PressableScale style={styles.scanPrimary} haptic onPress={openScanWithConsent}>
                <ScanLine size={18} stroke="#000000" strokeWidth={2.4} />
                <Text style={styles.scanPrimaryText}>Scan pantry</Text>
              </PressableScale>
              <PressableScale style={styles.scanSecondary} haptic onPress={openReceiptWithConsent}>
                <Receipt size={17} stroke={COLORS.textWhite} strokeWidth={2} />
                <Text style={styles.scanSecondaryText}>Scan receipt</Text>
              </PressableScale>
            </View>

            {/* Search bar */}
            <View style={[styles.searchBar, { marginHorizontal: 0 }]}>
              <Search size={16} stroke={COLORS.textMuted} strokeWidth={1.8} />
              <TextInput ref={searchRef} style={styles.searchInput} placeholder="Search ingredients..." placeholderTextColor={COLORS.textMuted} value={searchQuery} onChangeText={setSearchQuery} returnKeyType="search" blurOnSubmit />
              {isSearching && (
                <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7}>
                  <X size={16} stroke={COLORS.textMuted} strokeWidth={2} />
                </TouchableOpacity>
              )}
            </View>
          </>
        }
        ListFooterComponent={
          totalItems > 0 ? (
            <View style={styles.footerWrap}>
              {/* One add control — the ✚ in the header. Clear pantry stays as quiet text: destructive
                  and irreversible, so it keeps its confirmation and loses its red button. */}
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
            <View style={[styles.sectionDot, { backgroundColor: section.iconColor }]} />
            <Text style={styles.sectionTitle}>{section.name.toUpperCase()}</Text>
            <Text style={styles.sectionCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <PantryRow
            ingredient={item}
            first={index === 0}
            last={index === section.data.length - 1}
            onDelete={() => deleteIngredient(section.id, item.id)}
            onToggle={() => toggleStock(section.id, item.id)}
          />
        )}
      />

      {/* ── Scan Modal ── */}
      <PantryScanModal
        visible={showScanModal}
        onClose={() => setShowScanModal(false)}
        onItemsAdded={() => fetchItems()}
        // The modal owns the post-save flow (first scan auto-reveals; later scans offer a
        // choice). onSeeMeals is the cook-reveal payoff — deferred ~400ms so the scan <Modal>
        // slides away first, otherwise the nav is swallowed under the presented native modal.
        onSeeMeals={() => setTimeout(() => router.push('/cook-reveal' as any), 400)}
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
              Untouched for 3+ weeks. Tonight's meals are built from what's here, so a ghost ingredient costs a real recipe.
            </Text>
            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              {staleItems.map(i => (
                <View key={i.id} style={styles.reviewRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{i.name}</Text>
                    <Text style={styles.rowAge}>{ageLabel(i.since)}</Text>
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

  // Status strips
  strip: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#141414', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  stripDot: { width: 8, height: 8, borderRadius: 4 },
  stripText: { flex: 1, fontSize: 13, color: COLORS.textWhite },
  stripLink: { fontSize: 13, fontWeight: '700', color: '#4ADE80' },

  // Scan row
  scanRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 12 },
  scanPrimary: { flex: 1.6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.textWhite, borderRadius: 30, paddingVertical: 14 },
  scanPrimaryText: { fontSize: 15, fontWeight: '700', color: '#000000' },
  scanSecondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: COLORS.cardElevated, borderRadius: 30, paddingVertical: 14 },
  scanSecondaryText: { fontSize: 14, fontWeight: '600', color: COLORS.textWhite },

  // Grouped list
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 16, paddingBottom: 8, paddingHorizontal: 2, backgroundColor: COLORS.background },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { flex: 1, fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.2 },
  sectionCount: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: '#141414', paddingHorizontal: 14, paddingVertical: 12 },
  rowFirst: { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  rowLast: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  rowName: { flex: 1, fontSize: 15, color: COLORS.textWhite, fontWeight: '500' },
  rowNameOut: { color: COLORS.textMuted, textDecorationLine: 'line-through' },
  rowAge: { fontSize: 12, color: COLORS.textMuted, fontWeight: '500' },
  outPill: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  outPillText: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted },
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
  addIconBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.cardElevated,
  },

  // Gap chips get an amber tint + hairline so the eye lands on what's missing; ok chips stay quiet.

  // Absolute-positioned variant — sits in the top-right corner of the card so
  // we can drop the icon row entirely and let the title start at the top.
  // Compact animated illustration sitting below the title in each scan card.
  // Mirrors the home-screen hero animation but downsized to fit the card width.

  // kept for reference — replaced by scanRow

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.trackDark,
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
