import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { VestroColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';

const FRAME_SIZE = 168;

// Fake but honest progress: there's no real progress signal from the Gemini
// call (it's a single request/response), so we simulate an approach toward
// PROGRESS_CEILING that slows down the closer it gets — fast at first, never
// quite finishing on its own — and only snap to 100% once the request truly
// resolves. This is the standard "unknown duration" progress bar trick.
const PROGRESS_CEILING = 95;
const PROGRESS_TICK_MS = 120;
const PROGRESS_EASE_FACTOR = 0.035;
const FINISH_TICK_MS = 20;
const FINISH_STEP = 6;
const DONE_HOLD_MS = 700;

type Phase = 'idle' | 'loading' | 'done';

type ProcessingOverlayProps = {
  visible: boolean;
  imageUri?: string;
  /** 1-based index of the photo currently processing, for batch adds. */
  stepIndex?: number;
  /** Total number of photos in the batch. */
  stepCount?: number;
};

function messageKeyForSliceFraction(fraction: number): 'processing.analyzing' | 'processing.removingBackground' | 'processing.finalizing' {
  if (fraction < 30) return 'processing.analyzing';
  if (fraction < 70) return 'processing.removingBackground';
  return 'processing.finalizing';
}

function ScanLine() {
  const translateY = useSharedValue(-FRAME_SIZE / 2);

  useEffect(() => {
    translateY.value = withRepeat(
      withSequence(
        withTiming(FRAME_SIZE / 2, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
        withTiming(-FRAME_SIZE / 2, { duration: 0 })
      ),
      -1
    );
  }, [translateY]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View pointerEvents="none" style={[styles.scanLine, style]} />;
}

function CornerBracket({ corner }: { corner: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' }) {
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[styles.bracket, BRACKET_POSITION[corner], style]} />;
}

const CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const;

function StatusIcon({ done }: { done: boolean }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (done) {
      scale.value = withSequence(
        withTiming(1.3, { duration: 180, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) })
      );
      return;
    }

    scale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
  }, [done, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.iconBadge, style]}>
      <Ionicons name={done ? 'checkmark' : 'cut-outline'} size={20} color={VestroColors.ink} />
    </Animated.View>
  );
}

export function ProcessingOverlay({ visible, imageUri, stepIndex = 1, stepCount = 1 }: ProcessingOverlayProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [lastImageUri, setLastImageUri] = useState<string | undefined>(undefined);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (imageUri) setLastImageUri(imageUri);
  }, [imageUri]);

  useEffect(() => {
    function clearTick() {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    }

    if (visible) {
      hasStartedRef.current = true;
      setPhase('loading');

      const sliceSize = 100 / stepCount;
      const sliceFloor = (stepIndex - 1) * sliceSize;
      const sliceTarget = sliceFloor + sliceSize * (PROGRESS_CEILING / 100);

      setProgress((current) => Math.max(current, sliceFloor));
      clearTick();
      tickRef.current = setInterval(() => {
        setProgress((current) => {
          const base = Math.max(current, sliceFloor);
          return base + (sliceTarget - base) * PROGRESS_EASE_FACTOR;
        });
      }, PROGRESS_TICK_MS);
      return clearTick;
    }

    if (!hasStartedRef.current) return;

    // visible just turned false: the whole batch resolved. Race the display
    // to 100% instead of jump-cutting, then hold briefly on the checkmark.
    clearTick();
    setPhase((current) => (current === 'loading' ? 'done' : current));
    tickRef.current = setInterval(() => {
      setProgress((current) => {
        const next = Math.min(100, current + FINISH_STEP);
        if (next >= 100 && tickRef.current) {
          clearInterval(tickRef.current);
          tickRef.current = null;
        }
        return next;
      });
    }, FINISH_TICK_MS);

    const hideTimeout = setTimeout(() => setPhase('idle'), DONE_HOLD_MS);
    return () => {
      clearTick();
      clearTimeout(hideTimeout);
    };
  }, [visible, stepIndex, stepCount]);

  if (phase === 'idle') return null;

  const done = phase === 'done';
  const displayProgress = Math.round(progress);
  const sliceSize = 100 / stepCount;
  const sliceFraction = Math.min(100, Math.max(0, (progress - (stepIndex - 1) * sliceSize) / sliceSize * 100));
  const message = done ? t('processing.done') : t(messageKeyForSliceFraction(sliceFraction));

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        {stepCount > 1 && (
          <Text style={styles.stepBadge}>
            {t('processing.stepLabel', { index: Math.min(stepIndex, stepCount), count: stepCount })}
          </Text>
        )}

        <View style={styles.frame}>
          {lastImageUri ? (
            <Image source={{ uri: lastImageUri }} style={styles.frameImage} resizeMode="cover" />
          ) : (
            <View style={styles.framePlaceholder} />
          )}
          <View style={styles.frameTint} pointerEvents="none" />
          {!done && <ScanLine />}
          {CORNERS.map((corner) => (
            <CornerBracket key={corner} corner={corner} />
          ))}
        </View>

        <StatusIcon done={done} />

        <Text style={styles.percentage}>{displayProgress}%</Text>

        <Animated.Text
          key={message}
          entering={FadeIn.duration(220)}
          exiting={FadeOut.duration(160)}
          style={styles.message}
        >
          {message}
        </Animated.Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${displayProgress}%` }]} />
        </View>

        <Text style={styles.subtext}>{t('processing.subtext')}</Text>
      </View>
    </View>
  );
}

const BRACKET_SIZE = 18;
const BRACKET_THICKNESS = 2;
const BAR_TRACK_WIDTH = 120;

const BRACKET_POSITION: Record<string, object> = {
  topLeft: { top: -1, left: -1, borderRightWidth: 0, borderBottomWidth: 0 },
  topRight: { top: -1, right: -1, borderLeftWidth: 0, borderBottomWidth: 0 },
  bottomLeft: { bottom: -1, left: -1, borderRightWidth: 0, borderTopWidth: 0 },
  bottomRight: { bottom: -1, right: -1, borderLeftWidth: 0, borderTopWidth: 0 },
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(30,26,19,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  card: {
    width: 260,
    backgroundColor: VestroColors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: VestroColors.border,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  stepBadge: {
    marginBottom: 14,
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: VestroColors.background,
  },
  frameImage: {
    width: '100%',
    height: '100%',
  },
  framePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: VestroColors.background,
  },
  frameTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(30,26,19,0.22)',
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 2,
    backgroundColor: 'rgba(254,251,246,0.85)',
  },
  bracket: {
    position: 'absolute',
    width: BRACKET_SIZE,
    height: BRACKET_SIZE,
    borderColor: VestroColors.surface,
    borderWidth: BRACKET_THICKNESS,
  },
  iconBadge: {
    marginTop: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VestroColors.background,
  },
  percentage: {
    marginTop: 12,
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 30,
    color: VestroColors.ink,
  },
  message: {
    marginTop: 6,
    fontFamily: VestroFonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.8,
    color: VestroColors.muted,
    textAlign: 'center',
  },
  progressTrack: {
    marginTop: 14,
    width: BAR_TRACK_WIDTH,
    height: 4,
    borderRadius: 2,
    backgroundColor: VestroColors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: VestroColors.ink,
  },
  subtext: {
    marginTop: 16,
    fontFamily: VestroFonts.sans,
    fontSize: 10,
    lineHeight: 14,
    color: VestroColors.muted,
    textAlign: 'center',
  },
});
