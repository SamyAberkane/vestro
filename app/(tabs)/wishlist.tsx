import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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
import { VestroCategories, VestroColors, VestroFonts } from '@/constants/theme';
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

export default function WishlistScreen() {
  const { t, tCategory, language } = useI18n();
  const [clothes, setClothes] = useState<ClothingItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [processingImageUri, setProcessingImageUri] = useState<string | undefined>(undefined);
  const isProcessingImage = processingImageUri !== undefined;
  const [batchStep, setBatchStep] = useState({ index: 1, count: 1 });
  const [selectedCategory, setSelectedCategory] = useState('Tout');
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

  useFocusEffect(
    useCallback(() => {
      async function loadClothes() {
        const savedClothes = await AsyncStorage.getItem('vestro-clothes');

        if (savedClothes) {
          setClothes(JSON.parse(savedClothes));
        }

        setIsLoaded(true);
      }

      loadClothes();
    }, [])
  );

  const wishlistItems = clothes.filter(
    (item) => item.status === 'wishlist'
  );

  const filteredWishlistItems =
    selectedCategory === 'Tout'
      ? wishlistItems
      : wishlistItems.filter((item) => item.category === selectedCategory);

  async function saveClothes(updatedClothes: ClothingItem[]) {
    setClothes(updatedClothes);
    await AsyncStorage.setItem(
      'vestro-clothes',
      JSON.stringify(updatedClothes)
    );
  }

  function updateItem(id: number, patch: Partial<ClothingItem>) {
    saveClothes(clothes.map((clothing) => (clothing.id === id ? { ...clothing, ...patch } : clothing)));
  }

  async function addWishlistItem() {
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

    const newItems: ClothingItem[] = [];

    for (let i = 0; i < assets.length; i++) {
      setBatchStep({ index: i + 1, count: assets.length });
      setProcessingImageUri(assets[i].uri);

      const analysis = await analyzeClothingPhoto(assets[i].uri, language);

      newItems.push({
        id: Date.now() + i,
        name: analysis.name ?? t('wishlist.fallbackName', { index: i + 1 }),
        category: analysis.category ?? VestroCategories[0],
        color: analysis.color,
        image: analysis.image,
        status: 'wishlist',
      });
    }

    setProcessingImageUri(undefined);
    saveClothes([...newItems, ...clothes]);
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
      updateItem(targetId, { image: newImage });
    }
  }

  function openItem(item: ClothingItem) {
    setOptionsItemId(item.id);
  }

  return (
    <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t('wishlist.title')}</Text>
          <Text style={styles.count}>{t('wishlist.count', { count: wishlistItems.length })}</Text>
        </View>

        <TouchableOpacity
          style={styles.addButton}
          onPress={addWishlistItem}
        >
          <Text style={styles.addButtonGlyph}>+</Text>
        </TouchableOpacity>
      </View>

      {wishlistItems.length > 0 && (
        <ScrollView
          horizontal
          style={styles.filtersScroll}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {['Tout', ...VestroCategories].map((category) => {
            const active = selectedCategory === category;

            return (
              <TouchableOpacity
                key={category}
                style={active ? styles.activeFilter : styles.filter}
                onPress={() => setSelectedCategory(category)}
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
          {filteredWishlistItems.map((item) => (
            <TouchableOpacity
              style={styles.card}
              key={item.id}
              onPress={() => openItem(item)}
            >
              <View style={styles.imageWrap}>
                {item.image && (
                  <Image
                    source={{ uri: item.image }}
                    style={styles.image}
                    resizeMode="cover"
                  />
                )}
                <Text style={styles.envieBadge}>{t('wishlist.badge')}</Text>
              </View>

              <Text style={styles.itemName}>{item.name}</Text>
              <View style={styles.itemMetaRow}>
                <Text style={styles.category}>{tCategory(item.category)}</Text>
                {item.price !== undefined && (
                  <Text style={styles.price}>
                    {item.price.toFixed(2).replace('.', ',')} €
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
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
          saveClothes(clothes.filter((clothing) => clothing.id !== targetId));
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
    flexGrow: 1,
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
    justifyContent: 'space-between',
    rowGap: 20,
  },
  card: {
    width: '48%',
  },
  imageWrap: {
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
    fontFamily: VestroFonts.serifMediumItalic,
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
});