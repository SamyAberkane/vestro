import { useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { useAppTheme } from '@/theme/context';

type Slide = {
  icon: string;
  titleKey: 'onboarding.slide1Title' | 'onboarding.slide2Title' | 'onboarding.slide3Title';
  descKey: 'onboarding.slide1Desc' | 'onboarding.slide2Desc' | 'onboarding.slide3Desc';
};

const SLIDES: Slide[] = [
  { icon: '📸', titleKey: 'onboarding.slide1Title', descKey: 'onboarding.slide1Desc' },
  { icon: '🖼️', titleKey: 'onboarding.slide2Title', descKey: 'onboarding.slide2Desc' },
  { icon: '✨', titleKey: 'onboarding.slide3Title', descKey: 'onboarding.slide3Desc' },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  function handleScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    setIndex(Math.min(Math.max(next, 0), SLIDES.length - 1));
  }

  function goNext() {
    if (isLast) {
      onDone();
      return;
    }
    scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
    setIndex(index + 1);
  }

  return (
    <View style={styles.overlay}>
      <TouchableOpacity
        style={[styles.skip, { top: insets.top + 12 }]}
        onPress={onDone}
        hitSlop={10}
      >
        <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
      </TouchableOpacity>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
      >
        {SLIDES.map((slide) => (
          <View key={slide.titleKey} style={[styles.slide, { width }]}>
            <View style={styles.iconBadge}>
              <Text style={styles.icon}>{slide.icon}</Text>
            </View>
            <Text style={styles.title}>{t(slide.titleKey)}</Text>
            <Text style={styles.desc}>{t(slide.descKey)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.dots}>
          {SLIDES.map((slide, dotIndex) => (
            <View
              key={slide.titleKey}
              style={[styles.dot, dotIndex === index && styles.dotActive]}
            />
          ))}
        </View>

        <TouchableOpacity style={styles.ctaButton} onPress={goNext}>
          <Text style={styles.ctaText}>{isLast ? t('onboarding.start') : t('onboarding.next')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: VestroColors.background,
    zIndex: 100,
  },
  skip: {
    position: 'absolute',
    right: 20,
    zIndex: 1,
  },
  skipText: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  iconBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: VestroColors.surface,
    borderWidth: 1,
    borderColor: VestroColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 40,
  },
  title: {
    marginTop: 28,
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 26,
    color: VestroColors.ink,
    textAlign: 'center',
  },
  desc: {
    marginTop: 12,
    fontFamily: VestroFonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: VestroColors.muted,
    textAlign: 'center',
    maxWidth: 300,
  },
  footer: {
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: VestroColors.border,
  },
  dotActive: {
    width: 18,
    backgroundColor: VestroColors.ink,
  },
  ctaButton: {
    marginTop: 22,
    width: '100%',
    height: 52,
    backgroundColor: VestroColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: VestroColors.buttonText,
  },
});
