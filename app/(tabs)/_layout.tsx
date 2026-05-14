import { Tabs } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { COLORS } from '@/constants/colors'
import {
  Home,
  UtensilsCrossed,
  Bookmark,
  User,
} from 'lucide-react-native'

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
        strokeWidth={1.8}
      />
    </View>
  )
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: '#AAAAAA',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon Icon={Home} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="pantry"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon Icon={UtensilsCrossed} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
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
    backgroundColor: COLORS.tabActive,
  },
})
