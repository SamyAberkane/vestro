import { Ionicons } from '@expo/vector-icons';
import { openBrowserAsync } from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlertHost } from '@/components/alert-host';
import { AppColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import { alert } from '@/lib/alert';
import {
  getIsPremium,
  getMonthlyLocalizedPrice,
  isRealIAPAvailable,
  purchaseMonthly,
  restorePurchases,
  setSimulatedPremium,
} from '@/lib/premium';
import { getRemainingPhotoQuota, MONTHLY_PHOTO_LIMIT } from '@/lib/photo-quota';
import { useAppTheme } from '@/theme/context';

type PaywallModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Fires whenever the premium entitlement changes, so the entry point badge can reflect it. */
  onPremiumChange?: (active: boolean) => void;
  /** False when used as the app-wide access gate: no × button, no "maybe later"
   * link, hardware back/swipe-to-dismiss disabled — subscribing is the only
   * way through. `onSignOut`, if given, is offered instead so the user isn't
   * fully trapped. Defaults to true (the dismissible "manage subscription" view). */
  dismissible?: boolean;
  onSignOut?: () => void;
};

const MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';
// Opened in an in-app browser, not pushed as the app's own /legal routes:
// those are native stack modals, which iOS presents *underneath* this
// <Modal> — the links looked dead to App Review (Guideline 3.1.2). The EULA
// is Apple's standard one, matching the "Contrat de licence" setting in App
// Store Connect; the privacy URL is the one declared there too.
const TERMS_OF_USE_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const PRIVACY_POLICY_URL = 'https://samyaberkane.github.io/urlvestro/';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.72);
const CARD_GAP = 14;
const CAROUSEL_PADDING = 32;
const AUTOPLAY_INTERVAL_MS = 3200;

type FeatureIcon = keyof typeof Ionicons.glyphMap;

function useCarouselFeatures(): { icon: FeatureIcon; title: string; desc: string }[] {
  const { t } = useI18n();

  return useMemo(
    () => [
      { icon: 'shirt-outline', title: t('premium.feature1Title'), desc: t('premium.feature1Desc') },
      { icon: 'sparkles-outline', title: t('premium.feature2Title'), desc: t('premium.feature2Desc') },
      { icon: 'images-outline', title: t('premium.feature3Title'), desc: t('premium.feature3Desc') },
      { icon: 'cloud-outline', title: t('premium.feature4Title'), desc: t('premium.feature4Desc') },
      { icon: 'shield-checkmark-outline', title: t('premium.feature5Title'), desc: t('premium.feature5Desc') },
    ],
    [t]
  );
}

