import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { StickerImage } from '@/components/sticker-image';
import { AppColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { alert } from '@/lib/alert';
import { useAppTheme } from '@/theme/context';
import { currencySymbol, formatPriceInput, isUSD } from '@/utils/currency';

export type ClothingOptionsItem = {
  id: number;
  name: string;
  category: string;
  color?: string;
  image?: string;
  imagePath?: string;
  price?: number;
  available?: boolean;
  unavailableReason?: string;
};

type ClothingOptionsSheetProps = {
  item: ClothingOptionsItem | null;
  categories: string[];
  onClose: () => void;
  onRename: (name: string) => void;
  onChangeCategory: (category: string) => void;
  onChangePrice: (price: number | undefined) => void;
  onChangeAvailability: (available: boolean, reason?: string) => void;
  onRequestColorChange: () => void;
  onRequestPhotoChange: () => void;
  moveAction: { label: string; onPress: () => void };
  onDelete: () => void;
};

export function ClothingOptionsSheet({
  item,
  categories,
  onClose,
  onRename,
  onChangeCategory,
  onChangePrice,
  onChangeAvailability,
  onRequestColorChange,
  onRequestPhotoChange,
  moveAction,
  onDelete,
}: ClothingOptionsSheetProps) {
  const { t, tCategory, language } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const [nameDraft, setNameDraft] = useState('');
  const [priceDraft, setPriceDraft] = useState('');
  const [reasonDraft, setReasonDraft] = useState('');

  // Only reset the drafts when a *different* item is opened — not on every
  // render — so a parent re-render while the user is mid-keystroke can't
  // stomp what they just typed back to the last committed value.
  useEffect(() => {
    if (!item) return;
    setNameDraft(item.name);
    setPriceDraft(formatPriceInput(item.price, language));
    setReasonDraft(item.unavailableReason ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (!item) return null;

  function commitName() {
    const trimmed = nameDraft.trim();
    if (item && trimmed && trimmed !== item.name) onRename(trimmed);
    else if (item) setNameDraft(item.name);
  }

  function commitPrice() {
    const normalized = priceDraft.replace(',', '.').trim();
    if (!normalized) {
      onChangePrice(undefined);
      return;
    }
    const parsed = Number(normalized);
    if (Number.isNaN(parsed)) {
      setPriceDraft(formatPriceInput(item?.price, language));
      return;
    }
    onChangePrice(parsed);
  }

  function confirmDelete() {
    alert(
      t('options.deleteConfirmTitle'),
      t('options.deleteConfirmMessage', { name: item?.name ?? '' }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: onDelete },
      ]
    );
  }

  const isAvailable = item.available !== false;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.avoider}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
            <View style={styles.header}>
              {item.image ? (
                <TouchableOpacity style={styles.thumb} onPress={onRequestPhotoChange}>
                  <StickerImage uri={item.image} cacheKey={item.imagePath} containerStyle={styles.thumbImage} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.thumb, { backgroundColor: item.color ?? VestroColors.tints[item.category] }]}
                  onPress={onRequestPhotoChange}
                />
              )}

              <View style={styles.headerText}>
                <TextInput
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  onBlur={commitName}
                  onSubmitEditing={commitName}
                  style={styles.nameInput}
                  placeholder={t('options.namePlaceholder')}
                  placeholderTextColor={VestroColors.muted}
                  returnKeyType="done"
                />
                <Text style={styles.categoryLabel}>{tCategory(item.category)}</Text>
              </View>

              <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={10}>
                <Text style={styles.closeGlyph}>×</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionLabel}>{t('options.categoryLabel')}</Text>
            <View style={styles.chipsRow}>
              {categories.map((category) => {
                const active = category === item.category;
                return (
                  <TouchableOpacity
                    key={category}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => onChangeCategory(category)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {tCategory(category)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('options.priceLabel')}</Text>
              <View style={styles.priceInputWrap}>
                {isUSD(language) && (
                  <Text style={styles.pricePrefix}>{currencySymbol(language)}</Text>
                )}
                <TextInput
                  value={priceDraft}
                  onChangeText={setPriceDraft}
                  onBlur={commitPrice}
                  onSubmitEditing={commitPrice}
                  keyboardType="decimal-pad"
                  placeholder="—"
                  placeholderTextColor={VestroColors.muted}
                  style={styles.priceInput}
                  returnKeyType="done"
                />
                {!isUSD(language) && (
                  <Text style={styles.priceSuffix}>{currencySymbol(language)}</Text>
                )}
              </View>
            </View>

            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('options.availabilityLabel')}</Text>
              <View style={styles.segmented}>
                <TouchableOpacity
                  style={[styles.segment, isAvailable && styles.segmentActive]}
                  onPress={() => onChangeAvailability(true)}
                >
                  <Text style={[styles.segmentText, isAvailable && styles.segmentTextActive]}>
                    {t('options.available')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segment, !isAvailable && styles.segmentActive]}
                  onPress={() => onChangeAvailability(false, reasonDraft)}
                >
                  <Text style={[styles.segmentText, !isAvailable && styles.segmentTextActive]}>
                    {t('options.unavailable')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {!isAvailable && (
              <TextInput
                value={reasonDraft}
                onChangeText={setReasonDraft}
                onBlur={() => onChangeAvailability(false, reasonDraft)}
                onSubmitEditing={() => onChangeAvailability(false, reasonDraft)}
                placeholder={t('options.reasonPlaceholder')}
                placeholderTextColor={VestroColors.muted}
                style={styles.reasonInput}
                returnKeyType="done"
              />
            )}

            <View style={styles.divider} />

            <TouchableOpacity style={styles.actionRow} onPress={onRequestColorChange}>
              <Text style={styles.actionLabel}>{t('options.changeColor')}</Text>
              {item.color ? (
                <View style={[styles.colorPreview, { backgroundColor: item.color }]} />
              ) : (
                <Text style={styles.actionChevron}>›</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionRow} onPress={onRequestPhotoChange}>
              <Text style={styles.actionLabel}>{t('options.changePhoto')}</Text>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                moveAction.onPress();
                onClose();
              }}
            >
              <Text style={styles.actionLabel}>{moveAction.label}</Text>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.deleteButton} onPress={confirmDelete}>
              <Text style={styles.deleteText}>{t('options.deleteButton')}</Text>
            </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const THUMB_SIZE = 56;

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(30,26,19,0.45)',
    justifyContent: 'flex-end',
  },
  avoider: {
    width: '100%',
  },
  sheet: {
    width: '100%',
    // Caps how tall the sheet can grow so there's always room left for the
    // keyboard to push it up without shoving the top (name field) off the
    // top of the screen — the ScrollView below handles anything that
    // doesn't fit instead of the whole sheet just sliding upward.
    maxHeight: '88%',
    backgroundColor: VestroColors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: VestroColors.border,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: VestroColors.border,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  headerText: {
    flex: 1,
    marginLeft: 14,
  },
  nameInput: {
    fontFamily: VestroFonts.serifSemiBold,
    fontSize: 19,
    color: VestroColors.ink,
    padding: 0,
  },
  categoryLabel: {
    marginTop: 2,
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VestroColors.background,
  },
  closeGlyph: {
    fontSize: 18,
    lineHeight: 20,
    color: VestroColors.muted,
  },
  sectionLabel: {
    marginTop: 22,
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
  chipsRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: VestroColors.border,
  },
  chipActive: {
    backgroundColor: VestroColors.ink,
    borderColor: VestroColors.ink,
  },
  chipText: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 12,
    color: VestroColors.muted,
  },
  chipTextActive: {
    color: VestroColors.buttonText,
  },
  row: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
  },
  priceInputWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    borderBottomWidth: 1,
    borderBottomColor: VestroColors.border,
    minWidth: 80,
    justifyContent: 'flex-end',
  },
  priceInput: {
    fontFamily: VestroFonts.serifMedium,
    fontSize: 17,
    color: VestroColors.ink,
    textAlign: 'right',
    paddingVertical: 4,
    minWidth: 40,
  },
  priceSuffix: {
    marginLeft: 4,
    fontFamily: VestroFonts.serifMedium,
    fontSize: 15,
    color: VestroColors.muted,
  },
  pricePrefix: {
    marginRight: 2,
    fontFamily: VestroFonts.serifMedium,
    fontSize: 15,
    color: VestroColors.muted,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: VestroColors.border,
    overflow: 'hidden',
  },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  segmentActive: {
    backgroundColor: VestroColors.ink,
  },
  segmentText: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.5,
    color: VestroColors.muted,
  },
  segmentTextActive: {
    color: VestroColors.buttonText,
  },
  reasonInput: {
    marginTop: 10,
    fontFamily: VestroFonts.sans,
    fontSize: 13,
    color: VestroColors.ink,
    borderBottomWidth: 1,
    borderBottomColor: VestroColors.border,
    paddingVertical: 6,
  },
  divider: {
    marginTop: 22,
    marginBottom: 4,
    height: 1,
    backgroundColor: VestroColors.border,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: VestroColors.border,
  },
  actionLabel: {
    fontFamily: VestroFonts.sans,
    fontSize: 14,
    color: VestroColors.ink,
  },
  actionChevron: {
    fontSize: 18,
    color: VestroColors.muted,
  },
  colorPreview: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: VestroColors.border,
  },
  deleteButton: {
    marginTop: 22,
    alignItems: 'center',
  },
  deleteText: {
    fontFamily: VestroFonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.5,
    color: '#B2554A',
  },
});
