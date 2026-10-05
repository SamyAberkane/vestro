import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  SharedValue,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

// Must match the expo-splash-screen config in app.json (image, imageWidth,
// backgroundColor) so the hand-off from the native splash to this screen is
// seamless: same crystal, same spot, same size — only the sparkle appears.
const SPLASH_BACKGROUND = '#070B1F';
const CRYSTAL_SIZE = 200;

const ORBIT_RX = 150;
const ORBIT_RY = 42;
const ORBIT_MS = 2600;
// Head of the sparkle first, then its fading tail.
const TRAIL = [0, 1, 2, 3, 4, 5, 6];
const TRAIL_STEP = 0.11; // radians between tail particles

type Layer = 'back' | 'front';

function OrbitParticle({ progress, index, layer }: { progress: SharedValue<number>; index: number; layer: Layer }) {
  const isHead = index === 0;

  const style = useAnimatedStyle(() => {
    const theta = progress.value * Math.PI * 2 - index * TRAIL_STEP;
    const sin = Math.sin(theta);
    // Lower half of the ellipse is "in front" of the crystal; it only ever
    // switches layer at the far left/right, where it's clear of the crystal.
    const visible = layer === 'front' ? sin >= 0 : sin < 0;
    const depth = 0.7 + 0.3 * (sin + 1) / 2;
    const fade = 1 - index / TRAIL.length;
    return {
      opacity: visible ? fade * (0.55 + 0.45 * depth) : 0,
      transform: [
        { translateX: ORBIT_RX * Math.cos(theta) },
        { translateY: ORBIT_RY * sin },
        { scale: depth * (isHead ? 1 : 0.35 + 0.5 * fade) },
        { rotate: `${theta * 0.5}rad` },
      ],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[styles.particle, style]}>
      {isHead ? (
        <>
          <View style={styles.glow} />
          <View style={styles.rayVertical} />
          <View style={styles.rayHorizontal} />
          <View style={styles.core} />
        </>
      ) : (
        <View style={styles.dot} />
      )}
    </Animated.View>
  );
}

function OrbitLayer({ progress, layer }: { progress: SharedValue<number>; layer: Layer }) {
  return (
    <View pointerEvents="none" style={styles.layer}>
      {TRAIL.map((i) => (
        <OrbitParticle key={i} progress={progress} index={i} layer={layer} />
      ))}
    </View>
  );
}

export function LaunchLoader() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: ORBIT_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(progress);
  }, [progress]);

  return (
    <View style={styles.screen}>
      <OrbitLayer progress={progress} layer="back" />
      <Image
        source={require('@/assets/images/splash-icon.png')}
        style={styles.crystal}
        contentFit="contain"
      />
      <OrbitLayer progress={progress} layer="front" />
    </View>
  );
}

const SPARKLE = '#F5FDFF';
const SPARKLE_TINT = '#BEE8F5';

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: SPLASH_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crystal: {
    width: CRYSTAL_SIZE,
    height: CRYSTAL_SIZE,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: SPARKLE_TINT,
    opacity: 0.45,
    shadowColor: SPARKLE_TINT,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  rayVertical: {
    position: 'absolute',
    width: 2,
    height: 26,
    borderRadius: 1,
    backgroundColor: SPARKLE,
  },
  rayHorizontal: {
    position: 'absolute',
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: SPARKLE,
  },
  core: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: SPARKLE,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: SPARKLE_TINT,
    shadowColor: SPARKLE_TINT,
    shadowOpacity: 0.9,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
});
