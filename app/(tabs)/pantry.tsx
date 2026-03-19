import { useState } from 'react'
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
import { Plus, ChevronDown, Check, X, Search, ScanLine, Beef, Wheat, Leaf, Droplets, Milk, Package } from 'lucide-react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { COLORS } from '@/constants/colors'
import PantryScanModal from '@/components/PantryScanModal'

// ── Types ─────────────────────────────────────────────────────────────

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

// ── Mock data ──────────────────────────────────────────────────────────

const INITIAL_CATEGORIES: Category[] = [
  {
    id: 'protein',
    icon: Beef,
    iconColor: '#FF6B6B',
    name: 'Protein',
    ingredients: [
      { id: 'p1', name: 'Chicken breast', inStock: true },
      { id: 'p2', name: 'Eggs', inStock: true },
      { id: 'p3', name: 'Sirloin steak', inStock: true },
      { id: 'p4', name: 'Greek yogurt', inStock: true },
      { id: 'p5', name: 'Canned tuna', inStock: true },
    ],
  },
  {
    id: 'carbs',
    icon: Wheat,
    iconColor: '#F5A623',
    name: 'Carbs',
    ingredients: [
      { id: 'c1', name: 'White rice', inStock: true },
      { id: 'c2', name: 'Oats', inStock: true },
      { id: 'c3', name: 'Whole wheat bread', inStock: true },
      { id: 'c4', name: 'Pasta', inStock: true },
    ],
  },
  {
    id: 'produce',
    icon: Leaf,
    iconColor: '#4ADE80',
    name: 'Produce',
    ingredients: [
      { id: 'pr1', name: 'Broccoli florets', inStock: false },
      { id: 'pr2', name: 'Spinach', inStock: true },
      { id: 'pr3', name: 'Banana', inStock: true },
      { id: 'pr4', name: 'Garlic', inStock: true },
      { id: 'pr5', name: 'Lemon', inStock: true },
    ],
  },
  {
    id: 'condiments',
    icon: Droplets,
    iconColor: '#60A5FA',
    name: 'Condiments',
    ingredients: [
      { id: 'co1', name: 'Soy sauce', inStock: false },
      { id: 'co2', name: 'Hot sauce', inStock: true },
      { id: 'co3', name: 'Olive oil', inStock: true },
      { id: 'co4', name: 'Honey mustard', inStock: true },
    ],
  },
  {
    id: 'dairy',
    icon: Milk,
    iconColor: '#E2E8F0',
    name: 'Dairy',
    ingredients: [
      { id: 'd1', name: 'Milk', inStock: true },
      { id: 'd2', name: 'Cheddar cheese', inStock: true },
      { id: 'd3', name: 'Butter', inStock: true },
    ],
  },
  {
    id: 'staples',
    icon: Package,
    iconColor: '#C084FC',
    name: 'Pantry Staples',
    ingredients: [
      { id: 's1', name: 'Protein powder', inStock: false },
      { id: 's2', name: 'Canned beans', inStock: true },
      { id: 's3', name: 'Chicken stock', inStock: true },
    ],
  },
]

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
  const renderRightActions = () => (
    <TouchableOpacity style={styles.deleteAction} onPress={onDelete} activeOpacity={0.85}>
      <Text style={styles.deleteText}>Delete</Text>
    </TouchableOpacity>
  )

  return (
    <Swipeable renderRightActions={renderRightActions} friction={2} overshootRight={false}>
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
  const [categories, setCategories] = useState<Category[]>(INITIAL_CATEGORIES)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(['protein']))
  const [searchQuery, setSearchQuery] = useState('')
  const [showScanModal, setShowScanModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newIngredientName, setNewIngredientName] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('protein')

  const toggleSection = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleStock = (categoryId: string, ingredientId: string) => {
    setCategories(prev =>
      prev.map(cat =>
        cat.id === categoryId
          ? {
              ...cat,
              ingredients: cat.ingredients.map(i =>
                i.id === ingredientId ? { ...i, inStock: !i.inStock } : i
              ),
            }
          : cat
      )
    )
  }

  const deleteIngredient = (categoryId: string, ingredientId: string) => {
    setCategories(prev =>
      prev.map(cat =>
        cat.id === categoryId
          ? { ...cat, ingredients: cat.ingredients.filter(i => i.id !== ingredientId) }
          : cat
      )
    )
  }

  const addIngredient = () => {
    if (!newIngredientName.trim()) return
    const newIng: Ingredient = {
      id: `new_${Date.now()}`,
      name: newIngredientName.trim(),
      inStock: true,
    }
    setCategories(prev =>
      prev.map(cat =>
        cat.id === selectedCategoryId
          ? { ...cat, ingredients: [...cat.ingredients, newIng] }
          : cat
      )
    )
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Pantry</Text>
        <TouchableOpacity style={styles.iconBtn} onPress={() => setShowAddModal(true)} activeOpacity={0.7}>
          <Plus size={20} stroke={COLORS.textWhite} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {/* ── Scan hero card ── */}
      <TouchableOpacity
        style={styles.scanHero}
        onPress={() => setShowScanModal(true)}
        activeOpacity={0.85}
      >
        <View style={styles.scanHeroBadge}>
          <Text style={styles.scanHeroBadgeText}>Powered by AI</Text>
        </View>
        <ScanLine size={36} stroke="#4ADE80" strokeWidth={1.6} />
        <Text style={styles.scanHeroTitle}>Scan Your Pantry</Text>
        <Text style={styles.scanHeroSubtitle}>
          Point your camera at your fridge or shelf — AI detects your ingredients instantly
        </Text>
      </TouchableOpacity>

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
        {visibleCategories.map(cat => (
          <CategorySection
            key={cat.id}
            category={cat}
            isExpanded={isSearching || expandedIds.has(cat.id)}
            onToggle={() => toggleSection(cat.id)}
            onDelete={(ingId) => deleteIngredient(cat.id, ingId)}
            onToggleStock={(ingId) => toggleStock(cat.id, ingId)}
          />
        ))}
        <Text style={styles.timestamp}>Last updated today</Text>
      </ScrollView>

      {/* ── Scan Modal ── */}
      <PantryScanModal visible={showScanModal} onClose={() => setShowScanModal(false)} />

      {/* ── Add Ingredient Modal ── */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
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
                onChangeText={setNewIngredientName}
                autoFocus
              />

              <Text style={styles.pickerLabel}>Category</Text>
              <View style={styles.categoryPicker}>
                {INITIAL_CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.categoryChip,
                      selectedCategoryId === cat.id && styles.categoryChipActive,
                    ]}
                    onPress={() => setSelectedCategoryId(cat.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.categoryChipText,
                      selectedCategoryId === cat.id && styles.categoryChipTextActive,
                    ]}>
                      {cat.emoji} {cat.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => { setNewIngredientName(''); setShowAddModal(false) }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.addBtn} onPress={addIngredient} activeOpacity={0.85}>
                  <Text style={styles.addBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.5,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Scan hero card
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
  scanHeroBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4ADE80',
    letterSpacing: 0.2,
  },
  scanHeroTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  scanHeroSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },

  // Search
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
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textWhite,
    padding: 0,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },

  // Category sections
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
  categoryName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.2,
  },
  categoryCount: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
    marginRight: 4,
  },

  // Ingredient rows
  ingredientList: {},
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#141414',
  },
  ingredientName: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textWhite,
    fontWeight: '400',
  },
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
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginLeft: 16,
  },

  // Swipe delete
  deleteAction: {
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  deleteText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // Timestamp
  timestamp: {
    textAlign: 'center',
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 12,
  },

  // Modal shared
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
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
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.4,
  },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Add modal
  addInput: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.textWhite,
    marginBottom: 20,
  },
  pickerLabel: {
    fontSize: 13,
    color: COLORS.textDim,
    fontWeight: '600',
    marginBottom: 12,
  },
  categoryPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 28,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
  },
  categoryChipActive: {
    backgroundColor: COLORS.textWhite,
  },
  categoryChipText: {
    fontSize: 13,
    color: COLORS.textDim,
    fontWeight: '500',
  },
  categoryChipTextActive: {
    color: '#000000',
  },

  // Modal actions
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
  },
  cancelBtnText: {
    color: COLORS.textDim,
    fontSize: 15,
    fontWeight: '600',
  },
  addBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: COLORS.textWhite,
  },
  addBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
  },
})
