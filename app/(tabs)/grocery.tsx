import { useState, useCallback, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Modal,
  TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { Trash2, Check, Plus, X } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────

type GroceryItem = {
  id: string
  name: string
  meal: string
  category: string
  checked: boolean
}

// ── Constants ──────────────────────────────────────────────────────────

const PRESET_CATEGORIES = ['Produce', 'Meat & Fish', 'Dairy', 'Pantry Staples', 'Condiments', 'Frozen', 'Other']

// ── Grocery item row ───────────────────────────────────────────────────

function GroceryRow({ item, onToggle }: { item: GroceryItem; onToggle: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onToggle} activeOpacity={0.7}>
      <View style={[styles.checkbox, item.checked && styles.checkboxChecked]}>
        {item.checked && <Check size={12} stroke="#000000" strokeWidth={2.5} />}
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.itemName, item.checked && styles.itemNameChecked]}>
          {item.name}
        </Text>
        {item.meal ? <Text style={styles.itemMeal}>{item.meal}</Text> : null}
      </View>
    </TouchableOpacity>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────

export default function GroceryScreen() {
  const { user } = useAuth()
  const [items, setItems] = useState<GroceryItem[]>([])
  const [showToast, setShowToast] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addName, setAddName] = useState('')
  const [addMeal, setAddMeal] = useState('')
  const [addCategory, setAddCategory] = useState('Produce')
  const [addSaving, setAddSaving] = useState(false)
  const toastOpacity = useRef(new Animated.Value(0)).current

  const fetchItems = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('grocery_items')
      .select('id, name, meal, category, checked')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    if (data) setItems(data)
  }, [user?.id])

  useFocusEffect(useCallback(() => {
    fetchItems()
  }, [fetchItems]))

  const toggle = async (id: string) => {
    const item = items.find(i => i.id === id)
    if (!item) return
    const next = !item.checked
    setItems(prev => prev.map(i => i.id === id ? { ...i, checked: next } : i))
    await supabase.from('grocery_items').update({ checked: next }).eq('id', id)
  }

  const clearChecked = async () => {
    const ids = items.filter(i => i.checked).map(i => i.id)
    if (!ids.length) return
    setItems(prev => prev.filter(i => !i.checked))
    await supabase.from('grocery_items').delete().in('id', ids)
  }

  const addToPantry = async () => {
    const ids = items.filter(i => i.checked).map(i => i.id)
    if (!ids.length) return
    setItems(prev => prev.filter(i => !i.checked))
    await supabase.from('grocery_items').delete().in('id', ids)
    setShowToast(true)
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setShowToast(false))
  }

  const openAddModal = () => {
    setAddName('')
    setAddMeal('')
    setAddCategory('Produce')
    setShowAddModal(true)
  }

  const saveItem = async () => {
    const name = addName.trim()
    if (!name || !user) return
    setAddSaving(true)
    const { data, error } = await supabase
      .from('grocery_items')
      .insert({
        user_id: user.id,
        name,
        meal: addMeal.trim(),
        category: addCategory,
        checked: false,
      })
      .select('id, name, meal, category, checked')
      .single()
    setAddSaving(false)
    if (!error && data) {
      setItems(prev => [...prev, data])
      setShowAddModal(false)
    }
  }

  const checkedCount = items.filter(i => i.checked).length
  const isEmpty = items.length === 0
  const uniqueMeals = [...new Set(items.map(i => i.meal).filter(Boolean))]

  // Derive categories from actual items, preserving preset order
  const activeCategories = PRESET_CATEGORIES.filter(cat => items.some(i => i.category === cat))
  const otherCategories = [...new Set(items.map(i => i.category))].filter(c => !PRESET_CATEGORIES.includes(c))
  const categories = [...activeCategories, ...otherCategories]

  const grouped = categories.map(cat => ({
    category: cat,
    items: items.filter(i => i.category === cat),
  })).filter(g => g.items.length > 0)

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
            {items.length} item{items.length !== 1 ? 's' : ''}
            {uniqueMeals.length > 0 ? ` from ${uniqueMeals.length} meal${uniqueMeals.length !== 1 ? 's' : ''}` : ''}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.iconBtn, !checkedCount && styles.iconBtnDisabled]}
            onPress={clearChecked}
            activeOpacity={0.7}
            disabled={checkedCount === 0}
          >
            <Trash2 size={18} stroke={checkedCount ? '#EF4444' : COLORS.textMuted} strokeWidth={1.8} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={openAddModal} activeOpacity={0.7}>
            <Plus size={18} stroke={COLORS.textWhite} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      </View>

      {isEmpty ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyCircle}>
            <Check size={32} stroke="#4ADE80" strokeWidth={2} />
          </View>
          <Text style={styles.emptyTitle}>You're all stocked up</Text>
          <Text style={styles.emptySub}>Tap + to add items to your list</Text>
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Meal source card ── */}
            {uniqueMeals.length > 0 && (
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
            )}

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
              style={[styles.addBtn, !checkedCount && styles.addBtnDisabled]}
              activeOpacity={checkedCount ? 0.85 : 1}
              disabled={!checkedCount}
              onPress={addToPantry}
            >
              <Text style={[styles.addBtnText, !checkedCount && styles.addBtnTextDisabled]}>
                Add to Pantry{checkedCount ? ` (${checkedCount})` : ''}
              </Text>
            </TouchableOpacity>
            <Text style={styles.addBtnSub}>Checked items will be added to your pantry</Text>
            <TouchableOpacity
              style={styles.deliveryBtn}
              activeOpacity={0.85}
              onPress={() => router.push('/delivery-webview')}
            >
              <Text style={styles.deliveryBtnText}>Order for Delivery</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ── Add Item Modal ── */}
      <Modal visible={showAddModal} transparent animationType="slide">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAddModal(false)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Item</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)} activeOpacity={0.7}>
                <X size={18} stroke={COLORS.textMuted} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Item name (e.g. Broccoli)"
              placeholderTextColor={COLORS.textMuted}
              value={addName}
              onChangeText={setAddName}
              autoFocus
            />

            <TextInput
              style={styles.modalInput}
              placeholder="Meal (optional)"
              placeholderTextColor={COLORS.textMuted}
              value={addMeal}
              onChangeText={setAddMeal}
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryScroll}
              contentContainerStyle={styles.categoryScrollContent}
            >
              {PRESET_CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.catChip, addCategory === cat && styles.catChipActive]}
                  onPress={() => setAddCategory(cat)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.catChipText, addCategory === cat && styles.catChipTextActive]}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalConfirm, (!addName.trim() || addSaving) && { opacity: 0.5 }]}
              activeOpacity={0.8}
              onPress={saveItem}
              disabled={!addName.trim() || addSaving}
            >
              <Text style={styles.modalConfirmText}>{addSaving ? 'Adding...' : 'Add to List'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },

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
  toastText: { color: '#4ADE80', fontSize: 14, fontWeight: '600' },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  headerTitle: { fontSize: 28, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: COLORS.textMuted, marginTop: 3, fontWeight: '400' },
  headerActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnDisabled: { opacity: 0.4 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 16 },

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
  mealPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mealPill: {
    backgroundColor: '#2A2A2A',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  mealPillText: { fontSize: 13, color: COLORS.textWhite, fontWeight: '500' },

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
  groupCard: { backgroundColor: '#111111', borderRadius: 16, overflow: 'hidden' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginLeft: 56 },

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
  checkboxChecked: { backgroundColor: '#4ADE80', borderColor: '#4ADE80' },
  rowContent: { flex: 1, gap: 3 },
  itemName: { fontSize: 15, fontWeight: '600', color: COLORS.textWhite },
  itemNameChecked: { textDecorationLine: 'line-through', color: COLORS.textMuted },
  itemMeal: { fontSize: 12, color: COLORS.textMuted, fontWeight: '400' },

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
  addBtnDisabled: { backgroundColor: '#1A1A1A' },
  addBtnText: { color: '#000000', fontSize: 16, fontWeight: '700' },
  addBtnTextDisabled: { color: COLORS.textMuted },
  addBtnSub: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
  deliveryBtn: {
    borderWidth: 1.5,
    borderColor: '#00C9A7',
    borderRadius: 30,
    paddingVertical: 16,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  deliveryBtnText: { color: '#00C9A7', fontSize: 15, fontWeight: '700' },

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
  emptyTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.3 },
  emptySub: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.textWhite },
  modalInput: {
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textWhite,
  },
  categoryScroll: { marginHorizontal: -4 },
  categoryScrollContent: { paddingHorizontal: 4, gap: 8, flexDirection: 'row' },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#2A2A2A',
  },
  catChipActive: { backgroundColor: 'rgba(74,222,128,0.15)' },
  catChipText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  catChipTextActive: { color: '#4ADE80' },
  modalConfirm: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  modalConfirmText: { fontSize: 15, fontWeight: '700', color: '#000000' },
})
