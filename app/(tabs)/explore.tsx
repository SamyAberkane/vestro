import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { ClothingOptionsSheet } from '@/components/clothing-options-sheet';
import { ColorPickerModal } from '@/components/color-picker-modal';
import { ProcessingOverlay } from '@/components/processing-overlay';
import { VestroCategories, VestroColors, VestroFonts, VestroPalette } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { analyzeClothingPhoto, removeBackground } from '@/utils/remove-background';

type ClothingItem = {
  id: number;
  name: string;
  category: string;
  color?: string;
  image?: string;
  price?: number;
  status?: 'owned' | 'wishlist';
  available?: boolean;
  unavailableReason?: string;
};

export default function DressingScreen() {
  const { t, tCategory, language } = useI18n();
  const [clothes, setClothes] = useState<ClothingItem[]>([]);
const [isLoaded, setIsLoaded] = useState(false);
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
const optionsItem = clothes.find((clothing) => clothing.id === optionsItemId) ?? null;

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

useFocusEffect(
  useCallback(() => {
    async function loadClothes() {
      const savedClothes = await AsyncStorage.getItem('vestro-clothes');

      if (savedClothes) {
        setClothes(JSON.parse(savedClothes));
      } else {
        setClothes([]);
      }

      setIsLoaded(true);
    }

    loadClothes();
  }, [])
);

useEffect(() => {
  if (isLoaded) {
    AsyncStorage.setItem('vestro-clothes', JSON.stringify(clothes));
  }
}, [clothes, isLoaded]);

  async function addClothing() {
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

    for (let i = 0; i < assets.length; i++) {
      setBatchStep({ index: i + 1, count: assets.length });
      setProcessingImageUri(assets[i].uri);

      const analysis = await analyzeClothingPhoto(assets[i].uri, language);

      const newItem: ClothingItem = {
        id: Date.now() + i,
        name: analysis.name ?? t('dressing.fallbackName', { index: i + 1 }),
        category: analysis.category ?? VestroCategories[0],
        color: analysis.color,
        status: 'owned',
        available: true,
        image: analysis.image,
      };

      setClothes((currentClothes) => [newItem, ...currentClothes]);
    }

    setProcessingImageUri(undefined);
  }

function updateOptionsItem(id: number, patch: Partial<ClothingItem>) {
  setClothes((currentClothes) =>
    currentClothes.map((clothing) => (clothing.id === id ? { ...clothing, ...patch } : clothing))
  );
}

function openClothingOptions(item: ClothingItem) {
  setOptionsItemId(item.id);
}

async function handleOptionsPhotoChange() {
  if (!optionsItem) return;

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    Alert.alert(t('common.permissionTitle'), t('common.permissionPhotos'));
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
    const newImage = await removeBackground(result.assets[0].uri);
    setProcessingImageUri(undefined);
    updateOptionsItem(targetId, { image: newImage });
  }
}

  const filters = ['Tout', ...VestroCategories];

  return (
    <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t('dressing.title')}</Text>
          <Text style={styles.count}>{t('dressing.count', { count: ownedClothes.length })}</Text>
        </View>

        <View style={styles.headerActions}>
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

          <TouchableOpacity style={styles.addButton} onPress={addClothing}>
            <Text style={styles.addButtonGlyph}>+</Text>
          </TouchableOpacity>
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
        style={styles.filtersScroll}
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

      <View style={styles.grid}>
        {filteredClothes.map((item) => (
          <TouchableOpacity
            style={[styles.card, { width: columns === 2 ? '48%' : '31%' }]}
            key={item.id}
            onPress={() => openClothingOptions(item)}
          >
            <View style={styles.imageWrap}>
              {item.image ? (
                <Image
                  source={{ uri: item.image }}
                  style={[
                    styles.clothingImage,
                    { height: columns === 2 ? 172 : 108 },
                    item.available === false && styles.unavailableVisual,
                  ]}
                />
              ) : (
                <View
                  style={[
                    styles.imagePlaceholder,
                    { height: columns === 2 ? 172 : 108 },
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
                <Text style={styles.price}>
                  {item.price.toFixed(2).replace('.', ',')} €
                </Text>
              )}
            </View>
            {item.available === false && item.unavailableReason && (
              <Text style={styles.unavailableLabel} numberOfLines={1}>
                {item.unavailableReason}
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>

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
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: VestroColors.background,
  },
  content: {
    paddingTop: 65,
    paddingHorizontal: 20,
    paddingBottom: 40,
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  grid: {
    marginTop: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 20,
  },
  card: {
    width: '48%',
  },
  imagePlaceholder: {
    height: 172,
  },
  clothingImage: {
    width: '100%',
    height: 172,
    backgroundColor: VestroColors.surface,
  },
  itemName: {
    marginTop: 8,
    fontFamily: VestroFonts.serifMediumItalic,
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