import { useState, useCallback, useRef, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Modal,
  TextInput,
  PanResponder,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { Trash2, Check, Plus, X, Clock, ShoppingCart } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { STORE_CATEGORIES, autoCategoryMatches } from '@/lib/categories'

// ── Types ──────────────────────────────────────────────────────────────

type GroceryItem = {
  id: string
  name: string
  meal: string
  category: string
  checked: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────

function relativeTime(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

const PRESET_CATEGORIES = STORE_CATEGORIES

// ── Grocery item row ───────────────────────────────────────────────────

function GroceryRow({
  item,
  onToggle,
  onDelete,
}: {
  item: GroceryItem
  onToggle: () => void
  onDelete: () => void
}) {
  const translateX = useRef(new Animated.Value(0)).current
  const DELETE_THRESHOLD = -80

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        if (g.dx < 0) translateX.setValue(g.dx)
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < DELETE_THRESHOLD) {
          Animated.timing(translateX, { toValue: -400, duration: 200, useNativeDriver: true }).start(() => {
            onDelete()
          })
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start()
        }
      },
    }),
  ).current

  return (
    <View style={styles.swipeContainer}>
      <View style={styles.deleteBackground}>
        <Trash2 size={16} stroke="#FFFFFF" strokeWidth={2} />
      </View>
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity style={styles.row} onPress={onToggle} activeOpacity={0.7}>
          <View style={[styles.checkbox, item.checked && styles.checkboxChecked]}>
            {item.checked && <Check size={12} stroke="#000000" strokeWidth={2.5} />}
          </View>
          <View style={styles.rowContent}>
            <Text style={[styles.itemName, item.checked && styles.itemNameChecked]}>
              {item.name.replace(/\s*\*\s*$/, '')}
            </Text>
            {item.meal ? <Text style={styles.itemMeal}>{item.meal}</Text> : null}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────

export default function GroceryScreen() {
  const { user } = useAuth()
  const [items, setItems] = useState<GroceryItem[]>([])
  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [addName, setAddName] = useState('')
  const [addMeal, setAddMeal] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [disambigChoices, setDisambigChoices] = useState<string[]>([])
  const toastOpacity = useRef(new Animated.Value(0)).current
  const pendingOrderRef = useRef(false)
  const [recentOrder, setRecentOrder] = useState<{ meals: string[]; orderedAt: Date } | null>(null)
  const [lastOrder, setLastOrder] = useState<{ items: any[]; createdAt: Date } | null>(null)

  const fetchItems = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('grocery_items')
      .select('id, name, meal, category, checked')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    if (data) {
      // Re-categorize items stuck in "Other" or old categories
      const fixed = data.map(item => {
        const cleanName = item.name.replace(/\s*\*\s*$/, '').trim()
        if (item.category === 'Other' || item.category === 'Pantry Staples' || item.category === 'Condiments' || item.category === 'Dairy') {
          const matches = autoCategoryMatches(cleanName)
          if (matches.length > 0) {
            return { ...item, name: cleanName, category: matches[0] }
          }
        }
        return { ...item, name: cleanName }
      })

      // Remove duplicates (keep the first occurrence, fuzzy match)
      const seen: string[] = []
      const deduped = fixed.filter(item => {
        const lower = item.name.toLowerCase()
        const isDupe = seen.some(s => s.includes(lower) || lower.includes(s))
        if (isDupe) return false
        seen.push(lower)
        return true
      })

      setItems(deduped)
    }
  }, [user?.id])

  const handleOrderComplete = useCallback(async () => {
    if (!user) return
    const currentItems = await supabase
      .from('grocery_items')
      .select('id, name, meal, category')
      .eq('user_id', user.id)
    const groceryItems = currentItems.data || []
    if (!groceryItems.length) return

    // Save to order_history
    await supabase.from('order_history').insert({
      user_id: user.id,
      items: groceryItems.map(i => ({ name: i.name, category: i.category, meal: i.meal })),
    })

    // Insert into pantry_items
    await supabase.from('pantry_items').insert(
      groceryItems.map(i => ({
        user_id: user.id,
        name: i.name,
        category: i.category,
        in_stock: true,
      })),
    )

    // Set prep timeline from ordered meals
    const orderedMeals = [...new Set(groceryItems.map(i => i.meal).filter(Boolean))]
    if (orderedMeals.length > 0) {
      setRecentOrder({ meals: orderedMeals, orderedAt: new Date() })
    }

    // Delete all grocery items
    await supabase.from('grocery_items').delete().eq('user_id', user.id)

    const count = groceryItems.length
    setItems([])
    setToastMessage(`Added ${count} item${count !== 1 ? 's' : ''} to pantry ✓`)
    setShowToast(true)
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setShowToast(false))
  }, [user?.id])

  // Check for today's order (prep timeline) and last order (reorder)
  useEffect(() => {
    if (!user) return
    const checkOrders = async () => {
      // Check for today's order for prep timeline
      const today = new Date().toISOString().split('T')[0]
      const { data: todayOrder } = await supabase
        .from('order_history')
        .select('items, created_at')
        .eq('user_id', user.id)
        .gte('created_at', today)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (todayOrder) {
        const meals = [...new Set((todayOrder.items as any[]).map(i => i.meal).filter(Boolean))]
        if (meals.length > 0) setRecentOrder({ meals, orderedAt: new Date(todayOrder.created_at) })
      }

      // Check for last order (for reorder in empty state)
      const { data: last } = await supabase
        .from('order_history')
        .select('items, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (last) setLastOrder({ items: last.items as any[], createdAt: new Date(last.created_at) })
    }
    checkOrders()
  }, [user?.id])

  useFocusEffect(useCallback(() => {
    fetchItems()
    if (pendingOrderRef.current) {
      pendingOrderRef.current = false
      setTimeout(() => {
        Alert.alert(
          'Did you place your order?',
          undefined,
          [
            { text: 'Not yet', style: 'cancel' },
            { text: 'Yes, add to pantry', onPress: handleOrderComplete },
          ],
        )
      }, 500)
    }
  }, [fetchItems, handleOrderComplete]))

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

  const deleteItem = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
    await supabase.from('grocery_items').delete().eq('id', id)
  }

  const addToPantry = async () => {
    if (!user) return
    const checked = items.filter(i => i.checked)
    if (!checked.length) return
    const count = checked.length
    setItems(prev => prev.filter(i => !i.checked))

    // Insert into pantry_items
    await supabase.from('pantry_items').insert(
      checked.map(i => ({
        user_id: user.id,
        name: i.name,
        category: i.category,
        in_stock: true,
      })),
    )
    // Remove from grocery_items
    await supabase.from('grocery_items').delete().in('id', checked.map(i => i.id))

    setToastMessage(`Added ${count} item${count !== 1 ? 's' : ''} to pantry ✓`)
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
    setDisambigChoices([])
    setShowAddModal(true)
  }

  const saveItem = async (overrideCategory?: string) => {
    const name = addName.trim()
    if (!name || !user) return

    // Check for ambiguity if no override provided
    if (!overrideCategory) {
      const matches = autoCategoryMatches(name)
      if (matches.length > 1) {
        setDisambigChoices(matches)
        return
      }
    }

    const category = overrideCategory || autoCategoryMatches(name)[0] || 'Other'

    const isDuplicate = items.some(existing => {
      const a = existing.name.toLowerCase()
      const b = name.toLowerCase()
      return a === b || a.includes(b) || b.includes(a)
    })
    if (isDuplicate) {
      Alert.alert('Already on your list', `A similar item is already in your grocery list.`)
      setAddSaving(false)
      return
    }

    setAddSaving(true)
    setDisambigChoices([])
    const { data, error } = await supabase
      .from('grocery_items')
      .insert({
        user_id: user.id,
        name,
        meal: addMeal.trim(),
        category,
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

  const handleReorder = async () => {
    if (!user || !lastOrder) return
    await supabase.from('grocery_items').insert(
      lastOrder.items.map(i => ({
        user_id: user.id,
        name: i.name,
        meal: i.meal || '',
        category: i.category || 'Other',
        checked: false,
      })),
    )
    fetchItems()
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
          <Text style={styles.toastText}>{toastMessage}</Text>
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
        <>
          <View style={styles.emptyState}>
            <View style={styles.emptyCircle}>
              <ShoppingCart size={32} stroke="#4ADE80" strokeWidth={2} />
            </View>
            <Text style={styles.emptyTitle}>You're all stocked up</Text>
            <Text style={styles.emptySub}>Tap + to add items to your list</Text>
            {lastOrder && (
              <TouchableOpacity style={styles.reorderBtn} activeOpacity={0.8} onPress={handleReorder}>
                <Text style={styles.reorderBtnText}>Reorder Last</Text>
                <Text style={styles.reorderBtnSub}>
                  {lastOrder.items.length} item{lastOrder.items.length !== 1 ? 's' : ''} · {relativeTime(lastOrder.createdAt)}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.bottomBar}>
            <Text style={styles.storeLabel}>Order from your favorite grocery stores</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storeLogosContent}>
              {[
                { name: 'Costco', bg: '#E31837' },
                { name: 'Kroger', bg: '#0058A3' },
                { name: 'Walmart', bg: '#0071CE' },
                { name: 'Aldi', bg: '#00005F' },
                { name: 'Publix', bg: '#3E8534' },
                { name: 'Sprouts', bg: '#4A7C2E' },
                { name: 'H-E-B', bg: '#E21836' },
                { name: 'Target', bg: '#CC0000' },
              ].map(store => (
                <View key={store.name} style={[styles.storeBadge, { backgroundColor: store.bg }]}>
                  <Text style={styles.storeBadgeText}>{store.name}</Text>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.deliveryBtn}
              activeOpacity={0.85}
              onPress={() => { pendingOrderRef.current = true; router.push('/delivery-webview') }}
            >
              <ShoppingCart size={18} stroke="#00C9A7" strokeWidth={2} />
              <Text style={styles.deliveryBtnText}>Browse & Order</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          {/* ── Progress Bar ── */}
          <View style={styles.progressCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.progressText}>
                {checkedCount === items.length
                  ? 'All items collected!'
                  : `${checkedCount}/${items.length} items collected`}
              </Text>
              <Text style={styles.progressPercent}>
                {Math.round((checkedCount / items.length) * 100)}%
              </Text>
            </View>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${(checkedCount / items.length) * 100}%` }]} />
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Prep Timeline ── */}
            {recentOrder && (
              <View style={styles.prepCard}>
                <View style={styles.prepTitle}>
                  <Clock size={16} stroke="#4ADE80" strokeWidth={2} />
                  <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.textWhite }}>Your Meal Prep Schedule</Text>
                </View>
                {recentOrder.meals.slice(0, 2).length > 0 && (
                  <View style={styles.prepSection}>
                    <Text style={styles.prepSectionTitle}>Tonight</Text>
                    {recentOrder.meals.slice(0, 2).map(meal => (
                      <View key={meal} style={styles.prepMealRow}>
                        <Text style={styles.prepMealName}>• {meal}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {recentOrder.meals.length > 2 && (
                  <View style={styles.prepSection}>
                    <Text style={styles.prepSectionTitle}>Tomorrow</Text>
                    {recentOrder.meals.slice(2).map(meal => (
                      <View key={meal} style={styles.prepMealRow}>
                        <Text style={styles.prepMealName}>• {meal}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <TouchableOpacity onPress={() => setRecentOrder(null)} activeOpacity={0.7}>
                  <Text style={styles.prepDismiss}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Grouped items ── */}
            {items.length <= 10 ? (
              /* Flat list — no category headers for small lists */
              <View style={styles.groupCard}>
                {items.map((item, i) => (
                  <View key={item.id}>
                    {i > 0 && <View style={styles.divider} />}
                    <GroceryRow item={item} onToggle={() => toggle(item.id)} onDelete={() => deleteItem(item.id)} />
                  </View>
                ))}
              </View>
            ) : (
              /* Grouped by category */
              grouped.map(group => (
                <View key={group.category} style={styles.group}>
                  <Text style={styles.groupLabel}>{group.category}</Text>
                  <View style={styles.groupCard}>
                    {group.items.map((item, i) => (
                      <View key={item.id}>
                        {i > 0 && <View style={styles.divider} />}
                        <GroceryRow item={item} onToggle={() => toggle(item.id)} onDelete={() => deleteItem(item.id)} />
                      </View>
                    ))}
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          {/* ── Bottom action ── */}
          <View style={styles.bottomBar}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[styles.addBtn, { flex: 1 }, !checkedCount && styles.addBtnDisabled]}
                activeOpacity={checkedCount ? 0.85 : 1}
                disabled={!checkedCount}
                onPress={addToPantry}
              >
                <Text style={[styles.addBtnText, !checkedCount && styles.addBtnTextDisabled]}>
                  Add to Pantry{checkedCount ? ` (${checkedCount})` : ''}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deliveryBtn}
                activeOpacity={0.85}
                onPress={() => { pendingOrderRef.current = true; router.push('/delivery-webview') }}
              >
                <ShoppingCart size={18} stroke="#00C9A7" strokeWidth={2} />
                <Text style={styles.deliveryBtnText}>Order</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.storeLabel}>Order from your favorite grocery stores</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storeLogosContent}>
              {[
                { name: 'Costco', bg: '#E31837' },
                { name: 'Kroger', bg: '#0058A3' },
                { name: 'Walmart', bg: '#0071CE' },
                { name: 'Aldi', bg: '#00005F' },
                { name: 'Publix', bg: '#3E8534' },
                { name: 'Sprouts', bg: '#4A7C2E' },
                { name: 'H-E-B', bg: '#E21836' },
                { name: 'Target', bg: '#CC0000' },
              ].map(store => (
                <View key={store.name} style={[styles.storeBadge, { backgroundColor: store.bg }]}>
                  <Text style={styles.storeBadgeText}>{store.name}</Text>
                </View>
              ))}
            </ScrollView>
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
              onChangeText={(t) => { setAddName(t); setDisambigChoices([]) }}
              autoFocus
            />

            <TextInput
              style={styles.modalInput}
              placeholder="Meal (optional)"
              placeholderTextColor={COLORS.textMuted}
              value={addMeal}
              onChangeText={setAddMeal}
            />

            {disambigChoices.length > 0 ? (
              <View style={styles.disambigWrap}>
                <Text style={styles.disambigTitle}>Which section?</Text>
                <View style={styles.disambigOptions}>
                  {disambigChoices.map(cat => (
                    <TouchableOpacity key={cat} style={styles.disambigBtn} onPress={() => saveItem(cat)} activeOpacity={0.7}>
                      <Text style={styles.disambigBtnText}>{cat}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.modalConfirm, (!addName.trim() || addSaving) && { opacity: 0.5 }]}
                activeOpacity={0.8}
                onPress={() => saveItem()}
                disabled={!addName.trim() || addSaving}
              >
                <Text style={styles.modalConfirmText}>{addSaving ? 'Adding...' : 'Add to List'}</Text>
              </TouchableOpacity>
            )}
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

  swipeContainer: { overflow: 'hidden' },
  deleteBackground: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    backgroundColor: '#111111',
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
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  deliveryBtnText: { color: '#00C9A7', fontSize: 14, fontWeight: '700' },

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
  disambigWrap: { gap: 8 },
  disambigTitle: { fontSize: 14, fontWeight: '600', color: COLORS.textWhite },
  disambigOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  disambigBtn: {
    backgroundColor: '#2A2A2A',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
  },
  disambigBtnText: { fontSize: 13, fontWeight: '600', color: '#4ADE80' },

  // Instacart promo
  instacartCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,201,167,0.2)',
    gap: 12,
  },
  instacartLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  instacartIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(0,201,167,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instacartTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textWhite,
    marginBottom: 3,
  },
  instacartSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  storeLogos: {
    marginHorizontal: -4,
  },
  storeLogosContent: {
    paddingHorizontal: 4,
    gap: 6,
    flexDirection: 'row',
  },
  storeBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  storeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  instacartCta: {
    fontSize: 14,
    fontWeight: '700',
    color: '#00C9A7',
    alignSelf: 'flex-end',
  },

  // Progress bar
  progressCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 20,
    marginBottom: 12,
    gap: 10,
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#2A2A2A',
    borderRadius: 3,
  },
  progressBarFill: {
    height: 6,
    backgroundColor: '#4ADE80',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textWhite,
  },
  progressPercent: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4ADE80',
  },
  storeLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
    textAlign: 'center',
  },

  // Prep timeline
  prepCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.2)',
    padding: 16,
    marginBottom: 24,
    gap: 12,
  },
  prepTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  prepSection: {
    gap: 6,
  },
  prepSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  prepMealRow: {
    paddingLeft: 4,
  },
  prepMealName: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textWhite,
  },
  prepDismiss: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },

  // Reorder button
  reorderBtn: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,201,167,0.3)',
    alignItems: 'center',
    gap: 4,
  },
  reorderBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#00C9A7',
  },
  reorderBtnSub: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
})
