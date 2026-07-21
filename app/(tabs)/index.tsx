import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { LanguagePickerModal } from '@/components/language-picker-modal';
import { CanvasLayout, OutfitCanvas } from '@/components/outfit-canvas';
import { VestroCategories, VestroColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { LANGUAGES, MONTHS } from '@/i18n/translations';
import { CurrentWeather, fetchCurrentWeather } from '@/utils/weather';

type ClothingItem = {
  id: number;
  name: string;
  category: string;
  color?: string;
  image?: string;
  price?: number;
  status?: 'owned' | 'wishlist';
  available?: boolean;
};

type Outfit = {
  id: number;
  name: string;
  itemIds: number[];
  layout?: Record<number, CanvasLayout>;
};

type ActiveLook = {
  itemIds: number[];
  layout: Record<number, CanvasLayout>;
};

function dayOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

export default function HomeScreen() {
  const { t, tCategory, language } = useI18n();
  const [clothes, setClothes] = useState<ClothingItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [layout, setLayout] = useState<Record<number, CanvasLayout>>({});
  const [activeCategory, setActiveCategory] = useState('Hauts');
  const [canvasHeight, setCanvasHeight] = useState(0);
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [languagePickerVisible, setLanguagePickerVisible] = useState(false);

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
        const savedClothes = await AsyncStorage.getItem('vestro-clothes');
        const parsedClothes: ClothingItem[] = savedClothes ? JSON.parse(savedClothes) : [];
        setClothes(parsedClothes);

        const savedLook = await AsyncStorage.getItem('vestro-active-look');

        if (savedLook) {
          const look: ActiveLook = JSON.parse(savedLook);
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

        setIsLoaded(true);
      }

      loadData();
    }, [])
  );

  const ownedClothes = clothes.filter(
    (item) => (!item.status || item.status === 'owned') && item.available !== false
  );

  const availableCategories: string[] = VestroCategories.filter((category) =>
    ownedClothes.some((item) => item.category === category)
  );
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

  function handleCanvasAreaLayout(event: LayoutChangeEvent) {
    setCanvasHeight(event.nativeEvent.layout.height);
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

    await AsyncStorage.setItem('vestro-active-look', JSON.stringify(currentLookPayload()));
    Alert.alert(t('home.wornTitle'), t('home.wornMessage'));
  }

  function saveOutfit() {
    if (selectedItems.length === 0) {
      Alert.alert(t('common.emptyOutfitTitle'), t('common.emptyOutfitMessage'));
      return;
    }

    Alert.prompt(
      t('home.outfitNamePrompt'),
      undefined,
      async (name) => {
        if (!name?.trim()) return;

        const savedOutfits = await AsyncStorage.getItem('vestro-outfits');
        const outfits: Outfit[] = savedOutfits ? JSON.parse(savedOutfits) : [];

        const newOutfit: Outfit = {
          id: Date.now(),
          name: name.trim(),
          ...currentLookPayload(),
        };

        await AsyncStorage.setItem(
          'vestro-outfits',
          JSON.stringify([newOutfit, ...outfits])
        );

        Alert.alert(t('home.savedTitle'), t('home.savedMessage'));
      },
      'plain-text'
    );
  }

  const today = new Date();

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Text style={styles.logo}>Vestro</Text>

        <View style={styles.issueBlock}>
          <TouchableOpacity onPress={() => setLanguagePickerVisible(true)}>
            <Text style={styles.languageFlag}>
              {LANGUAGES.find((option) => option.code === language)?.flag}
            </Text>
          </TouchableOpacity>
          <Text style={styles.issueText}>
            N° {dayOfYear(today).toString().padStart(3, '0')}
          </Text>
          <Text style={styles.issueText}>{formatIssueDate(today)}</Text>
        </View>
      </View>

      <View style={styles.welcomeRow}>
        <Text style={styles.eyebrow}>{t('home.greeting', { name: 'SAMY' })}</Text>
        {weather && (
          <Text style={styles.weatherText}>
            {t(weather.descriptionKey)} · {Math.round(weather.temperature)}°
          </Text>
        )}
      </View>
      <Text style={styles.title}>{t('home.title')}</Text>

      <View style={styles.canvasArea} onLayout={handleCanvasAreaLayout}>
        {isLoaded && canvasHeight > 0 && (
          <OutfitCanvas
            items={selectedItems}
            layout={layout}
            onLayoutChange={handleLayoutChange}
            height={canvasHeight}
          />
        )}
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

      <LanguagePickerModal
        visible={languagePickerVisible}
        onClose={() => setLanguagePickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: VestroColors.background,
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 16,
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
  welcomeRow: {
    marginTop: 18,
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
    marginTop: 2,
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
    flex: 1,
    marginTop: 16,
  },
  categoryTabsScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 14,
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
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 12,
  },
  itemRow: {
    gap: 18,
  },
  thumbnailWrap: {
    alignItems: 'center',
  },
  thumbnail: {
    width: 62,
    height: 78,
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
    marginTop: 16,
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
    marginTop: 12,
  },
  saveLinkText: {
    fontFamily: VestroFonts.serifMediumItalic,
    fontSize: 13,
    color: VestroColors.muted,
    textDecorationLine: 'underline',
  },
});
