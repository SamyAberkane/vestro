import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { VestroColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import type { ClothingItem } from '@/types/clothing';

// Auto-plays, no tap required: how long each item stays on screen before the
// next one takes over (or the whole thing dismisses itself on the last one).
const ITEM_HOLD_MS = 1500;

const SPARKLE_COUNT = 8;
const SPARKLE_RADIUS = 78;
const SPARKLE_ANGLES = Array.from(
  { length: SPARKLE_COUNT },
  (_, i) => (i / SPARKLE_COUNT) * Math.PI * 2
);

function Sparkle({ angle, progress }: { angle: number; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { translateX: Math.cos(angle) * SPARKLE_RADIUS * progress.value },
      { translateY: Math.sin(angle) * SPARKLE_RADIUS * progress.value },
      { scale: 1 - progress.value * 0.6 },
    ],
  }));

  return <Animated.View style={[styles.sparkle, style]} />;
}

function RevealMoment({ item }: { item: ClothingItem }) {
  const { tCategory } = useI18n();

  const glowOpacity = useSharedValue(0);
  const glowScale = useSharedValue(0.6);
  const imageOpacity = useSharedValue(0);
  const imageScale = useSharedValue(0.55);
  const sparkleProgress = useSharedValue(0);
  const detailsOpacity = useSharedValue(0);
  const detailsY = useSharedValue(10);

  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    glowOpacity.value = withSequence(
      withTiming(1, { duration: 220 }),
      withDelay(150, withTiming(0, { duration: 500 }))
    );
    glowScale.value = withTiming(1.3, { duration: 650, easing: Easing.out(Easing.quad) });

    imageOpacity.value = withTiming(1, { duration: 220 });
    imageScale.value = withSequence(
      withSpring(1.1, { damping: 9, stiffness: 170 }),
      withSpring(1, { damping: 12, stiffness: 200 })
    );

    sparkleProgress.value = withDelay(80, withTiming(1, { duration: 600, easing: Easing.out(Easing.quad) }));

    detailsOpacity.value = withDelay(280, withTiming(1, { duration: 300 }));
    detailsY.value = withDelay(280, withSpring(0, { damping: 14, stiffness: 160 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));

  const imageStyle = useAnimatedStyle(() => ({
    opacity: imageOpacity.value,
    transform: [{ scale: imageScale.value }],
  }));

  const detailsStyle = useAnimatedStyle(() => ({
    opacity: detailsOpacity.value,
    transform: [{ translateY: detailsY.value }],
  }));

  const tint = item.color ?? VestroColors.tints[item.category] ?? VestroColors.tints.Accessoires;

  return (
    <View style={styles.moment}>
      <View style={styles.stage}>
        <Animated.View style={[styles.glow, { backgroundColor: tint }, glowStyle]} pointerEvents="none" />

        {SPARKLE_ANGLES.map((angle) => (
          <Sparkle key={angle} angle={angle} progress={sparkleProgress} />
        ))}

        <Animated.View style={imageStyle}>
          {item.image ? (
            <Image source={{ uri: item.image }} style={styles.image} resizeMode="contain" />
          ) : (
            <View style={[styles.imageFallback, { backgroundColor: tint }]} />
          )}
        </Animated.View>
      </View>

      <Animated.View style={detailsStyle}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.itemCategory}>{tCategory(item.category)}</Text>
      </Animated.View>
    </View>
  );
}

export function ItemReveal({
  items,
  visible,
  onDone,
}: {
  items: ClothingItem[];
  visible: boolean;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);

  useEffect(() => {
    if (!visible || items.length === 0) return;

    const isLast = index >= items.length - 1;
    const timeout = setTimeout(() => {
      if (isLast) onDone();
      else setIndex((current) => current + 1);
    }, ITEM_HOLD_MS);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, items, index]);

  if (!visible || items.length === 0) return null;

  const item = items[Math.min(index, items.length - 1)];

  return (
    <Pressable style={styles.overlay} onPress={onDone}>
      <Text style={styles.eyebrow}>{t('reveal.newItem')}</Text>
      <RevealMoment key={item.id} item={item} />

      {items.length > 1 && (
        <View style={styles.dots}>
          {items.map((dotItem, dotIndex) => (
            <View key={dotItem.id} style={[styles.dot, dotIndex === index && styles.dotActive]} />
          ))}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(30,26,19,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
  },
  dots: {
    position: 'absolute',
    bottom: '30%',
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(249,245,235,0.35)',
  },
  dotActive: {
    backgroundColor: VestroColors.background,
  },
  eyebrow: {
    position: 'absolute',
    top: '32%',
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: VestroColors.background,
    opacity: 0.85,
  },
  moment: {
    alignItems: 'center',
  },
  stage: {
    width: 190,
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
  },
  sparkle: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: VestroColors.background,
  },
  image: {
    width: 170,
    height: 170,
  },
  imageFallback: {
    width: 140,
    height: 140,
    borderRadius: 16,
  },
  itemName: {
    marginTop: 6,
    maxWidth: 260,
    fontFamily: VestroFonts.serifSemiBold,
    fontSize: 20,
    color: VestroColors.background,
    textAlign: 'center',
  },
  itemCategory: {
    marginTop: 4,
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: VestroColors.background,
    opacity: 0.75,
    textAlign: 'center',
  },
});
