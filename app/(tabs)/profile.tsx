import { useState, useRef, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Dimensions,
  PanResponder,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Settings, ChevronRight } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import { useAIConsent } from '@/context/AIConsentContext'
import { supabase } from '@/lib/supabase'
import { useSuperwall, useUser } from 'expo-superwall'
import { trackWeightLogged } from '@/lib/analytics'

const { width } = Dimensions.get('window')

// ── Types ──────────────────────────────────────────────────────────────

type PeriodKey = '7D' | '1M' | '3M' | '6M' | 'All'
type WeightLogEntry = { weight_kg: number; logged_at: string }

// ── Helpers ────────────────────────────────────────────────────────────

const PERIODS: PeriodKey[] = ['7D', '1M', '3M', '6M', 'All']

const PERIOD_CUTOFF_DAYS: Record<PeriodKey, number> = {
  '7D': 7, '1M': 30, '3M': 90, '6M': 180, 'All': 99999,
}

function buildPeriodData(
  logs: WeightLogEntry[]
): Record<PeriodKey, { values: number[]; labels: string[] }> | null {
  if (logs.length === 0) return null
  const result = {} as Record<PeriodKey, { values: number[]; labels: string[] }>
  for (const period of PERIODS) {
    const cutoff = new Date(Date.now() - PERIOD_CUTOFF_DAYS[period] * 86400000)
    const filtered = logs
      .filter(l => period === 'All' || new Date(l.logged_at) >= cutoff)
      .sort((a, b) => a.logged_at.localeCompare(b.logged_at))
    if (filtered.length === 0) {
      result[period] = { values: [], labels: [] }
      continue
    }
    const values = filtered.map(l => Math.round(l.weight_kg * 2.20462))
    const stride = Math.max(1, Math.ceil(filtered.length / 5))
    const labels = filtered.map((l, i) =>
      i === 0 || i === filtered.length - 1 || i % stride === 0
        ? new Date(l.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : ''
    )
    result[period] = { values, labels }
  }
  return result
}

function buildPeriodDates(logs: WeightLogEntry[]): Record<PeriodKey, string[]> | null {
  if (logs.length === 0) return null
  const result = {} as Record<PeriodKey, string[]>
  for (const period of PERIODS) {
    const cutoff = new Date(Date.now() - PERIOD_CUTOFF_DAYS[period] * 86400000)
    const filtered = logs
      .filter(l => period === 'All' || new Date(l.logged_at) >= cutoff)
      .sort((a, b) => a.logged_at.localeCompare(b.logged_at))
    result[period] = filtered.map(l =>
      new Date(l.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    )
  }
  return result
}

function calcStreak(dates: string[]): number {
  const dateSet = new Set(dates)
  let streak = 0
  const d = new Date()
  while (true) {
    const key = d.toISOString().split('T')[0]
    if (!dateSet.has(key)) break
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

function getLast7ActiveDays(dates: string[]): boolean[] {
  const dateSet = new Set(dates)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return dateSet.has(d.toISOString().split('T')[0])
  })
}

// ── Empty data (shown when no weight logs exist yet) ───────────

const EMPTY_PERIOD_DATA: Record<PeriodKey, { values: number[]; labels: string[] }> = {
  '7D': { values: [], labels: [] },
  '1M': { values: [], labels: [] },
  '3M': { values: [], labels: [] },
  '6M': { values: [], labels: [] },
  'All': { values: [], labels: [] },
}

const EMPTY_PERIOD_DATES: Record<PeriodKey, string[]> = {
  '7D': [],
  '1M': [],
  '3M': [],
  '6M': [],
  'All': [],
}

const CHART_H = 60
const CHART_W = width - 20 * 2 - 16 * 2
const DOT_R = 3.5

// ── WeightChart ────────────────────────────────────────────────────────

function WeightChart({
  onWeightChange,
  data: externalData,
  dates: externalDates,
}: {
  onWeightChange: (w: number | null) => void
  data: Record<PeriodKey, { values: number[]; labels: string[] }> | null
  dates: Record<PeriodKey, string[]> | null
}) {
  const [period, setPeriod] = useState<PeriodKey>('7D')
  const [scrubIndex, setScrubIndex] = useState<number | null>(null)

  const periodRef = useRef(period)
  const onWeightChangeRef = useRef(onWeightChange)
  const externalDataRef = useRef(externalData)
  periodRef.current = period
  onWeightChangeRef.current = onWeightChange
  externalDataRef.current = externalData

  const periodData = externalData ?? EMPTY_PERIOD_DATA
  const periodDates = externalDates ?? EMPTY_PERIOD_DATES

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const activeData = (externalDataRef.current ?? EMPTY_PERIOD_DATA)[periodRef.current].values
        if (activeData.length === 0) return
        const x = evt.nativeEvent.locationX
        const idx = Math.round((x / CHART_W) * (activeData.length - 1))
        const clamped = Math.max(0, Math.min(activeData.length - 1, idx))
        setScrubIndex(clamped)
        onWeightChangeRef.current(activeData[clamped])
      },
      onPanResponderMove: (evt) => {
        const activeData = (externalDataRef.current ?? EMPTY_PERIOD_DATA)[periodRef.current].values
        if (activeData.length === 0) return
        const x = evt.nativeEvent.locationX
        const idx = Math.round((x / CHART_W) * (activeData.length - 1))
        const clamped = Math.max(0, Math.min(activeData.length - 1, idx))
        setScrubIndex(clamped)
        onWeightChangeRef.current(activeData[clamped])
      },
      onPanResponderRelease: () => {
        setScrubIndex(null)
        onWeightChangeRef.current(null)
      },
      onPanResponderTerminate: () => {
        setScrubIndex(null)
        onWeightChangeRef.current(null)
      },
    })
  ).current

  const data = periodData[period].values
  const labels = periodData[period].labels
  const dates = periodDates[period]

  const isEmpty = data.length === 0

  const dataMin = isEmpty ? 0 : Math.min(...data) - 2
  const dataMax = isEmpty ? 100 : Math.max(...data) + 2

  const cx = (i: number) => (i / Math.max(data.length - 1, 1)) * (CHART_W - DOT_R * 2) + DOT_R
  const cy = (v: number) => ((dataMax - v) / (dataMax - dataMin)) * CHART_H + DOT_R

  const scrubX = scrubIndex !== null ? cx(scrubIndex) : null
  const scrubWeight = scrubIndex !== null ? data[scrubIndex] : null
  const scrubDate = scrubIndex !== null ? (dates[scrubIndex] ?? labels[scrubIndex]) : null

  return (
    <View>
      {/* Period toggle pills */}
      <View style={chartStyles.periodRow}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p}
            style={[chartStyles.periodPill, period === p && chartStyles.periodPillActive]}
            onPress={() => { setPeriod(p); setScrubIndex(null); onWeightChange(null) }}
            activeOpacity={0.7}
          >
            <Text style={[chartStyles.periodText, period === p && chartStyles.periodTextActive]}>
              {p}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isEmpty ? (
        <View style={chartStyles.emptyChart}>
          <Text style={chartStyles.emptyChartText}>Log your weight to see progress</Text>
        </View>
      ) : (
        <>
          {/* Chart area */}
          <View
            style={{ height: CHART_H + DOT_R * 2 + 4, position: 'relative' }}
            {...panResponder.panHandlers}
          >
            {/* Baseline */}
            <View style={{
              position: 'absolute',
              left: 0, right: 0,
              bottom: 4,
              height: 1,
              backgroundColor: '#2A2A2A',
            }} />

            {/* Connecting lines */}
            {data.slice(0, -1).map((val, i) => {
              const x1 = cx(i), y1 = cy(val)
              const x2 = cx(i + 1), y2 = cy(data[i + 1])
              const dx = x2 - x1, dy = y2 - y1
              const len = Math.sqrt(dx * dx + dy * dy)
              const angle = Math.atan2(dy, dx) * (180 / Math.PI)
              return (
                <View
                  key={`l${i}`}
                  style={{
                    position: 'absolute',
                    left: (x1 + x2) / 2 - len / 2,
                    top: (y1 + y2) / 2 - 1,
                    width: len,
                    height: 2,
                    backgroundColor: 'rgba(74,222,128,0.35)',
                    transform: [{ rotate: `${angle}deg` }],
                  }}
                />
              )
            })}

            {/* Dots */}
            {data.map((val, i) => (
              <View
                key={`d${i}`}
                style={{
                  position: 'absolute',
                  left: cx(i) - DOT_R,
                  top: cy(val) - DOT_R,
                  width: DOT_R * 2,
                  height: DOT_R * 2,
                  borderRadius: DOT_R,
                  backgroundColor: scrubIndex !== null
                    ? (i === scrubIndex ? '#4ADE80' : 'rgba(74,222,128,0.25)')
                    : (i === data.length - 1 ? '#4ADE80' : 'rgba(74,222,128,0.5)'),
                }}
              />
            ))}

            {/* Scrubber line */}
            {scrubX !== null && (
              <View style={{
                position: 'absolute',
                left: scrubX - 0.75,
                top: 0,
                bottom: 4,
                width: 1.5,
                backgroundColor: '#4ADE80',
                opacity: 0.8,
              }} />
            )}

            {/* Floating label */}
            {scrubX !== null && scrubWeight !== null && scrubDate !== null && (
              <View style={[
                chartStyles.scrubLabel,
                {
                  left: Math.min(Math.max(scrubX - 48, 0), CHART_W - 96),
                  top: -28,
                },
              ]}>
                <Text style={chartStyles.scrubLabelText}>
                  {scrubDate} · {scrubWeight} lbs
                </Text>
              </View>
            )}
          </View>

          {/* X-axis labels */}
          <View style={{ height: 14, marginTop: 6, position: 'relative' }}>
            {labels.map((label, i) => (
              <Text
                key={i}
                style={{
                  position: 'absolute',
                  left: cx(i) - 20,
                  width: 40,
                  fontSize: 9,
                  color: COLORS.textMuted,
                  fontWeight: '500',
                  textAlign: 'center',
                }}
              >
                {label}
              </Text>
            ))}
          </View>
        </>
      )}
    </View>
  )
}

