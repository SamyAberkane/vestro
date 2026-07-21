/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

/**
 * Editorial redesign palette, ported from the "Vestro Redesign" Claude Design mock
 * (oklch values converted to sRGB hex).
 */
export const VestroColors = {
  background: '#F9F5EB',
  ink: '#1E1A13',
  muted: '#686357',
  border: '#D2CDC3',
  surface: '#FEFBF6',
  accent: '#906754',
  frame: '#3F4A38',
  buttonText: '#FBF8F1',
  tints: {
    Hauts: '#D6E2D6',
    Bas: '#E2DED5',
    Chaussures: '#D9D4C9',
    Accessoires: '#F3D7CB',
  } as Record<string, string>,
};

export const VestroCategories = ['Hauts', 'Bas', 'Chaussures', 'Accessoires'] as const;

export const VestroPalette: { label: string; hex: string }[] = [
  { label: 'Blanc', hex: '#FFFFFF' },
  { label: 'Noir', hex: '#111111' },
  { label: 'Rouge', hex: '#DC2626' },
  { label: 'Bleu', hex: '#2563EB' },
  { label: 'Beige', hex: '#E3C9A0' },
  { label: 'Vert', hex: '#16A34A' },
  { label: 'Gris', hex: '#9CA3AF' },
  { label: 'Marron', hex: '#7B4B29' },
  { label: 'Jaune', hex: '#EAB308' },
];

export const VestroFonts = {
  serifMedium: 'PlayfairDisplay_500Medium',
  serifMediumItalic: 'PlayfairDisplay_500Medium_Italic',
  serifSemiBold: 'PlayfairDisplay_600SemiBold',
  serifSemiBoldItalic: 'PlayfairDisplay_600SemiBold_Italic',
  sans: 'Archivo_400Regular',
  sansMedium: 'Archivo_500Medium',
  sansSemiBold: 'Archivo_600SemiBold',
  sansBold: 'Archivo_700Bold',
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
