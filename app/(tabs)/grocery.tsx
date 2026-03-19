import { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Trash2, Check } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'

// ── Types ──────────────────────────────────────────────────────────────

type GroceryItem = {
  id: string
  name: string
  meal: string
  category: string
  checked: boolean
}

// ── Mock data ──────────────────────────────────────────────────────────

const INITIAL_ITEMS: GroceryItem[] = [
  { id: 'g1', name: 'Broccoli florets', meal: 'Steak & Rice Bowl',  category: 'Produce',        checked: false },
  { id: 'g2', name: 'Lemon',            meal: 'Salmon & Quinoa',    category: 'Produce',        checked: false },
  { id: 'g3', name: 'Soy sauce',        meal: 'Steak & Rice Bowl',  category: 'Condiments',     checked: false },
  { id: 'g4', name: 'Quinoa',           meal: 'Salmon & Quinoa',    category: 'Pantry Staples', checked: false },
]

const CATEGORIES = ['Produce', 'Condiments', 'Pantry Staples']

const MEAL_PILLS = ['Steak & Rice Bowl', 'Salmon & Quinoa']

// ── Grocery item row ───────────────────────────────────────────────────

function GroceryRow({
  item,
  onToggle,
}: {
  item: GroceryItem
  onToggle: () => void
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onToggle} activeOpacity={0.7}>
      <View style={[styles.checkbox, item.checked && styles.checkboxChecked]}>
        {item.checked && <Check size={12} stroke="#000000" strokeWidth={2.5} />}
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.itemName, item.checked && styles.itemNameChecked]}>
          {item.name}
        </Text>
        <Text style={styles.itemMeal}>{item.meal}</Text>
      </View>
    </TouchableOpacity>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────

export default function GroceryScreen() {
  const [items, setItems] = useState<GroceryItem[]>(INITIAL_ITEMS)
  const [showToast, setShowToast] = useState(false)
  const toastOpacity = useRef(new Animated.Value(0)).current

  const toggle = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, checked: !i.checked } : i))
  }

  const clearChecked = () => {
    setItems(prev => prev.filter(i => !i.checked))
  }

  const addToPantry = () => {
    setItems(prev => prev.filter(i => !i.checked))
    setShowToast(true)
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setShowToast(false))
  }

  const checkedCount = items.filter(i => i.checked).length
  const canAddToPantry = checkedCount > 0
  const isEmpty = items.length === 0

  const grouped = CATEGORIES.map(cat => ({
    category: cat,
    items: items.filter(i => i.category === cat),
  })).filter(g => g.items.length > 0)

  const uniqueMeals = [...new Set(items.map(i => i.meal))]

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Toast ── */}
      {showToast && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Text style={styles.toastText}>Added to pantry ✓</Text>
        </Animated.View>
      )}

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Grocery List</Text>
          <Text style={styles.headerSub}>
            {items.length} item{items.length !== 1 ? 's' : ''} from {uniqueMeals.length} meal{uniqueMeals.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.trashBtn, !checkedCount && styles.trashBtnDisabled]}
          onPress={clearChecked}
          activeOpacity={0.7}
          disabled={checkedCount === 0}
        >
          <Trash2 size={18} stroke={checkedCount ? '#EF4444' : COLORS.textMuted} strokeWidth={1.8} />
        </TouchableOpacity>
      </View>

      {isEmpty ? (
        /* ── Empty state ── */
        <View style={styles.emptyState}>
          <View style={styles.emptyCircle}>
            <Check size={32} stroke="#4ADE80" strokeWidth={2} />
          </View>
          <Text style={styles.emptyTitle}>You're all stocked up</Text>
          <Text style={styles.emptySub}>All ingredients are in your pantry</Text>
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Meal source card ── */}
            <View style={styles.sourceCard}>
              <Text style={styles.sourceLabel}>From your meals</Text>
              <View style={styles.mealPills}>
                {uniqueMeals.map(meal => (
                  <View key={meal} style={styles.mealPill}>
                    <Text style={styles.mealPillText}>{meal}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* ── Grouped items ── */}
            {grouped.map(group => (
              <View key={group.category} style={styles.group}>
                <Text style={styles.groupLabel}>{group.category}</Text>
                <View style={styles.groupCard}>
                  {group.items.map((item, i) => (
                    <View key={item.id}>
                      {i > 0 && <View style={styles.divider} />}
                      <GroceryRow item={item} onToggle={() => toggle(item.id)} />
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>

          {/* ── Bottom action ── */}
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={[styles.addBtn, !canAddToPantry && styles.addBtnDisabled]}
              activeOpacity={canAddToPantry ? 0.85 : 1}
              disabled={!canAddToPantry}
              onPress={addToPantry}
            >
              <Text style={[styles.addBtnText, !canAddToPantry && styles.addBtnTextDisabled]}>
                Add to Pantry{canAddToPantry ? ` (${checkedCount})` : ''}
              </Text>
            </TouchableOpacity>
            <Text style={styles.addBtnSub}>Checked items will be added to your pantry</Text>
          </View>
        </>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },

  // Toast
  toast: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 10,
    zIndex: 100,
  },
  toastText: {
    color: '#4ADE80',
    fontSize: 14,
    fontWeight: '600',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 3,
    fontWeight: '400',
  },
  trashBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  trashBtnDisabled: {
    opacity: 0.4,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 16 },

  // Source card
  sourceCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    gap: 12,
  },
  sourceLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  mealPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mealPill: {
    backgroundColor: '#2A2A2A',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  mealPillText: {
    fontSize: 13,
    color: COLORS.textWhite,
    fontWeight: '500',
  },

  // Groups
  group: { marginBottom: 24 },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  groupCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    overflow: 'hidden',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginLeft: 56,
  },

  // Rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#4ADE80',
    borderColor: '#4ADE80',
  },
  rowContent: { flex: 1, gap: 3 },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textWhite,
  },
  itemNameChecked: {
    textDecorationLine: 'line-through',
    color: COLORS.textMuted,
  },
  itemMeal: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '400',
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    gap: 10,
    alignItems: 'center',
  },
  addBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 18,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  addBtnDisabled: {
    backgroundColor: '#1A1A1A',
  },
  addBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  addBtnTextDisabled: {
    color: COLORS.textMuted,
  },
  addBtnSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(74,222,128,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  emptySub: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
})
