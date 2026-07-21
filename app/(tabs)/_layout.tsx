import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { VestroColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';

export default function TabLayout() {
  const { t } = useI18n();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: VestroColors.ink,
        tabBarInactiveTintColor: VestroColors.muted,
        tabBarStyle: {
          backgroundColor: VestroColors.background,
          borderTopWidth: 1,
          borderTopColor: VestroColors.border,
          height: 88,
          paddingTop: 10,
        },
        tabBarLabelStyle: {
          fontFamily: VestroFonts.sansSemiBold,
          fontSize: 10,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" color={color} size={size - 3} />
          ),
        }}
      />

      <Tabs.Screen
        name="explore"
        options={{
          title: t('tabs.dressing'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="shirt-outline" color={color} size={size - 3} />
          ),
        }}
      />
      <Tabs.Screen
        name="tenues"
        options={{
          title: t('tabs.outfits'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="albums-outline" color={color} size={size - 3} />
          ),
        }}
      />

      <Tabs.Screen
        name="wishlist"
        options={{
          title: t('tabs.wishlist'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="heart-outline" color={color} size={size - 3} />
          ),
        }}
      />
    </Tabs>
  );
}
