import { View, Text, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { COLORS } from '@/constants/colors'

export default function SavedScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Text style={styles.label}>Saved Meals</Text>
        <Text style={styles.sub}>Your bookmarked meals will appear here</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  label: { fontSize: 22, fontWeight: '700', color: COLORS.textWhite },
  sub: { fontSize: 14, color: COLORS.textDim },
})
