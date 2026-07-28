import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { AppColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { useAppTheme } from '@/theme/context';
import { uriToDataUri } from '@/utils/remove-background';

const MIN_CROP_SIZE = 56;
const MAX_VIEWPORT_HEIGHT = 440;
const HANDLE_SIZE = 26;
const HANDLE_HIT_SLOP = 14;

type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
const CORNERS: Corner[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

function CropHandle({
  corner,
  x0,
  y0,
  x1,
  y1,
  gesture,
}: {
  corner: Corner;
  x0: SharedValue<number>;
  y0: SharedValue<number>;
  x1: SharedValue<number>;
  y1: SharedValue<number>;
  gesture: ReturnType<typeof Gesture.Pan>;
}) {
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const isLeft = corner === 'topLeft' || corner === 'bottomLeft';
  const isTop = corner === 'topLeft' || corner === 'topRight';

  const style = useAnimatedStyle(() => ({
    left: (isLeft ? x0.value : x1.value) - HANDLE_SIZE / 2,
    top: (isTop ? y0.value : y1.value) - HANDLE_SIZE / 2,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.handle, style]} hitSlop={HANDLE_HIT_SLOP} />
    </GestureDetector>
  );
}

function CropSurface({
  imageUri,
  displayWidth,
  displayHeight,
  naturalWidth,
  naturalHeight,
  onCancel,
  onConfirm,
}: {
  imageUri: string;
  displayWidth: number;
  displayHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  onCancel: () => void;
  onConfirm: (dataUri: string) => void;
}) {
  const { t } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const [busy, setBusy] = useState(false);

  const x0 = useSharedValue(0);
  const y0 = useSharedValue(0);
  const x1 = useSharedValue(displayWidth);
  const y1 = useSharedValue(displayHeight);

  const startX0 = useSharedValue(0);
  const startY0 = useSharedValue(0);
  const startX1 = useSharedValue(0);
  const startY1 = useSharedValue(0);

  const cornerGesture = (corner: Corner) =>
    Gesture.Pan()
      .onStart(() => {
        startX0.value = x0.value;
        startY0.value = y0.value;
        startX1.value = x1.value;
        startY1.value = y1.value;
      })
      .onUpdate((event) => {
        if (corner === 'topLeft' || corner === 'bottomLeft') {
          x0.value = clamp(startX0.value + event.translationX, 0, x1.value - MIN_CROP_SIZE);
        } else {
          x1.value = clamp(startX1.value + event.translationX, x0.value + MIN_CROP_SIZE, displayWidth);
        }
        if (corner === 'topLeft' || corner === 'topRight') {
          y0.value = clamp(startY0.value + event.translationY, 0, y1.value - MIN_CROP_SIZE);
        } else {
          y1.value = clamp(startY1.value + event.translationY, y0.value + MIN_CROP_SIZE, displayHeight);
        }
      });

  const moveGesture = Gesture.Pan()
    .onStart(() => {
      startX0.value = x0.value;
      startY0.value = y0.value;
      startX1.value = x1.value;
      startY1.value = y1.value;
    })
    .onUpdate((event) => {
      const width = startX1.value - startX0.value;
      const height = startY1.value - startY0.value;
      const dx = clamp(event.translationX, -startX0.value, displayWidth - width - startX0.value);
      const dy = clamp(event.translationY, -startY0.value, displayHeight - height - startY0.value);
      x0.value = startX0.value + dx;
      x1.value = startX1.value + dx;
      y0.value = startY0.value + dy;
      y1.value = startY1.value + dy;
    });

  const rectStyle = useAnimatedStyle(() => ({
    left: x0.value,
    top: y0.value,
    width: x1.value - x0.value,
    height: y1.value - y0.value,
  }));

  const maskTopStyle = useAnimatedStyle(() => ({ height: y0.value }));
  const maskBottomStyle = useAnimatedStyle(() => ({ height: displayHeight - y1.value }));
  const maskLeftStyle = useAnimatedStyle(() => ({ top: y0.value, height: y1.value - y0.value, width: x0.value }));
  const maskRightStyle = useAnimatedStyle(() => ({
    top: y0.value,
    height: y1.value - y0.value,
    left: x1.value,
    width: displayWidth - x1.value,
  }));

  async function handleConfirm() {
    setBusy(true);
    try {
      const scale = naturalWidth / displayWidth;
      // originX/Y and width/height are rounded independently, which can push
      // origin + size 1px past the real image bounds and make the native
      // crop call reject the whole request — clamp everything to be safe.
      const originX = clamp(Math.round(x0.value * scale), 0, naturalWidth - 1);
      const originY = clamp(Math.round(y0.value * scale), 0, naturalHeight - 1);
      const width = clamp(Math.round((x1.value - x0.value) * scale), 1, naturalWidth - originX);
      const height = clamp(Math.round((y1.value - y0.value) * scale), 1, naturalHeight - originY);

      const context = ImageManipulator.manipulate(imageUri);
      context.crop({ originX, originY, width, height });
      const rendered = await context.renderAsync();
      const result = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });

      if (!result.base64) throw new Error('Pas de données base64 renvoyées par le recadrage');
      onConfirm(`data:image/png;base64,${result.base64}`);
    } catch (error) {
      Alert.alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Text style={styles.title}>{t('crop.title')}</Text>
      <Text style={styles.hint}>{t('crop.hint')}</Text>

      <View style={[styles.viewport, { width: displayWidth, height: displayHeight }]}>
        <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />

        <Animated.View style={[styles.mask, styles.maskTop, maskTopStyle]} pointerEvents="none" />
        <Animated.View style={[styles.mask, styles.maskBottom, maskBottomStyle]} pointerEvents="none" />
        <Animated.View style={[styles.mask, maskLeftStyle]} pointerEvents="none" />
        <Animated.View style={[styles.mask, maskRightStyle]} pointerEvents="none" />

        <GestureDetector gesture={moveGesture}>
          <Animated.View style={[styles.rect, rectStyle]} />
        </GestureDetector>

        {CORNERS.map((corner) => (
          <CropHandle
            key={corner}
            corner={corner}
            x0={x0}
            y0={y0}
            x1={x1}
            y1={y1}
            gesture={cornerGesture(corner)}
          />
        ))}
      </View>

      <View style={styles.buttonsRow}>
        <Pressable style={styles.cancelButton} onPress={onCancel} disabled={busy}>
          <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
        </Pressable>
        <Pressable style={styles.confirmButton} onPress={handleConfirm} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={VestroColors.buttonText} />
          ) : (
            <Text style={styles.confirmButtonText}>{t('crop.confirmButton')}</Text>
          )}
        </Pressable>
      </View>
    </>
  );
}

