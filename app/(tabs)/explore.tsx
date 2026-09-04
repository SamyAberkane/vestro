import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
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
import { PaywallModal } from '@/components/paywall-modal';
import { ProcessingOverlay } from '@/components/processing-overlay';
import { RefreshingBadge } from '@/components/refreshing-badge';
import { ScreenBackground } from '@/components/screen-background';
import { StickerImage } from '@/components/sticker-image';
import { AppColors, VestroCategories, VestroFonts, VestroPalette } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { alert } from '@/lib/alert';
import {
  deleteClothingItem,
  fetchClothingItems,
  subscribeToClothingItemsChanged,
  updateClothingItem,
} from '@/lib/clothing';
import { getIsPremium } from '@/lib/premium';
import { getRemainingPhotoQuota, MONTHLY_PHOTO_LIMIT } from '@/lib/photo-quota';
import { useAppTheme } from '@/theme/context';
import type { ClothingItem } from '@/types/clothing';
import { formatPrice } from '@/utils/currency';
import { removeBackground } from '@/utils/remove-background';

// Content horizontal padding (styles.content) and inter-card gap — kept as
// constants so the column-count math below stays readable.
const CONTENT_PADDING = 20;
const GRID_GAP = 16;

export default function DressingScreen() {
  const { t, tCategory, tPlural, language } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const { width: windowWidth } = useWindowDimensions();
  const [clothes, setClothes] = useState<ClothingItem[]>([]);
const [refreshing, setRefreshing] = useState(false);
const [selectedCategory, setSelectedCategory] = useState('Tout');
const [showAvailableOnly, setShowAvailableOnly] = useState(false);
const [colorFilter, setColorFilter] = useState<string | undefined>(undefined);
const [columns, setColumns] = useState<2 | 3>(2);
const [processingImageUri, setProcessingImageUri] = useState<string | undefined>(undefined);
const isProcessingImage = processingImageUri !== undefined;
const [batchStep, setBatchStep] = useState({ index: 1, count: 1 });
const [colorPickerVisible, setColorPickerVisible] = useState(false);
const colorSelectRef = useRef<((color: string | undefined) => void) | null>(null);
const colorDismissRef = useRef<(() => void) | null>(null);
const [optionsItemId, setOptionsItemId] = useState<number | null>(null);
const [previewItemId, setPreviewItemId] = useState<number | null>(null);
const [paywallVisible, setPaywallVisible] = useState(false);
const [isPremium, setIsPremium] = useState(false);
const [remainingCredits, setRemainingCredits] = useState<number | null>(null);
const [selectionMode, setSelectionMode] = useState(false);
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
const [bulkDeleteConfirmVisible, setBulkDeleteConfirmVisible] = useState(false);

useFocusEffect(
  useCallback(() => {
    getIsPremium().then((active) => {
      setIsPremium(active);
      if (active) getRemainingPhotoQuota().then(setRemainingCredits);
    });
  }, [])
);
const optionsItem = clothes.find((clothing) => clothing.id === optionsItemId) ?? null;
const previewItem = clothes.find((clothing) => clothing.id === previewItemId) ?? null;

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

const ownedClothes = clothes.filter(
  (item) => !item.status || item.status === 'owned'
);

const filteredClothes = ownedClothes
  .filter((item) => selectedCategory === 'Tout' || item.category === selectedCategory)
  .filter((item) => !showAvailableOnly || item.available !== false)
  .filter((item) => !colorFilter || item.color === colorFilter);

const loadClothes = useCallback(async () => {
  try {
    setClothes(await fetchClothingItems());
  } catch (error) {
    alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
  }
}, [t]);

useFocusEffect(
  useCallback(() => {
    loadClothes();
  }, [loadClothes])
);

// The tab bar's global "+" button adds items from outside this screen's
// component tree, and navigating back to a tab that's already focused
// (adding while already on Dressing) fires no focus event to catch it via
// useFocusEffect above — this subscription is what makes a freshly added
// garment show up immediately in that case, with no scroll/tab switch.
useEffect(() => subscribeToClothingItemsChanged(loadClothes), [loadClothes]);

async function handleRefresh() {
  setRefreshing(true);
  await loadClothes();
  setRefreshing(false);
}

async function updateOptionsItem(id: number, patch: Parameters<typeof updateClothingItem>[1]) {
  // patch.imageDataUri is a raw data URI, not the `image`/`imagePath` fields
  // ClothingItem is actually rendered from — spreading it as-is left the old
  // photo showing until the next full reload. Map it onto `image` for an
  // immediate preview and drop the now-stale `imagePath` (its cache key)
  // rather than let a new photo render under an old cache entry.
  const { imageDataUri, ...rest } = patch;
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

function handleCardPress(item: ClothingItem) {
  if (selectionMode) {
    toggleItemSelected(item.id);
    return;
  }
  setPreviewItemId(item.id);
}

function handleCardLongPress(item: ClothingItem) {
  if (selectionMode) return;
  setSelectionMode(true);
  setSelectedIds(new Set([item.id]));
}

function toggleSelectAll() {
  setSelectedIds((current) =>
    current.size === filteredClothes.length
      ? new Set()
      : new Set(filteredClothes.map((item) => item.id))
  );
}

async function handleBulkMoveToWishlist() {
  const ids = [...selectedIds];
  setSelectionMode(false);
  setSelectedIds(new Set());
  await Promise.all(ids.map((id) => updateOptionsItem(id, { status: 'wishlist' })));
}

async function handleBulkDelete() {
  const ids = [...selectedIds];
  setBulkDeleteConfirmVisible(false);
  setSelectionMode(false);
  setSelectedIds(new Set());

  setClothes((currentClothes) => currentClothes.filter((clothing) => !ids.includes(clothing.id)));

  const results = await Promise.allSettled(ids.map((id) => deleteClothingItem(id)));
  const firstFailure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (firstFailure) {
    const error = firstFailure.reason;
    alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    // The optimistic removal above already dropped these from view; a
    // partial failure means some rows are still alive server-side, so a
    // refetch is what puts things back in sync instead of leaving stale
    // "deleted" items missing from the list until the next natural reload.
    loadClothes();
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
      updateOptionsItem(targetId, { imageDataUri: newImage });
    } catch (error) {
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    } finally {
      setProcessingImageUri(undefined);
    }
  }
}

  const filters = ['Tout', ...VestroCategories];

  // The 2/3 toggle sets a *target* card size (phone-sized cards), and we fit
  // as many of that size as the actual screen width allows — so a wide iPad
  // gets more columns of the same comfortable card size instead of 2-3 huge
  // stretched-out cards.
  const availableWidth = windowWidth - CONTENT_PADDING * 2;
  const targetCardWidth = columns === 2 ? 170 : 112;
  const numColumns = Math.max(
    columns,
    Math.floor((availableWidth + GRID_GAP) / (targetCardWidth + GRID_GAP))
  );
  const cardWidth = (availableWidth - GRID_GAP * (numColumns - 1)) / numColumns;

  const listHeader = (
    <>
      <RefreshingBadge visible={refreshing} color={VestroColors.ink} />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t('dressing.title')}</Text>
          <Text style={styles.count}>{t('dressing.count', { count: ownedClothes.length })}</Text>
          <TouchableOpacity style={styles.premiumBadge} onPress={() => setPaywallVisible(true)}>
            <Text style={styles.premiumBadgeText}>
              {isPremium && remainingCredits !== null
                ? `💎 ${remainingCredits}/${MONTHLY_PHOTO_LIMIT}`
                : t(isPremium ? 'premium.entryPointActive' : 'premium.entryPoint')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity onPress={toggleSelectionMode}>
            <Text style={styles.selectToggleText}>
              {t(selectionMode ? 'dressing.selectDone' : 'dressing.select')}
            </Text>
          </TouchableOpacity>

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

      <ScrollView
        horizontal
        style={styles.filtersScroll}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
      >
        {filters.map((category) => {
          const active = selectedCategory === category;

          return (
            <TouchableOpacity
              key={category}
              style={active ? styles.activeFilter : styles.filter}
              onPress={() => setSelectedCategory(category)}
            >
              <Text
                style={active ? styles.activeFilterText : styles.filterText}
              >
                {category === 'Tout' ? t('dressing.filterAll') : tCategory(category)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView
        horizontal
        style={[styles.filtersScroll, styles.subFiltersScroll]}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.subFilters}
      >
        <TouchableOpacity
          style={showAvailableOnly ? styles.activeFilter : styles.filter}
          onPress={() => setShowAvailableOnly((current) => !current)}
        >
          <Text style={showAvailableOnly ? styles.activeFilterText : styles.filterText}>
            {t('dressing.filterAvailable')}
          </Text>
        </TouchableOpacity>

        {VestroPalette.map((swatch) => {
          const active = colorFilter === swatch.hex;

          return (
            <TouchableOpacity
              key={swatch.hex}
              style={styles.colorFilterDotWrap}
              onPress={() => setColorFilter(active ? undefined : swatch.hex)}
            >
              <View
                style={[
                  styles.colorFilterDot,
                  { backgroundColor: swatch.hex },
                  active && styles.colorFilterDotActive,
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </>
  );

  return (
    <ScreenBackground style={styles.screen}>
      <FlatList
        key={numColumns}
        data={filteredClothes}
        keyExtractor={(item) => String(item.id)}
        numColumns={numColumns}
        columnWrapperStyle={styles.gridRow}
        ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
        contentContainerStyle={[styles.content, selectionMode && styles.contentWithSelectionBar]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={VestroColors.ink} />
        }
        ListHeaderComponent={listHeader}
        // Only the ~6-8 cards actually on screen mount at once, instead of
        // every clothing item downloading and decoding its image
        // simultaneously the moment this screen opens.
        windowSize={5}
        initialNumToRender={8}
        renderItem={({ item }) => {
          const isSelected = selectedIds.has(item.id);

          return (
          <TouchableOpacity
            style={[styles.card, { width: cardWidth }]}
            onPress={() => handleCardPress(item)}
            onLongPress={() => handleCardLongPress(item)}
          >
            <View style={styles.imageWrap}>
              {selectionMode && (
                <View style={[styles.checkBadge, isSelected && styles.checkBadgeActive]}>
                  {isSelected && <Text style={styles.checkGlyph}>✓</Text>}
                </View>
              )}

              {item.image ? (
                <StickerImage
                  uri={item.image}
                  cacheKey={item.imagePath}
                  containerStyle={[
                    { width: cardWidth, height: cardWidth },
                    item.available === false && styles.unavailableVisual,
                  ]}
                />
              ) : (
                <View
                  style={[
                    styles.imagePlaceholder,
                    { width: cardWidth, height: cardWidth },
                    { backgroundColor: item.color ?? VestroColors.tints[item.category] },
                    item.available === false && styles.unavailableVisual,
                  ]}
                />
              )}

              {item.available === false && (
                <View style={styles.unavailableBanner}>
                  <Text style={styles.unavailableBannerText} numberOfLines={1}>
                    {t('dressing.unavailableLabel')}
                  </Text>
                </View>
              )}
            </View>

            <Text
              style={[styles.itemName, { marginTop: columns === 2 ? 4 : 8 }]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            <View style={styles.itemMetaRow}>
              {columns === 2 && <Text style={styles.category}>{tCategory(item.category)}</Text>}
              {item.price !== undefined && (
                <Text style={styles.price}>{formatPrice(item.price, language)}</Text>
              )}
            </View>
            {item.available === false && item.unavailableReason && (
              <Text style={styles.unavailableLabel} numberOfLines={1}>
                {item.unavailableReason}
              </Text>
            )}
          </TouchableOpacity>
          );
        }}
      />

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
            onPress={handleBulkMoveToWishlist}
          >
            <Text
              style={[
                styles.selectionBarButtonText,
                selectedIds.size === 0 && styles.selectionBarButtonTextDisabled,
              ]}
            >
              {t('dressing.bulkMoveToWishlist')}
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
        onRename={(name) => optionsItem && updateOptionsItem(optionsItem.id, { name })}
        onChangeCategory={(category) => optionsItem && updateOptionsItem(optionsItem.id, { category })}
        onChangePrice={(price) => optionsItem && updateOptionsItem(optionsItem.id, { price })}
        onChangeAvailability={(available, reason) =>
          optionsItem &&
          updateOptionsItem(optionsItem.id, {
            available,
            unavailableReason: available ? undefined : reason?.trim() || undefined,
          })
        }
        onRequestColorChange={() => {
          if (!optionsItem) return;
          const targetId = optionsItem.id;
          openColorPicker((color) => updateOptionsItem(targetId, { color }));
        }}
        onRequestPhotoChange={handleOptionsPhotoChange}
        moveAction={{
          label: t('dressing.moveToWishlist'),
          onPress: () => optionsItem && updateOptionsItem(optionsItem.id, { status: 'wishlist' }),
        }}
        onDelete={() => {
          if (!optionsItem) return;
          const targetId = optionsItem.id;
          setClothes((currentClothes) => currentClothes.filter((clothing) => clothing.id !== targetId));
          setOptionsItemId(null);
          deleteClothingItem(targetId).catch((error) =>
            alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error))
          );
        }}
      />

      <PaywallModal
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        onPremiumChange={setIsPremium}
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
  premiumBadge: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: VestroColors.accent,
  },
  premiumBadgeText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: VestroColors.buttonText,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  selectToggleText: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.ink,
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
  subFilters: {
    gap: 14,
    marginTop: 16,
    alignItems: 'center',
  },
  colorFilterDotWrap: {
    padding: 3,
  },
  colorFilterDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: VestroColors.border,
  },
  colorFilterDotActive: {
    borderWidth: 2,
    borderColor: VestroColors.ink,
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
  subFiltersScroll: {
    marginBottom: 24,
  },
  gridRow: {
    gap: GRID_GAP,
  },
  card: {},
  imagePlaceholder: {},
  itemName: {
    marginTop: 8,
    fontFamily: VestroFonts.serifMedium,
    fontSize: 12,
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
  imageWrap: {
    position: 'relative',
  },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
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
  unavailableVisual: {
    opacity: 0.4,
  },
  unavailableBanner: {
    position: 'absolute',
    top: 10,
    left: -6,
    right: -6,
    backgroundColor: '#DC2626',
    paddingVertical: 4,
    transform: [{ rotate: '-4deg' }],
  },
  unavailableBannerText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  unavailableLabel: {
    marginTop: 4,
    fontFamily: VestroFonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.accent,
  },
});