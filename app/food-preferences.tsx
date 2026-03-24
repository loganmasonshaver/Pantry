import { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft, Check, X } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { trackFoodPreferencesUpdated } from '../lib/analytics'

const TEAL = '#00C9A7'

export const DISLIKE_CHIPS = [
  'Shellfish',
  'Dairy',
  'Gluten',
  'Pork',
  'Beef',
  'Eggs',
  'Nuts',
  'Soy',
  'Fish',
  'Spicy Food',
]

export default function FoodPreferencesScreen() {
  const { user } = useAuth()
  const [selected, setSelected] = useState<string[]>([])
  const [customChips, setCustomChips] = useState<string[]>([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<TextInput>(null)

  useEffect(() => {
    loadPreferences()
  }, [user])

  const loadPreferences = async () => {
    if (!user) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('food_dislikes')
      .eq('id', user.id)
      .single()

    const dislikes: string[] = data?.food_dislikes ?? []
    const knownSelected = dislikes.filter(d => DISLIKE_CHIPS.includes(d))
    const custom = dislikes.filter(d => !DISLIKE_CHIPS.includes(d))
    setSelected(knownSelected)
    setCustomChips(custom)
    setInputText('')
    setLoading(false)
  }

  const toggleChip = (chip: string) => {
    setSelected(prev =>
      prev.includes(chip) ? prev.filter(c => c !== chip) : [...prev, chip]
    )
  }

  const commitInput = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    // Avoid duplicates with predefined chips or existing custom chips
    const normalized = trimmed.toLowerCase()
    const alreadyExists =
      customChips.some(c => c.toLowerCase() === normalized) ||
      DISLIKE_CHIPS.some(c => c.toLowerCase() === normalized)
    if (!alreadyExists) {
      // Capitalize first letter
      const label = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
      setCustomChips(prev => [...prev, label])
    }
    setInputText('')
  }

  const handleTextChange = (text: string) => {
    if (text.endsWith(',')) {
      commitInput(text.slice(0, -1))
    } else {
      setInputText(text)
    }
  }

  const removeCustomChip = (chip: string) => {
    setCustomChips(prev => prev.filter(c => c !== chip))
  }

  const save = async () => {
    if (!user) return
    // Commit any pending text before saving
    const pending = inputText.trim()
    let finalCustomChips = customChips
    if (pending) {
      const normalized = pending.toLowerCase()
      const alreadyExists =
        customChips.some(c => c.toLowerCase() === normalized) ||
        DISLIKE_CHIPS.some(c => c.toLowerCase() === normalized)
      if (!alreadyExists) {
        const label = pending.charAt(0).toUpperCase() + pending.slice(1)
        finalCustomChips = [...customChips, label]
        setCustomChips(finalCustomChips)
      }
      setInputText('')
    }

    setSaving(true)
    const allDislikes = [...selected, ...finalCustomChips]
    const { error } = await supabase
      .from('profiles')
      .update({
        food_dislikes: allDislikes,
        food_prefs_banner_dismissed: true,
      })
      .eq('id', user.id)
    setSaving(false)
    if (error) {
      Alert.alert('Save Failed', error.message)
      return
    }
    trackFoodPreferencesUpdated(allDislikes.length)
    router.back()
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={26} stroke={TEAL} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Food Preferences</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={TEAL} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.title}>What do you want to avoid?</Text>
            <Text style={styles.subtitle}>
              These will never appear in your meal suggestions.
            </Text>

            {/* ── All chips: predefined + custom ── */}
            <View style={styles.chipGrid}>
              {DISLIKE_CHIPS.map(chip => {
                const active = selected.includes(chip)
                return (
                  <TouchableOpacity
                    key={chip}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => toggleChip(chip)}
                    activeOpacity={0.75}
                  >
                    {active && (
                      <Check size={13} stroke={TEAL} strokeWidth={2.5} />
                    )}
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {chip}
                    </Text>
                  </TouchableOpacity>
                )
              })}

              {customChips.map(chip => (
                <TouchableOpacity
                  key={chip}
                  style={styles.customChip}
                  onPress={() => removeCustomChip(chip)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.customChipText}>{chip}</Text>
                  <X size={13} stroke={TEAL} strokeWidth={2.5} />
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Add custom item ── */}
            <Text style={styles.customLabel}>Add your own</Text>
            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                style={styles.customInput}
                placeholder="e.g. Mushrooms"
                placeholderTextColor={COLORS.textMuted}
                value={inputText}
                onChangeText={handleTextChange}
                onSubmitEditing={() => commitInput(inputText)}
                autoCapitalize="words"
                returnKeyType="done"
                blurOnSubmit={false}
              />
              {inputText.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={() => commitInput(inputText)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.addBtnText}>Add</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.customHint}>Press return or comma to add each item</Text>
          </ScrollView>

          {/* ── Save button ── */}
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={save}
              activeOpacity={0.85}
              disabled={saving}
            >
              <Text style={styles.saveBtnText}>
                {saving ? 'Saving…' : 'Save Preferences'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textWhite,
    letterSpacing: -0.2,
  },
  headerSpacer: { width: 36 },

  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
  },

  title: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.textWhite,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textMuted,
    lineHeight: 22,
    marginBottom: 28,
  },

  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 32,
  },

  // Predefined chips
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 30,
    backgroundColor: '#1A1A1A',
    borderWidth: 1.5,
    borderColor: '#2A2A2A',
  },
  chipActive: {
    backgroundColor: 'rgba(0,201,167,0.1)',
    borderColor: TEAL,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  chipTextActive: {
    color: TEAL,
    fontWeight: '600',
  },

  // Custom chips (always teal, with X)
  customChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 30,
    backgroundColor: 'rgba(0,201,167,0.1)',
    borderWidth: 1.5,
    borderColor: TEAL,
  },
  customChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: TEAL,
  },

  // Input row
  customLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textWhite,
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  customInput: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.textWhite,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  addBtn: {
    backgroundColor: TEAL,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  addBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },
  customHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 8,
  },

  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  saveBtn: {
    backgroundColor: COLORS.textWhite,
    borderRadius: 30,
    paddingVertical: 18,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
})
