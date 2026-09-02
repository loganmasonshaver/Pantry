import { Tabs } from 'expo-router'
import { useEffect } from 'react'
import { View, StyleSheet, AppState } from 'react-native'
import * as Haptics from 'expo-haptics'
import { COLORS } from '@/constants/colors'
import { useAuth } from '@/context/AuthContext'
import { prefetchDiscover } from '@/lib/discoverFeed'
import { prefetchPantryNames } from '@/lib/pantryPrefetch'
import {
  Home,
  UtensilsCrossed,
  Compass,
  Bookmark,
  User,
} from 'lucide-react-native'

// Light selection tick on tab change — discrete selection feedback, the iOS-native feel.
// selectionAsync is the lightest haptic and is meant for exactly this kind of change;
// never fire heavier impacts (or anything on scroll) from a tab bar or it becomes noise.
const tabPressHaptic = { tabPress: () => { Haptics.selectionAsync() } }

type TabIconProps = {
  Icon: React.ElementType
  focused: boolean
  size?: number
}

function TabIcon({ Icon, focused, size = 20 }: TabIconProps) {
  return (
    <View style={[styles.iconWrapper, focused && styles.iconWrapperActive]}>
      <Icon
        size={size}
        stroke={focused ? COLORS.textWhite : COLORS.tabInactive}
        // Heavier stroke on the active tab so selection reads by WEIGHT, not color alone
        // (lucide is outline-only, so stroke weight is our "filled" equivalent).
        strokeWidth={focused ? 2.4 : 1.8}
      />
    </View>
  )
}

export default function TabLayout() {
  const { user } = useAuth()

  // Warm the Discover cache from here rather than from inside the Discover screen, because that
  // screen isn't mounted until it's first opened — nothing in it can run ahead of the user. This
  // layout mounts once with the tab bar, so by the time anyone taps Compass the cache holds
  // today's feed and the tab paints instantly instead of starting a 2-3s fetch on arrival.
  // Re-warmed on foreground: the trending cron runs overnight, so an app resumed the next morning
  // is the exact case where the cached day is stale.
  useEffect(() => {
    if (!user) return
    prefetchDiscover(user.id)
    // Home's meal generation was gated on Home's OWN pantry read, so nothing could start until
    // that screen had mounted, rendered and completed a round trip. Starting the same read here —
    // where the tab bar mounts, before any screen does — takes that hop off the critical path.
    prefetchPantryNames(user.id)
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') prefetchDiscover(user.id)
    })
    return () => sub.remove()
  }, [user])

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false, // icon-only bar — active state is conveyed by the pill background, not text
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: '#AAAAAA',
        // 'none' is load-bearing, not a downgrade. Any animation makes BottomTabView drive
        // react-native-screens' `activityState` (what attaches RNSScreen to the UIKit hierarchy)
        // through a native-driver interpolation, so a UI-thread/JS desync leaves the incoming tab
        // focused and rendered in React but detached natively — the intermittent black screen.
        // A literal 0/2 commits atomically with the tree. See the commit for the 9 excluded causes.
        animation: 'none',
      }}
    >
      <Tabs.Screen
        name="index"
        listeners={tabPressHaptic}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon Icon={Home} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="pantry"
        listeners={tabPressHaptic}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon Icon={UtensilsCrossed} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        listeners={tabPressHaptic}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon Icon={Compass} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        listeners={tabPressHaptic}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon Icon={Bookmark} focused={focused} />
          ),
        }}
      />
      {/* Grocery is reachable only via the sub-tab toggle on the Pantry screen
          (Phase 4 of the IA refactor). href: null hides it from the bottom bar
          while keeping the route navigable so router.replace('/grocery') works. */}
      <Tabs.Screen
        name="grocery"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="profile"
        listeners={tabPressHaptic}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon Icon={User} focused={focused} />
          ),
        }}
      />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#000000',
    borderTopWidth: 0,
    elevation: 0,
    height: 80,
    paddingBottom: 16,
    paddingTop: 12,
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapperActive: {
    // Subtle teal pill behind the active icon — a visible surface, not the old #000000
    // (which was invisible on the black bar, leaving color as the only active cue).
    backgroundColor: COLORS.accentDim,
  },
})
