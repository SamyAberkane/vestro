import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AlertHost } from '@/components/alert-host';
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

  // This modal is often shown on a screen that's itself a native modal
  // presentation (e.g. create-outfit — see app/_layout.tsx), and onConfirm
  // often navigates away (delete an outfit, then router.back()). Calling
  // onConfirm/onCancel the instant a button is pressed — before the native
  // <Modal> below has actually finished its own dismiss animation — used to
  // race that outer screen's dismissal against this one's, which is what
  // froze the whole app after confirming a delete. `isOpen` is this
  // component's own gate on the native Modal (separate from the `visible`
  // prop): pressing a button closes it immediately and queues the real
  // callback in `pendingRef`, which only fires from onDismiss once iOS
  // reports the modal is actually, fully gone.
  const [isOpen, setIsOpen] = useState(visible);
  const pendingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (visible) setIsOpen(true);
  }, [visible]);

  function requestClose(action: () => void) {
    pendingRef.current = action;
    setIsOpen(false);
  }

  function handleDismiss() {
    const action = pendingRef.current;
    pendingRef.current = null;
    action?.();
  }

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      onRequestClose={() => requestClose(onCancel)}
      onDismiss={handleDismiss}
    >
      <Pressable style={styles.backdrop} onPress={() => requestClose(onCancel)}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{title}</Text>
          {message && <Text style={styles.message}>{message}</Text>}

          <Pressable
            style={[styles.confirmButton, destructive && styles.confirmButtonDestructive]}
            onPress={() => requestClose(onConfirm)}
          >
            <Text style={[styles.confirmText, destructive && styles.confirmTextDestructive]}>
              {confirmLabel}
            </Text>
          </Pressable>

          <Pressable style={styles.cancelButton} onPress={() => requestClose(onCancel)}>
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
      <AlertHost />
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
