import { Tabs } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import * as Haptics from 'expo-haptics'
import { COLORS } from '@/constants/colors'
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
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false, // icon-only bar — active state is conveyed by the pill background, not text
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: '#AAAAAA',
        // 'shift' (v7) translates screens horizontally by tab-index distance. Black frames were
        // reported switching between Discover and Saved — tabs 3 and 4, the ADJACENT pair — while
        // every non-adjacent pair Logan tried was fine. Smallest shift distance is the one that
        // breaks, which points at the transition rather than at either screen. 'fade' keeps the
        // polish without the horizontal geometry.
        animation: 'fade',
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