const chartStyles = StyleSheet.create({
  periodRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 16,
  },
  periodPill: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
  },
  periodPillActive: {
    backgroundColor: 'rgba(74,222,128,0.15)',
  },
  periodText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  periodTextActive: {
    color: '#4ADE80',
  },
  emptyChart: {
    height: CHART_H + DOT_R * 2 + 4 + 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyChartText: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  scrubLabel: {
    position: 'absolute',
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
    width: 96,
    alignItems: 'center',
  },
  scrubLabelText: {
    fontSize: 10,
    color: COLORS.textWhite,
    fontWeight: '600',
  },
})

// ── Reusable row components ────────────────────────────────────────────

function GoalRow({ label, value, isLast, onPress }: { label: string; value: string; isLast?: boolean; onPress?: () => void }) {
  return (
    <>
      <TouchableOpacity style={styles.goalRow} activeOpacity={0.7} onPress={onPress}>
        <Text style={styles.rowLabel}>{label}</Text>
        <View style={styles.rowRight}>
          <Text style={styles.goalValue}>{value}</Text>
          <ChevronRight size={15} stroke={COLORS.textMuted} strokeWidth={1.8} />
        </View>
      </TouchableOpacity>
      {!isLast && <View style={styles.divider} />}
    </>
  )
}

