import { useState, useRef } from 'react'
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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Settings, ChevronRight } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'

const { width } = Dimensions.get('window')

// ── Weight chart data per period ───────────────────────────────────────

type PeriodKey = '7D' | '1M' | '3M' | '6M' | 'All'

const PERIODS: PeriodKey[] = ['7D', '1M', '3M', '6M', 'All']

const PERIOD_DATA: Record<PeriodKey, { values: number[]; labels: string[] }> = {
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

const PERIOD_DATES: Record<PeriodKey, string[]> = {
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

function WeightChart({ onWeightChange }: { onWeightChange: (w: number | null) => void }) {
  const [period, setPeriod] = useState<PeriodKey>('7D')
  const [scrubIndex, setScrubIndex] = useState<number | null>(null)

  const periodRef = useRef(period)
  const onWeightChangeRef = useRef(onWeightChange)
  periodRef.current = period
  onWeightChangeRef.current = onWeightChange

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const data = PERIOD_DATA[periodRef.current].values
        const x = evt.nativeEvent.locationX
        const idx = Math.round((x / CHART_W) * (data.length - 1))
        const clamped = Math.max(0, Math.min(data.length - 1, idx))
        setScrubIndex(clamped)
        onWeightChangeRef.current(data[clamped])
      },
      onPanResponderMove: (evt) => {
        const data = PERIOD_DATA[periodRef.current].values
        const x = evt.nativeEvent.locationX
        const idx = Math.round((x / CHART_W) * (data.length - 1))
        const clamped = Math.max(0, Math.min(data.length - 1, idx))
        setScrubIndex(clamped)
        onWeightChangeRef.current(data[clamped])
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

  const data = PERIOD_DATA[period].values
  const labels = PERIOD_DATA[period].labels
  const dates = PERIOD_DATES[period]

  const dataMin = Math.min(...data) - 2
  const dataMax = Math.max(...data) + 2

  const cx = (i: number) => (i / (data.length - 1)) * (CHART_W - DOT_R * 2) + DOT_R
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

      {/* X-axis labels — positioned at same x coords as dots */}
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

function GoalRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
  return (
    <>
      <TouchableOpacity style={styles.goalRow} activeOpacity={0.7}>
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
  onPress,
  isLast,
  toggle,
}: {
  label: string
  onPress?: () => void
  isLast?: boolean
  toggle?: { value: boolean; onChange: (v: boolean) => void }
}) {
  return (
    <>
      <TouchableOpacity style={styles.goalRow} onPress={onPress} activeOpacity={toggle ? 1 : 0.7}>
        <Text style={styles.rowLabel}>{label}</Text>
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

const CURRENT_WEIGHT = 182

export default function ProfileScreen() {
  const router = useRouter()
  const [darkMode, setDarkMode] = useState(true)
  const [displayWeight, setDisplayWeight] = useState(CURRENT_WEIGHT)

  const signOut = () => {
    Alert.alert('Sign Out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem('onboarding_complete')
          router.replace('/onboarding')
        },
      },
    ])
  }

  const resetOnboarding = async () => {
    await AsyncStorage.removeItem('onboarding_complete')
    router.replace('/onboarding')
  }

  const handleWeightChange = (w: number | null) => {
    setDisplayWeight(w ?? CURRENT_WEIGHT)
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
            <Text style={styles.avatarInitial}>M</Text>
          </View>
          <Text style={styles.userName}>Marcus</Text>
          <Text style={styles.userSub}>Member since March 2026</Text>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>12 🔥</Text>
              <Text style={styles.statLabel}>Day Streak</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>6</Text>
              <Text style={styles.statLabel}>Meals Saved</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>48</Text>
              <Text style={styles.statLabel}>Meals Logged</Text>
            </View>
          </View>
        </View>

        {/* ── Goals ── */}
        <Text style={styles.sectionTitle}>My Goals</Text>
        <View style={styles.card}>
          <GoalRow label="Daily Calories"  value="2,400 kcal" />
          <GoalRow label="Protein Goal"    value="180g" />
          <GoalRow label="Meals Per Day"   value="3" />
          <GoalRow label="Max Prep Time"   value="30 min" isLast />
        </View>

        {/* ── Weight ── */}
        <Text style={styles.sectionTitle}>Weight</Text>
        <View style={styles.card}>
          <Text style={styles.weightCurrent}>{displayWeight} lbs</Text>
          <WeightChart onWeightChange={handleWeightChange} />
          <View style={styles.weightLabels}>
            <Text style={styles.weightLabel}>Start  195 lbs</Text>
            <Text style={styles.weightLabel}>Now  {CURRENT_WEIGHT} lbs</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.teaLink} activeOpacity={0.7}>
          <Text style={styles.teaLinkText}>+ Log Weight</Text>
        </TouchableOpacity>

        {/* ── Streak ── */}
        <Text style={styles.sectionTitle}>Consistency</Text>
        <View style={styles.card}>
          <Text style={styles.streakNumber}>12</Text>
          <Text style={styles.streakLabel}>Day Streak</Text>
          <View style={styles.dotRow}>
            {[true, true, true, true, true, false, false].map((active, i) => (
              <View key={i} style={[styles.dayDot, active && styles.dayDotActive]} />
            ))}
          </View>
          <Text style={styles.streakSub}>5 of last 7 days active</Text>
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
          <SettingsRow label="Dietary Restrictions" />
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
})
