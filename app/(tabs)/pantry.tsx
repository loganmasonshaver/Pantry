import { useState, useCallback } from 'react'
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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { Plus, ChevronDown, Check, X, Search, ScanLine, Package } from 'lucide-react-native'
import { Swipeable } from 'react-native-gesture-handler'
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
  'Canned & Jarred': '#C084FC',
  'Snacks': '#FFB020',
  'Condiments & Sauces': '#60A5FA',
  'Beverages': '#00C9A7',
  'Other': '#888888',
}

const CATEGORY_CONFIG = STORE_CATEGORIES.map(name => ({
  id: name.toLowerCase().replace(/[^a-z]/g, ''),
  name,
  icon: Package,
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
}: {
  category: Category
  isExpanded: boolean
  onToggle: () => void
  onDelete: (id: string) => void
  onToggleStock: (id: string) => void
}) {
  return (
    <View style={styles.categorySection}>
      <TouchableOpacity style={styles.categoryHeader} onPress={onToggle} activeOpacity={0.7}>
        <category.icon size={18} stroke={category.iconColor} strokeWidth={1.8} />
        <Text style={styles.categoryName}>{category.name}</Text>
        <Text style={styles.categoryCount}>{category.ingredients.length}</Text>
        <View style={{ transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }}>
          <ChevronDown size={18} stroke={COLORS.textDim} strokeWidth={2} />
        </View>
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.ingredientList}>
          {category.ingredients.map((ing, index) => (
            <View key={ing.id}>
              {index > 0 && <View style={styles.divider} />}
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
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Pantry</Text>
        <TouchableOpacity style={styles.manualEntryBtn} onPress={() => setShowAddModal(true)} activeOpacity={0.7}>
          <Plus size={14} stroke={COLORS.textMuted} strokeWidth={2} />
          <Text style={styles.manualEntryText}>Manual Entry</Text>
        </TouchableOpacity>
      </View>

      {/* ── Scan cards row ── */}
      <View style={styles.scanRow}>
        <TouchableOpacity
          style={[styles.scanCard, { flex: 1 }]}
          onPress={() => setShowScanModal(true)}
          activeOpacity={0.85}
        >
          <View style={styles.scanCardBadge}>
            <Text style={styles.scanCardBadgeText}>AI</Text>
          </View>
          <ScanLine size={32} stroke="#4ADE80" strokeWidth={1.6} />
          <Text style={styles.scanCardTitle}>Scan Pantry</Text>
          <Text style={styles.scanCardSub}>Point at fridge or shelf</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.scanCard, { flex: 1 }]}
          onPress={() => setShowReceiptModal(true)}
          activeOpacity={0.85}
        >
          <View style={styles.scanCardBadge}>
            <Text style={styles.scanCardBadgeText}>AI</Text>
          </View>
          <ScanLine size={32} stroke="#60A5FA" strokeWidth={1.6} />
          <Text style={styles.scanCardTitle}>Scan Receipt</Text>
          <Text style={styles.scanCardSub}>Add from grocery run</Text>
        </TouchableOpacity>
      </View>

      {/* ── Search bar ── */}
      <View style={styles.searchBar}>
        <Search size={16} stroke={COLORS.textMuted} strokeWidth={1.8} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search ingredients..."
          placeholderTextColor={COLORS.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {isSearching && (
          <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7}>
            <X size={16} stroke={COLORS.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Category sections ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {visibleCategories.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{isSearching ? 'No results' : 'Your pantry is empty'}</Text>
            <Text style={styles.emptySub}>{isSearching ? 'Try a different search' : 'Tap + to add ingredients'}</Text>
          </View>
        ) : (
          visibleCategories.map(cat => (
            <CategorySection
              key={cat.id}
              category={cat}
              isExpanded={isSearching || expandedIds.has(cat.id)}
              onToggle={() => toggleSection(cat.id)}
              onDelete={(ingId) => deleteIngredient(cat.id, ingId)}
              onToggleStock={(ingId) => toggleStock(cat.id, ingId)}
            />
          ))
        )}
        {totalItems > 0 && (
          <Text style={styles.timestamp}>{totalItems} ingredient{totalItems !== 1 ? 's' : ''} total</Text>
        )}
      </ScrollView>

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
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  manualEntryText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },

  scanRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 16,
    gap: 10,
  },
  scanCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 14,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(74,222,128,0.15)',
  },
  scanCardBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  scanCardBadgeText: { fontSize: 9, fontWeight: '700', color: '#4ADE80', letterSpacing: 0.3 },
  scanCardTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.2 },
  scanCardSub: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center' },

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
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 15, color: COLORS.textWhite, padding: 0 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },

  categorySection: {
    marginBottom: 10,
    backgroundColor: '#141414',
    borderRadius: 16,
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  categoryName: { flex: 1, fontSize: 16, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.2 },
  categoryCount: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500', marginRight: 4 },

  ingredientList: {},
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#141414',
  },
  ingredientName: { flex: 1, fontSize: 15, color: COLORS.textWhite, fontWeight: '400' },
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
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginLeft: 16 },

  deleteAction: {
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  deleteText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  emptyState: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textWhite },
  emptySub: { fontSize: 14, color: COLORS.textMuted },

  timestamp: { textAlign: 'center', fontSize: 12, color: COLORS.textMuted, marginTop: 12 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#141414',
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
