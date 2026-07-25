import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { VestroCategories } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { insertClothingItems } from '@/lib/clothing';
import { showPhotoTips } from '@/lib/photo-tips';
import type { ClothingItem } from '@/types/clothing';
import { analyzeClothingPhoto, type PhotoIssue } from '@/utils/remove-background';

export function useAddClothing() {
  const { t, language } = useI18n();
  const [processingImageUri, setProcessingImageUri] = useState<string | undefined>(undefined);
  const [batchStep, setBatchStep] = useState({ index: 1, count: 1 });
  const [revealItems, setRevealItems] = useState<ClothingItem[]>([]);
  const isProcessing = processingImageUri !== undefined;

  async function addClothing() {
    await showPhotoTips(t);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(t('common.permissionTitle'), t('common.permissionPhotos'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 0,
      quality: 0.8,
    });

    if (result.canceled || result.assets.length === 0) return;

    const assets = result.assets;

    if (assets.length > 1) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
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
    const rejected: { index: number; issue: PhotoIssue }[] = [];

    for (let i = 0; i < assets.length; i++) {
      setBatchStep({ index: i + 1, count: assets.length });
      setProcessingImageUri(assets[i].uri);

      const analysis = await analyzeClothingPhoto(assets[i].uri, language);

      if (analysis.usable === false) {
        rejected.push({ index: i + 1, issue: analysis.issue ?? 'other' });
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
      const lines = rejected.map((r) =>
        assets.length > 1
          ? `${t('processing.stepLabel', { index: r.index, count: assets.length })} — ${t(`photoIssue.${r.issue}`)}`
          : t(`photoIssue.${r.issue}`)
      );
      Alert.alert(t('photoIssue.alertTitle'), lines.join('\n'));
    }

    if (newItems.length === 0) return;

    let inserted: ClothingItem[];
    try {
      inserted = await insertClothingItems(newItems);
    } catch (error) {
      Alert.alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
      return;
    }

    setRevealItems(inserted);
  }

  function finishReveal() {
    setRevealItems([]);
    router.navigate('/(tabs)/explore');
  }

  return { addClothing, isProcessing, processingImageUri, batchStep, revealItems, finishReveal };
}