function SettingsRow({
  label,
  value,
  onPress,
  isLast,
  toggle,
}: {
  label: string
  value?: string
  onPress?: () => void
  isLast?: boolean
  toggle?: { value: boolean; onChange: (v: boolean) => void }
}) {
  return (
    <>
      <TouchableOpacity style={styles.goalRow} onPress={onPress} activeOpacity={toggle ? 1 : 0.7}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.rowLabel}>{label}</Text>
          {value ? <Text style={styles.rowSub}>{value}</Text> : null}
        </View>
        {toggle ? (
          <Switch
            value={toggle.value}
            onValueChange={toggle.onChange}
            trackColor={{ false: '#2A2A2A', true: '#4ADE80' }}
            thumbColor="#FFFFFF"
            ios_backgroundColor="#2A2A2A"
          />
        ) : (
          <ChevronRight size={15} stroke={COLORS.textMuted} strokeWidth={1.8} />
        )}
      </TouchableOpacity>
      {!isLast && <View style={styles.divider} />}
    </>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────

const DIET_OPTIONS = ['None', 'Vegetarian', 'Dairy-free', 'Gluten-free', 'Nut-free']

const ACTIVITY_OPTIONS = [
  { key: 'sedentary', label: 'Sedentary', sub: 'Desk job, little exercise', mult: 1.2 },
  { key: 'light', label: 'Lightly Active', sub: 'Light exercise 1-3x/week', mult: 1.375 },
  { key: 'moderate', label: 'Moderately Active', sub: 'Exercise 3-5x/week', mult: 1.55 },
  { key: 'very', label: 'Very Active', sub: 'Hard exercise 6-7x/week', mult: 1.725 },
  { key: 'athlete', label: 'Athlete', sub: '2x/day or physical job', mult: 1.9 },
]

const FITNESS_GOAL_OPTIONS = [
  { key: 'lose', label: 'Lose Weight' },
  { key: 'maintain', label: 'Maintain' },
  { key: 'gain', label: 'Gain Muscle' },
]

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725, athlete: 1.9,
}
const GOAL_ADJUSTMENTS: Record<string, number> = {
  lose: -500, maintain: 0, gain: 300,
}

function calculateGoals(age: number, gender: string, heightCm: number, weightKg: number, activityLevel: string, fitnessGoal: string) {
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (gender === 'male' ? 5 : -161)
  const tdee = bmr * (ACTIVITY_MULTIPLIERS[activityLevel] ?? 1.55)
  const calories = Math.round(tdee + (GOAL_ADJUSTMENTS[fitnessGoal] ?? 0))
  const weightLbs = weightKg / 0.453592
  const proteinPerLb = fitnessGoal === 'lose' ? 1.2 : fitnessGoal === 'maintain' ? 1.0 : 0.8
  const protein = Math.round(weightLbs * proteinPerLb)
  // Derive carbs/fat from remaining calories after protein
  // Protein = 4 cal/g, Fat = 30% of calories (9 cal/g), Carbs = remainder (4 cal/g)
  const proteinCals = protein * 4
  const fatCals = Math.round(calories * 0.30)
  const fat = Math.round(fatCals / 9)
  const carbsCals = calories - proteinCals - fatCals
  const carbs = Math.max(0, Math.round(carbsCals / 4))
  return { calories, protein, carbs, fat }
}

type Profile = {
  calorie_goal: number | null
  protein_goal: number | null
  carbs_goal: number | null
  fat_goal: number | null
  meals_per_day: number | null
  max_prep_minutes: number | null
  weight_kg: number | null
  target_weight_kg: number | null
  dietary_restrictions: string[] | null
  age: number | null
  gender: string | null
  height_cm: number | null
  activity_level: string | null
  fitness_goal: string | null
}

