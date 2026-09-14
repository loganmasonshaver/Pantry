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
  ScrollView,
  InputAccessoryView,
} from 'react-native'
import { X, ChevronDown, Check } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { saveOverride, deleteOverride } from '@/hooks/useMacroOverrides'
import { pickDefaultServing, type FoodServing } from '@/lib/fatsecret'
import {
  applyOverride, availableUnits, correctionStartAmount, correctionToStore, defaultCorrectionPortion,
  fatsecretNutrients, findServing, formatAmount, metricBasis, metricOf, parseAmount, portionMetric,
  sameUnit, servingTitle, unitKey, unitLabel, type Override, type Unit,
} from '@/lib/foodPortion'

type Props = {
  visible: boolean
  onClose: () => void
  foodKey: string
  foodName: string
  userId: string
  servings: FoodServing[]
  override: Override | null
  onSaved: () => void
}

// Prefill values: whole calories, macros to one decimal — FatSecret's precision, not float noise.
const kcalText = (n: number) => String(Math.round(n))
const gramText = (n: number) => String(Math.round(n * 10) / 10)
const ACCESSORY_ID = 'macro-edit-done'

// The correction is entered against the PORTION THE LABEL USES, chosen here, not the unit the user
// happens to be logging in. A label says "2 Tbsp (32 g) · 190 kcal"; the sheet used to say "per
// 100 g" when the user was logging grams, which meant a calculator. The Per row opens on the label
// serving and takes any amount of any unit the food has, so the four numbers are typed straight off
// the package. lib/foodPortion.correctionToStore turns that into what is stored.
export default function MacroEditModal({ visible, onClose, foodKey, foodName, userId, servings, override, onSaved }: Props) {
  // Keyboard up → this closes the KEYBOARD, not the form (people tap the nearest ✕/Cancel
  // just to dismiss it, and that used to discard everything typed). Second tap closes.
  const closeOrDismiss = () => { if (Keyboard.isVisible()) { Keyboard.dismiss(); return } onClose() }

  const start = defaultCorrectionPortion(servings, override, pickDefaultServing(servings))
  const [unit, setUnit] = useState<Unit>(start.unit)
  const [amount, setAmount] = useState(start.amount)
  const [amountText, setAmountText] = useState(formatAmount(start.amount, start.unit))
  const [picker, setPicker] = useState(false)

  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [saving, setSaving] = useState(false)

  // Prefill from the correction scaled to THIS portion when one applies, else FatSecret's numbers
  // for it — so the user is always comparing like with like. Re-runs when the portion changes:
  // the numbers are per portion, so a new portion means new starting numbers.
  useEffect(() => {
    if (!visible) return
    const fs = fatsecretNutrients(unit, amount, servings)
    if (!fs) return
    const applied = applyOverride(fs, override, unit, amount, servings)
    const v = applied.overridden ? applied.nutrients : fs
    setCalories(kcalText(v.calories))
    setProtein(gramText(v.protein))
    setCarbs(gramText(v.carbs))
    setFat(gramText(v.fat))
  }, [visible, foodKey, unitKey(unit), amount])

  const commitAmount = () => {
    const n = parseAmount(amountText)
    const next = n ?? amount
    setAmount(next)
    setAmountText(formatAmount(next, unit))
  }

  // No conversion on a unit change: "per 1 cup" → tbsp means "per 1 tbsp", because the next thing
  // typed is what the label says for that unit.
  const chooseUnit = (u: Unit) => {
    setPicker(false)
    if (sameUnit(u, unit)) return
    const a = correctionStartAmount(u)
    setUnit(u)
    setAmount(a)
    setAmountText(formatAmount(a, u))
  }

  const handleSave = async () => {
    const cal = parseFloat(calories.replace(',', '.'))
    const prot = parseFloat(protein.replace(',', '.'))
    const carb = parseFloat(carbs.replace(',', '.'))
    const f = parseFloat(fat.replace(',', '.'))
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
    const { nutrients, basis } = correctionToStore(unit, amount, { calories: cal, protein: prot, carbs: carb, fat: f }, servings)
    const { error } = await saveOverride(userId, { food_key: foodKey, food_name: foodName, ...nutrients, ...basis })
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

  const units = availableUnits(servings)
  const basis = metricBasis(servings)
  const metric = unit.kind === 'serving' ? portionMetric(unit, amount, servings) : null

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          {picker ? (
            // The unit list replaces the form rather than stacking a sheet on a sheet.
            <>
              <View style={styles.header}>
                <Text style={[styles.title, { flex: 1 }]}>Per</Text>
                <TouchableOpacity style={styles.closeBtn} onPress={() => setPicker(false)} activeOpacity={0.7}>
                  <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                {(() => {
                  const kcalFor = (u: Unit, a: number) => {
                    const fs = fatsecretNutrients(u, a, servings)
                    return fs ? Math.round(applyOverride(fs, override, u, a, servings).nutrients.calories) : null
                  }
                  const row = (u: Unit, title: string, sub: string | null) => (
                    <TouchableOpacity key={unitKey(u)} style={styles.pickRow} onPress={() => chooseUnit(u)} activeOpacity={0.7}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pickTitle}>{title}</Text>
                        {sub ? <Text style={styles.pickSub}>{sub}</Text> : null}
                      </View>
                      {sameUnit(u, unit) && <Check size={18} stroke="#4ADE80" strokeWidth={2.5} />}
                    </TouchableOpacity>
                  )
                  const servingUnits = units.filter(u => u.kind === 'serving')
                  const metricUnits = units.filter(u => u.kind !== 'serving')
                  return (
                    <>
                      {servingUnits.length > 0 && <Text style={styles.pickSection}>SERVINGS</Text>}
                      {servingUnits.map(u => {
                        const s = findServing(u, servings)!
                        const m = metricOf(s)
                        const kcal = kcalFor(u, 1)
                        const sub = [m ? `${Math.round(m.amount)} ${m.unit}` : null, kcal !== null ? `${kcal} kcal` : null].filter(Boolean).join(' · ')
                        return row(u, servingTitle(s), sub || null)
                      })}
                      {metricUnits.length > 0 && <Text style={styles.pickSection}>{basis?.unit === 'ml' ? 'BY VOLUME' : 'BY WEIGHT'}</Text>}
                      {metricUnits.map(u => {
                        if (u.kind === 'g') return row(u, 'grams', 'EU labels read per 100 g')
                        if (u.kind === 'oz') return row(u, 'ounces', null)
                        return row(u, 'milliliters', null)
                      })}
                    </>
                  )
                })()}
              </ScrollView>
              <Text style={styles.pickHint}>
                Label says ½ cup? Pick cup, then type 0.5. A serving size the list doesn't have? Pick grams and type the label's weight.
              </Text>
            </>
          ) : (
            <>
              {/* Header */}
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>Edit nutrition</Text>
                  <Text style={styles.subtitle} numberOfLines={1}>{foodName}</Text>
                </View>
                <TouchableOpacity style={styles.closeBtn} onPress={closeOrDismiss} activeOpacity={0.7}>
                  <X size={18} stroke={COLORS.textWhite} strokeWidth={2} />
                </TouchableOpacity>
              </View>

              {/* Per — the portion the label uses */}
              <Text style={styles.label}>PER</Text>
              <View style={styles.perRow}>
                <View style={styles.amountBox}>
                  <TextInput
                    style={styles.amountInput}
                    value={amountText}
                    onChangeText={setAmountText}
                    onBlur={commitAmount}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                    inputAccessoryViewID={ACCESSORY_ID}
                  />
                </View>
                <TouchableOpacity
                  style={styles.unitPill}
                  onPress={() => { Keyboard.dismiss(); setPicker(true) }}
                  disabled={units.length <= 1}
                  activeOpacity={0.7}
                >
                  <Text style={styles.unitText} numberOfLines={1}>{unitLabel(unit, servings)}</Text>
                  {units.length > 1 && <ChevronDown size={16} stroke={COLORS.textMuted} strokeWidth={2} />}
                </TouchableOpacity>
              </View>
              <Text style={styles.hint}>
                {metric ? `${Math.round(metric.amount)} ${metric.unit} · ` : ''}Type what the label says for this portion. Your account only — the app scales it to whatever amount you log.
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
                        keyboardType="decimal-pad"
                        selectTextOnFocus
                        inputAccessoryViewID={ACCESSORY_ID}
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
              {!!override && (
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
          )}
        </View>
      </KeyboardAvoidingView>

      {/* decimal-pad has no return key; this is the only way to finish typing. */}
      <InputAccessoryView nativeID={ACCESSORY_ID}>
        <View style={styles.accessoryBar}>
          <TouchableOpacity onPress={() => Keyboard.dismiss()} hitSlop={10} activeOpacity={0.7}>
            <Text style={styles.accessoryDone}>Done</Text>
          </TouchableOpacity>
        </View>
      </InputAccessoryView>
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

  label: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.2 },
  perRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  // The input fills its box, so every point of the visible box focuses it.
  amountBox: { width: 76, backgroundColor: '#1A1A1A', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(74,222,128,0.35)' },
  amountInput: { fontSize: 17, fontWeight: '700', color: COLORS.textWhite, textAlign: 'center', paddingVertical: 12, paddingHorizontal: 6, width: '100%' },
  unitPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1A1A1A', borderRadius: 12, paddingHorizontal: 14, gap: 8, borderWidth: 1, borderColor: 'rgba(74,222,128,0.35)' },
  unitText: { flex: 1, fontSize: 15, fontWeight: '600', color: COLORS.textWhite },
  hint: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 17,
    marginTop: 8,
    marginBottom: 16,
  },

  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#222222', gap: 12 },
  pickTitle: { fontSize: 15, fontWeight: '600', color: COLORS.textWhite },
  pickSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  pickSection: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1.2, marginTop: 12, marginBottom: 2 },
  pickHint: { fontSize: 12, color: COLORS.textMuted, lineHeight: 17, marginTop: 14 },

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

  accessoryBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  accessoryDone: { fontSize: 16, fontWeight: '700', color: '#4ADE80' },
})
