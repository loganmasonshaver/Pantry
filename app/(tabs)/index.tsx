import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
  Modal,
  TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useState, useRef } from 'react'
import { Clock, RefreshCw, Utensils, ScanLine, Milk, UtensilsCrossed, Droplets, ChevronDown, Pencil, Plus, X, Trash2 } from 'lucide-react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { COLORS } from '@/constants/colors'
import { MOCK_USER, MOCK_MACROS, MOCK_MEALS } from '@/constants/mock'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

const { width } = Dimensions.get('window')

// ── Types & meal slot data ────────────────────────────────────────────

type LogEntry = {
  id: string
  name: string
  time: string
  calories: number
  protein: number
  Icon: React.ElementType
}

type MealSlot = {
  id: string
  label: string
  entries: LogEntry[]
}

const INITIAL_SLOTS: MealSlot[] = [
  {
    id: 'breakfast',
    label: 'Breakfast',
    entries: [
      { id: '1', name: 'Greek Yogurt Bowl', time: '8:30 AM', calories: 320, protein: 28, Icon: Milk },
    ],
  },
  {
    id: 'lunch',
    label: 'Lunch',
    entries: [
      { id: '2', name: 'Chicken Pesto Pasta', time: '1:15 PM', calories: 620, protein: 52, Icon: UtensilsCrossed },
    ],
  },
  {
    id: 'dinner',
    label: 'Dinner',
    entries: [],
  },
  {
    id: 'snack',
    label: 'Snack',
    entries: [
      { id: '3', name: 'Protein Shake', time: '4:00 PM', calories: 180, protein: 30, Icon: Droplets },
    ],
  },
]

// ── Macro card ────────────────────────────────────────────────────────

const MACRO_ROWS = [
  { label: 'Calories', consumed: 1200, goal: 2400, unit: 'kcal', color: '#FFFFFF' },
  { label: 'Protein',  consumed: 80,   goal: 180,  unit: 'g',    color: '#4ADE80' },
  { label: 'Carbs',    consumed: 140,  goal: 280,  unit: 'g',    color: '#F59E0B' },
  { label: 'Fat',      consumed: 38,   goal: 70,   unit: 'g',    color: '#60A5FA' },
]

