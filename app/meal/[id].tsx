import { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Bookmark, Utensils } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { MOCK_MEAL_DETAILS } from '@/constants/mock'

type PortionMode = 'Visual' | 'Grams'

function renderStepText(step: string) {
  const parts = step.split(/\*\*(.+?)\*\*/)
  return parts.map((part, i) =>
    i % 2 === 1
      ? <Text key={i} style={{ fontWeight: '700', color: '#FFFFFF' }}>{part}</Text>
      : part
  )
}

export default function MealDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [saved, setSaved] = useState(false)
  const [portionMode, setPortionMode] = useState<PortionMode>('Visual')

  const meal = MOCK_MEAL_DETAILS[id ?? '']

  if (!meal) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.notFound}>Meal not found.</Text>
      </SafeAreaView>
    )
  }

  const showProteinWarning = meal.protein < 30

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <ChevronLeft size={24} stroke={COLORS.textWhite} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{meal.name}</Text>
        <TouchableOpacity style={styles.headerBtn} onPress={() => setSaved(s => !s)} activeOpacity={0.7}>
          <Bookmark
            size={22}
            stroke={saved ? COLORS.accent : COLORS.textWhite}
            fill={saved ? COLORS.accent : 'none'}
            strokeWidth={1.8}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero image ── */}
        <View style={styles.hero}>
          <Utensils size={40} stroke="#555555" strokeWidth={1.5} />
        </View>

        {/* ── Macro bar ── */}
        <View style={styles.macroBar}>
          {[
            { label: 'Calories', value: String(meal.calories), unit: 'kcal' },
            { label: 'Protein',  value: `${meal.protein}g`,    unit: ''     },
            { label: 'Carbs',    value: `${meal.carbs}g`,      unit: ''     },
            { label: 'Fat',      value: `${meal.fat}g`,        unit: ''     },
          ].map((stat, i, arr) => (
            <View key={stat.label} style={[styles.macroStat, i < arr.length - 1 && styles.macroStatBorder]}>
              <Text style={styles.macroValue}>{stat.value}</Text>
              <Text style={styles.macroLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* ── Protein warning ── */}
        {showProteinWarning && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>⚠ Add a protein source — this meal is light on protein</Text>
          </View>
        )}

        {/* ── Ingredients ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Ingredients</Text>
            <View style={styles.pillToggle}>
              {(['Visual', 'Grams'] as PortionMode[]).map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.pillOption, portionMode === mode && styles.pillOptionActive]}
                  onPress={() => setPortionMode(mode)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.pillOptionText, portionMode === mode && styles.pillOptionTextActive]}>
                    {mode}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.ingredientList}>
            {meal.ingredients.map((ing, i) => (
              <View key={ing.id} style={[styles.ingredientRow, i < meal.ingredients.length - 1 && styles.ingredientBorder]}>
                <Text style={styles.ingredientPortion}>
                  {portionMode === 'Visual' ? ing.visual : ing.grams}
                </Text>
                <View style={styles.ingredientRight}>
                  <View style={styles.ingredientNameRow}>
                    {!ing.inPantry && <View style={styles.missingDot} />}
                    <Text style={styles.ingredientName}>{ing.name}</Text>
                  </View>
                  {!ing.inPantry && (
                    <Text style={styles.addToGrocery}>+ Add to grocery list</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ── Steps ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Instructions</Text>
          <View style={styles.stepList}>
            {meal.steps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{renderStepText(step)}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* ── Fixed bottom button ── */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.saveButton} activeOpacity={0.85} onPress={() => setSaved(true)}>
          <Text style={styles.saveButtonText}>Save Meal</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  notFound: {
    color: COLORS.textWhite,
    textAlign: 'center',
    marginTop: 40,
    fontSize: 16,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
    marginHorizontal: 4,
  },

  // Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },

  // Hero
  hero: {
    height: 220,
    width: '100%',
    backgroundColor: '#2C2C2C',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Macro bar
  macroBar: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 16,
    overflow: 'hidden',
  },
  macroStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    gap: 4,
  },
  macroStatBorder: {
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.08)',
  },
  macroValue: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  macroLabel: {
    fontSize: 11,
    color: COLORS.textDim,
    fontWeight: '500',
  },

  // Protein warning
  warningBanner: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: '#2A1F00',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  warningText: {
    color: '#FFB020',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },

  // Sections
  section: {
    marginTop: 28,
    paddingHorizontal: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.4,
  },

  // Portion pill toggle
  pillToggle: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 3,
  },
  pillOption: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 17,
  },
  pillOptionActive: {
    backgroundColor: COLORS.textWhite,
  },
  pillOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textDim,
  },
  pillOptionTextActive: {
    color: '#000000',
  },

  // Ingredients
  ingredientList: {
    backgroundColor: '#111111',
    borderRadius: 16,
    overflow: 'hidden',
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 16,
  },
  ingredientBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  ingredientPortion: {
    width: 56,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.accent,
    paddingTop: 1,
  },
  ingredientRight: {
    flex: 1,
    gap: 3,
  },
  ingredientNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  missingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FF4444',
  },
  ingredientName: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textWhite,
  },
  addToGrocery: {
    fontSize: 12,
    color: COLORS.accent,
    fontWeight: '500',
  },

  // Steps
  stepList: {
    gap: 20,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  stepNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumberText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textWhite,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: '#FFFFFF',
    lineHeight: 22,
    fontWeight: '400',
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  saveButton: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  saveButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
})
