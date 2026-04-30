import { useState, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Pressable,
  Keyboard,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { X, Plus, ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useAIConsent } from '@/context/AIConsentContext'

// ── Types ───────────────────────────────────────────────────────────────

type Ingredient = { name: string; visual: string; grams: string }

type EditMeal = {
  id: string
  name: string
  prep_time: number | null
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  ingredients: any[]
  steps: string[]
} | null

type Props = {
  visible: boolean
  onClose: () => void
  onSaved: () => void
  editMeal?: EditMeal
}

// ── Helpers ─────────────────────────────────────────────────────────────

const EMPTY_INGREDIENT: Ingredient = { name: '', visual: '', grams: '' }

function parseIngredients(raw: any[]): Ingredient[] {
  if (!raw || raw.length === 0) return [{ ...EMPTY_INGREDIENT }]
  return raw.map((i: any) => ({
    name: typeof i === 'string' ? i : i.name ?? '',
    visual: i.visual ?? i.amount ?? '',
    grams: i.grams != null ? String(i.grams) : '',
  }))
}

// ── Component ───────────────────────────────────────────────────────────

export default function RecipeFormModal({ visible, onClose, onSaved, editMeal }: Props) {
  const { user } = useAuth()
  const { requestConsent } = useAIConsent()
  const isEdit = !!editMeal?.id

  // AI auto-fill
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // Form fields
  const [name, setName] = useState('')
  const [prepTime, setPrepTime] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [ingredients, setIngredients] = useState<Ingredient[]>([{ ...EMPTY_INGREDIENT }])
  const [steps, setSteps] = useState<string[]>([''])
  const [saving, setSaving] = useState(false)

  // Pre-fill when editing
  useEffect(() => {
    if (!visible) return
    if (editMeal) {
      setName(editMeal.name ?? '')
      setPrepTime(editMeal.prep_time != null ? String(editMeal.prep_time) : '')
      setCalories(editMeal.calories != null ? String(editMeal.calories) : '')
      setProtein(editMeal.protein != null ? String(editMeal.protein) : '')
      setCarbs(editMeal.carbs != null ? String(editMeal.carbs) : '')
      setFat(editMeal.fat != null ? String(editMeal.fat) : '')
      setIngredients(parseIngredients(editMeal.ingredients))
      setSteps(editMeal.steps?.length ? [...editMeal.steps] : [''])
    } else {
      resetForm()
    }
  }, [visible, editMeal])

  function resetForm() {
    setAiPrompt('')
    setName('')
    setPrepTime('')
    setCalories('')
    setProtein('')
    setCarbs('')
    setFat('')
    setIngredients([{ ...EMPTY_INGREDIENT }])
    setSteps([''])
  }

  // ── AI Generate ─────────────────────────────────────────────────────

  async function handleGenerate() {
    const desc = aiPrompt.trim()
    if (!desc) return
    const ok = await requestConsent()
    if (!ok) return
    setAiLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-recipe', {
        body: { description: desc },
      })
      if (error) throw error
      if (data) {
        setName(data.name ?? '')
        setPrepTime(data.prep_time != null ? String(data.prep_time) : '')
        setCalories(data.calories != null ? String(data.calories) : '')
        setProtein(data.protein != null ? String(data.protein) : '')
        setCarbs(data.carbs != null ? String(data.carbs) : '')
        setFat(data.fat != null ? String(data.fat) : '')
        if (data.ingredients?.length) setIngredients(parseIngredients(data.ingredients))
        if (data.steps?.length) setSteps(data.steps)
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to generate recipe')
    } finally {
      setAiLoading(false)
    }
  }

  // ── Ingredients ─────────────────────────────────────────────────────

  function updateIngredient(index: number, field: keyof Ingredient, value: string) {
    setIngredients(prev => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
  }

  function removeIngredient(index: number) {
    setIngredients(prev => (prev.length <= 1 ? [{ ...EMPTY_INGREDIENT }] : prev.filter((_, i) => i !== index)))
  }

  function addIngredient() {
    setIngredients(prev => [...prev, { ...EMPTY_INGREDIENT }])
  }

  // ── Steps ───────────────────────────────────────────────────────────

  function updateStep(index: number, value: string) {
    setSteps(prev => prev.map((s, i) => (i === index ? value : s)))
  }

  function removeStep(index: number) {
    setSteps(prev => (prev.length <= 1 ? [''] : prev.filter((_, i) => i !== index)))
  }

  function addStep() {
    setSteps(prev => [...prev, ''])
  }

  // ── Save ────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Missing name', 'Please enter a recipe name.')
      return
    }
    if (!user) return
    setSaving(true)

    const ingredientsList = ingredients
      .filter(i => i.name.trim())
      .map(i => ({
        name: i.name.trim(),
        visual: i.visual.trim() || null,
        grams: i.grams ? parseInt(i.grams) : null,
      }))

    const stepsList = steps.filter(s => s.trim())

    const payload = {
      user_id: user.id,
      name: name.trim(),
      prep_time: prepTime ? parseInt(prepTime) : null,
      calories: calories ? parseInt(calories) : null,
      protein: protein ? parseInt(protein) : null,
      carbs: carbs ? parseInt(carbs) : null,
      fat: fat ? parseInt(fat) : null,
      ingredients: ingredientsList,
      steps: stepsList,
      is_user_created: true,
    }

    try {
      if (isEdit && editMeal) {
        const { error } = await supabase
          .from('saved_meals')
          .update(payload)
          .eq('id', editMeal.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('saved_meals').insert(payload)
        if (error) throw error
      }
      onSaved()
      onClose()
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to save recipe')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <SafeAreaView style={s.safe} edges={['bottom']}>
          {/* Header */}
          <View style={s.header}>
            <Text
              style={s.backText}
              onPress={() => onClose()}
            >
              ← Back
            </Text>
            <Text style={s.headerTitle}>{isEdit ? 'Edit Recipe' : 'New Recipe'}</Text>
            <View style={{ width: 60 }} />
          </View>

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={s.scroll}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              onScrollBeginDrag={() => Keyboard.dismiss()}
            >
              {/* AI Auto-Fill — only in create mode */}
              {!isEdit && (
                <>
                  <View style={s.section}>
                    <TextInput
                      style={s.input}
                      placeholder="Describe a meal (e.g. chicken stir fry)"
                      placeholderTextColor="#888888"
                      value={aiPrompt}
                      onChangeText={setAiPrompt}
                    />
                    <TouchableOpacity
                      style={[s.aiBtn, (aiLoading || !aiPrompt.trim()) && { opacity: 0.5 }]}
                      onPress={handleGenerate}
                      disabled={aiLoading || !aiPrompt.trim()}
                      activeOpacity={0.8}
                    >
                      {aiLoading ? (
                        <ActivityIndicator color="#000000" size="small" />
                      ) : (
                        <Text style={s.aiBtnText}>Generate with AI</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Divider */}
                  <View style={s.dividerRow}>
                    <View style={s.dividerLine} />
                    <Text style={s.dividerText}>or fill in manually</Text>
                    <View style={s.dividerLine} />
                  </View>
                </>
              )}

              {/* Name */}
              <View style={s.section}>
                <Text style={s.label}>Name</Text>
                <TextInput
                  style={s.input}
                  placeholder="Recipe name"
                  placeholderTextColor="#888888"
                  value={name}
                  onChangeText={setName}
                />
              </View>

              {/* Prep Time */}
              <View style={s.section}>
                <Text style={s.label}>Prep Time</Text>
                <View style={s.suffixWrap}>
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    placeholder="Minutes"
                    placeholderTextColor="#888888"
                    keyboardType="number-pad"
                    value={prepTime}
                    onChangeText={setPrepTime}
                  />
                  <Text style={s.suffix}>min</Text>
                </View>
              </View>

              {/* Macros 2x2 */}
              <View style={s.section}>
                <Text style={s.sectionTitle}>Macros</Text>
                <View style={s.macroGrid}>
                  <View style={s.macroCell}>
                    <Text style={s.label}>Calories</Text>
                    <View style={s.suffixWrap}>
                      <TextInput
                        style={[s.input, { flex: 1 }]}
                        placeholder="0"
                        placeholderTextColor="#888888"
                        keyboardType="number-pad"
                        value={calories}
                        onChangeText={setCalories}
                      />
                      <Text style={s.suffix}>kcal</Text>
                    </View>
                  </View>
                  <View style={s.macroCell}>
                    <Text style={s.label}>Protein</Text>
                    <View style={s.suffixWrap}>
                      <TextInput
                        style={[s.input, { flex: 1 }]}
                        placeholder="0"
                        placeholderTextColor="#888888"
                        keyboardType="number-pad"
                        value={protein}
                        onChangeText={setProtein}
                      />
                      <Text style={s.suffix}>g</Text>
                    </View>
                  </View>
                  <View style={s.macroCell}>
                    <Text style={s.label}>Carbs</Text>
                    <View style={s.suffixWrap}>
                      <TextInput
                        style={[s.input, { flex: 1 }]}
                        placeholder="0"
                        placeholderTextColor="#888888"
                        keyboardType="number-pad"
                        value={carbs}
                        onChangeText={setCarbs}
                      />
                      <Text style={s.suffix}>g</Text>
                    </View>
                  </View>
                  <View style={s.macroCell}>
                    <Text style={s.label}>Fat</Text>
                    <View style={s.suffixWrap}>
                      <TextInput
                        style={[s.input, { flex: 1 }]}
                        placeholder="0"
                        placeholderTextColor="#888888"
                        keyboardType="number-pad"
                        value={fat}
                        onChangeText={setFat}
                      />
                      <Text style={s.suffix}>g</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Ingredients */}
              <View style={s.section}>
                <Text style={s.sectionTitle}>Ingredients</Text>
                {ingredients.map((ing, i) => (
                  <View key={i} style={s.ingredientRow}>
                    <TextInput
                      style={[s.input, { flex: 2 }]}
                      placeholder="Name"
                      placeholderTextColor="#888888"
                      value={ing.name}
                      onChangeText={v => updateIngredient(i, 'name', v)}
                    />
                    <TextInput
                      style={[s.input, { flex: 1 }]}
                      placeholder="1 cup"
                      placeholderTextColor="#888888"
                      value={ing.visual}
                      onChangeText={v => updateIngredient(i, 'visual', v)}
                    />
                    <TextInput
                      style={[s.input, { flex: 1 }]}
                      placeholder="150g"
                      placeholderTextColor="#888888"
                      keyboardType="number-pad"
                      value={ing.grams}
                      onChangeText={v => updateIngredient(i, 'grams', v)}
                    />
                    <TouchableOpacity onPress={() => removeIngredient(i)} hitSlop={8} style={s.rowDelete}>
                      <X size={16} stroke="#888888" strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity onPress={addIngredient} style={s.addRow} activeOpacity={0.7}>
                  <Plus size={14} stroke="#4ADE80" strokeWidth={2.5} />
                  <Text style={s.addText}>Add ingredient</Text>
                </TouchableOpacity>
              </View>

              {/* Steps */}
              <View style={s.section}>
                <Text style={s.sectionTitle}>Steps</Text>
                {steps.map((step, i) => (
                  <View key={i} style={s.stepRow}>
                    <View style={s.stepCircle}>
                      <Text style={s.stepNum}>{i + 1}</Text>
                    </View>
                    <TextInput
                      style={[s.input, { flex: 1 }]}
                      placeholder={`Step ${i + 1}`}
                      placeholderTextColor="#888888"
                      value={step}
                      onChangeText={v => updateStep(i, v)}
                      multiline
                    />
                    <TouchableOpacity onPress={() => removeStep(i)} hitSlop={8} style={s.rowDelete}>
                      <X size={16} stroke="#888888" strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity onPress={addStep} style={s.addRow} activeOpacity={0.7}>
                  <Plus size={14} stroke="#4ADE80" strokeWidth={2.5} />
                  <Text style={s.addText}>Add step</Text>
                </TouchableOpacity>
              </View>

              <View style={{ height: 16 }} />
            </ScrollView>
          </KeyboardAvoidingView>

          {/* Save — sticky bottom */}
          <View style={s.stickyBottom}>
            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={s.saveBtnText}>
                {saving ? 'Saving...' : isEdit ? 'Update Recipe' : 'Save Recipe'}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000000',
  },
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 56,
    paddingBottom: 8,
    zIndex: 10,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4ADE80',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  // Sections
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888888',
    marginBottom: 6,
  },

  // Inputs
  input: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 14,
    color: '#FFFFFF',
    fontSize: 15,
  },
  suffixWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  suffix: {
    fontSize: 14,
    color: '#888888',
    fontWeight: '500',
  },

  // AI section
  aiBtn: {
    backgroundColor: '#4ADE80',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  aiBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },

  // Divider
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  dividerText: {
    fontSize: 13,
    color: '#888888',
  },

  // Macros grid
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  macroCell: {
    width: '47%',
  },

  // Ingredient rows
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },

  // Step rows
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  stepNum: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Row delete
  rowDelete: {
    padding: 6,
    marginTop: 8,
  },

  // Add buttons
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  addText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4ADE80',
  },

  // Save
  stickyBottom: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  saveBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
})
