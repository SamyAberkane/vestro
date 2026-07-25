import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/context';
import { AppColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { deleteAccount } from '@/lib/account';
import { useAppTheme } from '@/theme/context';

const DESTRUCTIVE_RED = '#DC2626';

export default function AccountScreen() {
  const { t } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const { signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [isDeleting, setIsDeleting] = useState(false);

  function handleDelete() {
    Alert.alert(t('account.deleteConfirmTitle'), t('account.deleteConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('account.deleteConfirmButton'),
        style: 'destructive',
        onPress: async () => {
          setIsDeleting(true);
          try {
            await deleteAccount();
          } catch (error) {
            setIsDeleting(false);
            Alert.alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity
          style={[styles.closeButton, { top: insets.top + 12 }]}
          onPress={() => router.back()}
          hitSlop={10}
        >
          <Text style={styles.closeGlyph}>×</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{t('account.title')}</Text>

        <View style={styles.section}>
          <TouchableOpacity style={styles.row} onPress={() => signOut()}>
            <Text style={styles.rowText}>{t('auth.signOut')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.row} onPress={() => router.push('/legal/mentions')}>
            <Text style={styles.rowText}>{t('legal.mentionsLink')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => router.push('/legal/privacy')}>
            <Text style={styles.rowText}>{t('legal.privacyLink')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.row, styles.rowLast]} onPress={() => router.push('/legal/terms')}>
            <Text style={styles.rowText}>{t('legal.termsLink')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} disabled={isDeleting}>
          {isDeleting ? (
            <ActivityIndicator color={DESTRUCTIVE_RED} />
          ) : (
            <Text style={styles.deleteText}>{t('account.deleteCta')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: VestroColors.background,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 70,
    paddingBottom: 60,
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VestroColors.surface,
    zIndex: 1,
  },
  closeGlyph: {
    fontSize: 20,
    lineHeight: 22,
    color: VestroColors.muted,
  },
  title: {
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 26,
    color: VestroColors.ink,
    marginBottom: 28,
  },
  section: {
    marginBottom: 28,
    borderTopWidth: 1,
    borderTopColor: VestroColors.border,
  },
  row: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: VestroColors.border,
  },
  rowLast: {
    borderBottomWidth: 1,
  },
  rowText: {
    fontFamily: VestroFonts.sans,
    fontSize: 14,
    color: VestroColors.ink,
  },
  deleteButton: {
    marginTop: 12,
    alignItems: 'center',
  },
  deleteText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 13,
    color: DESTRUCTIVE_RED,
    textDecorationLine: 'underline',
  },
});
