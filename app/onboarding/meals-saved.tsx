import { useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  Animated,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Image,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Bookmark, Home, UtensilsCrossed, ShoppingCart, User } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const { height: H } = Dimensions.get('window')
const TEAL = '#4ADE80'

// Minimal data map for saving to DB — mirrors SWIPE_MEALS in onboarding/index.tsx
const SWIPE_MEAL_DATA: Record<string, { calories: number; protein: number; prepTime: number }> = {
  'Smash Burger':         { calories: 510, protein: 42, prepTime: 15 },
  'Chicken Caesar Wrap':  { calories: 460, protein: 44, prepTime: 15 },
  'Beef Tacos':           { calories: 460, protein: 38, prepTime: 20 },
  'Teriyaki Salmon Bowl': { calories: 520, protein: 44, prepTime: 20 },
  'Shrimp Fried Rice':    { calories: 480, protein: 32, prepTime: 25 },
  'Chicken Tikka Masala': { calories: 520, protein: 40, prepTime: 30 },
  'Beef and Broccoli':    { calories: 430, protein: 36, prepTime: 20 },
  'Korean BBQ Bowl':      { calories: 490, protein: 38, prepTime: 25 },
}

type MealItem = { name: string; image: string | null }

type CardAnim = {
  translateY: Animated.Value
  scale: Animated.Value
  opacity: Animated.Value
}

function makeCardAnim(): CardAnim {
  return {
    translateY: new Animated.Value(0),
    scale: new Animated.Value(1),
    opacity: new Animated.Value(1),
  }
}

