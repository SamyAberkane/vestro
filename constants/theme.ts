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
// Clothing category swatch colors — a physical fabric color reads the same
// regardless of the app's theme, so this stays a single shared table rather
// than being duplicated per palette.
const tints: Record<string, string> = {
  Hauts: '#D6E2D6',
  Bas: '#E2DED5',
  Chaussures: '#D9D4C9',
  Accessoires: '#F3D7CB',
  Robes: '#E5D3DE',
  Montres: '#D3D9E0',
  Bijoux: '#EDE0C8',
  Sacs: '#D7C9BB',
  'Couvre-chefs': '#DCD6E8',
  Lunettes: '#CFE0E8',
};

export const VestroColorsLight = {
  background: '#F9F5EB',
  ink: '#1E1A13',
  muted: '#686357',
  border: '#D2CDC3',
  surface: '#FEFBF6',
  accent: '#906754',
  frame: '#3F4A38',
  buttonText: '#FBF8F1',
  tints,
};

// Night theme: the same editorial palette inverted, so "ink" stays the
// high-contrast text/button-fill color and "buttonText" stays its
// counter-color — every screen that fills a button with `ink` and labels it
// with `buttonText` gets a correct-looking dark-mode button for free.
export const VestroColorsDark = {
  background: '#15120D',
  ink: '#F3ECDD',
  muted: '#9C9382',
  border: '#39332A',
  surface: '#1F1B14',
  accent: '#C9A47E',
  frame: '#4A5940',
  buttonText: '#1E1A13',
  tints,
};

// "Somptueux" third theme — a cosmic blue gradient (deep indigo through
// blue to diamond-cyan, plus a faint star scatter — see ScreenBackground)
// rather than a flat fill, the user asked for as an alternative to plain
// light/dark, independent of system light/dark and only ever chosen
// explicitly via the theme toggle. `background` stays a flat color (the
// gradient's own darkest stop) as a fallback for anywhere ScreenBackground
// isn't used yet — never literally rendered as the theme's real background.
export const VestroAmethystGradient = ['#070B1F', '#122A5E', '#1FA8C7'] as const;

export const VestroColorsAmethyst = {
  background: '#070B1F',
  ink: '#EAF6FC',
  muted: '#7E93B0',
  border: '#22345A',
  surface: '#152742',
  accent: '#5AC8FA',
  frame: '#24406B',
  buttonText: '#070B1F',
  tints,
};

export type AppColors = typeof VestroColorsLight;

// Fixed (non-reactive) palette for the outfit "board": it always renders as a
// literal white surface — see components/outfit-canvas.tsx — because
// clothing cutouts are photographed on pure white (utils/remove-background.ts)
// and need to sit on it without a color mismatch, in night mode too.
export const VestroColors: AppColors = VestroColorsLight;

export const VestroCategories = [
  'Hauts',
  'Bas',
  'Chaussures',
  'Accessoires',
  'Robes',
  'Montres',
  'Bijoux',
  'Sacs',
  'Couvre-chefs',
  'Lunettes',
] as const;

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
