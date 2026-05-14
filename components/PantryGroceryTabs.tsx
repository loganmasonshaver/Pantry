import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { COLORS } from '@/constants/colors'

// Sub-tab toggle shared by the Pantry and Grocery screens. Phase 4 of the IA refactor
// merged Grocery into Pantry conceptually (kitchen = "what I have" + "what to buy")
// while keeping each as its own route under the hood — router.replace swaps without
// adding to back stack, so the system-back gesture exits the kitchen surface
// rather than ping-ponging between sub-tabs.
type Props = { active: 'pantry' | 'grocery' }

export default function PantryGroceryTabs({ active }: Props) {
  const go = (target: 'pantry' | 'grocery') => {
    if (target === active) return
    router.replace(target === 'pantry' ? '/(tabs)/pantry' : '/(tabs)/grocery')
  }

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.pill, active === 'pantry' && styles.pillActive]}
        activeOpacity={0.7}
        onPress={() => go('pantry')}
      >
        <Text style={[styles.label, active === 'pantry' && styles.labelActive]}>My Pantry</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.pill, active === 'grocery' && styles.pillActive]}
        activeOpacity={0.7}
        onPress={() => go('grocery')}
      >
        <Text style={[styles.label, active === 'grocery' && styles.labelActive]}>Grocery</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: '#141414',
    borderRadius: 22,
    padding: 3,
    gap: 2,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  pillActive: {
    backgroundColor: COLORS.textWhite,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: -0.1,
  },
  labelActive: {
    color: '#000000',
  },
})
