import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { OutfitPreview } from '@/components/outfit-canvas';
import { AppColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
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
  onPress,
  onLongPress,
}: {
  outfit: Outfit;
  items: ClothingItem[];
  cardWidth: number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { tPlural } = useI18n();
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
  const { t } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const { width: windowWidth } = useWindowDimensions();
  const [clothes, setClothes] = useState<ClothingItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Outfit | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const availableWidth = windowWidth - CONTENT_PADDING * 2;
  const numColumns = Math.max(
    2,
    Math.floor((availableWidth + GRID_GAP) / (TARGET_CARD_WIDTH + GRID_GAP))
  );
  const cardWidth = (availableWidth - GRID_GAP * (numColumns - 1)) / numColumns;

  useFocusEffect(
    useCallback(() => {
      async function load() {
        try {
          const [loadedClothes, loadedOutfits] = await Promise.all([
            fetchClothingItems(),
            fetchOutfits(),
          ]);
          setClothes(loadedClothes);
          setOutfits(loadedOutfits);
        } catch (error) {
          Alert.alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
        }
      }

      load();
    }, [])
  );

  async function confirmDeleteOutfit() {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      await deleteOutfit(deleteTarget.id);
      setOutfits((current) => current.filter((outfit) => outfit.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (error) {
      Alert.alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    }
    setIsDeleting(false);
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
                  cardWidth={cardWidth}
                  onPress={() => router.push(`/create-outfit?id=${outfit.id}`)}
                  onLongPress={() => setDeleteTarget(outfit)}
                />
              );
            })}
          </View>
        )}
      </ScrollView>

      <ConfirmModal
        visible={deleteTarget !== null}
        title={t('createOutfit.deleteConfirmTitle')}
        message={t('createOutfit.deleteConfirmMessage', { name: deleteTarget?.name ?? '' })}
        confirmLabel={isDeleting ? t('createOutfit.deleting') : t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={confirmDeleteOutfit}
        onCancel={() => setDeleteTarget(null)}
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
    gap: GRID_GAP,
  },
  card: {},
  previewWrap: {
    width: '100%',
    aspectRatio: 1,
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
});
