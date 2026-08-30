import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { OutfitPreview } from '@/components/outfit-canvas';
import { RefreshingBadge } from '@/components/refreshing-badge';
import { ScreenBackground } from '@/components/screen-background';
import { AppColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { fetchActiveLook, saveActiveLook, subscribeToActiveLookChanged } from '@/lib/active-look';
import { alert } from '@/lib/alert';
import { fetchClothingItems } from '@/lib/clothing';
import { deleteOutfit, fetchOutfits } from '@/lib/outfits';
import { useAppTheme } from '@/theme/context';
import type { ClothingItem, Outfit } from '@/types/clothing';

// Content horizontal padding (styles.content) and inter-card gap — kept as
// constants so the column-count math below stays readable. Same approach as
// the Dressing tab: fit as many comfortable, phone-sized cards as the actual
// screen width allows, instead of always doing 2 columns stretched to fill
// whatever width is available (which turns into huge cards on a wide iPad).
const CONTENT_PADDING = 20;
const GRID_GAP = 20;
const TARGET_CARD_WIDTH = 170;

function OutfitCard({
  outfit,
  items,
  cardWidth,
  selectionMode,
  isSelected,
  onPress,
  onLongPress,
  onWear,
  isWorn,
}: {
  outfit: Outfit;
  items: ClothingItem[];
  cardWidth: number;
  selectionMode: boolean;
  isSelected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onWear: () => void;
  isWorn: boolean;
}) {
  const { t, tPlural } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const [size, setSize] = useState(0);

  function handleLayout(event: LayoutChangeEvent) {
    setSize(event.nativeEvent.layout.width);
  }

  return (
    <TouchableOpacity
      style={[styles.card, { width: cardWidth }]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View style={styles.previewWrap} onLayout={handleLayout}>
        {selectionMode && (
          <View style={[styles.checkBadge, isSelected && styles.checkBadgeActive]}>
            {isSelected && <Text style={styles.checkGlyph}>✓</Text>}
          </View>
        )}

        {!selectionMode && (
          <TouchableOpacity
            style={[styles.wearQuickButton, isWorn && styles.wearQuickButtonActive]}
            onPress={onWear}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t(isWorn ? 'home.currentlyWornBadge' : 'home.wearButton')}
          >
            <Ionicons
              name={isWorn ? 'shirt' : 'shirt-outline'}
              size={14}
              color={VestroColors.buttonText}
            />
          </TouchableOpacity>
        )}

        {size > 0 && (
          <OutfitPreview
            items={items}
            layout={outfit.layout ?? {}}
            size={size}
            showPrice={outfit.showPrice}
          />
        )}
      </View>

      <Text style={styles.itemName} numberOfLines={1}>
        {outfit.name}
      </Text>
      <Text style={styles.itemMeta}>
        {tPlural('outfits.pieceCount', items.length)}
      </Text>
    </TouchableOpacity>
  );
}

export default function TenuesScreen() {
  const { t, tPlural } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const { width: windowWidth } = useWindowDimensions();
  const [clothes, setClothes] = useState<ClothingItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteConfirmVisible, setBulkDeleteConfirmVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeLookItemIds, setActiveLookItemIds] = useState<number[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const availableWidth = windowWidth - CONTENT_PADDING * 2;
  const numColumns = Math.max(
    2,
    Math.floor((availableWidth + GRID_GAP) / (TARGET_CARD_WIDTH + GRID_GAP))
  );
  const cardWidth = (availableWidth - GRID_GAP * (numColumns - 1)) / numColumns;

  const loadData = useCallback(async () => {
    try {
      const [loadedClothes, loadedOutfits] = await Promise.all([
        fetchClothingItems(),
        fetchOutfits(),
      ]);
      setClothes(loadedClothes);
      setOutfits(loadedOutfits);
    } catch (error) {
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  useEffect(() => {
    async function loadActiveLook() {
      try {
        const look = await fetchActiveLook();
        setActiveLookItemIds(look?.itemIds ?? []);
      } catch (error) {
        alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
      }
    }

    loadActiveLook();
    return subscribeToActiveLookChanged(loadActiveLook);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function isOutfitWorn(outfit: Outfit) {
    if (activeLookItemIds === null) return false;
    return (
      activeLookItemIds.length === outfit.itemIds.length &&
      activeLookItemIds.every((itemId) => outfit.itemIds.includes(itemId))
    );
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
      current.size === outfits.length ? new Set() : new Set(outfits.map((outfit) => outfit.id))
    );
  }

  function handleCardPress(outfit: Outfit) {
    if (selectionMode) {
      toggleItemSelected(outfit.id);
      return;
    }
    router.push(`/create-outfit?id=${outfit.id}`);
  }

  // Lets a user equip an outfit straight from the grid instead of having to
  // open the full editor (name field, category tabs, delete button) just to
  // reach the "wear this outfit" button buried inside it. Stays right here —
  // the card's icon flips to the filled/worn state via isOutfitWorn once
  // activeLookItemIds updates (saveActiveLook triggers that through
  // subscribeToActiveLookChanged above), no navigation needed.
  async function handleQuickWear(outfit: Outfit) {
    try {
      await saveActiveLook({ itemIds: outfit.itemIds, layout: outfit.layout ?? {} });
    } catch (error) {
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    }
  }

  function handleCardLongPress(outfit: Outfit) {
    if (selectionMode) return;
    setSelectionMode(true);
    setSelectedIds(new Set([outfit.id]));
  }

  async function confirmBulkDelete() {
    const ids = [...selectedIds];

    setIsDeleting(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteOutfit(id)));
      const failedIds = new Set(
        ids.filter((_, index) => results[index].status === 'rejected')
      );

      setOutfits((current) => current.filter((outfit) => !ids.includes(outfit.id) || failedIds.has(outfit.id)));
      setBulkDeleteConfirmVisible(false);
      setSelectionMode(false);
      setSelectedIds(new Set());

      if (failedIds.size > 0) {
        const firstFailure = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        );
        const error = firstFailure?.reason;
        alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
      }
    } finally {
      setIsDeleting(false);
    }
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
            <Text style={styles.title}>{t('outfits.title')}</Text>
            <Text style={styles.count}>{t('outfits.count', { count: outfits.length })}</Text>
          </View>

          <View style={styles.headerActions}>
            {outfits.length > 0 && (
              <TouchableOpacity onPress={toggleSelectionMode}>
                <Text style={styles.selectToggleText}>
                  {t(selectionMode ? 'dressing.selectDone' : 'dressing.select')}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.addButton}
              onPress={() => router.push('/create-outfit')}
            >
              <Text style={styles.addButtonGlyph}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {outfits.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{t('outfits.emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t('outfits.emptyText')}</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {outfits.map((outfit) => {
              const items = outfit.itemIds
                .map((id) => clothes.find((c) => c.id === id))
                .filter((item): item is ClothingItem => Boolean(item));

              return (
                <OutfitCard
                  key={outfit.id}
                  outfit={outfit}
                  items={items}
                  cardWidth={cardWidth}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.has(outfit.id)}
                  onPress={() => handleCardPress(outfit)}
                  onLongPress={() => handleCardLongPress(outfit)}
                  onWear={() => handleQuickWear(outfit)}
                  isWorn={isOutfitWorn(outfit)}
                />
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

          <TouchableOpacity
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
      )}

      <ConfirmModal
        visible={bulkDeleteConfirmVisible}
        title={tPlural('outfits.bulkDeleteConfirmTitle', selectedIds.size)}
        message={t('dressing.bulkDeleteConfirmMessage')}
        confirmLabel={isDeleting ? t('createOutfit.deleting') : t('dressing.bulkDelete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={confirmBulkDelete}
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
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: VestroColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonGlyph: {
    fontFamily: VestroFonts.serifMedium,
    fontSize: 18,
    color: VestroColors.ink,
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
  // No aspectRatio here on purpose: OutfitPreview now renders at the real
  // 340x420 board proportions (see outfit-canvas.tsx) instead of being
  // squeezed into a square, so this wrapper just lets that height happen
  // naturally instead of fighting it with a mismatched fixed ratio.
  previewWrap: {
    width: '100%',
    position: 'relative',
  },
  itemName: {
    marginTop: 9,
    fontFamily: VestroFonts.serifMedium,
    fontSize: 14,
    color: VestroColors.ink,
  },
  itemMeta: {
    marginTop: 3,
    fontFamily: VestroFonts.sans,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
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
  wearQuickButton: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 1,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: VestroColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wearQuickButtonActive: {
    backgroundColor: VestroColors.accent,
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
