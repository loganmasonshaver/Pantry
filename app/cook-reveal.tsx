import { useEffect, useRef, useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, Animated, ScrollView, Easing } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'
import { Utensils, X, Sparkles } from 'lucide-react-native'
import { COLORS } from '@/constants/colors'
import { useAuth } from '@/context/AuthContext'
import { usePremium } from '@/context/SuperwallContext'
import { useMealSuggestions } from '@/lib/useMealSuggestions'
import { Shimmer } from '@/components/Shimmer'

// Tinted macro pill — same system as the Discover / Saved cards.
function Pill({ label, tint }: { label: string; tint: 'amber' | 'green' | 'white' }) {
  const t = {
    amber: { bg: 'rgba(245,158,11,0.18)', border: 'rgba(245,158,11,0.3)', color: '#F59E0B' },
    green: { bg: 'rgba(74,222,128,0.18)', border: 'rgba(74,222,128,0.3)', color: '#4ADE80' },
    white: { bg: 'rgba(255,255,255,0.12)', border: 'rgba(255,255,255,0.2)', color: COLORS.textWhite },
  }[tint]
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Text style={[styles.pillText, { color: t.color }]}>{label}</Text>
    </View>
  )
}

// Post-scan payoff screen: generates fresh cook-now meals from the just-updated pantry and
// reveals them with a staggered animation — the "look what you can make right now" moment.
export default function CookReveal() {
  const router = useRouter()
  const { user } = useAuth()
  const { isPremium } = usePremium()
  // enabled=false skips the hook's auto cache-load so we never flash yesterday's meals;
  // retry() force-generates a fresh batch and BYPASSES the 1/day regen cap (a scan earns it).
  // Same 'cookNow' cache as the pantry screen, so Cook Tonight stays in sync afterwards.
  const { meals, loading, error, retry } = useMealSuggestions(user?.id, isPremium, 'cookNow', false)
  const triggeredRef = useRef(false)
  const revealed = meals.slice(0, 3)

  useEffect(() => {
    if (triggeredRef.current || !user?.id) return
    triggeredRef.current = true
    retry() // force a fresh generation from the freshly-scanned pantry
  }, [user?.id])

  // ── Animations ──
  const headerAnim = useRef(new Animated.Value(0)).current
  const cardAnims = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current
  const spin = useRef(new Animated.Value(0)).current
  const animatedRef = useRef(false)

  // Loader spin while generating
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true })
    )
    loop.start()
    return () => loop.stop()
  }, [])

  // Fire the staggered reveal exactly once, when the meals first land.
  useEffect(() => {
    if (revealed.length === 0 || animatedRef.current) return
    animatedRef.current = true
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    Animated.timing(headerAnim, { toValue: 1, duration: 420, useNativeDriver: true }).start()
    Animated.stagger(130, cardAnims.map(a =>
      Animated.spring(a, { toValue: 1, friction: 7, tension: 55, useNativeDriver: true })
    )).start()
  }, [revealed.length])

  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })

  const openMeal = (meal: any) => {
    router.push({ pathname: '/meal/[id]', params: { id: meal.id, mealData: JSON.stringify(meal) } })
  }

  const showLoader = revealed.length === 0 && !error

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Close → back to the pantry screen the scan was launched from */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X size={20} stroke={COLORS.textWhite} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {showLoader ? (
        <View style={styles.loaderWrap}>
          <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
            <Sparkles size={56} stroke={'#4ADE80'} strokeWidth={1.4} />
          </Animated.View>
          <Text style={styles.loaderTitle}>Cooking up meals{'\n'}from your pantry…</Text>
          <Text style={styles.loaderSub}>Finding the tastiest things you can make right now</Text>
        </View>
      ) : error && revealed.length === 0 ? (
        <View style={styles.loaderWrap}>
          <Text style={styles.loaderTitle}>Couldn't generate meals</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { animatedRef.current = false; retry() }}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Animated.View style={[styles.header, {
            opacity: headerAnim,
            transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }]}>
            <Text style={styles.eyebrow}>✨ FROM YOUR PANTRY</Text>
            <Text style={styles.title}>{revealed.length} meals you{'\n'}can make right now</Text>
            <Text style={styles.subtitle}>Built from ingredients you already have</Text>
          </Animated.View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 14 }} showsVerticalScrollIndicator={false}>
            {revealed.map((meal, i) => (
              <Animated.View key={meal.id ?? i} style={{
                opacity: cardAnims[i],
                transform: [{ translateY: cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [34, 0] }) }],
              }}>
                <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={() => openMeal(meal)}>
                  {meal.image ? (
                    <Image source={{ uri: meal.image }} style={styles.cardImage} resizeMode="cover" />
                  ) : (
                    <Shimmer style={styles.cardImage} />
                  )}
                  <LinearGradient colors={['transparent', 'rgba(0,0,0,0.94)']} locations={[0.3, 1]} style={styles.cardGradient} />
                  {!meal.image && (
                    <View style={styles.cardPlaceholderIcon}><Utensils size={26} stroke="#666" strokeWidth={1.4} /></View>
                  )}
                  <View style={styles.cardContent}>
                    <Text style={styles.cardName} numberOfLines={2}>{meal.name}</Text>
                    <View style={styles.cardPillRow}>
                      {meal.prepTime > 0 && <Pill label={`${meal.prepTime}m`} tint="amber" />}
                      {meal.calories > 0 && <Pill label={`${meal.calories} CAL`} tint="white" />}
                      {meal.protein > 0 && <Pill label={`${meal.protein}P`} tint="green" />}
                    </View>
                  </View>
                </TouchableOpacity>
              </Animated.View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.doneBtn} activeOpacity={0.85} onPress={() => router.back()}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  topBar: { flexDirection: 'row', justifyContent: 'flex-start', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A1A1A' },

  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 18 },
  loaderTitle: { fontSize: 22, fontWeight: '800', color: COLORS.textWhite, textAlign: 'center', letterSpacing: -0.3, lineHeight: 28 },
  loaderSub: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 },
  retryBtn: { backgroundColor: '#FFFFFF', borderRadius: 30, paddingHorizontal: 28, paddingVertical: 13 },
  retryText: { color: '#000000', fontWeight: '700', fontSize: 15 },

  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 18 },
  eyebrow: { fontSize: 12, fontWeight: '800', color: '#4ADE80', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.6, lineHeight: 32 },
  subtitle: { fontSize: 14, color: COLORS.textMuted, marginTop: 8 },

  card: { height: 150, borderRadius: 18, overflow: 'hidden', backgroundColor: '#1A1A1A', position: 'relative' },
  cardImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  cardGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '75%' },
  cardPlaceholderIcon: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  cardContent: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14 },
  cardName: { fontSize: 18, fontWeight: '800', color: COLORS.textWhite, letterSpacing: -0.3, lineHeight: 22 },
  cardPillRow: { flexDirection: 'row', gap: 5, marginTop: 9, flexWrap: 'wrap' },

  pill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  pillText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },

  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  doneBtn: { backgroundColor: '#FFFFFF', borderRadius: 30, paddingVertical: 16, alignItems: 'center' },
  doneText: { color: '#000000', fontWeight: '700', fontSize: 16 },
})
