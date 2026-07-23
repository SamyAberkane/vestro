import AsyncStorage from '@react-native-async-storage/async-storage';
import { type EmitterSubscription, Platform } from 'react-native';
import {
  endConnection,
  finishTransaction,
  getAvailablePurchases,
  getSubscriptions,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestSubscription,
  type Purchase,
} from 'react-native-iap';

// Real StoreKit subscription (no RevenueCat) for the monthly plan. IAP only
// exists on iOS — on web/Android there's no real product to buy, so those
// platforms keep the same local-simulation fallback the paywall used before,
// which is what lets it still be tested outside a native iOS build.
export const MONTHLY_SKU = 'com.tailor.vestro.montlhy';

const SIMULATED_KEY = 'vestro.premium.simulated';
const CACHE_KEY = 'vestro.premium.cache';
const IAP_AVAILABLE = Platform.OS === 'ios';

let didInit = false;
let updateSub: EmitterSubscription | null = null;
let errorSub: EmitterSubscription | null = null;

function ownsMonthly(purchases: Purchase[]): boolean {
  return purchases.some((purchase) => purchase.productId === MONTHLY_SKU);
}

async function cachePremium(active: boolean): Promise<void> {
  await AsyncStorage.setItem(CACHE_KEY, active ? 'true' : 'false');
}

/** Call once at app startup (see app/_layout.tsx). No-op on web/Android. */
export async function initIAP(): Promise<void> {
  if (!IAP_AVAILABLE || didInit) return;
  didInit = true;

  try {
    await initConnection();
  } catch (error) {
    console.warn('[premium] initConnection a échoué', error);
    didInit = false;
    return;
  }

  updateSub = purchaseUpdatedListener(async (purchase) => {
    if (purchase.productId !== MONTHLY_SKU) return;

    try {
      // Required for auto-renewable subscriptions — until the transaction is
      // finished, StoreKit keeps redelivering it as an unfinished purchase.
      await finishTransaction({ purchase, isConsumable: false });
      await cachePremium(true);
    } catch (error) {
      console.warn('[premium] finishTransaction a échoué', error);
    }
  });

  errorSub = purchaseErrorListener((error) => {
    console.warn('[premium] Erreur StoreKit', error);
  });
}

export function teardownIAP(): void {
  updateSub?.remove();
  errorSub?.remove();
  updateSub = null;
  errorSub = null;
  if (IAP_AVAILABLE && didInit) endConnection();
  didInit = false;
}

export async function getIsPremium(): Promise<boolean> {
  if (!IAP_AVAILABLE) {
    return (await AsyncStorage.getItem(SIMULATED_KEY)) === 'true';
  }

  try {
    const purchases = await getAvailablePurchases();
    const active = ownsMonthly(purchases);
    await cachePremium(active);
    return active;
  } catch (error) {
    console.warn('[premium] getAvailablePurchases a échoué, utilisation du cache local', error);
    return (await AsyncStorage.getItem(CACHE_KEY)) === 'true';
  }
}

/** Starts the real StoreKit purchase sheet. Resolves once requested — the
 * `purchaseUpdatedListener` above is what actually confirms/finishes it. */
export async function purchaseMonthly(): Promise<void> {
  if (!IAP_AVAILABLE) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await AsyncStorage.setItem(SIMULATED_KEY, 'true');
    return;
  }

  const subscriptions = await getSubscriptions({ skus: [MONTHLY_SKU] });
  if (subscriptions.length === 0) {
    throw new Error(
      `Produit "${MONTHLY_SKU}" introuvable côté App Store Connect (pas encore validé ?)`
    );
  }

  await requestSubscription({ sku: MONTHLY_SKU });
}

export async function restorePurchases(): Promise<boolean> {
  if (!IAP_AVAILABLE) {
    return (await AsyncStorage.getItem(SIMULATED_KEY)) === 'true';
  }

  const purchases = await getAvailablePurchases();
  const active = ownsMonthly(purchases);
  await cachePremium(active);
  return active;
}

/** Dev/web-only: lets the "Résilier (simulation)" button keep working where
 * there's no real subscription to manage. Real cancellation always happens
 * in iOS Settings — see openManageSubscriptions() in paywall-modal.tsx. */
export async function setSimulatedPremium(active: boolean): Promise<void> {
  await AsyncStorage.setItem(SIMULATED_KEY, active ? 'true' : 'false');
}

export const isRealIAPAvailable = IAP_AVAILABLE;
