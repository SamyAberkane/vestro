import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { ClothingOptionsSheet } from '@/components/clothing-options-sheet';
import { ClothingPreviewModal } from '@/components/clothing-preview-modal';
import { ColorPickerModal } from '@/components/color-picker-modal';
import { ConfirmModal } from '@/components/confirm-modal';
import { ProcessingOverlay } from '@/components/processing-overlay';
import { RefreshingBadge } from '@/components/refreshing-badge';
import { ScreenBackground } from '@/components/screen-background';
import { StickerImage } from '@/components/sticker-image';
import { AppColors, VestroCategories, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { alert } from '@/lib/alert';
import { deleteClothingItem, fetchClothingItems, updateClothingItem } from '@/lib/clothing';
import { useAppTheme } from '@/theme/context';
import type { ClothingItem } from '@/types/clothing';
import { formatPrice } from '@/utils/currency';
import { removeBackground } from '@/utils/remove-background';

// Same fix as the Dressing tab: fit as many comfortable, phone-sized cards
// as the actual screen width allows, instead of always doing 2 columns
// stretched to fill whatever width is available (huge cards on a wide iPad).
const CONTENT_PADDING = 20;
const GRID_GAP = 20;

export default function WishlistScreen() {
  const { t, tCategory, tPlural, language } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const { width: windowWidth } = useWindowDimensions();
  const [clothes, setClothes] = useState<ClothingItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [processingImageUri, setProcessingImageUri] = useState<string | undefined>(undefined);
  const isProcessingImage = processingImageUri !== undefined;
  const [batchStep, setBatchStep] = useState({ index: 1, count: 1 });
  // Empty means "Tout" (no filter) — several categories can be active at
  // once (see toggleCategoryFilter), same as the home and closet screens.
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [columns, setColumns] = useState<2 | 3>(2);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const colorSelectRef = useRef<((color: string | undefined) => void) | null>(null);
  const colorDismissRef = useRef<(() => void) | null>(null);
  const [optionsItemId, setOptionsItemId] = useState<number | null>(null);
  const [previewItemId, setPreviewItemId] = useState<number | null>(null);
  const optionsItem = clothes.find((clothing) => clothing.id === optionsItemId) ?? null;
  const previewItem = clothes.find((clothing) => clothing.id === previewItemId) ?? null;
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteConfirmVisible, setBulkDeleteConfirmVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped by every optimistic local edit to `clothes` (delete, bulk delete,
  // update) AND by every loadClothes() call — see explore.tsx's identical
  // guard for why: without it, a slow fetchClothingItems() started just
  // before a delete can resolve just after it and silently put the deleted
  // item right back into state.
  const clothesTokenRef = useRef(0);

  function openColorPicker(
    onPick: (color: string | undefined) => void,
    onDismiss?: () => void
  ) {
    colorSelectRef.current = onPick;
    colorDismissRef.current = onDismiss ?? null;
    setColorPickerVisible(true);
  }

  function handleColorSelect(color: string | undefined) {
    setColorPickerVisible(false);
    colorSelectRef.current?.(color);
    colorSelectRef.current = null;
    colorDismissRef.current = null;
  }

  function handleColorCancel() {
    setColorPickerVisible(false);
    colorDismissRef.current?.();
    colorSelectRef.current = null;
    colorDismissRef.current = null;
  }

  const loadClothes = useCallback(async () => {
    const token = ++clothesTokenRef.current;
    try {
      const data = await fetchClothingItems();
      if (clothesTokenRef.current === token) setClothes(data);
    } catch (error) {
      if (clothesTokenRef.current === token) {
        alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
      }
    }

    setIsLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadClothes();
    }, [loadClothes])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await loadClothes();
    setRefreshing(false);
  }

  const wishlistItems = clothes.filter(
    (item) => item.status === 'wishlist'
  );

  const filteredWishlistItems =
    selectedCategories.length === 0
      ? wishlistItems
      : wishlistItems.filter((item) => selectedCategories.includes(item.category));

  // "Tout" clears every filter back to showing everything; any other pill
  // toggles independently of the rest, so several categories can be active
  // together.
  function toggleCategoryFilter(category: string) {
    if (category === 'Tout') {
      setSelectedCategories([]);
      return;
    }
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((existing) => existing !== category)
        : [...current, category]
    );
  }

  // Same 2/3-column target-width approach as the Dressing tab: fit as many
  // cards of the chosen target size as the screen allows.
  const availableWidth = windowWidth - CONTENT_PADDING * 2;
  const targetCardWidth = columns === 2 ? 170 : 112;
  const numColumns = Math.max(
    columns,
    Math.floor((availableWidth + GRID_GAP) / (targetCardWidth + GRID_GAP))
  );
  const cardWidth = (availableWidth - GRID_GAP * (numColumns - 1)) / numColumns;

  async function updateItem(id: number, patch: Parameters<typeof updateClothingItem>[1]) {
    // patch.imageDataUri is a raw data URI, not the `image`/`imagePath` fields
    // ClothingItem is actually rendered from — spreading it as-is left the old
    // photo showing until the next full reload. Map it onto `image` for an
    // immediate preview and drop the now-stale `imagePath` (its cache key)
    // rather than let a new photo render under an old cache entry.
    const { imageDataUri, ...rest } = patch;
    clothesTokenRef.current++;
    setClothes((currentClothes) =>
      currentClothes.map((clothing) =>
        clothing.id === id
          ? { ...clothing, ...rest, ...(imageDataUri ? { image: imageDataUri, imagePath: undefined } : null) }
          : clothing
      )
    );

    try {
      await updateClothingItem(id, patch);
    } catch (error) {
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    }
  }

  async function handleOptionsPhotoChange() {
    if (!optionsItem) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      alert(t('common.permissionTitle'), t('common.permissionPhotos'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled) {
      const targetId = optionsItem.id;
      setBatchStep({ index: 1, count: 1 });
      setProcessingImageUri(result.assets[0].uri);
      try {
        const newImage = await removeBackground(result.assets[0].uri);
        updateItem(targetId, { imageDataUri: newImage });
      } catch (error) {
        alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
      } finally {
        setProcessingImageUri(undefined);
      }
    }
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => !current);
    setSelectedIds(new Set());
  }

  function toggleItemSelected(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((current) =>
      current.size === filteredWishlistItems.length
        ? new Set()
        : new Set(filteredWishlistItems.map((item) => item.id))
    );
  }

  function handleCardPress(item: ClothingItem) {
    if (selectionMode) {
      toggleItemSelected(item.id);
      return;
    }
    openItem(item);
  }

  function handleCardLongPress(item: ClothingItem) {
    if (selectionMode) return;
    setSelectionMode(true);
    setSelectedIds(new Set([item.id]));
  }

  async function handleBulkMoveToDressing() {
    const ids = [...selectedIds];
    setSelectionMode(false);
    setSelectedIds(new Set());
    await Promise.all(ids.map((id) => updateItem(id, { status: 'owned' })));
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    setBulkDeleteConfirmVisible(false);
    setSelectionMode(false);
    setSelectedIds(new Set());

    clothesTokenRef.current++;
    setClothes((currentClothes) => currentClothes.filter((clothing) => !ids.includes(clothing.id)));

    const results = await Promise.allSettled(ids.map((id) => deleteClothingItem(id)));
    const firstFailure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (firstFailure) {
      const error = firstFailure.reason;
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
      loadClothes();
    }
  }

  function openItem(item: ClothingItem) {
    setPreviewItemId(item.id);
  }

  return (
    <ScreenBackground style={styles.screen}>
    <ScrollView
      contentContainerStyle={[styles.content, selectionMode && styles.contentWithSelectionBar]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={VestroColors.ink} />
      }
    >
      <RefreshingBadge visible={refreshing} color={VestroColors.ink} />

      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t('wishlist.title')}</Text>
          <Text style={styles.count}>{t('wishlist.count', { count: wishlistItems.length })}</Text>
        </View>

        <View style={styles.headerActions}>
          {wishlistItems.length > 0 && (
            <TouchableOpacity onPress={toggleSelectionMode}>
              <Text style={styles.selectToggleText}>
                {t(selectionMode ? 'dressing.selectDone' : 'dressing.select')}
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.viewToggleButton, columns === 2 && styles.viewToggleButtonActive]}
              onPress={() => setColumns(2)}
            >
              <View style={styles.gridIconTwo}>
                <View style={styles.gridIconBar} />
                <View style={styles.gridIconBar} />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.viewToggleButton, columns === 3 && styles.viewToggleButtonActive]}
              onPress={() => setColumns(3)}
            >
              <View style={styles.gridIconThree}>
                <View style={styles.gridIconBar} />
                <View style={styles.gridIconBar} />
                <View style={styles.gridIconBar} />
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {wishlistItems.length > 0 && (
        <ScrollView
          horizontal
          style={styles.filtersScroll}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {['Tout', ...VestroCategories].map((category) => {
            const active =
              category === 'Tout' ? selectedCategories.length === 0 : selectedCategories.includes(category);

            return (
              <TouchableOpacity
                key={category}
                style={active ? styles.activeFilter : styles.filter}
                onPress={() => toggleCategoryFilter(category)}
              >
                <Text style={active ? styles.activeFilterText : styles.filterText}>
                  {category === 'Tout' ? t('dressing.filterAll') : tCategory(category)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {isLoaded && wishlistItems.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t('wishlist.emptyTitle')}</Text>
          <Text style={styles.emptyText}>{t('wishlist.emptyText')}</Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {filteredWishlistItems.map((item) => {
            const isSelected = selectedIds.has(item.id);

            return (
            <TouchableOpacity
              style={[styles.card, { width: cardWidth }]}
              key={item.id}
              onPress={() => handleCardPress(item)}
              onLongPress={() => handleCardLongPress(item)}
            >
              <View style={styles.imageWrap}>
                {selectionMode && (
                  <View style={[styles.checkBadge, isSelected && styles.checkBadgeActive]}>
                    {isSelected && <Text style={styles.checkGlyph}>✓</Text>}
                  </View>
                )}

                {item.image && (
                  <StickerImage
                    uri={item.image}
                    cacheKey={item.imagePath}
                    containerStyle={styles.image}
                    resizeMode="cover"
                  />
                )}
                <Text style={styles.envieBadge}>{t('wishlist.badge')}</Text>
              </View>

              <Text style={styles.itemName}>{item.name}</Text>
              <View style={styles.itemMetaRow}>
                <Text style={styles.category}>{tCategory(item.category)}</Text>
                {item.price !== undefined && (
                  <Text style={styles.price}>{formatPrice(item.price, language)}</Text>
                )}
              </View>
            </TouchableOpacity>
            );
          })}
        </View>
      )}
    </ScrollView>

      {selectionMode && (
        <View style={styles.selectionBar}>
          <TouchableOpacity onPress={toggleSelectAll}>
            <Text style={styles.selectionBarCount}>
              {selectedIds.size > 0
                ? tPlural('dressing.selectedCount', selectedIds.size)
                : t('dressing.selectAll')}
            </Text>
          </TouchableOpacity>

          <View style={styles.selectionBarActions}>
            <TouchableOpacity
              style={styles.selectionBarButton}
              disabled={selectedIds.size === 0}
              onPress={handleBulkMoveToDressing}
            >
              <Text
                style={[
                  styles.selectionBarButtonText,
                  selectedIds.size === 0 && styles.selectionBarButtonTextDisabled,
                ]}
              >
                {t('wishlist.moveToDressing')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.selectionBarButton}
              disabled={selectedIds.size === 0}
              onPress={() => setBulkDeleteConfirmVisible(true)}
            >
              <Text
                style={[
                  styles.selectionBarButtonTextDestructive,
                  selectedIds.size === 0 && styles.selectionBarButtonTextDisabled,
                ]}
              >
                {t('dressing.bulkDelete')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ProcessingOverlay
        visible={isProcessingImage}
        imageUri={processingImageUri}
        stepIndex={batchStep.index}
        stepCount={batchStep.count}
      />

      <ColorPickerModal
        visible={colorPickerVisible}
        onSelect={handleColorSelect}
        onCancel={handleColorCancel}
      />

      <ClothingPreviewModal
        item={previewItem}
        onClose={() => setPreviewItemId(null)}
        onEdit={() => {
          if (!previewItem) return;
          setOptionsItemId(previewItem.id);
          setPreviewItemId(null);
        }}
      />

      <ClothingOptionsSheet
        item={optionsItem}
        categories={[...VestroCategories]}
        onClose={() => setOptionsItemId(null)}
        onRename={(name) => optionsItem && updateItem(optionsItem.id, { name })}
        onChangeCategory={(category) => optionsItem && updateItem(optionsItem.id, { category })}
        onChangePrice={(price) => optionsItem && updateItem(optionsItem.id, { price })}
        onChangeAvailability={(available, reason) =>
          optionsItem &&
          updateItem(optionsItem.id, {
            available,
            unavailableReason: available ? undefined : reason?.trim() || undefined,
          })
        }
        onRequestColorChange={() => {
          if (!optionsItem) return;
          const targetId = optionsItem.id;
          openColorPicker((color) => updateItem(targetId, { color }));
        }}
        onRequestPhotoChange={handleOptionsPhotoChange}
        moveAction={{
          label: t('wishlist.moveToDressing'),
          onPress: () => optionsItem && updateItem(optionsItem.id, { status: 'owned' }),
        }}
        onDelete={() => {
          if (!optionsItem) return;
          const targetId = optionsItem.id;
          clothesTokenRef.current++;
          setClothes((currentClothes) => currentClothes.filter((clothing) => clothing.id !== targetId));
          setOptionsItemId(null);
          deleteClothingItem(targetId).catch((error) =>
            alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error))
          );
        }}
      />

      <ConfirmModal
        visible={bulkDeleteConfirmVisible}
        title={tPlural('dressing.bulkDeleteConfirmTitle', selectedIds.size)}
        message={t('dressing.bulkDeleteConfirmMessage')}
        confirmLabel={t('dressing.bulkDelete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteConfirmVisible(false)}
      />

    </ScreenBackground>
  );
}

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingTop: 65,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  contentWithSelectionBar: {
    paddingBottom: 90,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  selectToggleText: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.ink,
  },
  title: {
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 27,
    color: VestroColors.ink,
  },
  count: {
    marginTop: 5,
    fontFamily: VestroFonts.sans,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
  viewToggle: {
    flexDirection: 'row',
    gap: 6,
  },
  viewToggleButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: VestroColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewToggleButtonActive: {
    borderColor: VestroColors.ink,
  },
  gridIconTwo: {
    flexDirection: 'row',
    gap: 3,
    width: 14,
    height: 12,
  },
  gridIconThree: {
    flexDirection: 'row',
    gap: 2,
    width: 14,
    height: 12,
  },
  gridIconBar: {
    flex: 1,
    backgroundColor: VestroColors.ink,
    borderRadius: 1,
  },
  filtersScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  filters: {
    gap: 18,
    marginTop: 28,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: VestroColors.border,
  },
  activeFilter: {
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: VestroColors.ink,
  },
  activeFilterText: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: VestroColors.ink,
  },
  filter: {
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  filterText: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
  emptyState: {
    flex: 1,
    minHeight: 450,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontFamily: VestroFonts.serifMediumItalic,
    fontSize: 20,
    color: VestroColors.ink,
  },
  emptyText: {
    marginTop: 8,
    textAlign: 'center',
    fontFamily: VestroFonts.sans,
    fontSize: 13,
    color: VestroColors.muted,
  },
  grid: {
    marginTop: 32,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  card: {},
  imageWrap: {
    position: 'relative',
    height: 172,
    backgroundColor: VestroColors.surface,
    alignItems: 'flex-end',
    padding: 8,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  envieBadge: {
    fontFamily: VestroFonts.sansBold,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.accent,
  },
  itemName: {
    marginTop: 9,
    fontFamily: VestroFonts.serifMedium,
    fontSize: 14,
    color: VestroColors.ink,
  },
  itemMetaRow: {
    marginTop: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  category: {
    fontFamily: VestroFonts.sans,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
  price: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.ink,
  },
  checkBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 1,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: VestroColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadgeActive: {
    backgroundColor: VestroColors.ink,
    borderColor: VestroColors.ink,
  },
  checkGlyph: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    color: VestroColors.buttonText,
  },
  selectionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: VestroColors.surface,
    borderTopWidth: 1,
    borderTopColor: VestroColors.border,
  },
  selectionBarCount: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.5,
    color: VestroColors.ink,
  },
  selectionBarActions: {
    flexDirection: 'row',
    gap: 20,
  },
  selectionBarButton: {},
  selectionBarButtonText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: VestroColors.ink,
  },
  selectionBarButtonTextDestructive: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#B2554A',
  },
  selectionBarButtonTextDisabled: {
    color: VestroColors.muted,
    opacity: 0.5,
  },
});