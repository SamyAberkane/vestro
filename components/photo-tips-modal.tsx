import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AppColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { useAppTheme } from '@/theme/context';

type PhotoTipsModalProps = {
  visible: boolean;
  onContinue: () => void;
  onDismiss: () => void;
};

type TipIcon = keyof typeof Ionicons.glyphMap;

function useTips(): { icon: TipIcon; text: string }[] {
  const { t } = useI18n();

  return useMemo(
    () => [
      { icon: 'shirt-outline' as TipIcon, text: t('photoTips.tip1') },
      { icon: 'body-outline' as TipIcon, text: t('photoTips.tip2') },
      { icon: 'scan-outline' as TipIcon, text: t('photoTips.tip3') },
      { icon: 'sunny-outline' as TipIcon, text: t('photoTips.tip4') },
    ],
    [t]
  );
}

/**
 * The "how to photograph your clothes" reminder shown every time the user is
 * about to add an item (see useAddClothing) — a bad source photo ruins the
 * sticker result, so this needs to actually hold attention. Replaces a plain
 * system Alert with a sheet that matches the rest of Vestro's editorial look,
 * one icon per tip instead of a wall of bullet text.
 */
export function PhotoTipsModal({ visible, onContinue, onDismiss }: PhotoTipsModalProps) {
  const { t } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const tips = useTips();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onContinue}
      onDismiss={onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerBadge}>
            <Ionicons name="camera-outline" size={22} color={VestroColors.accent} />
          </View>

          <Text style={styles.title}>{t('photoTips.title')}</Text>
          <Text style={styles.intro}>{t('photoTips.intro')}</Text>

          <View style={styles.tipList}>
            {tips.map((tip, index) => (
              <View style={styles.tipRow} key={index}>
                <View style={styles.tipIconBadge}>
                  <Ionicons name={tip.icon} size={17} color={VestroColors.accent} />
                </View>
                <Text style={styles.tipText}>{tip.text}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.ctaButton} onPress={onContinue} activeOpacity={0.85}>
            <Text style={styles.ctaText}>{t('photoTips.gotIt')}</Text>
          </TouchableOpacity>
        </View>
      </View>
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
      maxWidth: 380,
      backgroundColor: VestroColors.surface,
      borderRadius: 4,
      paddingVertical: 28,
      paddingHorizontal: 24,
      alignItems: 'center',
    },
    headerBadge: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: VestroColors.tints.Accessoires,
    },
    title: {
      marginTop: 14,
      fontFamily: VestroFonts.serifSemiBoldItalic,
      fontSize: 21,
      color: VestroColors.ink,
      textAlign: 'center',
    },
    intro: {
      marginTop: 8,
      fontFamily: VestroFonts.sans,
      fontSize: 13,
      lineHeight: 19,
      color: VestroColors.muted,
      textAlign: 'center',
    },
    tipList: {
      marginTop: 22,
      width: '100%',
      gap: 16,
    },
    tipRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    tipIconBadge: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: VestroColors.tints.Accessoires,
      flexShrink: 0,
    },
    tipText: {
      flex: 1,
      marginTop: 6,
      fontFamily: VestroFonts.sans,
      fontSize: 13,
      lineHeight: 19,
      color: VestroColors.ink,
    },
    ctaButton: {
      marginTop: 26,
      width: '100%',
      height: 52,
      backgroundColor: VestroColors.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaText: {
      fontFamily: VestroFonts.sansSemiBold,
      fontSize: 12,
      letterSpacing: 2.5,
      textTransform: 'uppercase',
      color: VestroColors.buttonText,
    },
  });
