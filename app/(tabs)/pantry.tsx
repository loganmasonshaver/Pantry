import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  Animated as RNAnimated,
  Easing,
  Alert,
  LayoutAnimation,
} from 'react-native'
import Svg, { G as SvgG, Rect as SvgRect, Line as SvgLine, Path as SvgPath } from 'react-native-svg'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Plus, ChevronDown, Check, X, Search, ScanLine, Package, Camera, Receipt, Apple, Wheat, Beef, Egg, Snowflake, Cookie, Coffee, Droplet, Salad, Bean, Nut, CakeSlice, Soup, Croissant, Flame, Ham, GripVertical, RefreshCw, Trash2 } from 'lucide-react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { LinearGradient } from 'expo-linear-gradient'
import { COLORS } from '@/constants/colors'
import { isAssumedStaple, dietExcludedStaples } from '@/constants/staples'
import { useAuth } from '@/context/AuthContext'
import { usePremium } from '@/context/SuperwallContext'
import { useAIConsent } from '@/context/AIConsentContext'
import { supabase } from '@/lib/supabase'
import { haptic } from '@/lib/haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { STORE_CATEGORIES, autoCategoryMatches, categorizeItem } from '@/lib/categories'
import { buildInsight, type FitnessGoal, type DietType } from '@/lib/pantryProfile'
import { useMealSuggestions } from '@/lib/useMealSuggestions'
import PantryScanModal from '@/components/PantryScanModal'
import ReceiptScanModal from '@/components/ReceiptScanModal'
import PressableScale from '@/components/PressableScale'
import Reanimated, { FadeIn } from 'react-native-reanimated'
import PantryGroceryTabs from '@/components/PantryGroceryTabs'
import { Shimmer } from '@/components/Shimmer'

// ── Types ──────────────────────────────────────────────────────────────

