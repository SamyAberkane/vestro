import { Alert } from 'react-native';

import type { I18nContextValue } from '@/i18n/context';

/**
 * Shows the "how to photograph your clothes" tips every time the user is
 * about to add an item — a bad source photo ruins the sticker result, so the
 * reminder needs to stay in front of them rather than fade after one look.
 */
export async function showPhotoTips(t: I18nContextValue['t']): Promise<void> {
  await new Promise<void>((resolve) => {
    Alert.alert(t('photoTips.title'), t('photoTips.message'), [
      { text: t('photoTips.gotIt'), onPress: () => resolve() },
    ]);
  });
}
