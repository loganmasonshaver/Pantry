import { useState, useCallback, useRef, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  TextInput,
  PanResponder,
  Alert,
  LayoutAnimation,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { Trash2, Check, Plus, Clock, ShoppingCart } from 'lucide-react-native'
import Svg, { Circle as SvgCircle } from 'react-native-svg'
import { COLORS } from '@/constants/colors'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { haptic } from '@/lib/haptics'
import { STORE_CATEGORIES, autoCategoryMatches, categorizeItem } from '@/lib/categories'
import PantryGroceryTabs from '@/components/PantryGroceryTabs'

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
  onRename,
}: {
  item: GroceryItem
  onToggle: () => void
  onDelete: () => void
  onRename: (newName: string) => void
}) {
  const translateX = useRef(new Animated.Value(0)).current
  const DELETE_THRESHOLD = -80
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(item.name)

  const startEdit = () => {
    setEditName(item.name.replace(/\s*\*\s*$/, ''))
    setEditing(true)
  }

  const commitEdit = () => {
    const next = editName.trim()
    if (next && next !== item.name) {
      onRename(next)
    }
    setEditing(false)
  }

  const panResponder = useRef(
    PanResponder.create({
      // only claim the gesture if horizontal movement dominates, so vertical scroll still works.
      // 10px threshold filters out incidental finger jitter on tap.
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        if (g.dx < 0) translateX.setValue(g.dx) // left-swipe only — right-swipe is a no-op
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < DELETE_THRESHOLD) {
          // Past threshold: animate the row fully off-screen (-400px is well past any
          // device width) BEFORE invoking onDelete, so the row doesn't flicker back to
          // origin between gesture release and the parent state update.
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
        <View style={styles.row}>
          {/* Checkbox toggles checked state. Tapping the row TEXT enters edit mode
              for renaming (Reminders pattern). Tapping the row outside both does nothing. */}
          <TouchableOpacity
            onPress={onToggle}
            hitSlop={10}
            activeOpacity={0.6}
          >
            <View style={[styles.checkbox, item.checked && styles.checkboxChecked]}>
              {item.checked && <Check size={12} stroke="#000000" strokeWidth={2.5} />}
            </View>
          </TouchableOpacity>
          <View style={styles.rowContent}>
            {editing ? (
              <TextInput
                style={[styles.itemName, { padding: 0 }]}
                value={editName}
                onChangeText={setEditName}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={commitEdit}
                onBlur={commitEdit}
                selectTextOnFocus
              />
            ) : (
              <TouchableOpacity onPress={startEdit} activeOpacity={0.6}>
                <Text style={[styles.itemName, item.checked && styles.itemNameChecked]}>
                  {item.name.replace(/\s*\*\s*$/, '')}
                </Text>
                {item.meal ? <Text style={styles.itemMeal}>{item.meal}</Text> : null}
              </TouchableOpacity>
            )}
          </View>
        </View>
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
  // Inline-edit pattern (Reminders-style): tapping "+ Add Item" transforms the
  // bottom row into an editable row with a circle on the left + TextInput.
  // No modal — multi-add is fluid (just keep hitting return).
  const [inlineAdding, setInlineAdding] = useState(false)
  const [inlineName, setInlineName] = useState('')
  const inlineInputRef = useRef<TextInput>(null)
  const scrollRef = useRef<ScrollView>(null)
  // In-flight guards: submitInline awaits categorizeItem (network) before inserting, and
  // handleReorder inserts a batch — without these a fast double-tap inserts duplicate rows
  // because the dedup check reads stale state during the async gap.
  const submittingRef = useRef(false)
  const reorderingRef = useRef(false)
  const toastOpacity = useRef(new Animated.Value(0)).current
  const [recentOrder, setRecentOrder] = useState<{ meals: string[]; orderedAt: Date } | null>(null)
  const [lastOrder, setLastOrder] = useState<{ items: any[]; createdAt: Date } | null>(null)

  const fetchItems = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('grocery_items')
      .select('id, name, meal, category, checked')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(500) // a grocery list never realistically exceeds this; bounds the per-focus fetch
    if (data) {
      // Lazy migration: items inserted before the category taxonomy was renamed
      // (Pantry Staples / Condiments / Dairy → new STORE_CATEGORIES) get re-bucketed
      // on read. The trailing '*' was an old hack to mark "from generated meal" — strip.
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

      // Exact (case-insensitive) dedup only. The old substring-based fuzzy match permanently
      // HID distinct items — e.g. "brown rice" collapsed under "rice", "almond milk" under
      // "milk" — and those DB rows were never cleaned up, so the user just lost groceries from
      // the list. Showing an occasional AI near-dupe is far better than hiding a real item.
      const seen = new Set<string>()
      const deduped = fixed.filter(item => {
        const lower = item.name.toLowerCase().trim()
        if (seen.has(lower)) return false
        seen.add(lower)
        return true
      })

      setItems(deduped)
    }
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
  }, [fetchItems]))

  const rename = async (id: string, newName: string) => {
    const trimmed = newName.trim()
    if (!trimmed) return
    setItems(prev => prev.map(i => i.id === id ? { ...i, name: trimmed } : i))
    await supabase.from('grocery_items').update({ name: trimmed }).eq('id', id)
  }

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
    haptic.medium()
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut) // rows collapse together instead of blinking out
    setItems(prev => prev.filter(i => !i.checked))
    await supabase.from('grocery_items').delete().in('id', ids)
  }

  const deleteItem = async (id: string) => {
    haptic.medium()
    // Row already slid off via the swipe translateX; this eases the gap closed behind it.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setItems(prev => prev.filter(i => i.id !== id))
    await supabase.from('grocery_items').delete().eq('id', id)
  }

  // Closed-loop grocery→pantry transfer: checked items move into the pantry as in_stock.
  // Pantry has a unique (user_id, name) constraint, so we split into insert (new) +
  // update (toggle existing back to in_stock) rather than upsert — gives accurate counts
  // for the success toast and avoids overwriting any custom category the user set.
  const addToPantry = async () => {
    if (!user) return
    const checked = items.filter(i => i.checked)
    if (!checked.length) return
    const count = checked.length
    haptic.success() // completed task: these are moving into the pantry
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setItems(prev => prev.filter(i => !i.checked))

    // Check which items already exist in pantry
    const { data: existing } = await supabase
      .from('pantry_items')
      .select('name')
      .eq('user_id', user.id)
    const existingNames = new Set((existing ?? []).map(e => e.name.toLowerCase()))

    // Only insert items not already in pantry
    const newItems = checked.filter(i => !existingNames.has(i.name.toLowerCase()))
    if (newItems.length > 0) {
      await supabase.from('pantry_items').insert(
        newItems.map(i => ({
          user_id: user.id,
          name: i.name,
          category: i.category,
          in_stock: true,
        })),
      )
    }

    // Mark existing ones as in_stock in case they were previously toggled off (out of stock).
    // ilike (case-insensitive) is safer than equality — historical entries have inconsistent casing.
    const existingItems = checked.filter(i => existingNames.has(i.name.toLowerCase()))
    for (const item of existingItems) {
      await supabase.from('pantry_items').update({ in_stock: true }).eq('user_id', user.id).ilike('name', item.name)
    }

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

  const startInlineAdd = () => {
    setInlineName('')
    setInlineAdding(true)
    // Scroll the inline row into view in case list is already long. setTimeout
    // gives React time to render the input before the scroll target exists.
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
    // autoFocus on the TextInput handles initial focus
  }

  const submitInline = async () => {
    const name = inlineName.trim()
    if (!name || !user) return
    if (submittingRef.current) return // ignore re-entry while a prior add is in flight
    submittingRef.current = true
    try {

    // Inline mode auto-picks the first category match — disambig modal is gone.
    // For ambiguous items the user can long-press to reassign later (future).
    const category = await categorizeItem(name)

    // Exact (case-insensitive) match only — substring matching was over-aggressive:
    // "chicken breast" was blocking "chicken thigh", "olive oil" blocking "vegetable oil",
    // etc. Users legitimately want multiple variants on a grocery list.
    const isDuplicate = items.some(existing =>
      existing.name.toLowerCase() === name.toLowerCase()
    )
    if (isDuplicate) {
      Alert.alert('Already on your list', `${name} is already in your grocery list.`)
      return
    }

    const { data, error } = await supabase
      .from('grocery_items')
      .insert({
        user_id: user.id,
        name,
        meal: '',
        category,
        checked: false,
      })
      .select('id, name, meal, category, checked')
      .single()
    if (!error && data) {
      setItems(prev => [...prev, data])
      setInlineName('')
      // Keep focus + scroll the inline input back into view so user can see what
      // they're typing as the list grows. setTimeout gives React time to commit
      // the new item + relayout before the scroll.
      inlineInputRef.current?.focus()
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
    }
    } finally {
      submittingRef.current = false
    }
  }

  const endInlineAdd = () => {
    setInlineAdding(false)
    setInlineName('')
    inlineInputRef.current?.blur()
  }

  const handleReorder = async () => {
    if (!user || !lastOrder) return
    if (reorderingRef.current) return // ignore double-tap on Reorder
    reorderingRef.current = true
    try {
      // Skip items already on the list (case-insensitive) so reorder doesn't pile on dupes.
      const existing = new Set(items.map(i => i.name.toLowerCase().trim()))
      const toInsert = lastOrder.items.filter(i => !existing.has(i.name.toLowerCase().trim()))
      if (toInsert.length) {
        await supabase.from('grocery_items').insert(
          toInsert.map(i => ({
            user_id: user.id,
            name: i.name,
            meal: i.meal || '',
            category: i.category || 'Other',
            checked: false,
          })),
        )
        fetchItems()
      }
    } finally {
      reorderingRef.current = false
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
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}

      {/* ── Header ── */}
      <View style={styles.header}>
        <PantryGroceryTabs active="grocery" />
        <View style={styles.headerActions}>
          {inlineAdding ? (
            <TouchableOpacity onPress={endInlineAdd} activeOpacity={0.7} hitSlop={10}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.iconBtn, !checkedCount && styles.iconBtnDisabled]}
                onPress={clearChecked}
                activeOpacity={0.7}
                disabled={checkedCount === 0}
              >
                <Trash2 size={18} stroke={checkedCount ? '#EF4444' : COLORS.textMuted} strokeWidth={1.8} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.addToPantryPill, !checkedCount && styles.addToPantryPillDisabled]}
                onPress={addToPantry}
                disabled={!checkedCount}
                activeOpacity={0.85}
              >
                <Text style={[styles.addToPantryPillText, !checkedCount && styles.addToPantryPillTextDisabled]}>
                  Add to Pantry{checkedCount ? ` (${checkedCount})` : ''}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {isEmpty ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyCircle}>
            <ShoppingCart size={32} stroke="#4ADE80" strokeWidth={2} />
          </View>
          <Text style={styles.emptyTitle}>You're all stocked up</Text>
          <Text style={styles.emptySub}>Add items as you think of them so you don't forget at the store</Text>
          <TouchableOpacity style={styles.emptyAddBtn} onPress={startInlineAdd} activeOpacity={0.85}>
            <Plus size={18} stroke="#000" strokeWidth={2.5} />
            <Text style={styles.emptyAddBtnText}>Add to List</Text>
          </TouchableOpacity>
          {lastOrder && (
            <TouchableOpacity style={styles.reorderBtn} activeOpacity={0.8} onPress={handleReorder}>
              <Text style={styles.reorderBtnText}>Reorder Last</Text>
              <Text style={styles.reorderBtnSub}>
                {lastOrder.items.length} item{lastOrder.items.length !== 1 ? 's' : ''} · {relativeTime(lastOrder.createdAt)}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <>
          {/* ── Progress Card with Ring ── */}
          <View style={styles.progressCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.progressLabel}>
                {checkedCount === items.length ? 'All Done' : checkedCount >= items.length * 0.5 ? 'Almost Done' : 'Getting Started'}
              </Text>
              <Text style={styles.progressTitle}>Grocery Run</Text>
              <Text style={styles.progressSub}>
                {checkedCount === items.length
                  ? 'Everything collected!'
                  : `Just ${items.length - checkedCount} item${items.length - checkedCount !== 1 ? 's' : ''} left to complete your list.`}
              </Text>
            </View>
            <View style={{ width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={80} height={80} style={{ transform: [{ rotate: '-90deg' }] }}>
                <SvgCircle cx={40} cy={40} r={34} stroke="rgba(255,255,255,0.08)" strokeWidth={5} fill="transparent" />
                <SvgCircle cx={40} cy={40} r={34} stroke="#4ADE80" strokeWidth={5} fill="transparent"
                  // dashoffset controls how much of the ring circumference is visible
                  strokeDasharray={`${2 * Math.PI * 34}`}
                  // fraction of ring to leave unfilled based on checked ratio
                  strokeDashoffset={2 * Math.PI * 34 * (1 - checkedCount / items.length)}
                  strokeLinecap="round" />
              </Svg>
              <View style={{ position: 'absolute', alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: '800', color: COLORS.textWhite }}>{checkedCount}/{items.length}</Text>
                <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Items</Text>
              </View>
            </View>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
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
            {(() => {
              /* Always grouped by category */
              return grouped.map(group => (
                <View key={group.category} style={styles.group}>
                  <Text style={styles.groupLabel}>{group.category}</Text>
                  <View style={styles.groupCard}>
                    {group.items.map((item, i) => (
                      <View key={item.id}>
                        {i > 0 && <View style={styles.divider} />}
                        <GroceryRow item={item} onToggle={() => toggle(item.id)} onDelete={() => deleteItem(item.id)} onRename={(name) => rename(item.id, name)} />
                      </View>
                    ))}
                  </View>
                </View>
              ))
            })()}

            {/* Reminders-style add: shows "+ Add Item" by default, transforms
                into an inline editable row (circle + TextInput) when tapped.
                Submit-on-return saves the item + clears input + keeps focus so
                user can rapid-add multiple. "Done" in header exits inline mode. */}
            {inlineAdding ? (
              <View style={styles.inlineEditRow}>
                <View style={styles.inlineEditCircle} />
                <TextInput
                  ref={inlineInputRef}
                  style={styles.inlineEditInput}
                  placeholder="Add Item"
                  placeholderTextColor={COLORS.textMuted}
                  value={inlineName}
                  onChangeText={setInlineName}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={submitInline}
                  blurOnSubmit={false}
                />
              </View>
            ) : (
              <TouchableOpacity
                style={styles.addItemRow}
                onPress={startInlineAdd}
                activeOpacity={0.7}
              >
                <Plus size={18} stroke="#4ADE80" strokeWidth={2} />
                <Text style={styles.addItemRowText}>Add Item</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </>
      )}

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

  group: { marginBottom: 16 },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  groupCard: { backgroundColor: COLORS.cardElevated, borderRadius: 16, overflow: 'hidden' },
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
    paddingVertical: 14,
    gap: 14,
    backgroundColor: COLORS.cardElevated,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
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
  emptyAddBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
  },
  emptyAddBtnText: { color: '#000000', fontSize: 16, fontWeight: '700' },
  addToPantryPill: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addToPantryPillDisabled: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  addToPantryPillText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  addToPantryPillTextDisabled: {
    color: COLORS.textMuted,
  },
  addItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginTop: 12,
    marginHorizontal: 20,
    borderRadius: 14,
    backgroundColor: 'rgba(74,222,128,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.15)',
  },
  addItemRowText: {
    color: '#4ADE80',
    fontSize: 15,
    fontWeight: '600',
  },
  inlineEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginTop: 12,
    marginHorizontal: 20,
    borderRadius: 14,
    backgroundColor: COLORS.cardElevated,
    borderWidth: 1,
    borderColor: COLORS.trackDark,
  },
  inlineEditCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.textMuted,
  },
  inlineEditInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textWhite,
    padding: 0,
  },
  doneText: {
    color: '#4ADE80',
    fontSize: 15,
    fontWeight: '600',
  },

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
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.cardElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 14,
    borderWidth: 1,
    borderColor: COLORS.trackDark,
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
  // Progress card
  progressCard: {
    backgroundColor: COLORS.cardElevated,
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4ADE80',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 4,
  },
  progressTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.5,
  },
  progressSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 6,
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