export function CropModal({
  visible,
  imageUri,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  imageUri?: string;
  onCancel: () => void;
  onConfirm: (dataUri: string) => void;
}) {
  const { t } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const { width: windowWidth } = useWindowDimensions();
  const [resolvedUri, setResolvedUri] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!visible || !imageUri) return;

    let cancelled = false;
    setResolvedUri(null);
    setNaturalSize(null);
    setLoadError(false);

    // expo-image-manipulator's manipulate() only accepts a local file or a
    // base64 data URI, never a remote URL — but an already-saved item's
    // photo is a Supabase Storage signed https:// URL, which it can't fetch.
    // The photo still displayed fine here (plain <Image> handles remote
    // URLs), so the crop looked like it should work right up until hitting
    // "confirm", where the native crop call had nothing valid to read.
    // Resolving to a data URI upfront makes both a fresh local photo and an
    // already-uploaded one equally croppable.
    async function resolve() {
      try {
        const uri = imageUri!.startsWith('http') ? await uriToDataUri(imageUri!) : imageUri!;
        if (cancelled) return;
        setResolvedUri(uri);
        Image.getSize(
          uri,
          (width, height) => {
            if (!cancelled) setNaturalSize({ width, height });
          },
          () => {
            if (!cancelled) setLoadError(true);
          }
        );
      } catch {
        if (!cancelled) setLoadError(true);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [visible, imageUri]);

  if (!visible || !imageUri) return null;

  const maxWidth = Math.min(windowWidth - 48, 400);
  let displayWidth = maxWidth;
  let displayHeight = naturalSize ? (maxWidth * naturalSize.height) / naturalSize.width : maxWidth;
  if (displayHeight > MAX_VIEWPORT_HEIGHT) {
    displayHeight = MAX_VIEWPORT_HEIGHT;
    displayWidth = naturalSize ? (MAX_VIEWPORT_HEIGHT * naturalSize.width) / naturalSize.height : maxWidth;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {loadError && <Text style={styles.hint}>{t('common.errorTitle')}</Text>}

          {!loadError && !(resolvedUri && naturalSize) && (
            <ActivityIndicator color={VestroColors.ink} />
          )}

          {!loadError && resolvedUri && naturalSize && (
            <CropSurface
              key={resolvedUri}
              imageUri={resolvedUri}
              displayWidth={displayWidth}
              displayHeight={displayHeight}
              naturalWidth={naturalSize.width}
              naturalHeight={naturalSize.height}
              onCancel={onCancel}
              onConfirm={onConfirm}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(30,26,19,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    backgroundColor: VestroColors.surface,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 18,
    color: VestroColors.ink,
  },
  hint: {
    marginTop: 4,
    fontFamily: VestroFonts.sans,
    fontSize: 12,
    color: VestroColors.muted,
    textAlign: 'center',
  },
  viewport: {
    marginTop: 16,
    backgroundColor: '#000',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  mask: {
    position: 'absolute',
    left: 0,
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  maskTop: {
    top: 0,
  },
  maskBottom: {
    bottom: 0,
  },
  rect: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: VestroColors.surface,
  },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: VestroColors.surface,
    borderWidth: 2,
    borderColor: VestroColors.accent,
  },
  buttonsRow: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: VestroColors.border,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.ink,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: VestroColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.buttonText,
  },
});
