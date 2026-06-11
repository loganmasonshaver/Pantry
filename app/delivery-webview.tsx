import { useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { WebView } from 'react-native-webview'
import { Image } from 'react-native'
import { ChevronLeft } from 'lucide-react-native'

// In-app browser to Instacart so users can re-order pantry/grocery items without
// leaving Pantry. Plain URL — no affiliate token yet, no SSO. Future: deep-link
// pre-populated cart from grocery list.
const DELIVERY_URL = 'https://www.instacart.com'

export default function DeliveryWebViewScreen() {
  const webViewRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

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
          <ChevronLeft size={26} stroke="#00C9A7" strokeWidth={2} />
        </TouchableOpacity>

        <View style={styles.logoContainer}>
          <Image
            source={require('../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.logoText}>pantry</Text>
        </View>

        {/* Spacer to balance the back button */}
        <View style={styles.headerSpacer} />
      </View>

      {/* ── WebView ── */}
      <View style={styles.webViewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: DELIVERY_URL }}
          style={styles.webView}
          // Restrict navigation to https — don't let the page redirect into custom schemes.
          originWhitelist={['https://*']}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          // Without these the spinner spins forever on a failed/offline load. Clear it
          // and surface the failure instead of leaving the user on a blank overlay.
          onError={() => { setLoading(false); setLoadError(true) }}
          onHttpError={() => setLoading(false)}
        />
        {loading && !loadError && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#00C9A7" />
          </View>
        )}
        {loadError && (
          <View style={styles.loadingOverlay}>
            <Text style={styles.errorText}>Couldn't load delivery. Check your connection and try again.</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#000000',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 26,
    height: 26,
    borderRadius: 6,
  },
  logoText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  headerSpacer: {
    width: 36,
  },

  webViewContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  webView: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#888888',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 22,
  },
})
