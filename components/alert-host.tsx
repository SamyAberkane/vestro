import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppColors, VestroFonts } from '@/constants/theme';
import { type AlertButton, type AlertState, dismissAlert, subscribeToAlert } from '@/lib/alert';
import { useAppTheme } from '@/theme/context';

const DESTRUCTIVE_RED = '#DC2626';

/**
 * Renders whatever `alert()` (lib/alert.ts) last requested, themed like the
 * rest of Vestro instead of the OS's own grey system dialog. Mounted once in
 * the root layout — every screen just calls `alert(...)`, same signature as
 * React Native's own `Alert.alert`, and this is what actually draws it.
 */
export function AlertHost() {
  const [state, setState] = useState<AlertState | null>(null);
  // Separate from `state`/subscribeToAlert on purpose — a button's onPress
  // often does something that navigates (sign-out after account deletion,
  // etc.), and this alert is frequently shown on top of a screen that's
  // itself a native modal presentation (create-outfit, account — see
  // app/_layout.tsx). Firing onPress the instant a button is tapped, before
  // this native <Modal> has actually finished dismissing, raced that outer
  // screen's own dismissal against this one's and froze the app. `isOpen`
  // gates the native Modal directly; a tap closes it right away and queues
  // the real work in `pendingRef`, which only runs from onDismiss once iOS
  // confirms the modal is fully gone.
  const [isOpen, setIsOpen] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);

  useEffect(
    () =>
      subscribeToAlert((next) => {
        setState(next);
        if (next) setIsOpen(true);
      }),
    []
  );

  function handlePress(button: AlertButton) {
    pendingRef.current = () => {
      dismissAlert();
      button.onPress?.();
    };
    setIsOpen(false);
  }

  function handleDismiss() {
    const action = pendingRef.current;
    pendingRef.current = null;
    action?.();
  }

  const cancelButton = state?.buttons.find((button) => button.style === 'cancel');
  const actionButtons = state?.buttons.filter((button) => button.style !== 'cancel') ?? [];

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      onRequestClose={() => cancelButton && handlePress(cancelButton)}
      onDismiss={handleDismiss}
    >
      {state && (
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>{state.title}</Text>
            {state.message && <Text style={styles.message}>{state.message}</Text>}

            <View style={styles.buttons}>
              {actionButtons.map((button, index) => (
                <Pressable
                  key={index}
                  style={[
                    styles.actionButton,
                    button.style === 'destructive' && styles.actionButtonDestructive,
                  ]}
                  onPress={() => handlePress(button)}
                >
                  <Text
                    style={[
                      styles.actionText,
                      button.style === 'destructive' && styles.actionTextDestructive,
                    ]}
                  >
                    {button.text ?? 'OK'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {cancelButton && (
              <Pressable style={styles.cancelButton} onPress={() => handlePress(cancelButton)}>
                <Text style={styles.cancelText}>{cancelButton.text ?? 'OK'}</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </Modal>
  );
}

const createStyles = (VestroColors: AppColors) =>
  StyleSheet.create({
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
    buttons: {
      marginTop: 22,
      width: '100%',
      gap: 10,
    },
    actionButton: {
      width: '100%',
      height: 48,
      backgroundColor: VestroColors.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionButtonDestructive: {
      backgroundColor: DESTRUCTIVE_RED,
    },
    actionText: {
      fontFamily: VestroFonts.sansSemiBold,
      fontSize: 12,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      color: VestroColors.buttonText,
    },
    actionTextDestructive: {
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
