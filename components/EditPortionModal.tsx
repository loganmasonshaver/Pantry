import { useState, useEffect } from 'react'
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { X, ChevronRight } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { getFoodById, parseMacros, FoodDetail, FoodServing } from '@/lib/fatsecret'

type Props = {
  visible: boolean
  onClose: () => void
  logId: string
  logName: string
  foodId: string | null
  initialServingId: string | null
  initialQuantity: number
  currentCalories: number
  currentProtein: number
  onUpdated: (logId: string, calories: number, protein: number) => void
}

export default function EditPortionModal({
  visible, onClose, logId, logName,
  foodId, initialServingId, initialQuantity,
  currentCalories, currentProtein,
  onUpdated,
}: Props) {
  const [food, setFood] = useState<FoodDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedServing, setSelectedServing] = useState<FoodServing | null>(null)
  const [quantity, setQuantity] = useState(String(initialQuantity ?? 1))
  const [saving, setSaving] = useState(false)

  // Direct edit fallback (no food_id)
  const [editCals, setEditCals] = useState(String(currentCalories))
  const [editProt, setEditProt] = useState(String(currentProtein))

  useEffect(() => {
    if (!visible) return
    setQuantity(String(initialQuantity ?? 1))
    setEditCals(String(currentCalories))
    setEditProt(String(currentProtein))

    if (!foodId) { setFood(null); return }

    setLoading(true)
    getFoodById(foodId)
      .then(f => {
        setFood(f)
        const match = initialServingId
          ? f.servings.find(s => s.serving_id === initialServingId) ?? f.servings[0]
          : f.servings[0]
        setSelectedServing(match ?? null)
      })
      .catch(() => setFood(null))
      .finally(() => setLoading(false))
  }, [visible, foodId])

  const handleSave = async () => {
    setSaving(true)
    let calories: number
    let protein: number
    let updatePayload: Record<string, any>

    if (food && selectedServing) {
      // floor at 0.1 to prevent zero-quantity division
      const qty = Math.max(0.1, parseFloat(quantity) || 1)
      const base = parseMacros(selectedServing)
      calories = Math.round(base.calories * qty)
      protein = Math.round(base.protein * qty)
      updatePayload = { calories, protein, serving_id: selectedServing.serving_id, quantity: qty }
    } else {
      calories = parseInt(editCals) || 0
      protein = parseInt(editProt) || 0
      updatePayload = { calories, protein }
    }

    const { error } = await supabase
      .from('meal_logs')
      .update(updatePayload)
      .eq('id', logId)

    setSaving(false)
    if (error) { Alert.alert('Error', error.message); return }
    onUpdated(logId, calories, protein)
    onClose()
  }

  // floor at 0.1 to prevent zero-quantity division
  const qty = Math.max(0.1, parseFloat(quantity) || 1)
  // compute fresh macros inline whenever quantity or serving changes
  const liveMacros = food && selectedServing
    ? (() => { const b = parseMacros(selectedServing); return { calories: Math.round(b.calories * qty), protein: Math.round(b.protein * qty), carbs: Math.round(b.carbs * qty), fat: Math.round(b.fat * qty) } })()
    : null

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
          </TouchableOpacity>
          <Text style={styles.topTitle} numberOfLines={1}>{logName}</Text>
          <View style={{ width: 34 }} />
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#4ADE80" size="large" />
            <Text style={styles.loadingText}>Loading food data...</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

            {food ? (
              <>
                {food.brand_name && (
                  <Text style={styles.brandName}>{food.brand_name}</Text>
                )}

                {/* Serving picker */}
                {food.servings.length > 1 && (
                  <View style={styles.servingSection}>
                    <Text style={styles.sectionLabel}>Serving size</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.chips}>
                        {food.servings.map(s => (
                          <TouchableOpacity
                            key={s.serving_id}
                            style={[styles.chip, selectedServing?.serving_id === s.serving_id && styles.chipActive]}
                            onPress={() => setSelectedServing(s)}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.chipText, selectedServing?.serving_id === s.serving_id && styles.chipTextActive]}>
                              {s.serving_description}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}

                {/* Quantity */}
                <View style={styles.quantityRow}>
                  <Text style={styles.sectionLabel}>Quantity</Text>
                  <View style={styles.quantityInputWrap}>
                    <TextInput
                      style={styles.quantityInput}
                      value={quantity}
                      onChangeText={setQuantity}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <Text style={styles.quantityUnit}>× serving</Text>
                  </View>
                </View>

                {/* Live macro grid */}
                {liveMacros && (
                  <View style={styles.macroGrid}>
                    {[
                      { label: 'Calories', value: liveMacros.calories, unit: 'kcal', color: '#FFFFFF' },
                      { label: 'Protein',  value: liveMacros.protein,  unit: 'g',    color: '#4ADE80' },
                      { label: 'Carbs',    value: liveMacros.carbs,    unit: 'g',    color: '#F59E0B' },
                      { label: 'Fat',      value: liveMacros.fat,      unit: 'g',    color: '#60A5FA' },
                    ].map(m => (
                      <View key={m.label} style={styles.macroCell}>
                        <View style={[styles.macroDot, { backgroundColor: m.color }]} />
                        <Text style={styles.macroCellLabel}>{m.label}</Text>
                        <Text style={styles.macroCellValue}>{m.value}<Text style={styles.macroCellUnit}>{m.unit}</Text></Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* FatSecret attribution */}
                <View style={styles.attribution}>
                  <Text style={styles.attributionText}>Nutrition data</Text>
                  <Image
                    source={{ uri: 'https://platform.fatsecret.com/api/static/images/powered_by_fatsecret.png' }}
                    style={styles.attributionLogo}
                    resizeMode="contain"
                  />
                </View>
              </>
            ) : (
              /* Fallback: direct edit for AI-logged items */
              <>
                <Text style={styles.fallbackHint}>
                  No serving data available. Edit calories and protein directly.
                </Text>
                <View style={styles.fallbackFields}>
                  <View style={styles.fallbackField}>
                    <Text style={styles.sectionLabel}>Calories</Text>
                    <View style={styles.fallbackInputRow}>
                      <TextInput
                        style={styles.fallbackInput}
                        value={editCals}
                        onChangeText={setEditCals}
                        keyboardType="numeric"
                        selectTextOnFocus
                        placeholderTextColor={COLORS.textMuted}
                      />
                      <Text style={styles.quantityUnit}>kcal</Text>
                    </View>
                  </View>
                  <View style={styles.fallbackField}>
                    <Text style={styles.sectionLabel}>Protein</Text>
                    <View style={styles.fallbackInputRow}>
                      <TextInput
                        style={styles.fallbackInput}
                        value={editProt}
                        onChangeText={setEditProt}
                        keyboardType="numeric"
                        selectTextOnFocus
                        placeholderTextColor={COLORS.textMuted}
                      />
                      <Text style={styles.quantityUnit}>g</Text>
                    </View>
                  </View>
                </View>
              </>
            )}

            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color="#000000" />
                : <Text style={styles.saveBtnText}>Update Log</Text>
              }
            </TouchableOpacity>

            <View style={{ height: 16 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: COLORS.textMuted },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
    gap: 10,
  },
  topTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },

  brandName: { fontSize: 13, color: COLORS.textMuted, paddingHorizontal: 20, marginBottom: 8 },

  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1.5,
    marginBottom: 8,
  },

  servingSection: { paddingHorizontal: 20, marginBottom: 20 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    backgroundColor: '#141414',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: '#FFFFFF' },
  chipText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },
  chipTextActive: { color: '#000000', fontWeight: '600' },

  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  quantityInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  quantityInput: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textWhite,
    minWidth: 36,
    textAlign: 'center',
    padding: 0,
  },
  quantityUnit: { fontSize: 12, color: COLORS.textMuted },

  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  macroCell: {
    width: '47%',
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  macroDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 2 },
  macroCellLabel: { fontSize: 10, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.5 },
  macroCellValue: { fontSize: 28, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.5 },
  macroCellUnit: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },

  attribution: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    opacity: 0.4,
  },
  attributionText: { fontSize: 11, color: COLORS.textMuted },
  attributionLogo: { width: 120, height: 16 },

  fallbackHint: {
    fontSize: 14,
    color: COLORS.textMuted,
    paddingHorizontal: 20,
    marginBottom: 24,
    lineHeight: 20,
  },
  fallbackFields: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginBottom: 28 },
  fallbackField: {
    flex: 1,
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 16,
  },
  fallbackInputRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 6 },
  fallbackInput: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.textWhite,
    padding: 0,
    flex: 1,
  },

  saveBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 18,
    marginHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#000000' },
})
