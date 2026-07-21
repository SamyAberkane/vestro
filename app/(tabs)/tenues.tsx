import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { CanvasLayout, OutfitPreview } from '@/components/outfit-canvas';
import { VestroColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';

type ClothingItem = {
  id: number;
  name: string;
  category: string;
  color?: string;
  image?: string;
  price?: number;
  status?: 'owned' | 'wishlist';
};

type Outfit = {
  id: number;
  name: string;
  itemIds: number[];
  layout?: Record<number, CanvasLayout>;
};

function OutfitCard({
  outfit,
  items,
  onPress,
}: {
  outfit: Outfit;
  items: ClothingItem[];
  onPress: () => void;
}) {
  const { tPlural } = useI18n();
  const [size, setSize] = useState(0);

  function handleLayout(event: LayoutChangeEvent) {
    setSize(event.nativeEvent.layout.width);
  }

  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.previewWrap} onLayout={handleLayout}>
        {size > 0 && (
          <OutfitPreview items={items} layout={outfit.layout ?? {}} size={size} />
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
  const { t } = useI18n();
  const [clothes, setClothes] = useState<ClothingItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);

  useFocusEffect(
    useCallback(() => {
      async function load() {
        const savedClothes = await AsyncStorage.getItem('vestro-clothes');
        const savedOutfits = await AsyncStorage.getItem('vestro-outfits');

        setClothes(savedClothes ? JSON.parse(savedClothes) : []);
        setOutfits(savedOutfits ? JSON.parse(savedOutfits) : []);
      }

      load();
    }, [])
  );

  async function saveOutfits(updatedOutfits: Outfit[]) {
    setOutfits(updatedOutfits);
    await AsyncStorage.setItem('vestro-outfits', JSON.stringify(updatedOutfits));
  }

  function openOutfit(outfit: Outfit) {
    Alert.alert(outfit.name, undefined, [
      {
        text: t('outfits.edit'),
        onPress: () => {
          router.push(`/create-outfit?id=${outfit.id}`);
        },
      },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          saveOutfits(outfits.filter((item) => item.id !== outfit.id));
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{t('outfits.title')}</Text>
            <Text style={styles.count}>{t('outfits.count', { count: outfits.length })}</Text>
          </View>

          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push('/create-outfit')}
          >
            <Text style={styles.addButtonGlyph}>+</Text>
          </TouchableOpacity>
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
                  onPress={() => openOutfit(outfit)}
                />
              );
            })}
          </View>
        )}
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
  previewWrap: {
    width: '100%',
    aspectRatio: 1,
  },
  itemName: {
    marginTop: 9,
    fontFamily: VestroFonts.serifMediumItalic,
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
});
