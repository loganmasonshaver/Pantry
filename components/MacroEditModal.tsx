import { useState, useEffect } from 'react'
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Keyboard,
} from 'react-native'
import { X } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { saveOverride, deleteOverride } from '@/hooks/useMacroOverrides'
import type { Nutrients, Override } from '@/lib/foodPortion'

type Props = {
  visible: boolean
  onClose: () => void
  foodKey: string
  foodName: string
  userId: string
  // The portion these numbers describe — a serving, 100 g, 1 oz or 100 ml — and the basis saved
  // with the correction so it can be scaled onto any other portion (lib/foodPortion.ts).
  portionLabel: string
  original: Nutrients
  current: Nutrients | null
  basis: Pick<Override, 'basis_amount' | 'basis_unit' | 'serving_id'>
  hasCorrection: boolean
  onSaved: () => void
}

// Prefill values: whole calories, macros to one decimal — FatSecret's precision, not float noise.
const kcalText = (n: number) => String(Math.round(n))
const gramText = (n: number) => String(Math.round(n * 10) / 10)

export default function MacroEditModal({
  visible, onClose, foodKey, foodName, userId,
  portionLabel, original, current, basis, hasCorrection,
  onSaved,
}: Props) {
  // Keyboard up → this closes the KEYBOARD, not the form (people tap the nearest ✕/Cancel
  // just to dismiss it, and that used to discard everything typed). Second tap closes.
  const closeOrDismiss = () => { if (Keyboard.isVisible()) { Keyboard.dismiss(); return } onClose() }
  const start = current ?? original
  const [calories, setCalories] = useState(kcalText(start.calories))
  const [protein, setProtein] = useState(gramText(start.protein))
  const [carbs, setCarbs] = useState(gramText(start.carbs))
  const [fat, setFat] = useState(gramText(start.fat))
  const [saving, setSaving] = useState(false)

  // Prefill from the correction scaled to THIS portion when one applies, else FatSecret's numbers.
  // The caller computes both, so the form can never show a correction in a different portion's terms.
  useEffect(() => {
    if (!visible) return
    const v = current ?? original
    setCalories(kcalText(v.calories))
    setProtein(gramText(v.protein))
    setCarbs(gramText(v.carbs))
    setFat(gramText(v.fat))
  }, [visible, foodKey, portionLabel])

  const handleSave = async () => {
    const cal = parseInt(calories)
    const prot = parseFloat(protein)
    const carb = parseFloat(carbs)
    const f = parseFloat(fat)
    // Reject empty/NaN AND negatives (and 0 calories) — these were silently persisting to
    // macro_overrides and corrupting log entries. Tell the user instead of no-op'ing.
    if (isNaN(cal) || isNaN(prot) || isNaN(carb) || isNaN(f)) {
      Alert.alert('Check your numbers', 'Please enter a value for calories and each macro.')
      return
    }
    if (cal <= 0 || prot < 0 || carb < 0 || f < 0) {
      Alert.alert('Check your numbers', 'Calories must be above 0 and macros can’t be negative.')
      return
    }
    setSaving(true)
    const { error } = await saveOverride(userId, {
      food_key: foodKey,
      food_name: foodName,
      calories: cal,
      protein: prot,
      carbs: carb,
      fat: f,
      ...basis,
    })
    setSaving(false)
    if (error) { Alert.alert('Save failed', error); return }
    onSaved()
    onClose()
  }

  const handleReset = async () => {
    setSaving(true)
    const { error } = await deleteOverride(userId, foodKey)
    setSaving(false)
    if (error) { Alert.alert('Reset failed', error); return }
    onSaved()
    onClose()
  }

  const fields = [
    { label: 'Calories', value: calories, onChange: setCalories, unit: 'kcal', color: '#FFFFFF' },
    { label: 'Protein',  value: protein,  onChange: setProtein,  unit: 'g',    color: COLORS.macroProtein },
    { label: 'Carbs',    value: carbs,    onChange: setCarbs,    unit: 'g',    color: COLORS.macroCarbs },
    { label: 'Fat',      value: fat,      onChange: setFat,      unit: 'g',    color: COLORS.macroFat },
  ]

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Edit nutrition</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{foodName} · per {portionLabel}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={closeOrDismiss} activeOpacity={0.7}>
              <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <>
              <Text style={styles.hint}>
                For your account only. Enter what {portionLabel} contains — the app scales it to whatever amount you log.
              </Text>

              {/* Macro inputs */}
              <View style={styles.fieldGrid}>
                {fields.map(field => (
                  <View key={field.label} style={styles.field}>
                    <View style={[styles.fieldDot, { backgroundColor: field.color }]} />
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <View style={styles.fieldInputRow}>
                      <TextInput
                        style={styles.fieldInput}
                        value={field.value}
                        onChangeText={field.onChange}
                        keyboardType="numeric"
                        selectTextOnFocus
                        placeholderTextColor={COLORS.textMuted}
                      />
                      <Text style={styles.fieldUnit}>{field.unit}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* Save */}
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving
                  ? <ActivityIndicator color="#000000" />
                  : <Text style={styles.saveBtnText}>Save Correction</Text>
                }
              </TouchableOpacity>

              {/* Reset — only if an override exists */}
              {hasCorrection && (
                <TouchableOpacity
                  style={[styles.resetBtn, saving && { opacity: 0.5 }]}
                  onPress={handleReset}
                  disabled={saving}
                  activeOpacity={0.7}
                >
                  <Text style={styles.resetBtnText}>Reset to Original</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.cancelBtn} onPress={closeOrDismiss} activeOpacity={0.7}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
          </>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },

  hint: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
    marginBottom: 20,
  },

  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  field: {
    width: '47%',
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  fieldDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 2,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 0.4,
  },
  fieldInputRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 4,
  },
  fieldInput: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textWhite,
    padding: 0,
    flex: 1,
  },
  fieldUnit: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },

  saveBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },

  resetBtn: {
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 12,
  },
  resetBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textMuted,
  },

  cancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    color: COLORS.textMuted,
  },
})
