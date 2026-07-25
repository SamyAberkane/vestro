import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppColors, VestroFonts } from '@/constants/theme';
import { useAppTheme } from '@/theme/context';

const DESTRUCTIVE_RED = '#DC2626';

type ConfirmModalProps = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{title}</Text>
          {message && <Text style={styles.message}>{message}</Text>}

          <Pressable
            style={[styles.confirmButton, destructive && styles.confirmButtonDestructive]}
            onPress={onConfirm}
          >
            <Text style={[styles.confirmText, destructive && styles.confirmTextDestructive]}>
              {confirmLabel}
            </Text>
          </Pressable>

          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(30,26,19,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: VestroColors.surface,
    borderRadius: 4,
    paddingVertical: 24,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  title: {
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 19,
    color: VestroColors.ink,
    textAlign: 'center',
  },
  message: {
    marginTop: 8,
    fontFamily: VestroFonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: VestroColors.muted,
    textAlign: 'center',
  },
  confirmButton: {
    marginTop: 22,
    width: '100%',
    height: 48,
    backgroundColor: VestroColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDestructive: {
    backgroundColor: DESTRUCTIVE_RED,
  },
  confirmText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: VestroColors.buttonText,
  },
  confirmTextDestructive: {
    color: '#FFFFFF',
  },
  cancelButton: {
    marginTop: 14,
  },
  cancelText: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
});
