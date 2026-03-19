import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Clock, RefreshCw, Utensils } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { MOCK_USER, MOCK_MACROS, MOCK_MEALS } from '@/constants/mock'

const { width } = Dimensions.get('window')

// ── Macro progress bar ───────────────────────────────────────────────
type ProgressBarProps = {
  progress: number   // 0–1
  color: string
}

function ProgressBar({ progress, color }: ProgressBarProps) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.min(progress, 1) * 100}%`, backgroundColor: color }]} />
    </View>
  )
}

// ── Meal card ────────────────────────────────────────────────────────
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

// ── Home screen ──────────────────────────────────────────────────────
export default function HomeScreen() {
  const { calories, protein } = MOCK_MACROS
  const calProgress = calories.consumed / calories.goal
  const proProgress = protein.consumed / protein.goal

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
        <View style={styles.macroCard}>
          <View style={styles.macroRow}>
            <Text style={styles.macroLabel}>Daily Macros</Text>
            <Text style={styles.macroLabel}>Remaining</Text>
          </View>
          <View style={styles.macroRow}>
            <ProgressBar progress={calProgress} color={COLORS.textWhite} />
            <ProgressBar progress={proProgress} color={COLORS.accent} />
          </View>
          <View style={styles.macroRow}>
            <Text style={styles.macroValue}>
              <Text style={styles.macroValueBold}>{calories.consumed.toLocaleString()}</Text>
              {' / '}{calories.goal.toLocaleString()} kcal
            </Text>
            <Text style={styles.macroValue}>
              <Text style={styles.macroValueBold}>{protein.consumed}</Text>
              {' / '}{protein.goal}g pro
            </Text>
          </View>
        </View>

        {/* ── White panel ── */}
        <View style={styles.panel}>
          {/* Section header */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Suggested Meals</Text>
            <TouchableOpacity activeOpacity={0.6}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          </View>

          {/* Meal cards */}
          <View style={styles.mealList}>
            {MOCK_MEALS.map((meal) => (
              <MealCard key={meal.id} meal={meal} />
            ))}
          </View>

          {/* Regenerate button */}
          <TouchableOpacity style={styles.regenButton} activeOpacity={0.8}>
            <RefreshCw size={18} stroke={COLORS.textWhite} strokeWidth={2} />
            <Text style={styles.regenText}>Regenerate</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingBottom: 0,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.2,
  },
  hiText: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  greetText: {
    fontSize: 14,
    color: COLORS.textDim,
    marginTop: 1,
  },
  // Macro card
  macroCard: {
    marginHorizontal: 20,
    marginBottom: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#1A1A1A',
    padding: 18,
    gap: 12,
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  macroLabel: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textDim,
    fontWeight: '500',
  },
  progressTrack: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  macroValue: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textDim,
    fontWeight: '400',
  },
  macroValueBold: {
    color: COLORS.textWhite,
    fontWeight: '700',
    fontSize: 15,
  },

  // White panel
  panel: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    minHeight: 500,
    paddingTop: 32,
    paddingHorizontal: 24,
    paddingBottom: 36,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  seeAll: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },

  // Meal list
  mealList: {
    gap: 14,
    marginBottom: 28,
  },
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
  mealImage: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
  },
  mealImagePlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: '#2C2C2C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealInfo: {
    flex: 1,
    gap: 6,
  },
  mealName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  mealMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mealMetaText: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '400',
  },
  mealMacros: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mealMacroText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '400',
  },
  mealMacroBold: {
    fontWeight: '700',
  },
  macroDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.textMuted,
  },

  // Regenerate
  regenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    paddingVertical: 18,
  },
  regenText: {
    color: COLORS.textWhite,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
})