export default function ProfileScreen() {
  const router = useRouter()
  const { user, signOut: authSignOut } = useAuth()
  const { acceptedAt, revokeConsent } = useAIConsent()
  const { registerPlacement } = useSuperwall()
  const { refresh: refreshSuperwallUser, getEntitlements } = useUser()
  const [darkMode, setDarkMode] = useState(true)
  const [restoring, setRestoring] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)

  const handleRestorePurchases = async () => {
    if (restoring) return
    setRestoring(true)
    try {
      await refreshSuperwallUser()
      const entitlements = await getEntitlements()
      if (entitlements?.active && entitlements.active.length > 0) {
        Alert.alert('Purchases Restored', 'Your subscription is active.')
      } else {
        // Fallback: present paywall which has native Restore button tied to StoreKit
        await registerPlacement('restore_purchases')
      }
    } catch (e: any) {
      Alert.alert('Restore Failed', e?.message ?? 'Please try again.')
    } finally {
      setRestoring(false)
    }
  }

  // Edit goal modal
  type GoalField = 'calorie_goal' | 'protein_goal' | 'meals_per_day' | 'max_prep_minutes'
  const [editGoal, setEditGoal] = useState<{ field: GoalField; label: string; unit: string; value: string } | null>(null)
  const [editValue, setEditValue] = useState('')

  const openGoalEdit = (field: GoalField, label: string, unit: string, current: number | null) => {
    setEditValue(current ? String(current) : '')
    setEditGoal({ field, label, unit, value: current ? String(current) : '' })
  }

  const saveGoal = async () => {
    if (!editGoal || !user) return
    const num = parseInt(editValue)
    if (isNaN(num) || num <= 0) { Alert.alert('Invalid value'); return }
    await supabase.from('profiles').update({ [editGoal.field]: num }).eq('id', user.id)
    setProfile(p => p ? { ...p, [editGoal.field]: num } : p)
    setEditGoal(null)
  }

  // Dietary restrictions modal
  const [showDietModal, setShowDietModal] = useState(false)
  const [dietDraft, setDietDraft] = useState<string[]>(['None'])

  const openDietModal = () => {
    setDietDraft(profile?.dietary_restrictions?.length ? profile.dietary_restrictions : ['None'])
    setShowDietModal(true)
  }

  const toggleDiet = (opt: string) => {
    if (opt === 'None') { setDietDraft(['None']); return }
    setDietDraft(prev => {
      const without = prev.filter(d => d !== 'None')
      const next = without.includes(opt) ? without.filter(d => d !== opt) : [...without, opt]
      return next.length === 0 ? ['None'] : next
    })
  }

  const saveDiet = async () => {
    if (!user) return
    await supabase.from('profiles').update({ dietary_restrictions: dietDraft }).eq('id', user.id)
    setProfile(p => p ? { ...p, dietary_restrictions: dietDraft } : p)
    // Clear meal cache so next home screen load regenerates with updated restrictions
    await AsyncStorage.multiRemove(['pantry_daily_meals_cookNow', 'pantry_daily_meals_mealPlan'])
    setShowDietModal(false)
  }
  // Calculator modal
  const [animatingGoals, setAnimatingGoals] = useState(false)
  const [displayCalories, setDisplayCalories] = useState<number | null>(null)
  const [displayProtein, setDisplayProtein] = useState<number | null>(null)
  const [showCalcModal, setShowCalcModal] = useState(false)
  const [calcAge, setCalcAge] = useState('')
  const [calcGender, setCalcGender] = useState('')
  const [calcFt, setCalcFt] = useState('')
  const [calcIn, setCalcIn] = useState('')
  const [calcWeight, setCalcWeight] = useState('')
  const [calcActivity, setCalcActivity] = useState('')
  const [calcGoal, setCalcGoal] = useState('')

  const [displayWeight, setDisplayWeight] = useState<number | null>(null)
  const [weightLogs, setWeightLogs] = useState<WeightLogEntry[]>([])
  const [mealLogDates, setMealLogDates] = useState<string[]>([])
  const [mealLogCount, setMealLogCount] = useState(0)
  const [savedCount, setSavedCount] = useState(0)
  const [weeklyCalories, setWeeklyCalories] = useState(0)
  const [weeklyProtein, setWeeklyProtein] = useState(0)
  const [weeklyDays, setWeeklyDays] = useState(0)

  const fetchWeightLogs = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('weight_logs')
      .select('weight_kg, logged_at')
      .eq('user_id', user.id)
      .order('logged_at', { ascending: true })
    if (data?.length) {
      setWeightLogs(data)
      const latest = data[data.length - 1]
      setProfile(p => p ? { ...p, weight_kg: latest.weight_kg } : p)
      setDisplayWeight(Math.round(latest.weight_kg * 2.20462))
    }
  }, [user?.id])

  useEffect(() => {
    if (!user) return

    // Profile goals + starting weight
    supabase
      .from('profiles')
      .select('calorie_goal, protein_goal, meals_per_day, max_prep_minutes, weight_kg, target_weight_kg, dietary_restrictions, age, gender, height_cm, activity_level, fitness_goal')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setProfile(data)
          if (data.weight_kg && weightLogs.length === 0) {
            setDisplayWeight(Math.round(data.weight_kg * 2.20462))
          }
        }
      })

    // Saved meals count
    supabase
      .from('saved_meals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .then(({ count }) => setSavedCount(count ?? 0))

    // Meal logs — streak + count
    supabase
      .from('meal_logs')
      .select('logged_at')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const dates = data?.map(r => r.logged_at) ?? []
        setMealLogDates(dates)
        setMealLogCount(dates.length)
      })

    // Weekly nutrition summary
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
    supabase
      .from('meal_logs')
      .select('calories, protein, logged_at')
      .eq('user_id', user.id)
      .gte('logged_at', sevenDaysAgo)
      .then(({ data }) => {
        if (data?.length) {
          setWeeklyCalories(data.reduce((sum, r) => sum + (r.calories ?? 0), 0))
          setWeeklyProtein(data.reduce((sum, r) => sum + (r.protein ?? 0), 0))
          setWeeklyDays(new Set(data.map(r => r.logged_at)).size)
        }
      })

    // Weight logs — chart
    fetchWeightLogs()
  }, [user?.id])

  const chartData = buildPeriodData(weightLogs)
  const chartDates = buildPeriodDates(weightLogs)

  const streak = calcStreak(mealLogDates)
  const last7 = getLast7ActiveDays(mealLogDates)
  const activeDaysCount = last7.filter(Boolean).length

  const displayName = user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || 'You'

  const avatarInitial = displayName[0]?.toUpperCase() ?? '?'

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : ''

  const currentWeightLbs = profile?.weight_kg ? Math.round(profile.weight_kg * 2.20462) : null
  const startWeightLbs = weightLogs.length > 1
    ? Math.round(weightLogs[0].weight_kg * 2.20462)
    : currentWeightLbs
  const targetWeightLbs = profile?.target_weight_kg
    ? Math.round(profile.target_weight_kg * 2.20462)
    : null

  const weightProgressPct = (() => {
    if (!targetWeightLbs || !startWeightLbs || startWeightLbs === targetWeightLbs) return 0
    const total = Math.abs(targetWeightLbs - startWeightLbs)
    const done = Math.abs((currentWeightLbs ?? startWeightLbs) - startWeightLbs)
    return Math.min(1, done / total)
  })()

  const editTargetWeight = () => {
    Alert.prompt(
      'Weight Goal',
      'Enter your target weight in lbs',
      async (input) => {
        const lbs = parseFloat(input)
        if (isNaN(lbs) || lbs <= 0) return
        const kg = Math.round((lbs / 2.20462) * 10) / 10
        await supabase.from('profiles').update({ target_weight_kg: kg }).eq('id', user!.id)
        setProfile(p => p ? { ...p, target_weight_kg: kg } : p)
      },
      'plain-text',
      targetWeightLbs ? `${targetWeightLbs}` : '',
      'numeric'
    )
  }

  const handleRecalculate = () => {
    // Always open modal pre-filled with existing data so user can review/update
    setCalcAge(profile?.age ? String(profile.age) : '')
    setCalcGender(profile?.gender ?? '')
    const heightCm = profile?.height_cm ?? 0
    const totalInches = Math.round(heightCm / 2.54)
    setCalcFt(heightCm ? String(Math.floor(totalInches / 12)) : '')
    setCalcIn(heightCm ? String(totalInches % 12) : '')
    const weightLbs = profile?.weight_kg ? Math.round(profile.weight_kg * 2.20462) : null
    setCalcWeight(weightLbs ? String(weightLbs) : '')
    setCalcActivity(profile?.activity_level ?? '')
    setCalcGoal(profile?.fitness_goal ?? '')
    setShowCalcModal(true)
  }

  const submitCalcModal = async () => {
    const age = parseInt(calcAge)
    const ft = parseInt(calcFt)
    const inches = parseInt(calcIn || '0')
    const weightLbs = parseFloat(calcWeight)
    if (!age || !calcGender || !ft || !weightLbs || !calcActivity || !calcGoal) {
      Alert.alert('Missing Info', 'Please fill in all fields.')
      return
    }
    const heightCm = Math.round((ft * 12 + inches) * 2.54)
    const weightKg = weightLbs * 0.453592
    const result = calculateGoals(age, calcGender, heightCm, weightKg, calcActivity, calcGoal)
    // Save profile fields + goals
    await supabase.from('profiles').update({
      age, gender: calcGender, height_cm: heightCm, weight_kg: weightKg,
      activity_level: calcActivity, fitness_goal: calcGoal,
      calorie_goal: result.calories, protein_goal: result.protein,
      carbs_goal: result.carbs, fat_goal: result.fat,
    }).eq('id', user!.id)
    setShowCalcModal(false)

    // Animate numbers counting up
    const startCal = profile?.calorie_goal ?? 0
    const startPro = profile?.protein_goal ?? 0
    const endCal = result.calories
    const endPro = result.protein
    setAnimatingGoals(true)
    setDisplayCalories(startCal)
    setDisplayProtein(startPro)

    const duration = 800
    const steps = 30
    const interval = duration / steps
    let step = 0
    const timer = setInterval(() => {
      step++
      const t = step / steps
      // Ease out cubic
      const ease = 1 - Math.pow(1 - t, 3)
      setDisplayCalories(Math.round(startCal + (endCal - startCal) * ease))
      setDisplayProtein(Math.round(startPro + (endPro - startPro) * ease))
      if (step >= steps) {
        clearInterval(timer)
        setProfile(p => p ? {
          ...p, age, gender: calcGender, height_cm: heightCm, weight_kg: weightKg,
          activity_level: calcActivity, fitness_goal: calcGoal,
          calorie_goal: endCal, protein_goal: endPro,
        } : p)
        setAnimatingGoals(false)
        setDisplayCalories(null)
        setDisplayProtein(null)
      }
    }, interval)
  }

  const handleWeightChange = (w: number | null) => {
    setDisplayWeight(w ?? currentWeightLbs)
  }

  const logWeight = () => {
    Alert.prompt(
      'Log Weight',
      'Enter your current weight in lbs',
      async (input) => {
        const lbs = parseFloat(input)
        if (isNaN(lbs) || lbs <= 0) return
        const kg = Math.round((lbs / 2.20462) * 10) / 10
        const { error } = await supabase
          .from('weight_logs')
          .insert({ user_id: user!.id, weight_kg: kg })
        if (!error) { fetchWeightLogs(); trackWeightLogged(kg) }
      },
      'plain-text',
      currentWeightLbs ? `${currentWeightLbs}` : '',
      'numeric'
    )
  }

  const signOut = () => {
    Alert.alert('Sign Out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem('onboarding_complete')
          await authSignOut()
        },
      },
    ])
  }

  const resetOnboarding = () => {
    Alert.alert(
      'Reset to New User?',
      'Clears all onboarding data and signs you out. Use this to test the full new-user flow.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.multiRemove([
              'onboarding_complete',
              'onboarding_step',
              'onboarding_data',
              'otp_verified',
              'onboarding_swiped_meals',
              'pantry_daily_meals_cookNow',
              'pantry_daily_meals_mealPlan',
              'pantry_image_urls_v1',
            ])
            await authSignOut()
          },
        },
      ]
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity activeOpacity={0.7}>
          <Settings size={22} stroke={COLORS.textWhite} strokeWidth={1.8} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* ── User card ── */}
        <View style={styles.card}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{avatarInitial}</Text>
          </View>
          <Text style={styles.userName}>{displayName}</Text>
          {memberSince ? <Text style={styles.userSub}>Member since {memberSince}</Text> : null}

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{streak}</Text>
              <Text style={styles.statLabel}>Day Streak</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>{savedCount}</Text>
              <Text style={styles.statLabel}>Meals Saved</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>{mealLogCount}</Text>
              <Text style={styles.statLabel}>Meals Logged</Text>
            </View>
          </View>
        </View>

        {/* ── Dietary Restrictions Modal ── */}
        <Modal visible={showDietModal} transparent animationType="fade" onRequestClose={() => setShowDietModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Dietary Restrictions</Text>
              <Text style={[styles.modalTitle, { fontSize: 13, fontWeight: '400', color: COLORS.textMuted, marginTop: -12, marginBottom: 16 }]}>
                Select all that apply
              </Text>
              <View style={styles.dietChipGrid}>
                {DIET_OPTIONS.map(opt => {
                  const active = dietDraft.includes(opt)
                  return (
                    <TouchableOpacity
                      key={opt}
                      style={[styles.dietChip, active && styles.dietChipActive]}
                      onPress={() => toggleDiet(opt)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.dietChipText, active && styles.dietChipTextActive]}>{opt}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setShowDietModal(false)} activeOpacity={0.7}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSave} onPress={saveDiet} activeOpacity={0.85}>
                  <Text style={styles.modalSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Calculator Modal ── */}
        <Modal visible={showCalcModal} transparent animationType="slide" onRequestClose={() => setShowCalcModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
            <View style={[styles.modalCard, { maxHeight: '85%' }]}>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={[styles.modalTitle, { marginBottom: 4 }]}>Calculate your goals</Text>
                <Text style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 16 }}>We'll use your info to find ideal targets</Text>

                {/* Age + Gender */}
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.calcLabel}>Age</Text>
                    <TextInput style={styles.calcInput} placeholder="25" placeholderTextColor={COLORS.textMuted} keyboardType="number-pad" value={calcAge} onChangeText={setCalcAge} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.calcLabel}>Gender</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {['male', 'female'].map(g => (
                        <TouchableOpacity key={g} style={[styles.calcPill, calcGender === g && styles.calcPillActive]} onPress={() => setCalcGender(g)} activeOpacity={0.7}>
                          <Text style={[styles.calcPillText, calcGender === g && styles.calcPillTextActive]}>{g === 'male' ? 'Male' : 'Female'}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>

                {/* Height + Weight */}
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.calcLabel}>Height (ft)</Text>
                    <TextInput style={styles.calcInput} placeholder="5" placeholderTextColor={COLORS.textMuted} keyboardType="number-pad" value={calcFt} onChangeText={setCalcFt} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.calcLabel}>Height (in)</Text>
                    <TextInput style={styles.calcInput} placeholder="10" placeholderTextColor={COLORS.textMuted} keyboardType="number-pad" value={calcIn} onChangeText={setCalcIn} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.calcLabel}>Weight (lbs)</Text>
                    <TextInput style={styles.calcInput} placeholder="170" placeholderTextColor={COLORS.textMuted} keyboardType="number-pad" value={calcWeight} onChangeText={setCalcWeight} />
                  </View>
                </View>

                {/* Activity Level */}
                <Text style={styles.calcLabel}>Activity Level</Text>
                <View style={{ gap: 6, marginBottom: 12 }}>
                  {ACTIVITY_OPTIONS.map(opt => (
                    <TouchableOpacity key={opt.key} style={[styles.calcOption, calcActivity === opt.key && styles.calcOptionActive]} onPress={() => setCalcActivity(opt.key)} activeOpacity={0.7}>
                      <Text style={[styles.calcOptionText, calcActivity === opt.key && styles.calcOptionTextActive]}>{opt.label}</Text>
                      <Text style={{ fontSize: 11, color: COLORS.textMuted }}>{opt.sub}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Fitness Goal */}
                <Text style={styles.calcLabel}>Fitness Goal</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  {FITNESS_GOAL_OPTIONS.map(opt => (
                    <TouchableOpacity key={opt.key} style={[styles.calcPill, { flex: 1 }, calcGoal === opt.key && styles.calcPillActive]} onPress={() => setCalcGoal(opt.key)} activeOpacity={0.7}>
                      <Text style={[styles.calcPillText, { textAlign: 'center' }, calcGoal === opt.key && styles.calcPillTextActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setShowCalcModal(false)} activeOpacity={0.7}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSave} onPress={submitCalcModal} activeOpacity={0.85}>
                  <Text style={styles.modalSaveText}>Calculate</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ── Edit Goal Modal ── */}
        <Modal visible={!!editGoal} transparent animationType="fade" onRequestClose={() => setEditGoal(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{editGoal?.label}</Text>

              {editGoal?.field === 'max_prep_minutes' ? (
                // Preset picker for max prep time — matches onboarding options (10 / 20 / 30 / 60+)
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 8 }}>
                  {[
                    { label: '10 min', value: 10 },
                    { label: '20 min', value: 20 },
                    { label: '30 min', value: 30 },
                    { label: '60+ min', value: 90 },
                  ].map(opt => {
                    const selected = parseInt(editValue) === opt.value
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        onPress={() => setEditValue(String(opt.value))}
                        activeOpacity={0.8}
                        style={{
                          paddingVertical: 12,
                          paddingHorizontal: 18,
                          borderRadius: 30,
                          backgroundColor: selected ? '#FFFFFF' : '#1A1A1A',
                          borderWidth: 1,
                          borderColor: selected ? '#FFFFFF' : '#2A2A2A',
                        }}
                      >
                        <Text style={{
                          fontSize: 14,
                          fontWeight: '700',
                          color: selected ? '#000000' : '#FFFFFF',
                        }}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              ) : (
                <View style={styles.modalInputRow}>
                  <TextInput
                    style={styles.modalInput}
                    value={editValue}
                    onChangeText={setEditValue}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={COLORS.textMuted}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={saveGoal}
                  />
                  {editGoal?.unit ? <Text style={styles.modalUnit}>{editGoal.unit}</Text> : null}
                </View>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setEditGoal(null)} activeOpacity={0.7}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSave} onPress={saveGoal} activeOpacity={0.85}>
                  <Text style={styles.modalSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ── Goals ── */}
        <Text style={styles.sectionTitle}>My Goals</Text>
        <View style={styles.card}>
          <GoalRow
            label="Daily Calories"
            value={animatingGoals && displayCalories !== null
              ? `${displayCalories.toLocaleString()} kcal`
              : profile?.calorie_goal ? `${profile.calorie_goal.toLocaleString()} kcal` : '—'}
            onPress={() => openGoalEdit('calorie_goal', 'Daily Calories', 'kcal', profile?.calorie_goal ?? null)}
          />
          <GoalRow
            label="Protein Goal"
            value={animatingGoals && displayProtein !== null
              ? `${displayProtein}g`
              : profile?.protein_goal ? `${profile.protein_goal}g` : '—'}
            onPress={() => openGoalEdit('protein_goal', 'Protein Goal', 'g', profile?.protein_goal ?? null)}
          />
          <GoalRow
            label="Meals Per Day"
            value={profile?.meals_per_day ? `${profile.meals_per_day}` : '—'}
            onPress={() => openGoalEdit('meals_per_day', 'Meals Per Day', '', profile?.meals_per_day ?? null)}
          />
          <GoalRow
            label="Max Prep Time"
            value={profile?.max_prep_minutes
              ? (profile.max_prep_minutes >= 90 ? '60+ min' : `${profile.max_prep_minutes} min`)
              : '—'}
            onPress={() => openGoalEdit('max_prep_minutes', 'Max Prep Time', 'min', profile?.max_prep_minutes ?? null)}
          />
          <GoalRow
            label="Weight Goal"
            value={targetWeightLbs !== null ? `${targetWeightLbs} lbs` : 'Set goal'}
            onPress={editTargetWeight}
            isLast
          />
        </View>
        <TouchableOpacity onPress={handleRecalculate} activeOpacity={0.7} style={{ alignItems: 'center', marginTop: 8, marginBottom: 8 }}>
          <Text style={{ fontSize: 14, color: '#4ADE80', fontWeight: '600' }}>Not sure? Recalculate for me</Text>
        </TouchableOpacity>

        {/* ── Weight ── */}
        <Text style={styles.sectionTitle}>Weight</Text>
        <View style={styles.card}>
          <Text style={styles.weightCurrent}>
            {displayWeight !== null ? `${displayWeight} lbs` : '— lbs'}
          </Text>
          <WeightChart
            onWeightChange={handleWeightChange}
            data={chartData}
            dates={chartDates}
          />
          <View style={styles.weightLabels}>
            <Text style={styles.weightLabel}>
              Start  {startWeightLbs !== null ? `${startWeightLbs} lbs` : '—'}
            </Text>
            <Text style={styles.weightLabel}>
              Now  {currentWeightLbs !== null ? `${currentWeightLbs} lbs` : '—'}
            </Text>
          </View>
          {targetWeightLbs !== null && (
            <View style={styles.goalProgressWrap}>
              <View style={styles.goalProgressBar}>
                <View style={[styles.goalProgressFill, { width: `${Math.round(weightProgressPct * 100)}%` as any }]} />
              </View>
              <Text style={styles.goalProgressLabel}>
                Goal: {targetWeightLbs} lbs{weightProgressPct >= 1 ? ' 🎉' : ` · ${Math.round(weightProgressPct * 100)}% there`}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={styles.teaLink} onPress={logWeight} activeOpacity={0.7}>
          <Text style={styles.teaLinkText}>+ Log Weight</Text>
        </TouchableOpacity>

        {/* ── Streak ── */}
        <Text style={styles.sectionTitle}>Consistency</Text>
        <View style={styles.card}>
          <Text style={styles.streakNumber}>{streak}</Text>
          <Text style={styles.streakLabel}>Day Streak</Text>
          <View style={styles.dotRow}>
            {last7.map((active, i) => (
              <View key={i} style={[styles.dayDot, active && styles.dayDotActive]} />
            ))}
          </View>
          <Text style={styles.streakSub}>{activeDaysCount} of last 7 days active</Text>
        </View>

        {/* ── This Week ── */}
        <Text style={styles.sectionTitle}>This Week</Text>
        <View style={styles.card}>
          <View style={styles.weekRow}>
            <View style={styles.weekStat}>
              <Text style={styles.weekStatValue}>{weeklyCalories.toLocaleString()}</Text>
              <Text style={styles.weekStatLabel}>Calories</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.weekStat}>
              <Text style={styles.weekStatValue}>{weeklyProtein}g</Text>
              <Text style={styles.weekStatLabel}>Protein</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.weekStat}>
              <Text style={styles.weekStatValue}>{weeklyDays}/7</Text>
              <Text style={styles.weekStatLabel}>Days Logged</Text>
            </View>
          </View>
          <Text style={styles.weekAvgLabel}>
            {weeklyDays > 0
              ? `Avg ${Math.round(weeklyCalories / weeklyDays).toLocaleString()} kcal · ${Math.round(weeklyProtein / weeklyDays)}g protein per day`
              : 'Log meals this week to see your summary'}
          </Text>
        </View>

        {/* ── Subscription ── */}
        <Text style={styles.sectionTitle}>Subscription</Text>
        <View style={styles.card}>
          <View style={styles.subRow}>
            <Text style={styles.rowLabel}>Pantry Free</Text>
            <TouchableOpacity style={styles.upgradeBtn} activeOpacity={0.8}>
              <Text style={styles.upgradeBtnText}>Upgrade</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.subDetails}>
            1 meal suggestion per day · 5 saved meals
          </Text>
        </View>

        {/* ── Settings ── */}
        <Text style={styles.sectionTitle}>Settings</Text>
        <View style={styles.card}>
          <SettingsRow label="Food Preferences" onPress={() => router.push('/food-preferences')} />
          <SettingsRow
            label="Dietary Restrictions"
            value={(profile?.dietary_restrictions ?? []).filter(d => d !== 'None').join(', ') || 'None'}
            onPress={openDietModal}
          />
          <SettingsRow label="Notifications" />
          <SettingsRow
            label="Dark Mode"
            toggle={{ value: darkMode, onChange: setDarkMode }}
          />
          <SettingsRow
            label="AI Data Processing"
            value={acceptedAt ? `Accepted ${new Date(acceptedAt).toLocaleDateString()}` : 'Not accepted'}
            onPress={() => {
              if (acceptedAt) {
                Alert.alert(
                  'AI Data Processing',
                  'Pantry sends your text and images to OpenAI and Anthropic to power AI features (meal suggestions, macro estimates, photo scans). They do not use your data for training. Revoke consent to disable AI features.',
                  [
                    { text: 'Close', style: 'cancel' },
                    { text: 'Revoke', style: 'destructive', onPress: () => revokeConsent() },
                  ]
                )
              } else {
                Alert.alert(
                  'AI Data Processing',
                  'Pantry sends your text and images to OpenAI and Anthropic to power AI features. You\'ll be asked to accept the first time you use one.'
                )
              }
            }}
          />
          <SettingsRow label="Restore Purchases" value={restoring ? 'Restoring…' : undefined} onPress={handleRestorePurchases} />
          <SettingsRow label="Privacy Policy" onPress={() => Linking.openURL('https://heypantry.app/privacy')} />
          <SettingsRow label="Terms of Service" onPress={() => Linking.openURL('https://heypantry.app/terms')} isLast />
        </View>

        {/* ── Sign out ── */}
        <TouchableOpacity style={styles.signOut} onPress={signOut} activeOpacity={0.7}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.resetOnboarding} onPress={resetOnboarding} activeOpacity={0.7}>
          <Text style={styles.resetOnboardingText}>Reset Onboarding</Text>
        </TouchableOpacity>

      </ScrollView>
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
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.5,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  // Cards
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
    marginTop: 20,
    marginBottom: 10,
  },

  // User card
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  avatarInitial: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.textWhite,
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textWhite,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  userSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 16,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textWhite,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 4,
  },

  // Rows
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  rowLabel: {
    fontSize: 15,
    color: COLORS.textWhite,
    fontWeight: '500',
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '400',
  },
  goalValue: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '400',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  // Weight
  weightCurrent: {
    fontSize: 32,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  weightLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  weightLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  teaLink: {
    alignSelf: 'flex-start',
    marginBottom: 4,
    marginTop: 4,
  },
  teaLinkText: {
    fontSize: 14,
    color: '#4ADE80',
    fontWeight: '600',
  },

  // Streak
  streakNumber: {
    fontSize: 40,
    fontWeight: '800',
    color: '#4ADE80',
    letterSpacing: -1,
    textAlign: 'center',
  },
  streakLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 16,
  },
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  dayDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2A2A2A',
  },
  dayDotActive: {
    backgroundColor: '#4ADE80',
  },
  streakSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
  },

  // Subscription
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  upgradeBtn: {
    backgroundColor: 'rgba(74,222,128,0.15)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  upgradeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4ADE80',
  },
  subDetails: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
  },

  // Sign out
  signOut: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 16,
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#EF4444',
  },

  resetOnboarding: {
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 8,
  },
  resetOnboardingText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '400',
  },

  // Weight goal progress bar
  goalProgressWrap: {
    marginTop: 12,
    gap: 6,
  },
  goalProgressBar: {
    height: 6,
    backgroundColor: '#2A2A2A',
    borderRadius: 3,
    overflow: 'hidden',
  },
  goalProgressFill: {
    height: '100%',
    backgroundColor: '#4ADE80',
    borderRadius: 3,
  },
  goalProgressLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },

  // Weekly summary
  weekRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  weekStat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  weekStatValue: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textWhite,
  },
  weekStatLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  weekAvgLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 12,
  },

  // Diet chips
  dietChipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  dietChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  dietChipActive: {
    backgroundColor: 'rgba(74,222,128,0.15)',
    borderColor: '#4ADE80',
  },
  dietChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  dietChipTextActive: {
    color: '#4ADE80',
    fontWeight: '600',
  },

  // Edit goal modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textWhite,
    marginBottom: 20,
    letterSpacing: -0.3,
  },
  modalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
    gap: 8,
  },
  modalInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textWhite,
    padding: 0,
  },
  modalUnit: {
    fontSize: 16,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancel: {
    flex: 1,
    backgroundColor: '#2A2A2A',
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  modalSave: {
    flex: 1,
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },

  // Calculator modal
  calcLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginBottom: 6,
  },
  calcInput: {
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textWhite,
  },
  calcPill: {
    backgroundColor: '#2A2A2A',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  calcPillActive: {
    backgroundColor: '#4ADE80',
  },
  calcPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  calcPillTextActive: {
    color: '#000000',
  },
  calcOption: {
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  calcOptionActive: {
    backgroundColor: 'rgba(74,222,128,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.4)',
  },
  calcOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textWhite,
  },
  calcOptionTextActive: {
    color: '#4ADE80',
  },
})
