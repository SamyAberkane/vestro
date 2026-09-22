import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AlertHost } from '@/components/alert-host';
import { AppColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { useAppTheme } from '@/theme/context';

type SaveOutfitModalProps = {
  visible: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

export function SaveOutfitModal({ visible, onConfirm, onCancel }: SaveOutfitModalProps) {
  const { t } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const [name, setName] = useState('');

  useEffect(() => {
    if (visible) setName('');
  }, [visible]);

  function confirm() {
    const trimmed = name.trim();
    if (trimmed) onConfirm(trimmed);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.avoider}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>{t('home.outfitNamePrompt')}</Text>

            <TextInput
              value={name}
              onChangeText={setName}
              onSubmitEditing={confirm}
              placeholder={t('createOutfit.namePlaceholder')}
              placeholderTextColor={VestroColors.muted}
              style={styles.input}
              autoFocus
              returnKeyType="done"
            />

            <Pressable
              style={[styles.confirmButton, !name.trim() && styles.confirmButtonDisabled]}
              onPress={confirm}
              disabled={!name.trim()}
            >
              <Text style={styles.confirmText}>{t('createOutfit.save')}</Text>
            </Pressable>

            <Pressable style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
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
  avoider: {
    width: '100%',
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
  input: {
    marginTop: 18,
    width: '100%',
    height: 44,
    borderBottomWidth: 1,
    borderBottomColor: VestroColors.border,
    fontFamily: VestroFonts.serifMedium,
    fontSize: 16,
    color: VestroColors.ink,
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
  confirmButtonDisabled: {
    opacity: 0.4,
  },
  confirmText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: VestroColors.buttonText,
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