function FeatureCarousel() {
  const features = useCarouselFeatures();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const listRef = useRef<FlatList>(null);
  const indexRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      const nextIndex = (indexRef.current + 1) % features.length;
      indexRef.current = nextIndex;
      setActiveIndex(nextIndex);
      listRef.current?.scrollToOffset({
        offset: nextIndex * (CARD_WIDTH + CARD_GAP),
        animated: true,
      });
    }, AUTOPLAY_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [features.length]);

  function handleMomentumScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / (CARD_WIDTH + CARD_GAP));
    const clamped = Math.max(0, Math.min(features.length - 1, nextIndex));
    indexRef.current = clamped;
    setActiveIndex(clamped);
  }

  return (
    <View style={styles.carouselWrap}>
      <FlatList
        ref={listRef}
        data={features}
        keyExtractor={(item) => item.title}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + CARD_GAP}
        decelerationRate="fast"
        contentContainerStyle={styles.carouselContent}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardIconBadge}>
              <Ionicons name={item.icon} size={20} color={VestroColors.accent} />
            </View>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardDesc}>{item.desc}</Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {features.map((item, i) => (
          <View key={item.title} style={[styles.dot, i === activeIndex && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

export function PaywallModal({
  visible,
  onClose,
  onPremiumChange,
  dismissible = true,
  onSignOut,
}: PaywallModalProps) {
  const { t } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const [isPremium, setIsPremium] = useState(false);
  const [remainingCredits, setRemainingCredits] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [storePrice, setStorePrice] = useState<string | null>(null);
  const price = storePrice ?? t('premium.defaultPrice');

  useEffect(() => {
    if (!visible) return;
    getIsPremium().then((active) => {
      setIsPremium(active);
      if (active) getRemainingPhotoQuota().then(setRemainingCredits);
    });
    getMonthlyLocalizedPrice().then((localized) => {
      if (localized) setStorePrice(localized);
    });
  }, [visible]);

  async function handleSubscribe() {
    setIsProcessing(true);

    try {
      // Resolves only once lib/premium.ts has verified the transaction with
      // Apple's server and written the entitlement — no arbitrary delay needed.
      await purchaseMonthly();

      const active = await getIsPremium();
      setIsPremium(active);
      if (active) setRemainingCredits(await getRemainingPhotoQuota());
      onPremiumChange?.(active);
      if (active) alert(t('premium.subscribedTitle'), t('premium.subscribedMessage'));
    } catch (error: any) {
      if (error?.code !== 'E_USER_CANCELLED') {
        alert(t('common.errorTitle'), String(error?.message ?? error));
      }
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleRestore() {
    setIsRestoring(true);

    try {
      const active = await restorePurchases();
      setIsPremium(active);
      if (active) setRemainingCredits(await getRemainingPhotoQuota());
      onPremiumChange?.(active);
      alert(
        active ? t('premium.subscribedTitle') : t('premium.restoreNoneTitle'),
        active ? t('premium.subscribedMessage') : t('premium.restoreNoneMessage')
      );
    } catch (error) {
      alert(t('common.errorTitle'), String(error instanceof Error ? error.message : error));
    } finally {
      setIsRestoring(false);
    }
  }

  function handleManageSubscription() {
    if (isRealIAPAvailable) {
      // Apple doesn't let apps cancel a subscription programmatically —
      // this is the standard deep link into the user's own App Store settings.
      Linking.openURL(MANAGE_SUBSCRIPTIONS_URL);
      return;
    }

    alert(t('premium.activeTitle'), t('premium.manageCta'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('premium.manageCta'),
        style: 'destructive',
        onPress: async () => {
          await setSimulatedPremium(false);
          setIsPremium(false);
          onPremiumChange?.(false);
          alert(t('premium.cancelledTitle'), t('premium.cancelledMessage'));
        },
      },
    ]);
  }

  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={dismissible ? onClose : () => {}}
    >
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          {dismissible && (
            <TouchableOpacity
              style={[styles.closeButton, { top: insets.top + 12 }]}
              onPress={onClose}
              hitSlop={10}
            >
              <Text style={styles.closeGlyph}>×</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.badge}>✨</Text>
          <Text style={styles.title}>{isPremium ? t('premium.activeTitle') : t('premium.title')}</Text>
          <Text style={styles.tagline}>{isPremium ? t('premium.activeTagline') : t('premium.tagline')}</Text>

          {isPremium && remainingCredits !== null && (
            <View style={styles.creditsBadge}>
              <Text style={styles.creditsText}>
                💎 {t('premium.creditsRemaining', { remaining: remainingCredits, limit: MONTHLY_PHOTO_LIMIT })}
              </Text>
            </View>
          )}

          <FeatureCarousel />

          {isPremium ? (
            <TouchableOpacity
              style={[styles.ctaButton, styles.manageButton]}
              onPress={handleManageSubscription}
            >
              <Text style={[styles.ctaText, styles.manageButtonText]}>
                {isRealIAPAvailable ? t('premium.manageCtaReal') : t('premium.manageCta')}
              </Text>
            </TouchableOpacity>
          ) : (
            <>
              <View style={styles.priceBlock}>
                <Text style={styles.planName}>{t('premium.planName')}</Text>
                <Text style={styles.price}>{t('premium.price', { price })}</Text>
                <Text style={styles.billingNote}>{t('premium.billingNote')}</Text>
              </View>

              <TouchableOpacity style={styles.ctaButton} onPress={handleSubscribe} disabled={isProcessing}>
                {isProcessing ? (
                  <ActivityIndicator color={VestroColors.buttonText} />
                ) : (
                  <Text style={styles.ctaText}>{t('premium.cta', { price })}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.restoreLink}
                onPress={handleRestore}
                disabled={isRestoring}
              >
                {isRestoring ? (
                  <ActivityIndicator color={VestroColors.muted} size="small" />
                ) : (
                  <Text style={styles.restoreText}>{t('premium.restoreCta')}</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.autoRenewNote}>{t('premium.autoRenewNote', { price })}</Text>
            </>
          )}

          <View style={styles.legalRow}>
            <TouchableOpacity onPress={() => openBrowserAsync(PRIVACY_POLICY_URL)} hitSlop={8}>
              <Text style={styles.legalLink}>{t('legal.privacyLink')}</Text>
            </TouchableOpacity>
            <Text style={styles.legalSeparator}>·</Text>
            <TouchableOpacity onPress={() => openBrowserAsync(TERMS_OF_USE_URL)} hitSlop={8}>
              <Text style={styles.legalLink}>{t('legal.eulaLink')}</Text>
            </TouchableOpacity>
          </View>

          {dismissible ? (
            <TouchableOpacity style={styles.dismissLink} onPress={onClose}>
              <Text style={styles.dismissText}>{t('premium.dismiss')}</Text>
            </TouchableOpacity>
          ) : (
            onSignOut && (
              <TouchableOpacity style={styles.dismissLink} onPress={onSignOut}>
                <Text style={styles.dismissText}>{t('auth.signOut')}</Text>
              </TouchableOpacity>
            )
          )}
        </ScrollView>
      </View>
      <AlertHost />
    </Modal>
  );
}

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: VestroColors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 60,
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VestroColors.surface,
    zIndex: 1,
  },
  closeGlyph: {
    fontSize: 20,
    lineHeight: 22,
    color: VestroColors.muted,
  },
  badge: {
    fontSize: 32,
    textAlign: 'center',
  },
  title: {
    marginTop: 10,
    paddingHorizontal: CAROUSEL_PADDING,
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 30,
    color: VestroColors.ink,
    textAlign: 'center',
  },
  tagline: {
    marginTop: 6,
    paddingHorizontal: CAROUSEL_PADDING,
    fontFamily: VestroFonts.serifMediumItalic,
    fontSize: 15,
    color: VestroColors.muted,
    textAlign: 'center',
  },
  creditsBadge: {
    marginTop: 16,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: VestroColors.surface,
    borderWidth: 1,
    borderColor: VestroColors.border,
  },
  creditsText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    color: VestroColors.ink,
  },
  carouselWrap: {
    marginTop: 36,
  },
  carouselContent: {
    paddingHorizontal: CAROUSEL_PADDING,
  },
  card: {
    width: CARD_WIDTH,
    marginRight: CARD_GAP,
    backgroundColor: VestroColors.surface,
    borderWidth: 1,
    borderColor: VestroColors.border,
    borderRadius: 18,
    padding: 20,
    minHeight: 148,
  },
  cardIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VestroColors.tints.Accessoires,
  },
  cardTitle: {
    marginTop: 14,
    fontFamily: VestroFonts.serifSemiBold,
    fontSize: 16,
    lineHeight: 21,
    color: VestroColors.ink,
  },
  cardDesc: {
    marginTop: 6,
    fontFamily: VestroFonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: VestroColors.muted,
  },
  dots: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: VestroColors.border,
  },
  dotActive: {
    width: 16,
    backgroundColor: VestroColors.accent,
  },
  priceBlock: {
    marginTop: 40,
    paddingHorizontal: CAROUSEL_PADDING,
    alignItems: 'center',
  },
  planName: {
    marginBottom: 4,
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.muted,
    textAlign: 'center',
  },
  price: {
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 22,
    color: VestroColors.ink,
  },
  billingNote: {
    marginTop: 4,
    fontFamily: VestroFonts.sans,
    fontSize: 11,
    color: VestroColors.muted,
    textAlign: 'center',
  },
  ctaButton: {
    marginTop: 24,
    marginHorizontal: CAROUSEL_PADDING,
    height: 52,
    backgroundColor: VestroColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 12,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: VestroColors.buttonText,
  },
  manageButton: {
    marginTop: 40,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: VestroColors.border,
  },
  manageButtonText: {
    color: VestroColors.muted,
  },
  restoreLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  restoreText: {
    fontFamily: VestroFonts.sans,
    fontSize: 12,
    color: VestroColors.muted,
    textDecorationLine: 'underline',
  },
  autoRenewNote: {
    marginTop: 16,
    paddingHorizontal: CAROUSEL_PADDING,
    fontFamily: VestroFonts.sans,
    fontSize: 10,
    lineHeight: 14,
    color: VestroColors.muted,
    textAlign: 'center',
  },
  legalRow: {
    marginTop: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  legalLink: {
    fontFamily: VestroFonts.sans,
    fontSize: 12,
    color: VestroColors.muted,
    textDecorationLine: 'underline',
  },
  legalSeparator: {
    fontFamily: VestroFonts.sans,
    fontSize: 10,
    color: VestroColors.muted,
  },
  dismissLink: {
    marginTop: 18,
    alignItems: 'center',
  },
  dismissText: {
    fontFamily: VestroFonts.sans,
    fontSize: 13,
    color: VestroColors.muted,
    textDecorationLine: 'underline',
  },
});
