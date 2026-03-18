import { Tabs } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { COLORS } from '@/constants/colors'
import {
  Home,
  Package,
  Bookmark,
  ShoppingCart,
  User,
} from 'lucide-react-native'

type TabIconProps = {
  Icon: React.ElementType
  focused: boolean
  size?: number
}

function TabIcon({ Icon, focused, size = 22 }: TabIconProps) {
  return (
    <View style={[styles.iconWrapper, focused && styles.iconWrapperActive]}>
      <Icon
        size={size}
        stroke={focused ? COLORS.textWhite : COLORS.tabInactive}
        strokeWidth={focused ? 2.2 : 1.8}
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
            <TabIcon Icon={Package} focused={focused} />
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
      <Tabs.Screen
        name="grocery"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon Icon={ShoppingCart} focused={focused} />
          ),
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
    backgroundColor: COLORS.tabBar,
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