export default function MealsSavedScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [meals, setMeals] = useState<MealItem[]>([])
  const [done, setDone] = useState(false)

  const cardAnims = useRef<CardAnim[]>([
    makeCardAnim(), makeCardAnim(), makeCardAnim(),
  ]).current

  const bookmarkScale = useRef(new Animated.Value(1)).current
  const buttonOpacity = useRef(new Animated.Value(0)).current
  const titleOpacity = useRef(new Animated.Value(0)).current

  const TRAVEL = H * 0.57

  // Load swiped meal names + their cached images
  useEffect(() => {
    ;(async () => {
      try {
        // Load names
        let names: string[] = []
        const swiped = await AsyncStorage.getItem('onboarding_swiped_meals')
        if (swiped) {
          const parsed: string[] = JSON.parse(swiped)
          if (parsed.length > 0) names = parsed.slice(0, 3)
        }
        if (names.length === 0) {
          const raw = await AsyncStorage.getItem('pantry_daily_meals_cookNow')
          if (raw) {
            const { meals: m } = JSON.parse(raw)
            names = (m as any[]).slice(0, 3).map((x: any) => x.name)
          }
        }

        // Load images from local cache
        const imgRaw = await AsyncStorage.getItem('pantry_image_urls_v1')
        const imgCache: Record<string, string> = imgRaw ? JSON.parse(imgRaw) : {}

        setMeals(names.map(name => ({ name, image: imgCache[name] ?? null })))

        // Save swiped meals to DB (fire-and-forget)
        if (user && names.length > 0) {
          saveMealsToDB(names, imgCache)
        }
      } catch {}
    })()
  }, [user])

  const saveMealsToDB = async (names: string[], imgCache: Record<string, string>) => {
    for (const name of names) {
      const data = SWIPE_MEAL_DATA[name]
      if (!data) continue
      try {
        await supabase.rpc('insert_saved_meal', {
          p_user_id: user!.id,
          p_name: name,
          p_calories: data.calories,
          p_protein: data.protein,
          p_carbs: 0,
          p_fat: 0,
          p_prep_time: data.prepTime,
          p_ingredients: [],
          p_steps: [],
          p_image_url: imgCache[name] ?? null,
        })
      } catch {}
    }
  }

  useEffect(() => {
    if (meals.length === 0) return

    const count = meals.length

    Animated.timing(titleOpacity, {
      toValue: 1, duration: 400, useNativeDriver: true,
    }).start()

    const flyCard = (i: number, delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(cardAnims[i].translateY, {
            toValue: TRAVEL, duration: 580,
            useNativeDriver: true,
          }),
          Animated.timing(cardAnims[i].scale, {
            toValue: 0.04, duration: 540,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.delay(300),
            Animated.timing(cardAnims[i].opacity, {
              toValue: 0, duration: 230,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ])

    const bounceIcon = (delay: number) =>
      Animated.sequence([
        Animated.delay(delay + 550),
        Animated.sequence([
          Animated.timing(bookmarkScale, { toValue: 1.6, duration: 110, useNativeDriver: true }),
          Animated.spring(bookmarkScale, { toValue: 1, friction: 4, useNativeDriver: true }),
        ]),
      ])

    const allAnims = [
      ...Array.from({ length: count }, (_, i) => flyCard(i, i * 430)),
      ...Array.from({ length: count }, (_, i) => bounceIcon(i * 430)),
    ]

    Animated.parallel(allAnims).start(() => {
      Animated.sequence([
        Animated.timing(bookmarkScale, { toValue: 1.4, duration: 180, useNativeDriver: true }),
        Animated.spring(bookmarkScale, { toValue: 1, friction: 4, useNativeDriver: true }),
      ]).start()
      Animated.timing(buttonOpacity, {
        toValue: 1, duration: 500, delay: 250, useNativeDriver: true,
      }).start()
      setDone(true)
    })
  }, [meals])

  const tabBarHeight = 60 + (insets.bottom || 20)

  return (
    <SafeAreaView style={s.safe} edges={['top']}>

      {/* Content: title + floating cards */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 24 }}>
        <Animated.View style={{ opacity: titleOpacity, alignItems: 'center' }}>
          <Text style={s.title}>Saved to your collection</Text>
          <Text style={s.sub}>Watch them land in Saved</Text>
        </Animated.View>

        {/* Card stack */}
        <View style={s.cardsWrap}>
          {meals.map(({ name, image }, i) => (
            <Animated.View
              key={i}
              style={[
                s.card,
                {
                  transform: [
                    { translateY: cardAnims[i].translateY },
                    { scale: cardAnims[i].scale },
                  ],
                  opacity: cardAnims[i].opacity,
                  zIndex: meals.length - i,
                  top: i * 14,
                },
              ]}
            >
              {image
                ? <Image source={{ uri: image }} style={s.cardImage} resizeMode="cover" />
                : <View style={[s.cardImage, { backgroundColor: '#2A2A2A' }]} />
              }
              <Text style={s.cardText} numberOfLines={1}>{name}</Text>
            </Animated.View>
          ))}
        </View>
      </View>

      {/* CTA — fades in above the tab bar */}
      <Animated.View style={[s.cta, { opacity: buttonOpacity, paddingBottom: tabBarHeight + 12 }]}>
        <TouchableOpacity
          style={s.pill}
          activeOpacity={0.85}
          onPress={() => router.replace('/(tabs)/saved')}
        >
          <Text style={s.pillText}>View saved meals</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.skipBtn}
          activeOpacity={0.7}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={s.skipText}>Go to home</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Fake tab bar — pixel-accurate replica, Saved tab active */}
      <View style={[s.tabBar, { paddingBottom: insets.bottom || 20 }]}>
        <View style={s.tabItem}><Home size={20} stroke="#333" strokeWidth={1.8} /></View>
        <View style={s.tabItem}><UtensilsCrossed size={20} stroke="#333" strokeWidth={1.8} /></View>
        <View style={s.tabItem}>
          <Animated.View style={{ transform: [{ scale: bookmarkScale }] }}>
            <Bookmark
              size={22}
              stroke={done ? TEAL : '#888888'}
              fill={done ? TEAL : 'transparent'}
              strokeWidth={1.8}
            />
          </Animated.View>
        </View>
        <View style={s.tabItem}><ShoppingCart size={20} stroke="#333" strokeWidth={1.8} /></View>
        <View style={s.tabItem}><User size={20} stroke="#333" strokeWidth={1.8} /></View>
      </View>

    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },

  cardsWrap: {
    width: '100%',
    height: 80,
    position: 'relative',
    alignItems: 'center',
  },
  card: {
    position: 'absolute',
    width: '100%',
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardImage: {
    width: 48,
    height: 48,
    borderRadius: 10,
  },
  cardText: {
    fontSize: 16, fontWeight: '600', color: '#FFFFFF', flex: 1,
  },

  title: {
    fontSize: 26, fontWeight: '800', color: '#FFFFFF',
    letterSpacing: -0.5, textAlign: 'center',
  },
  sub: {
    fontSize: 15, color: '#888888', textAlign: 'center', marginTop: 6,
  },

  cta: {
    paddingHorizontal: 24,
    gap: 8,
  },
  pill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingVertical: 18,
    alignItems: 'center',
  },
  pillText: { fontSize: 16, fontWeight: '700', color: '#000000' },
  skipBtn: { alignItems: 'center', paddingVertical: 10 },
  skipText: { fontSize: 14, color: '#888888', fontWeight: '500' },

  tabBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: '#000000',
    borderTopWidth: 0.5,
    borderTopColor: '#1A1A1A',
    flexDirection: 'row',
    paddingTop: 12,
  },
  tabItem: {
    flex: 1, alignItems: 'center', justifyContent: 'center', height: 44,
  },
})
