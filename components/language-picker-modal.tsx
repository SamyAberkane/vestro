import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { VestroColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { LANGUAGES } from '@/i18n/translations';

type LanguagePickerModalProps = {
  visible: boolean;
  onClose: () => void;
};

export function LanguagePickerModal({ visible, onClose }: LanguagePickerModalProps) {
  const { language, setLanguage, t } = useI18n();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{t('home.languagePickerTitle')}</Text>

          <View style={styles.list}>
            {LANGUAGES.map((option) => {
              const active = option.code === language;
              return (
                <TouchableOpacity
                  key={option.code}
                  style={[styles.row, active && styles.rowActive]}
                  onPress={() => {
                    setLanguage(option.code);
                    onClose();
                  }}
                >
                  <Text style={styles.flag}>{option.flag}</Text>
                  <Text style={[styles.label, active && styles.labelActive]}>{option.label}</Text>
                  {active && <Text style={styles.check}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

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
    maxWidth: 340,
    backgroundColor: VestroColors.surface,
    borderRadius: 4,
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  title: {
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 19,
    color: VestroColors.ink,
    textAlign: 'center',
    marginBottom: 12,
  },
  list: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  rowActive: {
    backgroundColor: VestroColors.background,
  },
  flag: {
    fontSize: 20,
    marginRight: 12,
  },
  label: {
    flex: 1,
    fontFamily: VestroFonts.sans,
    fontSize: 14,
    color: VestroColors.ink,
  },
  labelActive: {
    fontFamily: VestroFonts.sansSemiBold,
  },
  check: {
    fontSize: 14,
    color: VestroColors.accent,
  },
});
