import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';

// The native RefreshControl spinner doesn't reliably render on every screen
// (confirmed live on the Dressing grid: pulling down does trigger a real
// reload, but nothing visible ever appears) — this is a fully custom,
// always-visible stand-in that only depends on the `visible` prop the
// caller already controls, not on whatever native rendering quirk is
// swallowing the system one.
export function RefreshingBadge({ visible, color }: { visible: boolean; color: string }) {
  const { t } = useI18n();
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      rotation.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1);
    } else {
      rotation.value = 0;
    }
  }, [visible, rotation]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  if (!visible) return null;

  return (
    <View style={styles.row} pointerEvents="none">
      <Animated.View style={iconStyle}>
        <Ionicons name="refresh" size={14} color={color} />
      </Animated.View>
      <Text style={[styles.text, { color }]}>{t('dressing.refreshing')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 14,
  },
  text: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.5,
  },
});