function MacroCard() {
  const [expanded, setExpanded] = useState(false)

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setExpanded(prev => !prev)
  }

  const cal  = MACRO_ROWS[0]
  const prot = MACRO_ROWS[1]

  return (
    <TouchableOpacity style={styles.macroCard} activeOpacity={0.85} onPress={toggle}>

      {/* Collapsed: only when not expanded */}
      {!expanded && (
        <View style={styles.macroColRow}>
          <View style={styles.macroCol}>
            <Text style={styles.macroColLabel}>Total Daily Cals</Text>
            <Text style={styles.macroColValue}>
              <Text style={styles.macroColBold}>{cal.consumed.toLocaleString()} / {cal.goal.toLocaleString()} kcal</Text>
            </Text>
            <View style={styles.macroBarTrack}>
              <View style={[styles.macroBarFill, { width: `${(cal.consumed / cal.goal) * 100}%`, backgroundColor: '#FFFFFF' }]} />
            </View>
            <Text style={styles.macroColRemaining}>{(cal.goal - cal.consumed).toLocaleString()} kcal left</Text>
          </View>
          <View style={styles.macroColDivider} />
          <View style={styles.macroCol}>
            <Text style={styles.macroColLabel}>Protein</Text>
            <Text style={styles.macroColValue}>
              <Text style={styles.macroColBold}>{prot.consumed} / {prot.goal}g</Text>
            </Text>
            <View style={styles.macroBarTrack}>
              <View style={[styles.macroBarFill, { width: `${(prot.consumed / prot.goal) * 100}%`, backgroundColor: '#4ADE80' }]} />
            </View>
          </View>
        </View>
      )}

      {/* Expanded: only when expanded */}
      {expanded && (
        <View style={styles.macroExpandedBlock}>
          {MACRO_ROWS.map((row, i) => (
            <View key={row.label}>
              {i > 0 && <View style={styles.macroExpandedDivider} />}
              <View style={styles.macroExpandedRow}>
                <Text style={styles.macroExpandedLabel}>{row.label}</Text>
                <View style={styles.macroExpandedBarTrack}>
                  <View style={[styles.macroBarFill, { width: `${Math.min(row.consumed / row.goal, 1) * 100}%`, backgroundColor: row.color }]} />
                </View>
                <Text style={styles.macroExpandedValue}>
                  <Text style={styles.macroExpandedBold}>{row.consumed.toLocaleString()}</Text>
                  <Text style={styles.macroExpandedUnit}> / {row.goal.toLocaleString()}{row.label === 'Calories' ? '' : row.unit}</Text>
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Chevron: always visible, never conditional */}
      <View style={styles.macroChevronRow}>
        <View style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined}>
          <ChevronDown size={14} stroke={COLORS.textMuted} strokeWidth={2} />
        </View>
      </View>

    </TouchableOpacity>
  )
}

// ── Suggested meal card ───────────────────────────────────────────────

type Meal = (typeof MOCK_MEALS)[number]

function MealCard({ meal }: { meal: Meal }) {
  const router = useRouter()
  return (
    <TouchableOpacity style={styles.mealCard} activeOpacity={0.75} onPress={() => router.push({ pathname: '/meal/[id]', params: { id: meal.id } })}>
      {meal.image ? (
        <Image source={{ uri: meal.image }} style={styles.mealImage} />
      ) : (
        <View style={styles.mealImagePlaceholder}>
          <Utensils size={24} stroke="#666666" strokeWidth={1.5} />
        </View>
      )}
      <View style={styles.mealInfo}>
        <Text style={styles.mealName}>{meal.name}</Text>
        <View style={styles.mealMeta}>
          <Clock size={13} stroke={COLORS.textMuted} strokeWidth={1.8} />
          <Text style={styles.mealMetaText}>{meal.prepTime} min prep</Text>
        </View>
        <View style={styles.mealMacros}>
          <Text style={styles.mealMacroText}>
            <Text style={styles.mealMacroBold}>{meal.calories} kcal</Text>
          </Text>
          <View style={styles.macroDot} />
          <Text style={styles.mealMacroText}>
            <Text style={styles.mealMacroBold}>{meal.protein}g</Text> Protein
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

// ── Meal slot component ───────────────────────────────────────────────

function SlotCard({
  slot,
  expanded,
  onToggle,
  onDeleteEntry,
  onRemoveSlot,
}: {
  slot: MealSlot
  expanded: boolean
  onToggle: () => void
  onDeleteEntry: (entryId: string) => void
  onRemoveSlot: () => void
}) {
  const router = useRouter()
  const [pendingDelete, setPendingDelete] = useState(false)
  const slotCal = slot.entries.reduce((s, e) => s + e.calories, 0)

  return (
    <View style={styles.slotCard}>
      <TouchableOpacity
        style={styles.slotHeader}
        onPress={pendingDelete ? undefined : onToggle}
        onLongPress={() => setPendingDelete(true)}
        delayLongPress={400}
        activeOpacity={0.7}
      >
        <Text style={styles.slotLabel}>{slot.label}</Text>
        {pendingDelete ? (
          <View style={styles.slotDeleteRow}>
            <TouchableOpacity
              onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); onRemoveSlot() }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.slotRemoveText}>Remove Slot</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setPendingDelete(false)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.slotCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.slotHeaderRight}>
            <Text style={styles.slotCal}>
              {slot.entries.length === 0 ? 'Empty' : `${slotCal} kcal`}
            </Text>
            <ChevronDown
              size={16}
              stroke={COLORS.textMuted}
              strokeWidth={2}
              style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
            />
          </View>
        )}
      </TouchableOpacity>

      {expanded && slot.entries.length > 0 && (
        <View style={styles.slotEntries}>
          {slot.entries.map((entry, i) => (
            <View key={entry.id}>
              {i > 0 && <View style={styles.slotDivider} />}
              <Swipeable
                renderRightActions={() => (
                  <TouchableOpacity
                    style={styles.deleteAction}
                    onPress={() => onDeleteEntry(entry.id)}
                    activeOpacity={0.8}
                  >
                    <Trash2 size={18} stroke="#FFFFFF" strokeWidth={2} />
                  </TouchableOpacity>
                )}
                overshootRight={false}
              >
                <TouchableOpacity
                  style={styles.logCard}
                  activeOpacity={0.7}
                  onPress={() => router.push({ pathname: '/meal/[id]', params: { id: '1' } })}
                >
                  <View style={styles.logIconCircle}>
                    <entry.Icon size={12} stroke="#888888" strokeWidth={1.8} />
                  </View>
                  <View style={styles.logInfo}>
                    <Text style={styles.logName}>{entry.name}</Text>
                    <Text style={styles.logTime}>{entry.time}</Text>
                  </View>
                  <View style={styles.logMacros}>
                    <Text style={styles.logCal}>{entry.calories} kcal</Text>
                    <Text style={styles.logPro}>{entry.protein}g protein</Text>
                  </View>
                </TouchableOpacity>
              </Swipeable>
            </View>
          ))}
        </View>
      )}

      {expanded && slot.entries.length === 0 && (
        <View style={styles.slotEmpty}>
          <Text style={styles.slotEmptyText}>Nothing logged yet</Text>
        </View>
      )}
    </View>
  )
}

