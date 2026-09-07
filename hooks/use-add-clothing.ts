import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useRef, useState } from 'react';

import { VestroCategories } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { alert } from '@/lib/alert';
import { insertClothingItems } from '@/lib/clothing';
import { getIsPremium } from '@/lib/premium';
import { getRemainingPhotoQuota } from '@/lib/photo-quota';
import type { ClothingItem } from '@/types/clothing';
import { analyzeClothingPhoto, type PhotoIssue } from '@/utils/remove-background';

export function useAddClothing() {
  const { t, language } = useI18n();
  const [processingImageUri, setProcessingImageUri] = useState<string | undefined>(undefined);
  const [batchStep, setBatchStep] = useState({ index: 1, count: 1 });
  const [revealItems, setRevealItems] = useState<ClothingItem[]>([]);
  const [photoTipsVisible, setPhotoTipsVisible] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const photoTipsResolveRef = useRef<(() => void) | null>(null);
  const isProcessing = processingImageUri !== undefined;
  // Lets cancelProcessing hide the full-screen overlay immediately instead of
  // it being stuck up until the in-flight analyzeClothingPhoto call settles —
  // that call now has its own network timeout (see EDGE_FUNCTION_TIMEOUT_MS
  // in utils/remove-background.ts), but a user shouldn't have to wait out a
  // 45s timeout just to get back to the rest of the app. The in-flight call
  // itself isn't aborted, just ignored once it resolves.
  const cancelledRef = useRef(false);

  // Split in two on purpose: closing the modal (button tap) and actually
  // continuing (resolving the promise addClothing is awaiting) can't happen
  // in the same tick. Launching the image picker while the modal's own
  // dismiss animation is still running makes iOS silently drop the picker
  // presentation — the promise from launchImageLibraryAsync then never
  // resolves or rejects, it just hangs forever. onPhotoTipsDismissed fires
  // from the native Modal's onDismiss, which only runs once the animation
  // has actually finished, so the picker always opens on a clear screen.
  function closePhotoTips() {
    setPhotoTipsVisible(false);
  }

  function onPhotoTipsDismissed() {
    photoTipsResolveRef.current?.();
    photoTipsResolveRef.current = null;
  }

  // Vestro is fully browsable for free — adding a clothing item is the one
  // action that actually needs a subscription (it's what drives the on-device
  // segmentation + Gemini classification cost). This is a UX nicety only:
  // the real enforcement is has_active_premium() in Postgres RLS on
  // clothing_items — see supabase/schema.sql — so a bypassed client-side
  // check here still can't write a row for free.
  async function addClothing() {
    if (!(await getIsPremium())) {
      setPaywallVisible(true);
      return;
    }

    if ((await getRemainingPhotoQuota()) <= 0) {
      alert(t('common.errorTitle'), t('dressing.monthlyLimitReached'));
      return;
    }

    await new Promise<void>((resolve) => {
      photoTipsResolveRef.current = resolve;
      setPhotoTipsVisible(true);
    });

    let permission;
    try {
      permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    } catch (error) {
      console.warn('[addClothing] échec de la demande de permission', error);
      return;
    }

    if (!permission.granted) {
      alert(t('common.permissionTitle'), t('common.permissionPhotos'));
      return;
    }

    let result;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 5,
        quality: 0.8,
      });
    } catch (error) {
      console.warn('[addClothing] échec de l\'ouverture de la galerie', error);
      return;
    }

    if (result.canceled || result.assets.length === 0) return;

    // Same class of timing bug as the photo-tips modal above: the promise
    // from launchImageLibraryAsync resolves as soon as the selection is
    // confirmed, but the picker's own dismiss animation is still running for
    // a moment after that. Starting the native Vision cutout (heavy native
    // work, right on the bridge) while that transition is still in flight is
    // what was actually crashing the app — not the Vision code itself. A
    // short wait for the dismissal to finish, matching the same fix already
    // used for modal-to-modal transitions elsewhere in this app, is the
    // proper fix here too.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const assets = result.assets;

    if (assets.length > 1) {
      const confirmed = await new Promise<boolean>((resolve) => {
        alert(
          t('dressing.multiSelectTitle', { count: assets.length }),
          t('dressing.multiSelectMessage', { count: assets.length }),
          [
            { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('common.continue'), onPress: () => resolve(true) },
          ]
        );
      });
      if (!confirmed) return;
    }

    const newItems = [];
    const rejected: { index: number; issue: PhotoIssue; errorCode?: string; errorDetail?: string }[] = [];
    cancelledRef.current = false;

    for (let i = 0; i < assets.length; i++) {
      setBatchStep({ index: i + 1, count: assets.length });
      setProcessingImageUri(assets[i].uri);

      const analysis = await analyzeClothingPhoto(assets[i].uri, language);
      if (cancelledRef.current) return;

      if (analysis.usable === false) {
        rejected.push({
          index: i + 1,
          issue: analysis.issue ?? 'other',
          errorCode: analysis.errorCode,
          errorDetail: analysis.errorDetail,
        });
        continue;
      }

      newItems.push({
        name: analysis.name ?? t('dressing.fallbackName', { index: i + 1 }),
        category: analysis.category ?? VestroCategories[0],
        color: analysis.color,
        status: 'owned' as const,
        available: true,
        imageDataUri: analysis.image,
      });
    }

    setProcessingImageUri(undefined);

    if (rejected.length > 0) {
      const lines = rejected.map((r) => {
        const base = r.errorCode
          ? t('photoIssue.technical_error', { code: r.errorCode })
          : t(`photoIssue.${r.issue}`);
        const text = r.errorDetail ? `${base}\n${r.errorDetail}` : base;
        return assets.length > 1
          ? `${t('processing.stepLabel', { index: r.index, count: assets.length })} — ${text}`
          : text;
      });
      alert(t('photoIssue.alertTitle'), lines.join('\n'));
    }

    if (newItems.length === 0) return;

    let inserted: ClothingItem[];
    try {
      inserted = await insertClothingItems(newItems);
    } catch (error) {
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
      return;
    }

    setRevealItems(inserted);
  }

  function finishReveal() {
    setRevealItems([]);
    router.navigate('/(tabs)/explore');
  }

  // The user's own escape hatch out of the processing overlay — see
  // ProcessingOverlay's onCancel. Hides the overlay immediately rather than
  // waiting for the current photo's analyzeClothingPhoto call to settle, and
  // the cancelledRef check right after that await stops the batch from
  // inserting anything once it does.
  function cancelProcessing() {
    cancelledRef.current = true;
    setProcessingImageUri(undefined);
  }

  return {
    addClothing,
    isProcessing,
    processingImageUri,
    batchStep,
    revealItems,
    finishReveal,
    photoTipsVisible,
    closePhotoTips,
    onPhotoTipsDismissed,
    paywallVisible,
    dismissPaywall: () => setPaywallVisible(false),
    cancelProcessing,
  };
}
