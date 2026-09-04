import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import type { AppColors } from '@/constants/theme';

const TRACK_WIDTH = 51;
const TRACK_HEIGHT = 31;
const KNOB_SIZE = 27;
const KNOB_MARGIN = 2;

// iOS's native Switch can't have its off-state track fill recolored past
// iOS 13 (trackColor.false only tints the outline ring, the fill stays a
// fixed system gray) — on this app's colored themes that reads as a washed
// out blob instead of the app's own off/on colors. This redraws the same
// control from scratch so both states use our actual palette.
export function ToggleSwitch({
  value,
  onValueChange,
  colors,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  colors: AppColors;
}) {
  const progress = useDerivedValue(() => withTiming(value ? 1 : 0, { duration: 150 }), [value]);

  const trackStyle = useAnimatedStyle(
    () => ({
      backgroundColor: interpolateColor(progress.value, [0, 1], [colors.border, colors.ink]),
    }),
    [colors]
  );

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * (TRACK_WIDTH - KNOB_SIZE - KNOB_MARGIN * 2) },
    ],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      hitSlop={8}
      onPress={() => {
        // The native Switch it replaces gives a tap a small haptic click —
        // matches that instead of trading it away for a silent tap.
        if (process.env.EXPO_OS === 'ios') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onValueChange(!value);
      }}
    >
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.knob, knobStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: KNOB_MARGIN,
    justifyContent: 'center',
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
  },
});