// ── Home screen ──────────────────────────────────────────────────────

export default function HomeScreen() {
  // Suggested meals collapse
  const [mealsExpanded, setMealsExpanded] = useState(false)
  const chevronAnim = useRef(new Animated.Value(0)).current

  const toggleMeals = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    Animated.timing(chevronAnim, {
      toValue: mealsExpanded ? 0 : 1,
      duration: 250,
      useNativeDriver: true,
    }).start()
    setMealsExpanded(prev => !prev)
  }

  const chevronRotation = chevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '0deg'],
  })

  // Meal slots
  const [slots, setSlots] = useState<MealSlot[]>(INITIAL_SLOTS)
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set(['breakfast']))

  const toggleSlot = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setExpandedSlots(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const deleteEntry = (slotId: string, entryId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setSlots(prev => prev.map(s =>
      s.id === slotId ? { ...s, entries: s.entries.filter(e => e.id !== entryId) } : s
    ))
  }

  const removeSlot = (slotId: string) => {
    setSlots(prev => prev.filter(s => s.id !== slotId))
    setExpandedSlots(prev => { const next = new Set(prev); next.delete(slotId); return next })
  }

  // Add meal modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [newSlotName, setNewSlotName] = useState('')

  const confirmAddSlot = () => {
    const trimmed = newSlotName.trim()
    if (!trimmed) return
    const id = trimmed.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now()
    setSlots(prev => [...prev, { id, label: trimmed, entries: [] }])
    setNewSlotName('')
    setShowAddModal(false)
  }

  const totalCal = slots.flatMap(s => s.entries).reduce((s, e) => s + e.calories, 0)
  const totalPro = slots.flatMap(s => s.entries).reduce((s, e) => s + e.protein, 0)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.avatar}>
              <Text style={styles.avatarInitial}>{MOCK_USER.name.charAt(0)}</Text>
            </View>
            <View>
              <Text style={styles.hiText}>Hi {MOCK_USER.name}</Text>
              <Text style={styles.greetText}>{MOCK_USER.greeting},</Text>
            </View>
          </View>
        </View>

        {/* ── Daily Macros card ── */}
        <MacroCard />

        {/* ── Suggested Meals panel ── */}
        <View style={[styles.panel, !mealsExpanded && styles.panelCollapsed]}>
          <TouchableOpacity style={[styles.sectionHeader, mealsExpanded && styles.sectionHeaderExpanded]} onPress={toggleMeals} activeOpacity={0.7}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Suggested Meals</Text>
              {!mealsExpanded && (
                <Text style={styles.mealsCollapsedSub}>{MOCK_MEALS.length} meals ready</Text>
              )}
            </View>
            <Animated.View style={{ transform: [{ rotate: chevronRotation }] }}>
              <ChevronDown size={20} stroke={COLORS.textMuted} strokeWidth={2} />
            </Animated.View>
          </TouchableOpacity>

          {mealsExpanded && (
            <>
              <View style={styles.mealList}>
                {MOCK_MEALS.map((meal) => (
                  <MealCard key={meal.id} meal={meal} />
                ))}
              </View>
              <TouchableOpacity style={styles.regenButton} activeOpacity={0.8}>
                <RefreshCw size={18} stroke={COLORS.textWhite} strokeWidth={2} />
                <Text style={styles.regenText}>Regenerate</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* ── Today's Log ── */}
        <View style={styles.logSection}>
          <View style={styles.logHeader}>
            <Text style={styles.logTitle}>Today's Log</Text>
            <TouchableOpacity style={styles.logPillBtn} activeOpacity={0.7}>
              <ScanLine size={18} stroke={COLORS.textWhite} strokeWidth={1.8} />
              <Text style={styles.logPillBtnText}>Log with AI</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.logPillBtn} activeOpacity={0.7}>
              <Pencil size={18} stroke={COLORS.textWhite} strokeWidth={1.8} />
              <Text style={styles.logPillBtnText}>Manual</Text>
            </TouchableOpacity>
          </View>

          {slots.map(slot => (
            <SlotCard
              key={slot.id}
              slot={slot}
              expanded={expandedSlots.has(slot.id)}
              onToggle={() => toggleSlot(slot.id)}
              onDeleteEntry={(entryId) => deleteEntry(slot.id, entryId)}
              onRemoveSlot={() => removeSlot(slot.id)}
            />
          ))}

          <TouchableOpacity style={styles.addSlotBtn} activeOpacity={0.6} onPress={() => setShowAddModal(true)}>
            <Plus size={15} stroke={COLORS.textMuted} strokeWidth={2} />
            <Text style={styles.addSlotText}>Add Meal</Text>
          </TouchableOpacity>

          <Text style={styles.logTotal}>
            Total today: {totalCal.toLocaleString()} kcal · {totalPro}g protein
          </Text>
        </View>
      </ScrollView>

      {/* ── Add Meal Modal ── */}
      <Modal visible={showAddModal} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAddModal(false)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Meal Slot</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)} activeOpacity={0.7}>
                <X size={18} stroke={COLORS.textMuted} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Pre-Workout, Evening Snack"
              placeholderTextColor={COLORS.textMuted}
              value={newSlotName}
              onChangeText={setNewSlotName}
              autoFocus
              onSubmitEditing={confirmAddSlot}
            />
            <TouchableOpacity style={styles.modalConfirm} activeOpacity={0.8} onPress={confirmAddSlot}>
              <Text style={styles.modalConfirmText}>Add Slot</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { paddingBottom: 40 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 18, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.2 },
  hiText: { fontSize: 20, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.3 },
  greetText: { fontSize: 14, color: COLORS.textDim, marginTop: 1 },

  // Macro card
  macroCard: {
    marginHorizontal: 20,
    marginBottom: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
  },
  // Collapsed layout
  macroColRow: { flexDirection: 'row', gap: 16 },
  macroCol: { flex: 1, gap: 6 },
  macroColDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 2 },
  macroColValue: { fontSize: 13, color: COLORS.textDim },
  macroColBold: { fontSize: 16, fontWeight: '700', color: COLORS.textWhite },
  macroColUnit: { fontSize: 12, color: COLORS.textMuted },
  macroColLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: '500', marginBottom: 4 },
  macroColRemaining: { fontSize: 11, color: COLORS.textMuted, fontWeight: '400', marginTop: 5 },
  macroBarTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  macroBarFill: { height: '100%', borderRadius: 2 },
  macroChevronRow: { alignItems: 'center', marginTop: 10 },
  // Expanded layout
  macroExpandedBlock: { marginTop: 14, gap: 0 },
  macroExpandedDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 8 },
  macroExpandedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  macroExpandedLabel: { width: 62, fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },
  macroExpandedBarTrack: {
    flex: 1,
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  macroExpandedValue: { width: 100, fontSize: 12, color: COLORS.textMuted, textAlign: 'right' },
  macroExpandedBold: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite },
  macroExpandedUnit: { fontSize: 12, fontWeight: '400', color: COLORS.textMuted },

  // Suggested meals panel
  panel: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    marginHorizontal: 20,
    minHeight: 500,
    paddingTop: 12,
    paddingHorizontal: 24,
    paddingBottom: 36,
  },
  panelCollapsed: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    minHeight: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 0,
  },
  sectionHeaderExpanded: { paddingBottom: 0, marginBottom: 20 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, letterSpacing: -0.4 },
  mealsCollapsedSub: { fontSize: 13, color: COLORS.textMuted, fontWeight: '400' },

  // Meal cards
  mealList: { gap: 14, marginBottom: 28 },
  mealCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EBEBEB',
    backgroundColor: COLORS.card,
    padding: 16,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  mealImage: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#F5F5F5' },
  mealImagePlaceholder: {
    width: 72, height: 72, borderRadius: 12,
    backgroundColor: '#2C2C2C', alignItems: 'center', justifyContent: 'center',
  },
  mealInfo: { flex: 1, gap: 6 },
  mealName: { fontSize: 16, fontWeight: '700', color: COLORS.text, letterSpacing: -0.2 },
  mealMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mealMetaText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '400' },
  mealMacros: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mealMacroText: { fontSize: 13, color: COLORS.text, fontWeight: '400' },
  mealMacroBold: { fontWeight: '700' },
  macroDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.textMuted },
  regenButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: COLORS.background, borderRadius: 16, paddingVertical: 18,
  },
  regenText: { color: COLORS.textWhite, fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },

  // Today's Log
  logSection: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 40, gap: 10 },
  logHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  logTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.4 },
  logPillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A',
    borderRadius: 24, paddingVertical: 12, paddingHorizontal: 20,
  },
  logPillBtnText: { fontSize: 15, fontWeight: '700', color: COLORS.textWhite },

  // Meal slots
  slotCard: {
    backgroundColor: '#1A1A1A', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A2A2A', overflow: 'hidden',
  },
  slotHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 14,
  },
  slotLabel: { fontSize: 15, fontWeight: '700', color: COLORS.textWhite },
  slotHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slotCal: { fontSize: 13, color: COLORS.textMuted, fontWeight: '400' },
  slotDeleteRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  slotRemoveText: { fontSize: 13, fontWeight: '600', color: '#EF4444' },
  slotCancelText: { fontSize: 13, fontWeight: '500', color: COLORS.textMuted },
  slotEntries: { paddingHorizontal: 12, paddingBottom: 12 },
  slotDivider: { height: 1, backgroundColor: '#2A2A2A', marginVertical: 4 },
  slotEmpty: { paddingHorizontal: 14, paddingBottom: 12 },
  slotEmptyText: { fontSize: 12, color: COLORS.textMuted },

  // Swipe delete
  deleteAction: { width: 80, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },

  // Log entry row
  logCard: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, paddingHorizontal: 0, gap: 10,
    backgroundColor: '#1A1A1A',
  },
  logIconCircle: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center',
  },
  logInfo: { flex: 1, gap: 2 },
  logName: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite, letterSpacing: -0.1 },
  logTime: { fontSize: 11, color: COLORS.textMuted },
  logMacros: { alignItems: 'flex-end', gap: 2 },
  logCal: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite },
  logPro: { fontSize: 11, color: COLORS.textMuted },

  // Add slot button
  addSlotBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  addSlotText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },
  logTotal: { fontSize: 12, color: COLORS.textMuted, textAlign: 'right', marginTop: 4 },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#1A1A1A', borderRadius: 20, padding: 20,
    gap: 16, borderWidth: 1, borderColor: '#2A2A2A',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.textWhite },
  modalInput: {
    backgroundColor: '#2A2A2A', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: COLORS.textWhite,
  },
  modalConfirm: {
    backgroundColor: COLORS.textWhite, borderRadius: 30,
    paddingVertical: 14, alignItems: 'center',
  },
  modalConfirmText: { fontSize: 15, fontWeight: '700', color: '#000000' },
})
