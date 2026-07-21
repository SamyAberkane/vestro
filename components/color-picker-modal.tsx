import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { VestroColors, VestroFonts, VestroPalette } from '@/constants/theme';
import { useI18n } from '@/i18n/context';

type ColorPickerModalProps = {
  visible: boolean;
  title?: string;
  onSelect: (hex: string | undefined) => void;
  onCancel: () => void;
};

export function ColorPickerModal({
  visible,
  title,
  onSelect,
  onCancel,
}: ColorPickerModalProps) {
  const { t, tColor } = useI18n();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{title ?? t('colorPicker.title')}</Text>

          <View style={styles.grid}>
            {VestroPalette.map((swatch) => (
              <TouchableOpacity
                key={swatch.hex}
                style={styles.swatchWrap}
                onPress={() => onSelect(swatch.hex)}
              >
                <View style={[styles.swatch, { backgroundColor: swatch.hex }]} />
                <Text style={styles.swatchLabel}>{tColor(swatch.label)}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={styles.swatchWrap} onPress={() => onSelect(undefined)}>
              <View style={[styles.swatch, styles.noneSwatch]}>
                <View style={styles.noneSwatchLine} />
              </View>
              <Text style={styles.swatchLabel}>{tColor('none')}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const SWATCH_SIZE = 52;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(30,26,19,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: VestroColors.surface,
    borderRadius: 4,
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  title: {
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 19,
    color: VestroColors.ink,
    textAlign: 'center',
  },
  grid: {
    marginTop: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 18,
  },
  swatchWrap: {
    width: 68,
    alignItems: 'center',
  },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: SWATCH_SIZE / 2,
    borderWidth: 1,
    borderColor: VestroColors.border,
  },
  noneSwatch: {
    backgroundColor: VestroColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  noneSwatchLine: {
    width: SWATCH_SIZE * 1.2,
    height: 1,
    backgroundColor: VestroColors.muted,
    transform: [{ rotate: '45deg' }],
  },
  swatchLabel: {
    marginTop: 8,
    fontFamily: VestroFonts.sans,
    fontSize: 11,
    letterSpacing: 0.5,
    color: VestroColors.muted,
    textAlign: 'center',
  },
  cancelButton: {
    marginTop: 22,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
});
