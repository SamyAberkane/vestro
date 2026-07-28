import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '@/auth/context';
import { LanguagePickerModal } from '@/components/language-picker-modal';
import { CANVAS_REFERENCE_SIZE, CanvasLayout, OutfitCanvas, OutfitPreview } from '@/components/outfit-canvas';
import { SaveOutfitModal } from '@/components/save-outfit-modal';
import { AppColors, VestroCategories, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { LANGUAGES, MONTHS } from '@/i18n/translations';
import { fetchActiveLook, saveActiveLook } from '@/lib/active-look';
import { fetchClothingItems } from '@/lib/clothing';
import { fetchOutfits, insertOutfit } from '@/lib/outfits';
import { supabase } from '@/lib/supabase';
import { useAppTheme } from '@/theme/context';
import type { ActiveLook, ClothingItem, Outfit } from '@/types/clothing';
import { CurrentWeather, fetchCurrentWeather } from '@/utils/weather';

function dayOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

const RECENT_OUTFIT_PREVIEW_SIZE = 96;

export default function HomeScreen() {
  const { t, tCategory, tPlural, language } = useI18n();
  const { firstName } = useAuth();
  const { scheme, colors: VestroColors, setScheme } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const [clothes, setClothes] = useState<ClothingItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [layout, setLayout] = useState<Record<number, CanvasLayout>>({});
  const [activeCategory, setActiveCategory] = useState('Hauts');
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [showPrice, setShowPrice] = useState(false);
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [languagePickerVisible, setLanguagePickerVisible] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [recentOutfits, setRecentOutfits] = useState<Outfit[]>([]);

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

  useFocusEffect(
    useCallback(() => {
      async function loadData() {
        try {
          const parsedClothes = await fetchClothingItems();
          setClothes(parsedClothes);

          const {
            data: { user },
          } = await supabase.auth.getUser();
          const { data: entitlement } = user
            ? await supabase
                .from('premium_entitlements')
                .select('*')
                .eq('user_id', user.id)
                .maybeSingle()
            : { data: null };

          console.log('[Vestro] Compte connecté:', user);
          console.log('[Vestro] Abonnement:', entitlement);
          console.log(`[Vestro] Vêtements (${parsedClothes.length}):`, parsedClothes);

          const look: ActiveLook | null = await fetchActiveLook();

          if (look) {
            const initialSelected: Record<string, number[]> = {};

            look.itemIds.forEach((itemId) => {
              const item = parsedClothes.find((c) => c.id === itemId);
              if (item) {
                initialSelected[item.category] = [
                  ...(initialSelected[item.category] ?? []),
                  item.id,
                ];
              }
            });

            setSelected(initialSelected);
            setLayout(look.layout ?? {});
          }

          setRecentOutfits(await fetchOutfits());
        } catch (error) {
          Alert.alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
        }

        setIsLoaded(true);
      }

      loadData();
    }, [])
  );

  const ownedClothes = clothes.filter(
    (item) => (!item.status || item.status === 'owned') && item.available !== false
  );

  // Always show every category (not just ones you already own an item in) —
  // otherwise a category tab can disappear/reappear as you add or remove
  // items, which reads as items "missing" from the picker.
  const availableCategories: string[] = [...VestroCategories];
  const currentCategory = availableCategories.includes(activeCategory)
    ? activeCategory
    : availableCategories[0];
  const currentCategoryItems = ownedClothes.filter(
    (item) => item.category === currentCategory
  );

  const selectedItems = Object.values(selected)
    .flat()
    .map((itemId) => clothes.find((item) => item.id === itemId))
    .filter((item): item is ClothingItem => Boolean(item));

  const recentOutfitsWithItems = recentOutfits.slice(0, 8).map((outfit) => ({
    outfit,
    items: outfit.itemIds
      .map((itemId) => clothes.find((item) => item.id === itemId))
      .filter((item): item is ClothingItem => Boolean(item)),
  }));

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

  // Deriving height from the measured width (rather than also measuring and
  // using the container's own height) keeps the board's box exactly the
  // reference proportions on any device, in either orientation — the same
  // fix as the create-outfit screen.
  function handleCanvasAreaLayout(event: LayoutChangeEvent) {
    const { width } = event.nativeEvent.layout;
    const height = Math.round((width * CANVAS_REFERENCE_SIZE.height) / CANVAS_REFERENCE_SIZE.width);
    setCanvasSize({ width, height });
  }

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
      Alert.alert(t('common.emptyOutfitTitle'), t('common.emptyOutfitMessage'));
      return;
    }

    try {
      await saveActiveLook(currentLookPayload());
      Alert.alert(t('home.wornTitle'), t('home.wornMessage'));
    } catch (error) {
      Alert.alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    }
  }

  function saveOutfit() {
    if (selectedItems.length === 0) {
      Alert.alert(t('common.emptyOutfitTitle'), t('common.emptyOutfitMessage'));
      return;
    }

    setSaveModalVisible(true);
  }

  async function confirmSaveOutfit(name: string) {
    setSaveModalVisible(false);

    try {
      await insertOutfit({ name, ...currentLookPayload(), showPrice });
      Alert.alert(t('home.savedTitle'), t('home.savedMessage'));
    } catch (error) {
      Alert.alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    }
  }

  const today = new Date();

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.topBar}>
        <Text style={styles.logo}>Vestro</Text>

        <View style={styles.issueBlock}>
          <View style={styles.topBarIcons}>
            <TouchableOpacity onPress={() => setLanguagePickerVisible(true)}>
              <Text style={styles.languageFlag}>
                {LANGUAGES.find((option) => option.code === language)?.flag}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setScheme(scheme === 'dark' ? 'light' : 'dark')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('account.darkMode')}
            >
              <Text style={styles.languageFlag}>{scheme === 'dark' ? '☀️' : '🌙'}</Text>
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
        {isLoaded && canvasSize.height > 0 && (
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
        style={styles.itemRowScroll}
        contentContainerStyle={styles.itemRow}
      >
        {currentCategoryItems.map((item) => {
          const isSelected = selected[currentCategory]?.includes(item.id) ?? false;

          return (
            <TouchableOpacity
              key={item.id}
              style={styles.thumbnailWrap}
              onPress={() => toggleSelect(currentCategory, item.id)}
            >
              <View
                style={[
                  styles.thumbnail,
                  { backgroundColor: item.color ?? VestroColors.tints[item.category] },
                ]}
              >
                {item.image && (
                  <Image
                    source={{ uri: item.image }}
                    style={styles.thumbnailImage}
                    resizeMode="cover"
                  />
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
        <TouchableOpacity style={styles.wearButton} onPress={wearToday}>
          <Text style={styles.wearButtonText}>{t('home.wearButton')}</Text>
        </TouchableOpacity>

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
    </View>
  );
}

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: VestroColors.background,
    paddingTop: 54,
    paddingHorizontal: 20,
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
    maxWidth: 480,
    alignSelf: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  logo: {
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 26,
    letterSpacing: 0.5,
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