type Ingredient = {
  id: string
  name: string
  inStock: boolean
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

const CATEGORY_ORDER_KEY = 'pantry_category_order' // device-local saved drag order of categories
const categoryConfigByName = Object.fromEntries(CATEGORY_CONFIG.map(c => [c.name, c]))
const categoryConfigById   = Object.fromEntries(CATEGORY_CONFIG.map(c => [c.id,   c]))

// ── Swipeable ingredient row ───────────────────────────────────────────

function IngredientRow({
  ingredient,
  onDelete,
  onToggle,
}: {
  ingredient: Ingredient
  onDelete: () => void
  onToggle: () => void
}) {
  return (
    <Swipeable
      renderRightActions={() => (
        <TouchableOpacity style={styles.deleteAction} onPress={onDelete} activeOpacity={0.85}>
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      )}
      friction={2}
      overshootRight={false}
    >
      <View style={styles.ingredientRow}>
        <Text style={styles.ingredientName}>{ingredient.name}</Text>
        {!ingredient.inStock && (
          <View style={styles.outOfStockPill}>
            <Text style={styles.outOfStockPillText}>Out</Text>
          </View>
        )}
        <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
          {ingredient.inStock ? (
            <View style={styles.checkCircle}>
              <Check size={12} stroke="#000000" strokeWidth={2.5} />
            </View>
          ) : (
            <View style={styles.outOfStockDot} />
          )}
        </TouchableOpacity>
      </View>
    </Swipeable>
  )
}

// ── Category section ───────────────────────────────────────────────────

function CategorySection({
  category,
  isExpanded,
  onToggle,
  onDelete,
  onToggleStock,
  drag,
}: {
  category: Category
  isExpanded: boolean
  onToggle: () => void
  onDelete: (id: string) => void
  onToggleStock: (id: string) => void
  drag?: () => void
}) {
  return (
    <View>
      <View style={[styles.categorySection, isExpanded && styles.categorySectionExpanded]}>
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 }}
          onPress={onToggle}
          activeOpacity={0.7}
        >
          <View style={[styles.categoryIconCircle, isExpanded && { backgroundColor: `${category.iconColor}20` }]}>
            <category.icon size={18} stroke={isExpanded ? category.iconColor : COLORS.textMuted} strokeWidth={1.8} />
          </View>
          <Text style={styles.categoryName}>{category.name}</Text>
          <View style={styles.categoryCountPill}>
            <Text style={[styles.categoryCount, isExpanded && { color: category.iconColor }]}>{category.ingredients.length}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPressIn={drag} style={{ padding: 8 }}>
          <GripVertical size={16} stroke={COLORS.textMuted} strokeWidth={1.5} style={{ opacity: 0.5 }} />
        </TouchableOpacity>
      </View>

      {isExpanded && (
        <View style={styles.ingredientList}>
          {category.ingredients.map((ing, index) => (
            <View key={ing.id}>
              <IngredientRow
                ingredient={ing}
                onDelete={() => onDelete(ing.id)}
                onToggle={() => onToggleStock(ing.id)}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

// ── Pantry screen ──────────────────────────────────────────────────────

export default function PantryScreen() {
  const { user } = useAuth()
  const router = useRouter()
  const { isPremium } = usePremium()
  const [categories, setCategories] = useState<Category[]>([])
  const [loaded, setLoaded] = useState(false) // gate the empty state until the first fetch lands, so "your pantry is empty" doesn't flash before items arrive
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(['protein']))
  const [searchQuery, setSearchQuery] = useState('')
  const [showScanModal, setShowScanModal] = useState(false)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const { requestConsent } = useAIConsent()
  // Consent must be gathered BEFORE the scan modal opens: two native iOS modals can't stack,
  // so a consent prompt fired from inside the open scan modal gets queued behind it and only
  // surfaces after the user exits (and the scan hangs waiting on it). Gate it at the tap.
  const openScanWithConsent = async () => { if (await requestConsent()) setShowScanModal(true) }
  const openReceiptWithConsent = async () => { if (await requestConsent()) setShowReceiptModal(true) }

  // Sweeping scan-beam animation reused by both scan cards. Single shared Animated
  // value so both beams stay perfectly in sync — visually reads as one continuous
  // pulse across the row. Loops indefinitely on mount.
  const scanCardBeam = useRef(new RNAnimated.Value(0)).current
  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(scanCardBeam, { toValue: 1, duration: 2200, useNativeDriver: true, easing: Easing.linear }),
        RNAnimated.timing(scanCardBeam, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])
  const [showAddModal, setShowAddModal] = useState(false)
  const [newIngredientName, setNewIngredientName] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const addingRef = useRef(false) // synchronous in-flight guard for addIngredient (double-tap)
  const [disambigChoices, setDisambigChoices] = useState<string[]>([])
  const searchRef = useRef<TextInput>(null)

  // Cook Tonight — moved from Home tab in Phase 2b of the IA refactor. Lives here
  // because "what to cook from my pantry" is a kitchen task, not a tracking task.
  // Visually distinct from the Discover tab (cinematic horizontal browse): compact
  // action-rows with missing-ingredient surfacing, anchored to actual pantry contents.
  // Generation fires once per day (daily cache). Manual refresh button is capped at
  // 1/day per user to bound image-gen cost — see MAX_DAILY_REGENS in useMealSuggestions.
  const hasPantryItems = categories.some(c => c.ingredients.length > 0)
  const { meals, loading: mealsLoading, error: mealsError, errorCode: mealsErrorCode, regenerate, retry, canRegenerate } = useMealSuggestions(
    user?.id, isPremium, 'cookNow', hasPantryItems
  )

  // Lower-cased pantry names for fuzzy substring matching against meal ingredients.
  const pantryNameSet = useMemo(() => {
    return new Set(
      categories.flatMap(c => c.ingredients.map(i => i.name.toLowerCase()))
    )
  }, [categories])

  // Staples the user has opted out of assuming — their manual "I don't keep this" taps
  // (staples_excluded) PLUS diet-conflicting basics (butter for vegan, flour for GF).
  // Mirrors meal-detail so an exclusion made there is honored in the Cook Tonight NEED
  // list here — otherwise the two surfaces disagree on what counts as a basic.
  const [excludedStaples, setExcludedStaples] = useState<Set<string>>(new Set())
  // Goal/diet fields for the personalized pantry insight (see lib/pantryProfile + PLAN.md).
  const [insightProfile, setInsightProfile] = useState<{ goal: FitnessGoal | null; diet: DietType | null; restrictions: string[]; dislikes: string[]; cuisines: string[]; cookingSkill: string | null; maxPrep: number | null } | null>(null)
  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('staples_excluded, dietary_restrictions, fitness_goal, diet_type, food_dislikes, cuisine_preferences, cooking_skill, max_prep_minutes').eq('id', user.id).single()
      .then(({ data }) => {
        const manual = (data?.staples_excluded ?? []).map((s: string) => s.toLowerCase())
        setExcludedStaples(new Set([...manual, ...dietExcludedStaples(data?.dietary_restrictions ?? [])]))
        setInsightProfile({
          goal: (data?.fitness_goal as FitnessGoal) ?? null,
          diet: (data?.diet_type as DietType) ?? null,
          restrictions: data?.dietary_restrictions ?? [],
          dislikes: data?.food_dislikes ?? [],
          cuisines: data?.cuisine_preferences ?? [],
          cookingSkill: data?.cooking_skill ?? null,
          maxPrep: data?.max_prep_minutes ?? null,
        })
      })
  }, [user])

  // Personalized "what to stock next" insight — replaces the old item-count "Stock Level".
  // In-stock items only; keyed on the item's real store category (Produce, Meat & Fish, …).
  const pantryInsight = useMemo(() => {
    const items = categories.flatMap(c => c.ingredients.filter(i => i.inStock).map(i => ({ name: i.name, category: c.name })))
    return buildInsight(items, insightProfile?.goal, insightProfile?.diet, insightProfile?.restrictions ?? [], insightProfile?.dislikes ?? [], insightProfile?.cuisines ?? [], insightProfile?.cookingSkill ?? null, insightProfile?.maxPrep ?? null)
  }, [categories, insightProfile])

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

  const missingFor = (mealIngs: { name: string }[] | undefined): string[] => {
    if (!mealIngs) return []
    const missing: string[] = []
    for (const ing of mealIngs) {
      const n = ing.name.toLowerCase()
      // Canonical staple check (constants/staples) — keeps "Need: …" honest by not
      // flagging salt/oil/etc. Single source of truth; the old local list drifted and
      // missed aliases like "cooking oil", which then leaked into NEED. Excluded set
      // makes a user's "I don't keep this" opt-out flip the basic back into NEED.
      if (isAssumedStaple(ing.name, excludedStaples)) continue
      // Two-way substring match — pantry "chicken breast" covers meal "chicken",
      // and pantry "chicken" covers meal "chicken breast".
      let have = false
      for (const p of pantryNameSet) {
        if (p === n || p.includes(n) || n.includes(p)) { have = true; break }
      }
      if (!have) missing.push(ing.name)
    }
    return missing
  }

  // Manual refresh removed — Cook Tonight regenerates automatically when (a) a new day
  // starts (daily cache) or (b) pantry changes by 3+ items since last gen (handled in
  // useMealSuggestions). Killing the button bounds image-gen cost at scale.

  const fetchItems = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('pantry_items')
      .select('id, name, category, in_stock')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    if (!data) return

    // Group by category, preserving config order
    const grouped = new Map<string, Ingredient[]>()
    for (const row of data) {
      const catName = row.category || 'Other'
      if (!grouped.has(catName)) grouped.set(catName, [])
      grouped.get(catName)!.push({ id: row.id, name: row.name, inStock: row.in_stock })
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

    // Apply the user's saved drag order if present: saved names first (in saved order),
    // then anything new that wasn't in the saved order, appended in config order.
    try {
      const savedRaw = await AsyncStorage.getItem(CATEGORY_ORDER_KEY)
      if (savedRaw) {
        const savedOrder: string[] = JSON.parse(savedRaw)
        const rank = new Map(savedOrder.map((name, i) => [name, i]))
        result.sort((a, b) => (rank.get(a.name) ?? 999) - (rank.get(b.name) ?? 999))
      }
    } catch {}

    setCategories(result)
    setLoaded(true)
  }, [user?.id])

  useFocusEffect(useCallback(() => {
    fetchItems()
  }, [fetchItems]))

  const toggleSection = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleStock = async (categoryId: string, ingredientId: string) => {
    const cat = categories.find(c => c.id === categoryId)
    const ing = cat?.ingredients.find(i => i.id === ingredientId)
    if (!ing) return
    const next = !ing.inStock
    setCategories(prev =>
      prev.map(c =>
        c.id === categoryId
          ? { ...c, ingredients: c.ingredients.map(i => i.id === ingredientId ? { ...i, inStock: next } : i) }
          : c
      )
    )
    await supabase.from('pantry_items').update({ in_stock: next }).eq('id', ingredientId)
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
      .select('id, name, category, in_stock')
      .single()
    setAddSaving(false)
    addingRef.current = false
    if (error || !data) return

    const newIng: Ingredient = { id: data.id, name: data.name, inStock: data.in_stock }
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
            i.name.toLowerCase().includes(searchQuery.toLowerCase())
          ),
        }))
        .filter(cat => cat.ingredients.length > 0)
    : categories

  const totalItems = categories.reduce((s, c) => s + c.ingredients.length, 0)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header (fixed) ── */}
      <View style={styles.header}>
        <PantryGroceryTabs active="pantry" />
        <TouchableOpacity style={styles.manualEntryBtn} onPress={() => setShowAddModal(true)} activeOpacity={0.7}>
          <Plus size={14} stroke="#000000" strokeWidth={2.5} />
          <Text style={styles.manualEntryText}>Manual Entry</Text>
        </TouchableOpacity>
      </View>

      {/* ── Category sections (draggable) ── */}
      <DraggableFlatList
          data={visibleCategories}
          keyExtractor={(item) => item.id}
          onDragEnd={({ data }) => {
            if (!isSearching) {
              setCategories(data)
              // Persist the order (device-local — it's a UI preference) so fetchItems can
              // restore it instead of always re-sorting by CATEGORY_CONFIG on next focus.
              AsyncStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(data.map(c => c.name))).catch(() => {})
            }
          }}
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
                  <Text style={styles.emptyScanBtnText}>Scan Pantry</Text>
                </PressableScale>
              )}
            </View>
            ) : null
          }
          ListHeaderComponent={
            <>
              {/* Hero banner — a personalized "what to stock next" insight (goal + diet aware),
                  replacing the old item-count "Stock Level" (see lib/pantryProfile). */}
              <View style={[styles.heroBanner, { marginHorizontal: 0 }]}>
                <Image
                  source={{ uri: 'https://fdafjnkqqtpsjtddbfdz.supabase.co/storage/v1/object/public/ingredient-images/pantry-hero.webp?v=2' }}
                  style={[styles.heroBannerImage, { opacity: totalItems >= 25 ? 0.6 : totalItems > 0 ? 0.45 : 0.35 }]}
                  resizeMode="cover"
                />
                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)', '#000000']} locations={[0.2, 0.7, 1]} style={styles.heroBannerGradient} />
                <View style={styles.heroBannerContent}>
                  <Text style={styles.heroBannerLabel}>{pantryInsight.tone === 'affirm' ? 'PANTRY CHECK' : pantryInsight.tone === 'empty' ? 'GET STARTED' : 'STOCK NEXT'}</Text>
                  <Text style={styles.heroInsightHeadline}>{pantryInsight.headline}</Text>
                  <Text style={styles.heroInsightDetail} numberOfLines={2}>{pantryInsight.detail}</Text>
                  {pantryInsight.suggestedItems.length > 0 && (
                    <PressableScale style={styles.heroInsightCta} onPress={addInsightToGrocery} haptic disabled={insightAdded}>
                      <Text style={styles.heroInsightCtaText}>
                        {insightAdded ? '✓ Added to grocery' : `Add ${pantryInsight.suggestedItems.join(', ')} to grocery`}
                      </Text>
                    </PressableScale>
                  )}
                </View>
              </View>

              {/* Scan cards — each card has a compact animated illustration filling
                  the lower half so the cards aren't visually empty. Both share the
                  same scanCardBeam loop so the sweeping beams stay in sync. */}
              <View style={[styles.scanRow, { marginHorizontal: 0 }]}>
                <TouchableOpacity style={[styles.scanCard, { flex: 1 }]} onPress={openScanWithConsent} activeOpacity={0.85}>
                  <View style={styles.scanCardBadgeAbs}><Text style={styles.scanCardBadgeText}>AI</Text></View>
                  <View><Text style={styles.scanCardTitle}>Scan Pantry</Text><Text style={styles.scanCardSub}>Auto-detect items</Text></View>
                  {/* Compact pantry visual: 2 shelves × 3 items, beam sweeps top→bottom */}
                  <View style={styles.scanCardVisual}>
                    <Svg width="100%" height="100%" viewBox="0 0 160 70">
                      {[24, 56].map(y => (
                        <SvgG key={y}>
                          <SvgRect x={6} y={y - 1.5} width={148} height={2} fill="rgba(74,222,128,0.18)" />
                          <SvgLine x1={6} y1={y + 0.5} x2={154} y2={y + 0.5} stroke="#4ADE80" strokeWidth={1} opacity={0.55} />
                        </SvgG>
                      ))}
                      {/* Shelf 1 */}
                      <SvgG>
                        <SvgRect x={16} y={6} width={14} height={2.5} rx={0.5} stroke="#4ADE80" strokeWidth={1} fill="rgba(74,222,128,0.15)" />
                        <SvgRect x={17} y={8.5} width={12} height={15} rx={1.5} stroke="#4ADE80" strokeWidth={1} fill="rgba(74,222,128,0.05)" />
                        <SvgRect x={18} y={14} width={10} height={6} fill="rgba(0,201,167,0.30)" />
                      </SvgG>
                      <SvgG>
                        <SvgRect x={72} y={6} width={18} height={17} stroke="#4ADE80" strokeWidth={1} fill="rgba(74,222,128,0.05)" />
                        <SvgLine x1={74} y1={10} x2={88} y2={10} stroke="#4ADE80" strokeWidth={0.8} opacity={0.5} />
                        <SvgRect x={74} y={14} width={14} height={3} fill="rgba(0,201,167,0.30)" />
                      </SvgG>
                      <SvgG>
                        <SvgRect x={120} y={8} width={20} height={1.5} rx={0.3} stroke="#4ADE80" strokeWidth={1} fill="rgba(74,222,128,0.2)" />
                        <SvgRect x={120} y={9.5} width={20} height={14} stroke="#4ADE80" strokeWidth={1} fill="rgba(74,222,128,0.05)" />
                        <SvgRect x={120} y={14} width={20} height={5} fill="rgba(0,201,167,0.30)" />
                      </SvgG>
                      {/* Shelf 2 */}
                      <SvgG>
                        <SvgRect x={16} y={38} width={16} height={2.5} rx={0.5} stroke="#4ADE80" strokeWidth={1} fill="rgba(74,222,128,0.2)" />
                        <SvgRect x={17} y={40.5} width={14} height={15} rx={1.5} stroke="#4ADE80" strokeWidth={1} fill="rgba(74,222,128,0.05)" />
                        <SvgRect x={17} y={46} width={14} height={7} fill="rgba(0,201,167,0.30)" />
                      </SvgG>
                      <SvgG>
                        <SvgPath d="M 72 56 L 72 41 L 81 38 L 90 41 L 90 56 Z" stroke="#4ADE80" strokeWidth={1} fill="rgba(74,222,128,0.05)" />
                        <SvgRect x={73} y={48} width={16} height={6} fill="rgba(0,201,167,0.30)" />
                      </SvgG>
                      <SvgG>
                        <SvgRect x={118} y={42} width={24} height={14} stroke="#4ADE80" strokeWidth={1} fill="rgba(74,222,128,0.05)" />
                        <SvgRect x={118} y={47} width={24} height={4} fill="rgba(0,201,167,0.30)" />
                      </SvgG>
                    </Svg>
                    {/* Corner brackets */}
                    <View style={[styles.scanCardCorner, styles.scanCardCornerTL]} />
                    <View style={[styles.scanCardCorner, styles.scanCardCornerTR]} />
                    <View style={[styles.scanCardCorner, styles.scanCardCornerBL]} />
                    <View style={[styles.scanCardCorner, styles.scanCardCornerBR]} />
                    {/* Sweeping beam */}
                    <RNAnimated.View
                      pointerEvents="none"
                      style={[
                        styles.scanCardBeam,
                        {
                          transform: [{
                            translateY: scanCardBeam.interpolate({ inputRange: [0, 1], outputRange: [2, 68] }),
                          }],
                        },
                      ]}
                    />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.scanCard, { flex: 1 }]} onPress={openReceiptWithConsent} activeOpacity={0.85}>
                  <View style={styles.scanCardBadgeAbs}><Text style={styles.scanCardBadgeText}>AI</Text></View>
                  <View><Text style={styles.scanCardTitle}>Scan Receipt</Text><Text style={styles.scanCardSub}>Import purchases</Text></View>
                  {/* Compact receipt visual: paper with item lines + price column, beam sweeps */}
                  <View style={styles.scanCardVisual}>
                    <Svg width="100%" height="100%" viewBox="0 0 160 70">
                      {/* Receipt body with serrated bottom edge */}
                      <SvgPath
                        d="M 40 4 L 120 4 L 120 60 L 116 56 L 112 60 L 108 56 L 104 60 L 100 56 L 96 60 L 92 56 L 88 60 L 84 56 L 80 60 L 76 56 L 72 60 L 68 56 L 64 60 L 60 56 L 56 60 L 52 56 L 48 60 L 44 56 L 40 60 Z"
                        stroke="#4ADE80"
                        strokeWidth={1}
                        fill="rgba(74,222,128,0.05)"
                      />
                      {/* Header line (store name placeholder) */}
                      <SvgRect x={50} y={10} width={40} height={3} rx={0.5} fill="rgba(74,222,128,0.30)" />
                      {/* Itemized rows: 5 rows of (item label + price) */}
                      {[20, 28, 36, 44, 52].map(y => (
                        <SvgG key={y}>
                          <SvgRect x={46} y={y} width={32} height={1.5} rx={0.4} fill="rgba(74,222,128,0.22)" />
                          <SvgRect x={94} y={y} width={20} height={1.5} rx={0.4} fill="rgba(0,201,167,0.30)" />
                        </SvgG>
                      ))}
                    </Svg>
                    {/* Corner brackets */}
                    <View style={[styles.scanCardCorner, styles.scanCardCornerTL]} />
                    <View style={[styles.scanCardCorner, styles.scanCardCornerTR]} />
                    <View style={[styles.scanCardCorner, styles.scanCardCornerBL]} />
                    <View style={[styles.scanCardCorner, styles.scanCardCornerBR]} />
                    {/* Sweeping beam (same value as pantry card → in sync) */}
                    <RNAnimated.View
                      pointerEvents="none"
                      style={[
                        styles.scanCardBeam,
                        {
                          transform: [{
                            translateY: scanCardBeam.interpolate({ inputRange: [0, 1], outputRange: [2, 68] }),
                          }],
                        },
                      ]}
                    />
                  </View>
                </TouchableOpacity>
              </View>

              {/* ── Cook Tonight — utility-framed action list (NOT the cinematic browse
                  experience that lives in the Discover tab). Compact rows surface
                  what's missing per meal so the section is unmistakably pantry-anchored. ── */}
              {hasPantryItems && (
                <View style={{ marginBottom: 24 }}>
                  <View style={styles.cookTonightHeader}>
                    <View>
                      <Text style={styles.cookTonightTitle}>Cook tonight</Text>
                      <Text style={styles.cookTonightSub}>
                        {canRegenerate ? 'From what you have' : 'Refreshed today · New tomorrow'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={regenerate}
                      hitSlop={10}
                      activeOpacity={0.7}
                      disabled={!canRegenerate}
                      style={[styles.cookTonightRegen, !canRegenerate && { opacity: 0.35 }]}
                    >
                      <RefreshCw size={14} stroke={canRegenerate ? '#4ADE80' : '#888'} strokeWidth={2.2} />
                    </TouchableOpacity>
                  </View>

                  {mealsLoading ? (
                    <View style={styles.cookTonightLoading}>
                      <ActivityIndicator color="#4ADE80" />
                      <Text style={styles.cookTonightLoadingText}>Finding meals from your pantry…</Text>
                    </View>
                  ) : mealsError ? (
                    <View style={styles.cookTonightLoading}>
                      {/* Show the real reason (e.g. the daily cap message) instead of a generic line. */}
                      <Text style={styles.cookTonightErrorText}>{mealsError}</Text>
                      {/* Retry is pointless once the daily cap is hit — hide it in that case. */}
                      {mealsErrorCode !== 'meal_cap_reached' && (
                        <TouchableOpacity onPress={retry} activeOpacity={0.7}>
                          <Text style={styles.cookTonightRetryText}>Try again →</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : meals.length > 0 ? (
                    <Reanimated.View entering={FadeIn.duration(300)} style={{ gap: 10 }}>
                      {meals.slice(0, 3).map((meal, idx) => {
                        // Compute against the LIVE pantry (the same check the meal-detail screen uses)
                        // so the card and the detail always agree. The old code trusted the server's
                        // self-reported missing_ingredients, but GPT returns [] even when the pantry is
                        // near-empty → a false "Got everything" on the card while the detail correctly
                        // showed every ingredient missing. `missingFor` skips staples + does two-way
                        // substring, so a genuinely stocked pantry still reads "Got everything".
                        const missing = missingFor(meal.ingredients)
                        return (
                          <TouchableOpacity
                            key={`${meal.id}-${idx}`}
                            style={styles.cookTonightRow}
                            activeOpacity={0.7}
                            onPress={() => router.push({ pathname: '/meal/[id]', params: { id: meal.id, mealData: JSON.stringify(meal) } })}
                          >
                            {meal.image && meal.image.startsWith('http') ? (
                              <Image source={{ uri: meal.image }} style={styles.cookTonightThumb} resizeMode="cover" />
                            ) : (
                              <Shimmer style={styles.cookTonightThumb} />
                            )}
                            <View style={{ flex: 1, gap: 4 }}>
                              <Text style={styles.cookTonightName} numberOfLines={1}>{meal.name}</Text>
                              <Text style={styles.cookTonightMeta} numberOfLines={1}>
                                {meal.prepTime > 0 ? `${meal.prepTime} min` : null}
                                {meal.prepTime > 0 ? '  ·  ' : ''}
                                {meal.calories} cal
                                {meal.protein > 0 ? `  ·  ${meal.protein}g protein` : ''}
                              </Text>
                              {missing.length === 0 ? (
                                <View style={styles.cookTonightHaveRow}>
                                  <Check size={11} stroke="#4ADE80" strokeWidth={2.5} />
                                  <Text style={styles.cookTonightHaveText}>Got everything</Text>
                                </View>
                              ) : (
                                <Text style={styles.cookTonightNeedText} numberOfLines={1}>
                                  Need: {missing.slice(0, 3).join(', ')}{missing.length > 3 ? ` +${missing.length - 3}` : ''}
                                </Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        )
                      })}
                    </Reanimated.View>
                  ) : (
                    // Zero meals came back (pantry too sparse) — nudge instead of rendering nothing.
                    <View style={styles.cookTonightLoading}>
                      <Text style={styles.cookTonightLoadingText}>Scan a few more items and we'll suggest meals you can make right now.</Text>
                    </View>
                  )}
                </View>
              )}

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

              {/* Categories header — only when there are categories */}
              {visibleCategories.length > 0 && (
                <View style={styles.categoriesHeader}>
                  <Text style={styles.categoriesTitle}>Categories</Text>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1 }}>HOLD TO REORDER</Text>
                </View>
              )}
            </>
          }
          ListFooterComponent={
            totalItems > 0 ? (
              <View style={styles.footerWrap}>
                <Text style={styles.footerCount}>{totalItems} ingredient{totalItems !== 1 ? 's' : ''} total</Text>
                <TouchableOpacity style={styles.clearBtn} onPress={clearPantry} activeOpacity={0.7}>
                  <Trash2 size={15} stroke="#EF4444" strokeWidth={2} />
                  <Text style={styles.clearBtnText}>Clear pantry</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          renderItem={({ item: cat, drag, isActive }: RenderItemParams<Category>) => (
            <ScaleDecorator>
              <CategorySection
                category={cat}
                isExpanded={isSearching || expandedIds.has(cat.id)}
                onToggle={() => toggleSection(cat.id)}
                onDelete={(ingId) => deleteIngredient(cat.id, ingId)}
                onToggleStock={(ingId) => toggleStock(cat.id, ingId)}
                drag={drag}
              />
            </ScaleDecorator>
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
                    onPress={() => { setNewIngredientName(''); setDisambigChoices([]); setShowAddModal(false) }}
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  manualEntryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.textWhite,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  manualEntryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
  },

  heroBanner: {
    marginHorizontal: 20,
    marginBottom: 20,
    height: 220,
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  heroBannerImage: {
    width: '100%',
    height: '100%',
  },
  heroBannerGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  heroBannerContent: {
    position: 'absolute',
    bottom: 18,
    left: 20,
    right: 20,
  },
  heroBannerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4ADE80',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 5,
  },
  heroInsightHeadline: {
    fontSize: 21,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  heroInsightDetail: {
    fontSize: 12.5,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 17,
  },
  heroInsightCta: {
    alignSelf: 'flex-start',
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  heroInsightCtaText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
  },

  scanRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 16,
    gap: 10,
  },
  scanCard: {
    backgroundColor: '#191919',
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    position: 'relative',
  },
  scanIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(74,222,128,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanCardBadge: {
    backgroundColor: '#4ADE80',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  // Absolute-positioned variant — sits in the top-right corner of the card so
  // we can drop the icon row entirely and let the title start at the top.
  scanCardBadgeAbs: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#4ADE80',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    zIndex: 1,
  },
  scanCardBadgeText: { fontSize: 9, fontWeight: '800', color: '#004a22', letterSpacing: 0.5 },
  scanCardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.2 },
  scanCardSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  // Compact animated illustration sitting below the title in each scan card.
  // Mirrors the home-screen hero animation but downsized to fit the card width.
  scanCardVisual: {
    width: '100%',
    height: 70,
    marginTop: 6,
    position: 'relative',
    overflow: 'hidden',
  },
  scanCardCorner: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderColor: '#4ADE80',
  },
  scanCardCornerTL: { top: 0, left: 0, borderTopWidth: 1.5, borderLeftWidth: 1.5 },
  scanCardCornerTR: { top: 0, right: 0, borderTopWidth: 1.5, borderRightWidth: 1.5 },
  scanCardCornerBL: { bottom: 0, left: 0, borderBottomWidth: 1.5, borderLeftWidth: 1.5 },
  scanCardCornerBR: { bottom: 0, right: 0, borderBottomWidth: 1.5, borderRightWidth: 1.5 },
  scanCardBeam: {
    position: 'absolute',
    left: 2,
    right: 2,
    height: 1.5,
    backgroundColor: '#4ADE80',
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
  },

  // kept for reference — replaced by scanRow
  scanHero: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(74, 222, 128, 0.20)',
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
  },
  scanHeroBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(74, 222, 128, 0.15)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  scanHeroBadgeText: { fontSize: 11, fontWeight: '600', color: '#4ADE80', letterSpacing: 0.2 },
  scanHeroTitle: { fontSize: 17, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.3 },
  scanHeroSubtitle: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', lineHeight: 19 },

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

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  categoriesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  categoriesTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textWhite },

  categorySection: {
    marginBottom: 8,
    backgroundColor: '#191919',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 12,
  },
  categorySectionExpanded: {
    backgroundColor: COLORS.cardElevated,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.15)',
  },
  categoryIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryName: { flex: 1, fontSize: 15, fontWeight: '600', color: COLORS.textWhite },
  categoryCountPill: {
    backgroundColor: '#262626',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryCount: { fontSize: 12, color: COLORS.textMuted, fontWeight: '700' },

  ingredientList: {
    marginLeft: 20,
    paddingLeft: 16,
    borderLeftWidth: 2,
    borderLeftColor: '#262626',
    marginBottom: 8,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  ingredientName: { flex: 1, fontSize: 14, color: COLORS.textWhite, fontWeight: '400' },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#4ADE80',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outOfStockDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  outOfStockPill: {
    backgroundColor: 'rgba(74,222,128,0.1)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 8,
  },
  outOfStockPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4ADE80',
  },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginLeft: 16 },

  deleteAction: {
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  deleteText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  emptyState: { alignItems: 'center', paddingTop: 60, gap: 8 },
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

  timestamp: { textAlign: 'center', fontSize: 13, color: COLORS.textMuted, fontWeight: '500', marginTop: 24, letterSpacing: 0.3 },
  footerWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 24, paddingBottom: 48 },
  footerCount: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500', letterSpacing: 0.3 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 30, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  clearBtnText: { color: '#EF4444', fontSize: 14, fontWeight: '600' },

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

  // Cook Tonight — compact action-row list (Phase 2b). Visually distinct from the
  // Discover tab's cinematic browse so users feel the difference between "what to
  // make right now" and "what to explore."
  cookTonightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  cookTonightTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  cookTonightSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
    fontWeight: '500',
  },
  cookTonightRegen: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.2)',
  },
  cookTonightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#141414',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  cookTonightThumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
  },
  cookTonightThumbPlaceholder: {
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cookTonightName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.1,
  },
  cookTonightMeta: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  cookTonightHaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cookTonightHaveText: {
    fontSize: 11,
    color: '#4ADE80',
    fontWeight: '700',
  },
  cookTonightNeedText: {
    fontSize: 11,
    color: '#F59E0B',
    fontWeight: '600',
  },
  cookTonightLoading: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 10,
  },
  cookTonightLoadingText: { fontSize: 13, color: COLORS.textMuted },
  cookTonightErrorText: { fontSize: 13, color: '#EF4444' },
  cookTonightRetryText: { fontSize: 13, color: '#4ADE80', fontWeight: '700' },
})
