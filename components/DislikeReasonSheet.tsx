import { useEffect, useState } from 'react'
import { View, Text, Modal, Pressable, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { COLORS } from '@/constants/colors'
import { DISLIKE_REASONS, DislikeReason } from '@/lib/dislikeReasons'

// The five reasons and their routing live in lib/dislikeReasons.ts — this file only draws them.
// Two of the five are bug reports about a meal the user may well want again, so the dish must
// survive them; that is the whole reason the sheet exists.
export type DislikeFeedback = { reason: DislikeReason; ingredients: string[] }

type Props = {
  visible: boolean
  mealName: string
  // Ingredient names for the taste follow-up. Empty is fine — the follow-up is skipped.
  ingredients: string[]
  onClose: () => void
  onSubmit: (feedback: DislikeFeedback) => void
  // Fired when the user names specific ingredients, so the caller can offer the existing food
  // filter. Nothing is written to food_dislikes here: that column is injected into the prompt as
  // an allergen-strength HARD EXCLUSION and also filters Discover, which is far too broad an
  // outcome for one bad parfait. The user opts into that severity on the screen that explains it.
  onIngredientsNamed?: (ingredients: string[]) => void
}

export default function DislikeReasonSheet({ visible, mealName, ingredients, onClose, onSubmit, onIngredientsNamed }: Props) {
  const [step, setStep] = useState<'reason' | 'culprit'>('reason')
  const [picked, setPicked] = useState<string[]>([])

  useEffect(() => {
    if (!visible) return
    setStep('reason')
    setPicked([])
  }, [visible])

  const choose = (reason: DislikeReason) => {
    // "Not to my taste" is the one answer that cannot be acted on as given. Too much of one
    // thing, an ingredient they hate, a pairing that does not work and a cook who overdid it all
    // arrive as the same tap. A second question separates them; the COUNT of what they pick is
    // itself the signal (one = a disliked food, several = a bad combination).
    if (reason === 'taste' && ingredients.length > 0) { setStep('culprit'); return }
    onSubmit({ reason, ingredients: [] })
    onClose()
  }

  const toggle = (name: string) => {
    setPicked(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
  }

  const finishCulprit = () => {
    onSubmit({ reason: 'taste', ingredients: picked })
    // Ordered so the rating is recorded before any navigation the caller does on this callback.
    if (picked.length > 0) onIngredientsNamed?.(picked)
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* A Modal is its own WINDOW and react-native-safe-area-context cannot read the app root's
          insets from it, so both the hook and SafeAreaView yield 0 without a provider INSIDE the
          modal — otherwise the buttons sit on the home indicator.
          The provider is the OUTERMOST child, matching PantryScanModal. It renders with flex:1 of
          its own, so putting it BETWEEN the backdrop and the sheet made it fill the backdrop and
          swallow the backdrop's justifyContent — which drew the sheet at the top of the screen
          with its title behind the Dynamic Island. Nesting is the fix; duplicating the layout onto
          the provider was not. */}
      <SafeAreaProvider>
        {/* Tap-outside dismiss. The sheet asks a question the user never opted into, so leaving
            must be at least as easy as answering — backing out still keeps the thumbs-down. */}
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <SafeAreaView edges={['bottom']}>
              {/* No grabber: a transparent Modal has no drag gesture, so a handle would promise a
                  swipe-to-dismiss that does nothing. Tap-outside is the dismiss. */}
              {step === 'reason' ? (
                <>
                  <Text style={styles.title}>What put you off?</Text>
                  <Text style={styles.subtitle} numberOfLines={1}>{mealName}</Text>
                  <View style={styles.chips}>
                    {DISLIKE_REASONS.map(r => (
                      <TouchableOpacity key={r.key} style={styles.chip} onPress={() => choose(r.key)} activeOpacity={0.7}>
                        <Text style={styles.chipText}>{r.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.title}>Was it something in it?</Text>
                  <Text style={styles.subtitle}>Tap anything you didn't like — or skip.</Text>
                  <ScrollView style={styles.culpritScroll} showsVerticalScrollIndicator={false}>
                    <View style={styles.chips}>
                      {ingredients.map(name => {
                        const on = picked.includes(name)
                        return (
                          <TouchableOpacity
                            key={name}
                            style={[styles.ingChip, on && styles.ingChipOn]}
                            onPress={() => toggle(name)}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.ingChipText, on && styles.ingChipTextOn]}>{name}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </ScrollView>
                  <TouchableOpacity style={styles.primary} onPress={finishCulprit} activeOpacity={0.85}>
                    {/* One button, two meanings — "Skip" when nothing is picked. A separate skip
                        control would be a second CTA for the same moment. */}
                    <Text style={styles.primaryText}>{picked.length > 0 ? 'Done' : 'Skip'}</Text>
                  </TouchableOpacity>
                </>
              )}
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </SafeAreaProvider>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  // paddingTop 28 = the old 10 + the removed grabber's 4px bar and 14px gap, so the title doesn't move.
  sheet: { backgroundColor: '#1A1A1A', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 8 },
  // textWhite, not text: COLORS.text is #000000 for WHITE cards, and this sheet is #1A1A1A.
  title: { color: COLORS.textWhite, fontSize: 20, fontWeight: '700' },
  subtitle: { color: COLORS.textMuted, fontSize: 13, marginTop: 4, marginBottom: 16 },
  chips: { gap: 10, flexDirection: 'row', flexWrap: 'wrap' },
  chip: { width: '100%', backgroundColor: '#111111', borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16 },
  chipText: { color: COLORS.textWhite, fontSize: 15, fontWeight: '600' },
  culpritScroll: { maxHeight: 260 },
  ingChip: { backgroundColor: '#111111', borderRadius: 30, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: 'transparent' },
  ingChipOn: { backgroundColor: 'rgba(74,222,128,0.12)', borderColor: COLORS.accent },
  ingChipText: { color: COLORS.textWhite, fontSize: 14, fontWeight: '600' },
  ingChipTextOn: { color: COLORS.accent },
  primary: { backgroundColor: '#FFFFFF', borderRadius: 30, paddingVertical: 16, alignItems: 'center', marginTop: 18 },
  primaryText: { color: '#000000', fontSize: 16, fontWeight: '700' },
})
