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
} from 'react-native'
import { X } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { getOverride, saveOverride, deleteOverride } from '@/hooks/useMacroOverrides'

type Props = {
  visible: boolean
  onClose: () => void
  foodKey: string
  foodName: string
  userId: string
  originalCalories: number
  originalProtein: number
  originalCarbs: number
  originalFat: number
  onSaved: (overrideActive: boolean) => void
}

export default function MacroEditModal({
  visible, onClose, foodKey, foodName, userId,
  originalCalories, originalProtein, originalCarbs, originalFat,
  onSaved,
}: Props) {
  const [calories, setCalories] = useState(String(originalCalories))
  const [protein, setProtein] = useState(String(originalProtein))
  const [carbs, setCarbs] = useState(String(originalCarbs))
  const [fat, setFat] = useState(String(originalFat))
  const [hasOverride, setHasOverride] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    setLoading(true)
    getOverride(userId, foodKey).then(existing => {
      if (existing) {
        setCalories(String(existing.calories))
        setProtein(String(existing.protein))
        setCarbs(String(existing.carbs))
        setFat(String(existing.fat))
        setHasOverride(true)
      } else {
        setCalories(String(originalCalories))
        setProtein(String(originalProtein))
        setCarbs(String(originalCarbs))
        setFat(String(originalFat))
        setHasOverride(false)
      }
    }).finally(() => setLoading(false))
  }, [visible, foodKey])

  const handleSave = async () => {
    const cal = parseInt(calories)
    const prot = parseFloat(protein)
    const carb = parseFloat(carbs)
    const f = parseFloat(fat)
    if (isNaN(cal) || isNaN(prot) || isNaN(carb) || isNaN(f)) return
    setSaving(true)
    const { error } = await saveOverride(userId, {
      food_key: foodKey,
      food_name: foodName,
      calories: cal,
      protein: prot,
      carbs: carb,
      fat: f,
    })
    setSaving(false)
    if (error) { Alert.alert('Save failed', error); return }
    onSaved(true)
    onClose()
  }

  const handleReset = async () => {
    setSaving(true)
    const { error } = await deleteOverride(userId, foodKey)
    setSaving(false)
    if (error) { Alert.alert('Reset failed', error); return }
    onSaved(false)
    onClose()
  }

  const fields = [
    { label: 'Calories', value: calories, onChange: setCalories, unit: 'kcal', color: '#FFFFFF' },
    { label: 'Protein',  value: protein,  onChange: setProtein,  unit: 'g',    color: '#4ADE80' },
    { label: 'Carbs',    value: carbs,    onChange: setCarbs,    unit: 'g',    color: '#F59E0B' },
    { label: 'Fat',      value: fat,      onChange: setFat,      unit: 'g',    color: '#60A5FA' },
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
              <Text style={styles.title}>Fix Nutrition Data</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{foodName}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color="#4ADE80" style={{ marginVertical: 32 }} />
          ) : (
            <>
              <Text style={styles.hint}>
                Your corrections apply only to your account and override FatSecret values when you log this food.
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
              {hasOverride && (
                <TouchableOpacity
                  style={[styles.resetBtn, saving && { opacity: 0.5 }]}
                  onPress={handleReset}
                  disabled={saving}
                  activeOpacity={0.7}
                >
                  <Text style={styles.resetBtnText}>Reset to Original</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
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
