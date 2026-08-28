import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { VestroAmethystGradient } from '@/constants/theme';
import { useAppTheme } from '@/theme/context';

// Fixed relative positions (not random per render) so the star scatter
// doesn't jump around on every re-render — echoes the dot layout used in
// the theme's design canvas mockup.
const STARS: { left: `${number}%`; top: `${number}%`; size: number; opacity: number }[] = [
  { left: '15%', top: '10%', size: 2, opacity: 0.55 },
  { left: '60%', top: '6%', size: 1.5, opacity: 0.4 },
  { left: '85%', top: '20%', size: 1.5, opacity: 0.35 },
  { left: '30%', top: '28%', size: 1, opacity: 0.4 },
  { left: '75%', top: '42%', size: 1.5, opacity: 0.3 },
  { left: '10%', top: '48%', size: 1, opacity: 0.3 },
  { left: '45%', top: '62%', size: 1.5, opacity: 0.35 },
  { left: '90%', top: '70%', size: 1, opacity: 0.3 },
  { left: '22%', top: '80%', size: 1.5, opacity: 0.3 },
  { left: '65%', top: '88%', size: 1, opacity: 0.35 },
];

type ScreenBackgroundProps = {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

// Fills its container with the current theme's background — a flat color
// for light/dark, or the cosmic gradient (plus a faint star scatter) for
// the amethyst theme. A flat `backgroundColor` can't express a gradient,
// so every screen/modal that used to just set
// `backgroundColor: VestroColors.background` renders through this instead.
export function ScreenBackground({ style, children }: ScreenBackgroundProps) {
  const { scheme, colors } = useAppTheme();

  if (scheme === 'amethyst') {
    return (
      <LinearGradient
        colors={VestroAmethystGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={[styles.fill, style]}
      >
        {STARS.map((star, index) => (
          <View
            key={index}
            pointerEvents="none"
            style={[
              styles.star,
              {
                left: star.left,
                top: star.top,
                width: star.size,
                height: star.size,
                borderRadius: star.size,
                opacity: star.opacity,
              },
            ]}
          />
        ))}
        {children}
      </LinearGradient>
    );
  }

  return <View style={[styles.fill, { backgroundColor: colors.background }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  star: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
  },
});
