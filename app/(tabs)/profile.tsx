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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Settings, ChevronRight } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
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

// ── Fallback mock data (shown when no weight logs exist yet) ───────────

const MOCK_PERIOD_DATA: Record<PeriodKey, { values: number[]; labels: string[] }> = {
  '7D': {
    values: [195, 193, 192, 189, 187, 184, 182],
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
  '1M': {
    values: [197, 195, 194, 192, 191, 189, 188, 186, 185, 183, 182, 181, 180, 179, 182],
    labels: ['Mar 1', '', '', '', 'Mar 8', '', '', '', 'Mar 15', '', '', '', 'Mar 22', '', 'Mar 28'],
  },
  '3M': {
    values: [205, 203, 200, 198, 196, 194, 192, 190, 188, 186, 184, 182],
    labels: ['Jan', '', '', 'Feb', '', '', 'Mar', '', '', '', '', 'Now'],
  },
  '6M': {
    values: [215, 212, 209, 207, 204, 201, 199, 196, 194, 191, 188, 185, 182],
    labels: ['Oct', '', 'Nov', '', 'Dec', '', 'Jan', '', 'Feb', '', 'Mar', '', 'Now'],
  },
  'All': {
    values: [220, 216, 212, 208, 205, 202, 199, 196, 193, 190, 187, 184, 182],
    labels: ['Apr', '', 'Jun', '', 'Aug', '', 'Oct', '', 'Dec', '', 'Feb', '', 'Now'],
  },
}

const MOCK_PERIOD_DATES: Record<PeriodKey, string[]> = {
  '7D':  ['Mar 12', 'Mar 13', 'Mar 14', 'Mar 15', 'Mar 16', 'Mar 17', 'Mar 18'],
  '1M':  Array.from({ length: 15 }, (_, i) => `Mar ${i + 1}`),
  '3M':  ['Jan 1', 'Jan 8', 'Jan 15', 'Jan 22', 'Feb 1', 'Feb 8', 'Feb 15', 'Feb 22', 'Mar 1', 'Mar 8', 'Mar 15', 'Mar 22'],
  '6M':  ['Oct 1', 'Oct 15', 'Nov 1', 'Nov 15', 'Dec 1', 'Dec 15', 'Jan 1', 'Jan 15', 'Feb 1', 'Feb 15', 'Mar 1', 'Mar 15', 'Mar 18'],
  'All': ['Apr 1', 'May 1', 'Jun 1', 'Jul 1', 'Aug 1', 'Sep 1', 'Oct 1', 'Nov 1', 'Dec 1', 'Jan 1', 'Feb 1', 'Mar 1', 'Mar 18'],
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

  const periodData = externalData ?? MOCK_PERIOD_DATA
  const periodDates = externalDates ?? MOCK_PERIOD_DATES

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const activeData = (externalDataRef.current ?? MOCK_PERIOD_DATA)[periodRef.current].values
        if (activeData.length === 0) return
        const x = evt.nativeEvent.locationX
        const idx = Math.round((x / CHART_W) * (activeData.length - 1))
        const clamped = Math.max(0, Math.min(activeData.length - 1, idx))
        setScrubIndex(clamped)
        onWeightChangeRef.current(activeData[clamped])
      },
      onPanResponderMove: (evt) => {
        const activeData = (externalDataRef.current ?? MOCK_PERIOD_DATA)[periodRef.current].values
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
          <Text style={chartStyles.emptyChartText}>No entries yet</Text>
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

type Profile = {
  calorie_goal: number | null
  protein_goal: number | null
  meals_per_day: number | null
  max_prep_minutes: number | null
  weight_kg: number | null
  target_weight_kg: number | null
  dietary_restrictions: string[] | null
}

export default function ProfileScreen() {
  const router = useRouter()
  const { user, signOut: authSignOut } = useAuth()
  const [darkMode, setDarkMode] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)

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
    setShowDietModal(false)
  }
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
      .select('calorie_goal, protein_goal, meals_per_day, max_prep_minutes, weight_kg, target_weight_kg, dietary_restrictions')
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

  const resetOnboarding = async () => {
    await AsyncStorage.removeItem('onboarding_complete')
    router.replace('/onboarding')
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
              <Text style={styles.statValue}>{streak > 0 ? `${streak} 🔥` : '0'}</Text>
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

        {/* ── Edit Goal Modal ── */}
        <Modal visible={!!editGoal} transparent animationType="fade" onRequestClose={() => setEditGoal(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{editGoal?.label}</Text>
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
            value={profile?.calorie_goal ? `${profile.calorie_goal.toLocaleString()} kcal` : '—'}
            onPress={() => openGoalEdit('calorie_goal', 'Daily Calories', 'kcal', profile?.calorie_goal ?? null)}
          />
          <GoalRow
            label="Protein Goal"
            value={profile?.protein_goal ? `${profile.protein_goal}g` : '—'}
            onPress={() => openGoalEdit('protein_goal', 'Protein Goal', 'g', profile?.protein_goal ?? null)}
          />
          <GoalRow
            label="Meals Per Day"
            value={profile?.meals_per_day ? `${profile.meals_per_day}` : '—'}
            onPress={() => openGoalEdit('meals_per_day', 'Meals Per Day', '', profile?.meals_per_day ?? null)}
          />
          <GoalRow
            label="Max Prep Time"
            value={profile?.max_prep_minutes ? `${profile.max_prep_minutes} min` : '—'}
            onPress={() => openGoalEdit('max_prep_minutes', 'Max Prep Time', 'min', profile?.max_prep_minutes ?? null)}
          />
          <GoalRow
            label="Weight Goal"
            value={targetWeightLbs !== null ? `${targetWeightLbs} lbs` : 'Set goal'}
            onPress={editTargetWeight}
            isLast
          />
        </View>

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
          <SettingsRow label="Privacy Policy" />
          <SettingsRow label="Terms of Service" isLast />
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
})
