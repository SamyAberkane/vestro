import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { CanvasLayout, OutfitCanvas } from '@/components/outfit-canvas';
import { AppColors, VestroCategories, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { fetchClothingItems } from '@/lib/clothing';
import { deleteOutfit, fetchOutfits, insertOutfit, updateOutfit } from '@/lib/outfits';
import { useAppTheme } from '@/theme/context';
import type { ClothingItem } from '@/types/clothing';

const DESTRUCTIVE_RED = '#DC2626';

export default function CreateOutfitScreen() {
  const { t, tCategory } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = Boolean(id);

  const [clothes, setClothes] = useState<ClothingItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [layout, setLayout] = useState<Record<number, CanvasLayout>>({});
  const [showPrice, setShowPrice] = useState(false);
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeCategory, setActiveCategory] = useState('Hauts');

  useEffect(() => {
    async function loadData() {
      try {
        const parsedClothes = await fetchClothingItems();
        setClothes(
          parsedClothes.filter(
            (item) => (!item.status || item.status === 'owned') && item.available !== false
          )
        );

        if (id) {
          const outfits = await fetchOutfits();
          const outfit = outfits.find((item) => item.id === Number(id));

          if (outfit) {
            setName(outfit.name);

            const initialSelected: Record<string, number[]> = {};
            outfit.itemIds.forEach((itemId) => {
              const item = parsedClothes.find((c) => c.id === itemId);
              if (item) {
                initialSelected[item.category] = [
                  ...(initialSelected[item.category] ?? []),
                  item.id,
                ];
              }
            });
            setSelected(initialSelected);
            setLayout(outfit.layout ?? {});
            setShowPrice(outfit.showPrice ?? false);
          }
        }
      } catch (error) {
        Alert.alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
      }

      setIsLoaded(true);
    }

    loadData();
  }, [id]);

  function toggleSelect(category: string, itemId: number) {
    setSelected((current) => {
      const currentIds = current[category] ?? [];
      const nextIds = currentIds.includes(itemId)
        ? currentIds.filter((id) => id !== itemId)
        : [...currentIds, itemId];

      return { ...current, [category]: nextIds };
    });
  }

  function handleLayoutChange(itemId: number, next: CanvasLayout) {
    setLayout((current) => ({ ...current, [itemId]: next }));
  }

  async function saveOutfit() {
    const itemIds = Object.values(selected).flat();

    if (!name.trim()) {
      Alert.alert(t('createOutfit.missingNameTitle'), t('createOutfit.missingNameMessage'));
      return;
    }

    if (itemIds.length === 0) {
      Alert.alert(t('common.emptyOutfitTitle'), t('common.emptyOutfitMessage'));
      return;
    }

    const itemIdSet = new Set(itemIds);
    const savedLayout = Object.fromEntries(
      Object.entries(layout).filter(([itemId]) => itemIdSet.has(Number(itemId)))
    );

    try {
      if (id) {
        await updateOutfit(Number(id), { name: name.trim(), itemIds, layout: savedLayout, showPrice });
      } else {
        await insertOutfit({ name: name.trim(), itemIds, layout: savedLayout, showPrice });
      }
    } catch (error) {
      Alert.alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
      return;
    }

    router.back();
  }

  const availableCategories = VestroCategories.filter((category) =>
    clothes.some((item) => item.category === category)
  );
  const currentCategory = availableCategories.includes(activeCategory as (typeof VestroCategories)[number])
    ? activeCategory
    : availableCategories[0];
  const currentCategoryItems = clothes.filter((item) => item.category === currentCategory);

  async function confirmDelete() {
    if (!id) return;

    setIsDeleting(true);
    try {
      await deleteOutfit(Number(id));
      router.back();
    } catch (error) {
      setIsDeleting(false);
      setConfirmDeleteVisible(false);
      Alert.alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.cancel}>{t('common.cancel')}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={saveOutfit}>
            <Text style={styles.save}>{t('createOutfit.save')}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>
          {isEditing ? t('createOutfit.editTitle') : t('createOutfit.newTitle')}
        </Text>

        <TextInput
          style={styles.nameInput}
          placeholder={t('createOutfit.namePlaceholder')}
          placeholderTextColor={VestroColors.muted}
          value={name}
          onChangeText={setName}
        />

        {isLoaded && (
          <View style={styles.canvasWrap}>
            <OutfitCanvas
              items={Object.values(selected)
                .flat()
                .map((itemId) => clothes.find((item) => item.id === itemId))
                .filter((item): item is ClothingItem => Boolean(item))}
              layout={layout}
              onLayoutChange={handleLayoutChange}
              showPrice={showPrice}
            />

            <View style={styles.priceToggleRow}>
              <Text style={styles.priceToggleLabel}>{t('createOutfit.showPrice')}</Text>
              <Switch
                value={showPrice}
                onValueChange={setShowPrice}
                trackColor={{ false: VestroColors.border, true: VestroColors.ink }}
                thumbColor={VestroColors.buttonText}
                ios_backgroundColor={VestroColors.border}
              />
            </View>
          </View>
        )}

        {availableCategories.length > 0 && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryTabsScroll}
              contentContainerStyle={styles.categoryTabs}
            >
              {availableCategories.map((category) => {
                const active = category === currentCategory;

                return (
                  <TouchableOpacity
                    key={category}
                    onPress={() => setActiveCategory(category)}
                    style={active ? styles.categoryTabActive : styles.categoryTab}
                  >
                    <Text style={active ? styles.categoryTabTextActive : styles.categoryTabText}>
                      {tCategory(category)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.itemRow}
            >
              {currentCategoryItems.map((item) => {
                const isSelected = selected[currentCategory]?.includes(item.id) ?? false;

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.thumbnail,
                      { backgroundColor: item.color ?? VestroColors.tints[item.category] },
                      isSelected && styles.thumbnailSelected,
                    ]}
                    onPress={() => toggleSelect(currentCategory, item.id)}
                  >
                    {item.image && (
                      <Image
                        source={{ uri: item.image }}
                        style={styles.thumbnailImage}
                        resizeMode="cover"
                      />
                    )}
                    {isSelected && (
                      <View style={styles.checkBadge}>
                        <Text style={styles.checkGlyph}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </>
        )}

        {isEditing && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => setConfirmDeleteVisible(true)}
          >
            <Text style={styles.deleteText}>{t('createOutfit.deleteButton')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <ConfirmModal
        visible={confirmDeleteVisible}
        title={t('createOutfit.deleteConfirmTitle')}
        message={t('createOutfit.deleteConfirmMessage', { name: name.trim() })}
        confirmLabel={isDeleting ? t('createOutfit.deleting') : t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteVisible(false)}
      />
    </View>
  );
}

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: VestroColors.background,
  },
  content: {
    paddingTop: 65,
    paddingHorizontal: 20,
    paddingBottom: 60,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cancel: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
  save: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.accent,
  },
  title: {
    marginTop: 20,
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 27,
    color: VestroColors.ink,
  },
  nameInput: {
    marginTop: 20,
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: VestroColors.border,
    fontFamily: VestroFonts.serifMediumItalic,
    fontSize: 17,
    color: VestroColors.ink,
  },
  canvasWrap: {
    marginTop: 24,
  },
  priceToggleRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  priceToggleLabel: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 13,
    color: VestroColors.ink,
  },
  categoryTabsScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 30,
  },
  categoryTabs: {
    gap: 20,
  },
  categoryTab: {
    paddingBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  categoryTabActive: {
    paddingBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: VestroColors.ink,
  },
  categoryTabText: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
  categoryTabTextActive: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: VestroColors.ink,
  },
  itemRow: {
    marginTop: 14,
    gap: 12,
  },
  thumbnail: {
    width: 92,
    height: 116,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbnailSelected: {
    borderWidth: 2,
    borderColor: VestroColors.ink,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: VestroColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlyph: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 11,
    color: VestroColors.buttonText,
  },
  deleteButton: {
    marginTop: 36,
    alignItems: 'center',
  },
  deleteText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 13,
    color: DESTRUCTIVE_RED,
    textDecorationLine: 'underline',
  },
});
