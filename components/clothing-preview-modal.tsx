import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlertHost } from '@/components/alert-host';
import { AppColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { StickerImage } from '@/components/sticker-image';
import { useAppTheme } from '@/theme/context';

export type ClothingPreviewItem = {
  id: number;
  name: string;
  image?: string;
  imagePath?: string;
  color?: string;
};

type ClothingPreviewModalProps = {
  item: ClothingPreviewItem | null;
  onClose: () => void;
  onEdit: () => void;
};

const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 900;

export function ClothingPreviewModal({ item, onClose, onEdit }: ClothingPreviewModalProps) {
  const { t } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const translateY = useSharedValue(0);

  // The same modal instance is reused for the next item opened after a swipe
  // dismissal — without this, it would reappear stuck at last drag's offset
  // instead of centered.
  useEffect(() => {
    translateY.value = 0;
  }, [item?.id, translateY]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const past =
        Math.abs(e.translationY) > DISMISS_DISTANCE || Math.abs(e.velocityY) > DISMISS_VELOCITY;
      if (past) {
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0);
      }
    });

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(onClose)();
  });

  const dismissGesture = Gesture.Race(pan, tap);

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0.35, 1 - Math.abs(translateY.value) / 350),
  }));

  if (!item) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.topBar}>
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={VestroColors.buttonText} />
            </Pressable>
          </View>

          <GestureDetector gesture={dismissGesture}>
            <Animated.View style={[styles.imageWrap, dragStyle]}>
              {item.image ? (
                <StickerImage uri={item.image} cacheKey={item.imagePath} containerStyle={styles.imageCard} />
              ) : (
                <View style={[styles.fallback, { backgroundColor: item.color ?? VestroColors.surface }]} />
              )}
            </Animated.View>
          </GestureDetector>

          <View style={styles.bottomBar}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Pressable style={styles.editButton} onPress={onEdit}>
              <Ionicons name="pencil" size={14} color={VestroColors.ink} />
              <Text style={styles.editLabel}>{t('preview.editButton')}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Animated.View>
      <AlertHost />
    </Modal>
  );
}

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,17,12,0.94)',
  },
  safeArea: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  imageWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  imageCard: {
    width: '86%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  fallback: {
    width: '70%',
    aspectRatio: 1,
    borderRadius: 16,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  name: {
    flex: 1,
    marginRight: 12,
    fontFamily: VestroFonts.serifSemiBold,
    fontSize: 17,
    color: VestroColors.buttonText,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: VestroColors.buttonText,
  },
  editLabel: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 13,
    color: VestroColors.ink,
  },
});
