import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { CANVAS_REFERENCE_SIZE, CanvasLayout, OutfitCanvas } from '@/components/outfit-canvas';
import { StickerImage } from '@/components/sticker-image';
import { ToggleSwitch } from '@/components/toggle-switch';
import { AppColors, VestroCategories, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { fetchActiveLook, saveActiveLook, subscribeToActiveLookChanged } from '@/lib/active-look';
import { alert } from '@/lib/alert';
import { fetchClothingItems } from '@/lib/clothing';
import { deleteOutfit, fetchOutfits, insertOutfit, updateOutfit } from '@/lib/outfits';
import { useAppTheme } from '@/theme/context';
import type { ClothingItem } from '@/types/clothing';

const DESTRUCTIVE_RED = '#DC2626';
// Mirrors styles.content's paddingHorizontal and maxWidth below — shared so
// the fallback-width calc in the canvas resize effect can never silently
// drift out of sync with what that style actually renders.
const CONTENT_HORIZONTAL_PADDING = 20;
const CONTENT_MAX_WIDTH = 480;

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
  const [confirmClearVisible, setConfirmClearVisible] = useState(false);
  // null = not loaded yet, so the wear button never flashes "worn" before
  // this resolves — same pattern as the home screen (see index.tsx).
  const [activeLookItemIds, setActiveLookItemIds] = useState<number[] | null>(null);
  // Item positions are stored as fractions of the canvas size (see
  // outfit-canvas.tsx), so they always fill whatever box is rendered here —
  // this screen scrolls, so there's room to be generous and use the same
  // proportions as the original canvas design (taller than it is wide).
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  function handleCanvasWrapLayout(event: LayoutChangeEvent) {
    const { width } = event.nativeEvent.layout;
    const height = Math.round((width * CANVAS_REFERENCE_SIZE.height) / CANVAS_REFERENCE_SIZE.width);
    setCanvasSize({ width, height });
  }

  // onLayout normally refires whenever this view's own size changes, but
  // iPad multitasking (Split View, Slide Over) and rotation don't always
  // trigger that reliably — when it doesn't, the board keeps rendering at
  // its old size while its own overflow: hidden frame is now sized (via
  // width/height props below) for a window that no longer exists, cutting
  // off whatever no longer fits, most often its bottom. Blanking canvasSize
  // on every window resize forces the canvas to stay hidden until a fresh
  // onLayout actually lands, instead of ever risking staying stuck at a
  // stale size.
  useEffect(() => {
    setCanvasSize({ width: 0, height: 0 });

    // Belt-and-suspenders for the exact failure mode this effect exists to
    // work around: if onLayout genuinely never refires after this resize,
    // don't leave the board hidden forever either — after a brief grace
    // period for the real onLayout to land first, fall back to a width
    // computed straight from the window itself (same formula the actual
    // layout resolves to, given content's fixed padding above).
    const fallback = setTimeout(() => {
      setCanvasSize((current) => {
        if (current.width > 0) return current;
        const width = Math.min(windowWidth, CONTENT_MAX_WIDTH) - CONTENT_HORIZONTAL_PADDING * 2;
        const height = Math.round((width * CANVAS_REFERENCE_SIZE.height) / CANVAS_REFERENCE_SIZE.width);
        return { width, height };
      });
    }, 400);

    return () => clearTimeout(fallback);
  }, [windowWidth, windowHeight]);

  const [activeCategory, setActiveCategory] = useState('Hauts');

  useEffect(() => {
    async function loadData() {
      try {
        const parsedClothes = await fetchClothingItems();
        setClothes(parsedClothes);

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
        alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
      }

      setIsLoaded(true);
    }

    loadData();
  }, [id]);

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

  function toggleSelect(category: string, itemId: number) {
    setSelected((current) => {
      const currentIds = current[category] ?? [];
      const nextIds = currentIds.includes(itemId)
        ? currentIds.filter((id) => id !== itemId)
        : [...currentIds, itemId];

      return { ...current, [category]: nextIds };
    });
  }

  // Merges onto whatever's already saved for this item rather than
  // replacing it outright — OutfitCanvas can call this with just a z bump
  // (from tapping/selecting an item, no real position yet) or with just a
  // position (from an actual drag/resize, which doesn't resend z) and
  // either one must leave the other field(s) already saved for that item
  // intact instead of wiping them back to undefined.
  function handleLayoutChange(itemId: number, next: CanvasLayout) {
    setLayout((current) => ({ ...current, [itemId]: { ...current[itemId], ...next } }));
  }

  // Clears every saved position so all items fall back to the automatic,
  // overlap-free grid (see autoGridLayout in outfit-canvas.tsx) — the way
  // out for outfits whose positions were saved before that grid existed,
  // which otherwise have no way to self-correct back to a clean layout.
  // Empties the board. Leaves `layout` alone so an item added back later
  // still remembers where it used to sit — this never repositions anything
  // on its own, only removes what the user explicitly asked to clear.
  function clearBoard() {
    setSelected({});
    setConfirmClearVisible(false);
  }

  // Shared by saveOutfit and wearThisOutfit below — both need the same
  // itemIds/layout pair, trimmed to just the items still actually selected
  // (a saved layout can carry stale entries for items removed since).
  function selectedLookPayload() {
    const itemIds = Object.values(selected).flat();
    const itemIdSet = new Set(itemIds);
    const savedLayout = Object.fromEntries(
      Object.entries(layout).filter(([itemId]) => itemIdSet.has(Number(itemId)))
    );

    return { itemIds, layout: savedLayout };
  }

  // Same itemIds-only comparison as the home screen's isCurrentlyWorn — the
  // board's exact positions don't matter for "worn", only which clothes.
  const currentItemIds = Object.values(selected).flat();
  const isCurrentlyWorn =
    activeLookItemIds !== null &&
    activeLookItemIds.length === currentItemIds.length &&
    activeLookItemIds.every((itemId) => currentItemIds.includes(itemId));

  async function saveOutfit() {
    const { itemIds, layout: savedLayout } = selectedLookPayload();

    if (!name.trim()) {
      alert(t('createOutfit.missingNameTitle'), t('createOutfit.missingNameMessage'));
      return;
    }

    if (itemIds.length === 0) {
      alert(t('common.emptyOutfitTitle'), t('common.emptyOutfitMessage'));
      return;
    }

    try {
      if (id) {
        await updateOutfit(Number(id), { name: name.trim(), itemIds, layout: savedLayout, showPrice });
      } else {
        await insertOutfit({ name: name.trim(), itemIds, layout: savedLayout, showPrice });
      }
    } catch (error) {
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
      return;
    }

    router.back();
  }

  // Sets this outfit as today's active look and stays right here — the
  // button below flips to the same "currently worn" badge the home screen
  // shows, via isCurrentlyWorn above, instead of navigating anywhere.
  async function wearThisOutfit() {
    const { itemIds, layout: savedLayout } = selectedLookPayload();

    if (itemIds.length === 0) {
      alert(t('common.emptyOutfitTitle'), t('common.emptyOutfitMessage'));
      return;
    }

    try {
      await saveActiveLook({ itemIds, layout: savedLayout });
      // No success alert here on purpose: this screen is a native modal
      // presentation (see app/_layout.tsx), and AlertHost's confirmation is
      // ALSO a native Modal — showing one on top of the other and then
      // dismissing both in quick succession (tap the alert's OK, then Cancel
      // or swipe to leave) races two overlapping UIKit modal transitions,
      // which is what was freezing the app after "wear this outfit" from a
      // recently-viewed outfit. isCurrentlyWorn already flips this screen's
      // button to the worn banner the instant the save lands, which is
      // confirmation enough without a second modal to dismiss.
    } catch (error) {
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    }
  }

  // Items already in the outfit stay visible on the board even if they've
  // since become unavailable or moved to the wishlist (clothes, above, is
  // deliberately unfiltered so it always matches what the Tenues preview
  // resolves outfit.itemIds against) — but only owned, available items
  // should be offered as new additions here.
  const pickableClothes = clothes.filter(
    (item) => (!item.status || item.status === 'owned') && item.available !== false
  );
  const availableCategories = VestroCategories.filter((category) =>
    pickableClothes.some((item) => item.category === category)
  );
  const currentCategory = availableCategories.includes(activeCategory as (typeof VestroCategories)[number])
    ? activeCategory
    : availableCategories[0];
  const currentCategoryItems = pickableClothes.filter((item) => item.category === currentCategory);

  async function confirmDelete() {
    if (!id) return;

    setIsDeleting(true);
    try {
      await deleteOutfit(Number(id));
      router.back();
    } catch (error) {
      setIsDeleting(false);
      setConfirmDeleteVisible(false);
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
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
          <View style={styles.canvasWrap} onLayout={handleCanvasWrapLayout}>
            {canvasSize.width > 0 && (
              <OutfitCanvas
                items={Object.values(selected)
                  .flat()
                  .map((itemId) => clothes.find((item) => item.id === itemId))
                  .filter((item): item is ClothingItem => Boolean(item))}
                layout={layout}
                onLayoutChange={handleLayoutChange}
                width={canvasSize.width}
                height={canvasSize.height}
                showPrice={showPrice}
              />
            )}

            {isEditing && (
              isCurrentlyWorn ? (
                // Still tappable, not just a static badge — isCurrentlyWorn only
                // compares which clothes are selected, not their board positions,
                // so re-arranging items on an outfit that's already "worn" leaves
                // this showing worn with nothing to press to save the new
                // positions. Tapping re-runs wearThisOutfit, which always saves
                // whatever's live on the board right now.
                <TouchableOpacity style={styles.wornBanner} onPress={wearThisOutfit}>
                  <Text style={styles.wornBannerCheck}>✓</Text>
                  <Text style={styles.wornBannerText}>{t('home.currentlyWornBadge')}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.wearOutfitButton} onPress={wearThisOutfit}>
                  <Text style={styles.wearOutfitButtonText}>{t('createOutfit.wearThisOutfit')}</Text>
                </TouchableOpacity>
              )
            )}

            <View style={styles.priceToggleRow}>
              <Text style={styles.priceToggleLabel}>{t('createOutfit.showPrice')}</Text>
              <ToggleSwitch value={showPrice} onValueChange={setShowPrice} colors={VestroColors} />
            </View>

            {Object.values(selected).flat().length > 0 && (
              <View style={styles.boardLinksRow}>
                <TouchableOpacity onPress={() => setConfirmClearVisible(true)}>
                  <Text style={styles.boardLinkText}>{t('createOutfit.clearBoard')}</Text>
                </TouchableOpacity>
              </View>
            )}
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
                      <StickerImage
                        uri={item.image}
                        cacheKey={item.imagePath}
                        containerStyle={styles.thumbnailImage}
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

      <ConfirmModal
        visible={confirmClearVisible}
        title={t('createOutfit.clearBoardConfirmTitle')}
        message={t('createOutfit.clearBoardConfirmMessage')}
        confirmLabel={t('createOutfit.clearBoard')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={clearBoard}
        onCancel={() => setConfirmClearVisible(false)}
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
    paddingHorizontal: CONTENT_HORIZONTAL_PADDING,
    paddingBottom: 60,
    // Otherwise every row here (header, name input, category tabs, item
    // thumbnails) stretches the full width of a wide iPad screen — capping
    // the whole column, not just the board below, keeps the entire editor a
    // comfortable, phone-like width and centers it in the extra space.
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
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
  wearOutfitButton: {
    marginTop: 14,
    height: 46,
    backgroundColor: VestroColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wearOutfitButtonText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: VestroColors.buttonText,
  },
  wornBanner: {
    marginTop: 14,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: VestroColors.accent,
  },
  wornBannerCheck: {
    fontFamily: VestroFonts.sansBold,
    fontSize: 16,
    color: VestroColors.buttonText,
  },
  wornBannerText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: VestroColors.buttonText,
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
  boardLinksRow: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 20,
  },
  boardLinkText: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
    textDecorationLine: 'underline',
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
