import { useState, useCallback, useRef } from 'react'
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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { Plus, ChevronDown, Check, X, Search, ScanLine, Package, Camera, Receipt, Apple, Wheat, Beef, Egg, Snowflake, Cookie, Coffee, Droplet, Salad, Bean, Nut, CakeSlice, Soup, Croissant, Flame, Ham, GripVertical } from 'lucide-react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { LinearGradient } from 'expo-linear-gradient'
import { COLORS } from '@/constants/colors'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { STORE_CATEGORIES, autoCategoryMatches } from '@/lib/categories'
import PantryScanModal from '@/components/PantryScanModal'
import ReceiptScanModal from '@/components/ReceiptScanModal'

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
  const [categories, setCategories] = useState<Category[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(['protein']))
  const [searchQuery, setSearchQuery] = useState('')
  const [showScanModal, setShowScanModal] = useState(false)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newIngredientName, setNewIngredientName] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [disambigChoices, setDisambigChoices] = useState<string[]>([])
  const searchRef = useRef<TextInput>(null)

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

    setCategories(result)
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

  const addIngredient = async (overrideCategory?: string) => {
    const name = newIngredientName.trim()
    if (!name || !user) return

    if (!overrideCategory) {
      const matches = autoCategoryMatches(name)
      if (matches.length > 1) {
        setDisambigChoices(matches)
        return
      }
    }

    const category = overrideCategory || autoCategoryMatches(name)[0] || 'Other'
    setAddSaving(true)
    setDisambigChoices([])
    const { data, error } = await supabase
      .from('pantry_items')
      .insert({ user_id: user.id, name, category, in_stock: true })
      .select('id, name, category, in_stock')
      .single()
    setAddSaving(false)
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
        <Text style={styles.headerTitle}>My Pantry</Text>
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
            if (!isSearching) setCategories(data)
          }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={styles.emptyStateInline}>
              <View style={styles.emptyIconCircle}>
                <Camera size={28} stroke="#4ADE80" strokeWidth={1.8} />
              </View>
              <Text style={styles.emptyTitle}>
                {isSearching ? 'No results' : 'Your pantry is empty'}
              </Text>
              <Text style={styles.emptySub}>
                {isSearching
                  ? 'Try a different search'
                  : 'Tap Scan Pantry above to auto-detect what you have, or add items manually.'}
              </Text>
            </View>
          }
          ListHeaderComponent={
            <>
              {/* Hero banner */}
              <View style={[styles.heroBanner, { marginHorizontal: 0 }]}>
                <Image
                  source={{ uri: 'https://fdafjnkqqtpsjtddbfdz.supabase.co/storage/v1/object/public/ingredient-images/pantry-hero.webp?v=2' }}
                  style={[styles.heroBannerImage, { opacity: totalItems >= 50 ? 0.7 : totalItems >= 25 ? 0.6 : totalItems >= 10 ? 0.5 : totalItems > 0 ? 0.4 : 0.35 }]}
                  resizeMode="cover"
                />
                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)', '#000000']} locations={[0.2, 0.7, 1]} style={styles.heroBannerGradient} />
                <View style={styles.heroBannerContent}>
                  <Text style={styles.heroBannerLabel}>Stock Level</Text>
                  <Text style={[styles.heroBannerValue, {
                    color: totalItems >= 50 ? '#4ADE80' : totalItems >= 25 ? COLORS.textWhite : totalItems >= 10 ? '#F59E0B' : totalItems > 0 ? '#EF4444' : COLORS.textMuted
                  }]}>
                    {totalItems >= 50 ? 'Optimal' : totalItems >= 25 ? 'Stocked' : totalItems >= 10 ? 'Low' : totalItems > 0 ? 'Critical' : 'Empty'}
                  </Text>
                </View>
              </View>

              {/* Scan cards */}
              <View style={[styles.scanRow, { marginHorizontal: 0 }]}>
                <TouchableOpacity style={[styles.scanCard, { flex: 1 }]} onPress={() => setShowScanModal(true)} activeOpacity={0.85}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'flex-start' }}>
                    <View style={styles.scanIconContainer}><Camera size={22} stroke="#4ADE80" strokeWidth={1.8} /></View>
                    <View style={styles.scanCardBadge}><Text style={styles.scanCardBadgeText}>AI</Text></View>
                  </View>
                  <View><Text style={styles.scanCardTitle}>Scan Pantry</Text><Text style={styles.scanCardSub}>Auto-detect items</Text></View>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.scanCard, { flex: 1 }]} onPress={() => setShowReceiptModal(true)} activeOpacity={0.85}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'flex-start' }}>
                    <View style={styles.scanIconContainer}><Receipt size={22} stroke="#4ADE80" strokeWidth={1.8} /></View>
                    <View style={styles.scanCardBadge}><Text style={styles.scanCardBadgeText}>AI</Text></View>
                  </View>
                  <View><Text style={styles.scanCardTitle}>Scan Receipt</Text><Text style={styles.scanCardSub}>Import purchases</Text></View>
                </TouchableOpacity>
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
              <Text style={styles.timestamp}>{totalItems} ingredient{totalItems !== 1 ? 's' : ''} total</Text>
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
        onItemsAdded={fetchItems}
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
  headerTitle: { fontSize: 28, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.5 },
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
    bottom: 20,
    left: 20,
  },
  heroBannerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4ADE80',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 4,
  },
  heroBannerValue: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.5,
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
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'flex-start',
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
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
  scanCardBadgeText: { fontSize: 9, fontWeight: '800', color: '#004a22', letterSpacing: 0.5 },
  scanCardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.2 },
  scanCardSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

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
