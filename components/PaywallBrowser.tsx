import { useState, useRef, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { X, Scan, ShoppingBasket, BarChart3, Sparkles } from 'lucide-react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSuperwall } from 'expo-superwall'
import { trackPaywallViewed } from '../lib/analytics'

const TEAL = '#4ADE80'

type Props = {
  visible: boolean
  onClose: () => void
  source?: 'regen_limit' | 'meal_save_limit' | 'scan_limit' | 'browse'
}

const FEATURES = [
  { Icon: Sparkles, title: 'Unlimited AI Meal Plans', desc: 'Fresh personalized meals every day — never see the same suggestion twice.' },
  { Icon: Scan, title: 'Unlimited AI Scans', desc: 'Scan your pantry, receipts, and food photos as many times as you want.' },
  { Icon: BarChart3, title: 'Full Nutrition History', desc: 'Unlimited saved meals and complete macro history — no 30-day cutoff.' },
]

export default function PaywallBrowser({ visible, onClose, source = 'browse' }: Props) {
  const { registerPlacement } = useSuperwall()
  const [selectedPlan, setSelectedPlan] = useState<'annual' | 'monthly'>('annual')
  const fadeAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      trackPaywallViewed(source as any)
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start()
    } else {
      fadeAnim.setValue(0)
    }
  }, [visible])

  const handleStartTrial = async () => {
    try {
      await registerPlacement('usage_paywall')
    } catch {}
    onClose()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={s.root}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          {/* Close */}
          <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <X size={22} stroke="#888" strokeWidth={2} />
          </TouchableOpacity>

          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} bounces={false}>
            {/* Icon */}
            <View style={s.heroIcon}>
              <Sparkles size={32} stroke="#000" strokeWidth={2} />
            </View>

            {/* Headline */}
            <Text style={s.headline}>
              Unlock the{'\n'}<Text style={s.greenText}>Smarter</Text> Way to Eat.
            </Text>

            {/* Trial badge */}
            <View style={s.trialBadge}>
              <Text style={s.trialBadgeText}>3-DAY FREE TRIAL · CANCEL ANYTIME</Text>
            </View>

            {/* Features */}
            <View style={s.features}>
              {FEATURES.map((f, i) => (
                <View key={i} style={s.featureRow}>
                  <View style={s.featureIcon}>
                    <f.Icon size={20} stroke={TEAL} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.featureTitle}>{f.title}</Text>
                    <Text style={s.featureDesc}>{f.desc}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Pricing */}
            <View style={s.pricing}>
              {/* Annual */}
              <TouchableOpacity
                style={[s.planCard, selectedPlan === 'annual' && s.planActive]}
                onPress={() => setSelectedPlan('annual')}
                activeOpacity={0.8}
              >
                <View style={s.bestBadge}><Text style={s.bestBadgeText}>BEST VALUE</Text></View>
                <View style={s.planInner}>
                  <View>
                    <Text style={s.planName}>Annual Access</Text>
                    <Text style={s.planSub}>Just $2.50/month</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.planPrice}>$29.99<Text style={s.planPer}>/yr</Text></Text>
                    <Text style={s.saveText}>Save 75%</Text>
                  </View>
                </View>
              </TouchableOpacity>

              {/* Monthly */}
              <TouchableOpacity
                style={[s.planCard, selectedPlan === 'monthly' && s.planActive, selectedPlan !== 'monthly' && { opacity: 0.6 }]}
                onPress={() => setSelectedPlan('monthly')}
                activeOpacity={0.8}
              >
                <View style={s.planInner}>
                  <View>
                    <Text style={s.planName}>Monthly</Text>
                    <Text style={s.planSub}>Flexible access</Text>
                  </View>
                  <Text style={s.planPrice}>$9.99<Text style={s.planPer}>/mo</Text></Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* Fine print */}
            <Text style={s.finePrint}>
              After trial, your subscription will automatically renew. Cancel at least 24 hours before your trial or current period ends.
            </Text>

            <View style={s.footerLinks}>
              <TouchableOpacity activeOpacity={0.7}><Text style={s.footerLink}>Restore Purchase</Text></TouchableOpacity>
              <Text style={s.footerDot}>·</Text>
              <TouchableOpacity activeOpacity={0.7}><Text style={s.footerLink}>Privacy Policy</Text></TouchableOpacity>
              <Text style={s.footerDot}>·</Text>
              <TouchableOpacity activeOpacity={0.7}><Text style={s.footerLink}>Terms</Text></TouchableOpacity>
            </View>

            <View style={{ height: 120 }} />
          </ScrollView>

          {/* Fixed CTA */}
          <LinearGradient
            colors={['transparent', '#000000CC', '#000000']}
            style={s.bottomGradient}
          >
            <TouchableOpacity style={s.ctaButton} onPress={handleStartTrial} activeOpacity={0.9}>
              <Text style={s.ctaText}>Start 3-Day Free Trial</Text>
            </TouchableOpacity>
            <Text style={s.ctaSubtext}>No commitment. Cancel before Day 3 to pay nothing.</Text>
          </LinearGradient>
        </SafeAreaView>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  closeBtn: {
    position: 'absolute', top: 56, right: 20, zIndex: 10,
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#1A1A1A',
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { paddingHorizontal: 24, paddingTop: 70, alignItems: 'center' },
  heroIcon: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: TEAL,
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  headline: {
    fontSize: 34, fontWeight: '800', color: '#FFF', letterSpacing: -0.8,
    lineHeight: 40, textAlign: 'center', marginBottom: 20,
  },
  greenText: { color: TEAL },
  trialBadge: {
    backgroundColor: 'rgba(74,222,128,0.12)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)',
    paddingHorizontal: 16, paddingVertical: 8, marginBottom: 32,
  },
  trialBadgeText: { fontSize: 12, fontWeight: '700', color: TEAL, letterSpacing: 1 },
  features: { gap: 12, width: '100%', marginBottom: 32 },
  featureRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    backgroundColor: '#111', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#1F1F1F',
  },
  featureIcon: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(74,222,128,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  featureTitle: { fontSize: 17, fontWeight: '700', color: '#FFF', marginBottom: 4 },
  featureDesc: { fontSize: 14, color: '#888', lineHeight: 20 },
  pricing: { gap: 12, width: '100%', marginBottom: 20 },
  planCard: {
    backgroundColor: '#111', borderRadius: 20, padding: 20,
    borderWidth: 2, borderColor: '#222',
  },
  planActive: { borderColor: TEAL },
  bestBadge: {
    alignSelf: 'flex-start', backgroundColor: TEAL, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 4, marginBottom: 10,
  },
  bestBadgeText: { fontSize: 10, fontWeight: '800', color: '#000', letterSpacing: 1 },
  planInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planName: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  planSub: { fontSize: 13, color: '#888', marginTop: 2 },
  planPrice: { fontSize: 22, fontWeight: '800', color: '#FFF' },
  planPer: { fontSize: 13, fontWeight: '400', color: '#888' },
  saveText: { fontSize: 12, fontWeight: '700', color: TEAL, marginTop: 2 },
  finePrint: { fontSize: 11, color: '#555', textAlign: 'center', lineHeight: 16, marginBottom: 16, paddingHorizontal: 8 },
  footerLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  footerLink: { fontSize: 11, fontWeight: '600', color: '#555', textTransform: 'uppercase', letterSpacing: 1 },
  footerDot: { fontSize: 11, color: '#333' },
  bottomGradient: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 24, paddingTop: 40, paddingBottom: 40, alignItems: 'center',
  },
  ctaButton: {
    backgroundColor: '#FFF', borderRadius: 30, paddingVertical: 18,
    width: '100%', alignItems: 'center',
  },
  ctaText: { fontSize: 17, fontWeight: '800', color: '#000', letterSpacing: 0.5 },
  ctaSubtext: { fontSize: 11, color: '#777', marginTop: 8 },
})
