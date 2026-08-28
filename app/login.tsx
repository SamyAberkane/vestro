import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAuth } from '@/auth/context';
import { AppColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { alert } from '@/lib/alert';
import { useAppTheme } from '@/theme/context';

export default function LoginScreen() {
  const { t } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const { continueWithApple } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  async function handlePress() {
    setSubmitting(true);

    try {
      await continueWithApple();
    } catch (error: any) {
      if (error?.code !== 'ERR_REQUEST_CANCELED') {
        alert(t('common.errorTitle'), String(error?.message ?? error));
      }
    }

    setSubmitting(false);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.logo}>Crystal AI Closet</Text>
        <Text style={styles.tagline}>{t('auth.tagline')}</Text>

        <TouchableOpacity style={styles.appleButton} onPress={handlePress} disabled={submitting}>
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="logo-apple" size={20} color="#FFFFFF" />
              <Text style={styles.appleText}>{t('auth.signIn')}</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => router.push('/legal/privacy')}>
            <Text style={styles.legalLink}>{t('legal.privacyLink')}</Text>
          </TouchableOpacity>
          <Text style={styles.legalSeparator}>·</Text>
          <TouchableOpacity onPress={() => router.push('/legal/terms')}>
            <Text style={styles.legalLink}>{t('legal.termsLink')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: VestroColors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 26,
    color: VestroColors.ink,
    textAlign: 'center',
  },
  tagline: {
    marginTop: 8,
    fontFamily: VestroFonts.serifMediumItalic,
    fontSize: 14,
    color: VestroColors.muted,
    textAlign: 'center',
  },
  appleButton: {
    marginTop: 56,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#000000',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  appleText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  legalRow: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  legalLink: {
    fontFamily: VestroFonts.sans,
    fontSize: 11,
    color: VestroColors.muted,
    textDecorationLine: 'underline',
  },
  legalSeparator: {
    fontFamily: VestroFonts.sans,
    fontSize: 11,
    color: VestroColors.muted,
  },
});
