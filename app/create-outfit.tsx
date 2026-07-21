import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { CanvasLayout, OutfitCanvas } from '@/components/outfit-canvas';
import { VestroCategories, VestroColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';

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

export default function CreateOutfitScreen() {
  const { t, tCategory } = useI18n();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = Boolean(id);

  const [clothes, setClothes] = useState<ClothingItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [layout, setLayout] = useState<Record<number, CanvasLayout>>({});

  useEffect(() => {
    async function loadData() {
      const savedClothes = await AsyncStorage.getItem('vestro-clothes');
      const parsedClothes: ClothingItem[] = savedClothes ? JSON.parse(savedClothes) : [];
      setClothes(
        parsedClothes.filter(
          (item) => (!item.status || item.status === 'owned') && item.available !== false
        )
      );

      if (id) {
        const savedOutfits = await AsyncStorage.getItem('vestro-outfits');
        const outfits: Outfit[] = savedOutfits ? JSON.parse(savedOutfits) : [];
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
        }
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

    const savedOutfits = await AsyncStorage.getItem('vestro-outfits');
    const outfits: Outfit[] = savedOutfits ? JSON.parse(savedOutfits) : [];

    const itemIdSet = new Set(itemIds);
    const savedLayout = Object.fromEntries(
      Object.entries(layout).filter(([itemId]) => itemIdSet.has(Number(itemId)))
    );

    if (id) {
      const updatedOutfits = outfits.map((outfit) =>
        outfit.id === Number(id)
          ? { ...outfit, name: name.trim(), itemIds, layout: savedLayout }
          : outfit
      );

      await AsyncStorage.setItem('vestro-outfits', JSON.stringify(updatedOutfits));
    } else {
      const newOutfit: Outfit = {
        id: Date.now(),
        name: name.trim(),
        itemIds,
        layout: savedLayout,
      };

      await AsyncStorage.setItem(
        'vestro-outfits',
        JSON.stringify([newOutfit, ...outfits])
      );
    }

    router.back();
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
            />
          </View>
        )}

        {VestroCategories.map((category) => {
          const items = clothes.filter((item) => item.category === category);

          if (items.length === 0) return null;

          return (
            <View key={category} style={styles.categoryBlock}>
              <Text style={styles.categoryLabel}>{tCategory(category)}</Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.itemRow}
              >
                {items.map((item) => {
                  const isSelected = selected[category]?.includes(item.id) ?? false;

                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.thumbnail,
                        { backgroundColor: item.color ?? VestroColors.tints[item.category] },
                        isSelected && styles.thumbnailSelected,
                      ]}
                      onPress={() => toggleSelect(category, item.id)}
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
            </View>
          );
        })}
      </ScrollView>
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
  categoryBlock: {
    marginTop: 30,
  },
  categoryLabel: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: VestroColors.muted,
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
});
