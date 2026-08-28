import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAuth } from '@/auth/context';
import { ConfirmModal } from '@/components/confirm-modal';
import { LanguagePickerModal } from '@/components/language-picker-modal';
import { CANVAS_REFERENCE_SIZE, CanvasLayout, OutfitCanvas, OutfitPreview } from '@/components/outfit-canvas';
import { SaveOutfitModal } from '@/components/save-outfit-modal';
import { ScreenBackground } from '@/components/screen-background';
import { StickerImage } from '@/components/sticker-image';
import { AppColors, VestroCategories, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { LANGUAGES, MONTHS } from '@/i18n/translations';
import { fetchActiveLook, saveActiveLook, subscribeToActiveLookChanged } from '@/lib/active-look';
import { alert } from '@/lib/alert';
import { fetchClothingItems, fetchClothingItemsByIds } from '@/lib/clothing';
import { fetchOutfits, insertOutfit } from '@/lib/outfits';
import { type ColorScheme, useAppTheme } from '@/theme/context';
import type { ClothingItem, Outfit } from '@/types/clothing';
import { CurrentWeather, fetchCurrentWeather } from '@/utils/weather';

// The icon shown is the theme a tap switches TO, not the current one —
// light shows the moon you're about to get, dark shows the next gem theme,
// amethyst shows the sun that brings you back to light.
const NEXT_SCHEME: Record<ColorScheme, ColorScheme> = {
  light: 'dark',
  dark: 'amethyst',
  amethyst: 'light',
};

const SCHEME_ICON: Record<ColorScheme, string> = {
  light: '🌙',
  dark: '💎',
  amethyst: '☀️',
};

function dayOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

const RECENT_OUTFIT_PREVIEW_SIZE = 96;
// Mirrors styles.screen's paddingHorizontal and styles.content's maxWidth
// below — shared so the fallback-width calc in the resize effect can never
// silently drift out of sync with what those styles actually render.
const SCREEN_HORIZONTAL_PADDING = 20;
const CONTENT_MAX_WIDTH = 480;

export default function HomeScreen() {
  const { t, tCategory, tPlural, language } = useI18n();
  const { firstName } = useAuth();
  const { scheme, colors: VestroColors, setScheme } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const [clothes, setClothes] = useState<ClothingItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [layout, setLayout] = useState<Record<number, CanvasLayout>>({});
  const [activeCategories, setActiveCategories] = useState<string[]>(['Hauts']);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [showPrice, setShowPrice] = useState(false);
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [languagePickerVisible, setLanguagePickerVisible] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [confirmClearVisible, setConfirmClearVisible] = useState(false);
  const [recentOutfits, setRecentOutfits] = useState<Outfit[]>([]);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // null = not loaded yet (see isActiveLookLoaded below) — distinguishes
  // "we don't know yet" from "you have no active look", so the worn/unsaved
  // badge never flashes the wrong state before the first fetch resolves.
  const [activeLookItemIds, setActiveLookItemIds] = useState<number[] | null>(null);
  const [isActiveLookLoaded, setIsActiveLookLoaded] = useState(false);

  function formatIssueDate(date: Date) {
    const day = date.getDate().toString().padStart(2, '0');
    return `${day} ${MONTHS[language][date.getMonth()]}`;
  }

  useEffect(() => {
    async function loadWeather() {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) return;

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const current = await fetchCurrentWeather(
        position.coords.latitude,
        position.coords.longitude
      );

      setWeather(current);
    }

    loadWeather();
  }, []);

  // Loads the saved active look ONCE per app session (mount) plus whenever
  // it's explicitly changed elsewhere (see subscribeToActiveLookChanged) —
  // deliberately NOT on every tab focus. This board used to reload from the
  // server every time this tab regained focus, silently discarding whatever
  // in-progress selection/layout the user hadn't saved yet the moment they
  // so much as glanced at another tab. Self-contained (fetches clothes
  // itself rather than reading the `clothes` state) so it's never at the
  // mercy of that state's own separate, focus-driven refresh below.
  const loadActiveLook = useCallback(async () => {
    try {
      const look = await fetchActiveLook();

      if (look) {
        const items = look.itemIds.length > 0 ? await fetchClothingItemsByIds(look.itemIds) : [];
        const itemById = new Map(items.map((item) => [item.id, item]));
        const initialSelected: Record<string, number[]> = {};

        look.itemIds.forEach((itemId) => {
          const item = itemById.get(itemId);
          if (item) {
            initialSelected[item.category] = [
              ...(initialSelected[item.category] ?? []),
              item.id,
            ];
          }
        });

        setSelected(initialSelected);
        setLayout(look.layout ?? {});
        setActiveLookItemIds(look.itemIds);
      } else {
        setActiveLookItemIds([]);
      }
    } catch (error) {
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    }

    setIsActiveLookLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadActiveLook();
  }, [loadActiveLook]);

  useEffect(() => subscribeToActiveLookChanged(loadActiveLook), [loadActiveLook]);

  // Everything else (wardrobe contents, recent outfits) still refreshes on
  // every focus — it's fine, even desirable, for that to reflect changes
  // made on other tabs; it's only the active look above that must NOT be
  // silently re-pulled from the server while the user might be mid-edit.
  useFocusEffect(
    useCallback(() => {
      async function loadFocusData() {
        try {
          const parsedClothes = await fetchClothingItems();
          setClothes(parsedClothes);
          setRecentOutfits(await fetchOutfits());
        } catch (error) {
          alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
        }

        setIsLoaded(true);
      }

      loadFocusData();
    }, [])
  );

  const ownedClothes = clothes.filter(
    (item) => (!item.status || item.status === 'owned') && item.available !== false
  );

  // Always show every category (not just ones you already own an item in) —
  // otherwise a category tab can disappear/reappear as you add or remove
  // items, which reads as items "missing" from the picker.
  const availableCategories: string[] = [...VestroCategories];
  // Several tabs can be active at once (see toggleActiveCategory) so you can
  // browse tops and bottoms together instead of round-tripping through one
  // category at a time — the row below just shows every owned item whose
  // category is in this set, in whatever order they're already fetched in.
  const currentCategoryItems = ownedClothes.filter((item) =>
    activeCategories.includes(item.category)
  );

  const selectedItems = Object.values(selected)
    .flat()
    .map((itemId) => clothes.find((item) => item.id === itemId))
    .filter((item): item is ClothingItem => Boolean(item));

  // Same set of items as what's actually saved as today's active look —
  // ignores exact board positions on purpose, since "worn" is about which
  // clothes, not their pixel arrangement. `activeLookItemIds` is null until
  // the very first load resolves, so this can't flash "unsaved" before then.
  const isCurrentlyWorn =
    activeLookItemIds !== null &&
    activeLookItemIds.length === selectedItems.length &&
    activeLookItemIds.every((id) => selectedItems.some((item) => item.id === id));

  const recentOutfitsWithItems = recentOutfits.slice(0, 8).map((outfit) => ({
    outfit,
    items: outfit.itemIds
      .map((itemId) => clothes.find((item) => item.id === itemId))
      .filter((item): item is ClothingItem => Boolean(item)),
  }));

  function toggleActiveCategory(category: string) {
    setActiveCategories((current) =>
      current.includes(category)
        ? current.filter((existing) => existing !== category)
        : [...current, category]
    );
  }

  function toggleSelect(category: string, itemId: number) {
    setSelected((current) => {
      const currentIds = current[category] ?? [];
      const nextIds = currentIds.includes(itemId)
        ? currentIds.filter((id) => id !== itemId)
        : [...currentIds, itemId];

      return { ...current, [category]: nextIds };
    });
  }

  // Empties the board without touching `layout` — an item added back later
  // still remembers where it used to sit.
  function clearBoard() {
    setSelected({});
    setConfirmClearVisible(false);
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

  // Deriving height from the measured width (rather than also measuring and
  // using the container's own height) keeps the board's box exactly the
  // reference proportions on any device, in either orientation — the same
  // fix as the create-outfit screen.
  function handleCanvasAreaLayout(event: LayoutChangeEvent) {
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
    // layout resolves to, given screen/content's fixed padding above).
    const fallback = setTimeout(() => {
      setCanvasSize((current) => {
        if (current.width > 0) return current;
        const width = Math.min(
          windowWidth - SCREEN_HORIZONTAL_PADDING * 2,
          CONTENT_MAX_WIDTH
        );
        const height = Math.round((width * CANVAS_REFERENCE_SIZE.height) / CANVAS_REFERENCE_SIZE.width);
        return { width, height };
      });
    }, 400);

    return () => clearTimeout(fallback);
  }, [windowWidth, windowHeight]);

  function currentLookPayload() {
    const itemIds = selectedItems.map((item) => item.id);
    const itemIdSet = new Set(itemIds);
    const savedLayout = Object.fromEntries(
      Object.entries(layout).filter(([itemId]) => itemIdSet.has(Number(itemId)))
    );

    return { itemIds, layout: savedLayout };
  }

  async function wearToday() {
    if (selectedItems.length === 0) {
      alert(t('common.emptyOutfitTitle'), t('common.emptyOutfitMessage'));
      return;
    }

    try {
      await saveActiveLook(currentLookPayload());
      alert(t('home.wornTitle'), t('home.wornMessage'));
    } catch (error) {
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    }
  }

  function saveOutfit() {
    if (selectedItems.length === 0) {
      alert(t('common.emptyOutfitTitle'), t('common.emptyOutfitMessage'));
      return;
    }

    setSaveModalVisible(true);
  }

  async function confirmSaveOutfit(name: string) {
    setSaveModalVisible(false);

    try {
      await insertOutfit({ name, ...currentLookPayload(), showPrice });
      alert(t('home.savedTitle'), t('home.savedMessage'));
    } catch (error) {
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    }
  }

  const today = new Date();

  return (
    <ScreenBackground style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.topBar}>
        <Text style={styles.logo} numberOfLines={2}>Crystal AI Closet</Text>

        <View style={styles.issueBlock}>
          <View style={styles.topBarIcons}>
            <TouchableOpacity onPress={() => setLanguagePickerVisible(true)}>
              <Text style={styles.languageFlag}>
                {LANGUAGES.find((option) => option.code === language)?.flag}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setScheme(NEXT_SCHEME[scheme])}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('account.darkMode')}
            >
              <Text style={styles.languageFlag}>{SCHEME_ICON[scheme]}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.issueText}>
            N° {dayOfYear(today).toString().padStart(3, '0')}
          </Text>
          <Text style={styles.issueText}>{formatIssueDate(today)}</Text>
          <TouchableOpacity onPress={() => router.push('/account')}>
            <Text style={styles.signOutLink}>{t('account.entryPoint')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.welcomeRow}>
        <Text style={styles.eyebrow}>
          {firstName ? t('home.greeting', { name: firstName.toUpperCase() }) : t('home.greetingNoName')}
        </Text>
        {weather && (
          <Text style={styles.weatherText}>
            {t(weather.descriptionKey)} · {Math.round(weather.temperature)}°
          </Text>
        )}
      </View>
      <Text style={styles.title}>{t('home.title')}</Text>

      <View style={styles.canvasArea} onLayout={handleCanvasAreaLayout}>
        {isLoaded && isActiveLookLoaded && canvasSize.height > 0 && (
          <OutfitCanvas
            items={selectedItems}
            layout={layout}
            onLayoutChange={handleLayoutChange}
            width={canvasSize.width}
            height={canvasSize.height}
            showPrice={showPrice}
          />
        )}
      </View>

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

      {selectedItems.length > 0 && (
        <TouchableOpacity
          style={styles.clearBoardButton}
          onPress={() => setConfirmClearVisible(true)}
        >
          <Text style={styles.clearBoardText}>{t('createOutfit.clearBoard')}</Text>
        </TouchableOpacity>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoryTabsScroll}
        contentContainerStyle={styles.categoryTabs}
      >
        {availableCategories.map((category) => {
          const active = activeCategories.includes(category);

          return (
            <TouchableOpacity
              key={category}
              onPress={() => toggleActiveCategory(category)}
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
        style={styles.itemRowScroll}
        contentContainerStyle={styles.itemRow}
      >
        {currentCategoryItems.map((item) => {
          const isSelected = selected[item.category]?.includes(item.id) ?? false;

          return (
            <TouchableOpacity
              key={item.id}
              style={styles.thumbnailWrap}
              onPress={() => toggleSelect(item.category, item.id)}
            >
              <View
                style={[
                  styles.thumbnail,
                  { backgroundColor: item.color ?? VestroColors.tints[item.category] },
                ]}
              >
                {item.image && (
                  <StickerImage uri={item.image} containerStyle={styles.thumbnailImage} resizeMode="cover" />
                )}
              </View>
              <View
                style={[
                  styles.thumbnailUnderline,
                  isSelected && styles.thumbnailUnderlineActive,
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.actions}>
        {isActiveLookLoaded && isCurrentlyWorn ? (
          <View style={styles.wornBanner}>
            <Text style={styles.wornBannerCheck}>✓</Text>
            <Text style={styles.wornBannerText}>{t('home.currentlyWornBadge')}</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.wearButton} onPress={wearToday}>
            <Text style={styles.wearButtonText}>{t('home.wearButton')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.saveLink} onPress={saveOutfit}>
          <Text style={styles.saveLinkText}>{t('home.saveOutfitLink')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.recentSection}>
        <View style={styles.recentHeader}>
          <Text style={styles.recentTitle}>{t('home.recentOutfitsTitle')}</Text>
          {recentOutfitsWithItems.length > 0 && (
            <TouchableOpacity onPress={() => router.push('/tenues')}>
              <Text style={styles.recentSeeAll}>{t('home.recentOutfitsSeeAll')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {recentOutfitsWithItems.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentRow}
          >
            {recentOutfitsWithItems.map(({ outfit, items }) => (
              <TouchableOpacity
                key={outfit.id}
                style={styles.recentCard}
                onPress={() => router.push(`/create-outfit?id=${outfit.id}`)}
              >
                <OutfitPreview
                  items={items}
                  layout={outfit.layout ?? {}}
                  size={RECENT_OUTFIT_PREVIEW_SIZE}
                  showPrice={outfit.showPrice}
                />
                <Text style={styles.recentCardName} numberOfLines={1}>
                  {outfit.name}
                </Text>
                <Text style={styles.recentCardMeta}>
                  {tPlural('outfits.pieceCount', items.length)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.recentEmpty}>
            <Text style={styles.recentEmptyText}>{t('home.recentOutfitsEmptyText')}</Text>
          </View>
        )}
      </View>
      </ScrollView>

      <LanguagePickerModal
        visible={languagePickerVisible}
        onClose={() => setLanguagePickerVisible(false)}
      />

      <SaveOutfitModal
        visible={saveModalVisible}
        onConfirm={confirmSaveOutfit}
        onCancel={() => setSaveModalVisible(false)}
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
    </ScreenBackground>
  );
}

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: 54,
    paddingHorizontal: SCREEN_HORIZONTAL_PADDING,
    paddingBottom: 10,
  },
  scroll: {
    flex: 1,
  },
  content: {
    // flexGrow (not flex) since this is a ScrollView's contentContainerStyle
    // — it lets the content stretch to fill a short screen without
    // preventing it from growing taller than the screen and scrolling on a
    // small phone.
    flexGrow: 1,
    paddingBottom: 20,
    // Otherwise this fills the whole screen width — fine on a phone, but on
    // a wide iPad it stretches the board, the wear button and every row
    // into oversized, awkward shapes. Capping it keeps the whole builder a
    // comfortable, phone-like width and centers it in the extra space
    // instead, same as the create-outfit screen's board.
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  logo: {
    flexShrink: 1,
    marginRight: 12,
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 19,
    lineHeight: 22,
    letterSpacing: 0.2,
    color: VestroColors.ink,
  },
  issueBlock: {
    alignItems: 'flex-end',
  },
  topBarIcons: {
    flexDirection: 'row',
    gap: 10,
  },
  languageFlag: {
    fontSize: 18,
    marginBottom: 4,
  },
  issueText: {
    fontFamily: VestroFonts.sans,
    fontSize: 10,
    letterSpacing: 1.5,
    color: VestroColors.muted,
    marginTop: 2,
  },
  signOutLink: {
    marginTop: 6,
    fontFamily: VestroFonts.sans,
    fontSize: 9,
    color: VestroColors.muted,
    textDecorationLine: 'underline',
  },
  welcomeRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 10,
    letterSpacing: 2.5,
    color: VestroColors.muted,
  },
  title: {
    marginTop: 0,
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 26,
    lineHeight: 30,
    color: VestroColors.ink,
  },
  weatherText: {
    fontFamily: VestroFonts.sans,
    fontSize: 11,
    color: VestroColors.muted,
  },
  canvasArea: {
    marginTop: 12,
  },
  priceToggleRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  priceToggleLabel: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 13,
    color: VestroColors.ink,
  },
  clearBoardButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  clearBoardText: {
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
    marginTop: 10,
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
  itemRowScroll: {
    // Fixed height (not just flexGrow/flexShrink: 0) so an empty category's
    // row doesn't collapse to 0 and hand its space to the canvas below —
    // that made the board resize as you switched tabs, which could strand
    // an already-placed item outside the (now smaller) visible canvas.
    height: 78,
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 8,
  },
  itemRow: {
    gap: 18,
  },
  thumbnailWrap: {
    alignItems: 'center',
  },
  thumbnail: {
    width: 54,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 2,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailUnderline: {
    marginTop: 8,
    width: 18,
    height: 1,
    backgroundColor: 'transparent',
  },
  thumbnailUnderlineActive: {
    height: 2,
    backgroundColor: VestroColors.ink,
  },
  actions: {
    marginTop: 10,
    alignItems: 'center',
  },
  wearButton: {
    width: '100%',
    height: 48,
    backgroundColor: VestroColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wearButtonText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 11,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: VestroColors.buttonText,
  },
  // Replaces the wear button entirely once today's board matches the saved
  // active look — bigger than the button it replaces (not smaller/fainter),
  // a plain View with no press handler at all, so there's nothing to tap
  // and no ambiguity that this is a state, not an action to repeat.
  wornBanner: {
    width: '100%',
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: VestroColors.accent,
  },
  wornBannerCheck: {
    fontFamily: VestroFonts.sansBold,
    fontSize: 18,
    color: VestroColors.buttonText,
  },
  wornBannerText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 13,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: VestroColors.buttonText,
  },
  saveLink: {
    marginTop: 8,
  },
  saveLinkText: {
    fontFamily: VestroFonts.serifMediumItalic,
    fontSize: 13,
    color: VestroColors.muted,
    textDecorationLine: 'underline',
  },
  recentSection: {
    marginTop: 28,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  recentTitle: {
    fontFamily: VestroFonts.serifMedium,
    fontSize: 16,
    color: VestroColors.ink,
  },
  recentSeeAll: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
    textDecorationLine: 'underline',
  },
  recentRow: {
    marginTop: 14,
    gap: 16,
  },
  recentEmpty: {
    marginTop: 14,
    minHeight: 140,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: VestroColors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  recentEmptyText: {
    textAlign: 'center',
    fontFamily: VestroFonts.serifMediumItalic,
    fontSize: 14,
    color: VestroColors.muted,
  },
  recentCard: {
    width: RECENT_OUTFIT_PREVIEW_SIZE,
  },
  recentCardName: {
    marginTop: 8,
    fontFamily: VestroFonts.serifMedium,
    fontSize: 12,
    color: VestroColors.ink,
  },
  recentCardMeta: {
    marginTop: 2,
    fontFamily: VestroFonts.sans,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
});

