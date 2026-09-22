import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { type EmitterSubscription, Platform } from 'react-native';
import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  endConnection,
  finishTransaction,
  getAvailablePurchases,
  getSubscriptions,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestSubscription,
} from 'react-native-iap';

import { supabase } from '@/lib/supabase';

// Real StoreKit subscription (no RevenueCat) for the monthly plan. IAP only
// exists on iOS — on web/Android there's no real product to buy, so those
// platforms keep the same local-simulation fallback the paywall used before,
// which is what lets it still be tested outside a native iOS build.
export const MONTHLY_SKU = 'com.tailor.vestro.monthly';

const SIMULATED_KEY = 'vestro.premium.simulated';
const CACHE_KEY = 'vestro.premium.cache';
// react-native-iap needs a native module that isn't present in the Expo Go
// client (only in a custom dev/standalone build) — trying real StoreKit
// there just fails silently, so Expo Go gets the same local-simulation
// fallback as web/Android instead of a paywall nothing can get through.
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const IAP_AVAILABLE = Platform.OS === 'ios' && !IS_EXPO_GO;

let initPromise: Promise<boolean> | null = null;
let updateSub: EmitterSubscription | null = null;
let errorSub: EmitterSubscription | null = null;

async function cachePremium(active: boolean): Promise<void> {
  await AsyncStorage.setItem(CACHE_KEY, active ? 'true' : 'false');
}

// Calls the `verify-purchase` edge function, which confirms the transaction
// directly with Apple's App Store Server API and — only if Apple confirms
// it — writes the server-side entitlement row that getIsPremium() below
// actually trusts. Never treat a local StoreKit receipt as proof on its own.
async function verifyPurchase(transactionId: string): Promise<boolean> {
  return callVerifyPurchase({ transactionId });
}

// Asks verify-purchase to re-check the user's already-verified subscription
// with Apple — see getIsPremium() for why an expired row isn't final.
async function refreshSubscriptionStatus(): Promise<boolean> {
  return callVerifyPurchase({ refresh: true });
}

async function callVerifyPurchase(body: { transactionId: string } | { refresh: true }): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke<{
    isPremium: boolean;
    expiresAt: string | null;
    message?: string;
  }>('verify-purchase', { body });

  if (error) {
    // supabase-js's own error.message is just the generic "Edge Function
    // returned a non-2xx status code" — the actual reason the function
    // threw is in the response body, reachable only via error.context.
    if (error instanceof FunctionsHttpError) {
      const body: { message?: string } | null = await error.context.json().catch(() => null);
      throw new Error(body?.message ?? error.message);
    }
    throw error;
  }
  if (!data) throw new Error('Réponse vide de verify-purchase');
  return data.isPremium;
}

type PendingVerification = { resolve: (active: boolean) => void; reject: (error: unknown) => void };
let pendingVerifications: PendingVerification[] = [];

// purchaseMonthly() resolves once *this* fires — bridges StoreKit's
// fire-and-forget requestSubscription() to a real "done, and Apple
// confirmed it" promise instead of guessing with an arbitrary delay.
// Registered before the purchase sheet opens (the listener can fire before
// requestSubscription() returns), but the timeout is only armed afterwards
// via `startTimeout` — the sheet itself (Apple ID sign-in, Face ID, sandbox
// password on App Review's devices) can legitimately take well over 30s.
function waitForVerifiedPurchase(): { promise: Promise<boolean>; startTimeout: (ms: number) => void } {
  let entry!: PendingVerification;
  const promise = new Promise<boolean>((resolve, reject) => {
    entry = { resolve, reject };
    pendingVerifications.push(entry);
  });

  function startTimeout(ms: number) {
    setTimeout(() => {
      if (!pendingVerifications.includes(entry)) return;
      pendingVerifications = pendingVerifications.filter((pending) => pending !== entry);
      entry.reject(new Error('Délai dépassé en attendant la confirmation StoreKit'));
    }, ms);
  }

  return { promise, startTimeout };
}

function settlePendingVerifications(active: boolean): void {
  const pending = pendingVerifications;
  pendingVerifications = [];
  pending.forEach((entry) => entry.resolve(active));
}

function failPendingVerifications(error: unknown): void {
  const pending = pendingVerifications;
  pendingVerifications = [];
  pending.forEach((entry) => entry.reject(error));
}

/** Call at app startup (see app/_layout.tsx); purchase/restore also await it,
 * so a slow or failed startup connection is retried instead of every StoreKit
 * call after it failing. Resolves false when StoreKit is unreachable. No-op on
 * web/Android. */
export function initIAP(): Promise<boolean> {
  if (!IAP_AVAILABLE) return Promise.resolve(false);
  if (!initPromise) {
    initPromise = connectIAP().then((connected) => {
      if (!connected) initPromise = null;
      return connected;
    });
  }
  return initPromise;
}

async function connectIAP(): Promise<boolean> {
  try {
    await initConnection();
  } catch (error) {
    console.warn('[premium] initConnection a échoué', error);
    return false;
  }

  updateSub = purchaseUpdatedListener(async (purchase) => {
    if (purchase.productId !== MONTHLY_SKU) return;

    try {
      // Required for auto-renewable subscriptions — until the transaction is
      // finished, StoreKit keeps redelivering it as an unfinished purchase.
      await finishTransaction({ purchase, isConsumable: false });

      if (!purchase.transactionId) {
        throw new Error('Achat StoreKit sans transactionId');
      }

      const active = await verifyPurchase(purchase.transactionId);
      await cachePremium(active);
      settlePendingVerifications(active);
    } catch (error) {
      console.warn('[premium] finishTransaction/verifyPurchase a échoué', error);
      failPendingVerifications(error);
    }
  });

  errorSub = purchaseErrorListener((error) => {
    console.warn('[premium] Erreur StoreKit', error);
    failPendingVerifications(error);
  });

  return true;
}

async function ensureIAPConnected(): Promise<void> {
  if (!(await initIAP())) {
    throw new Error("Impossible de se connecter à l'App Store. Vérifie ta connexion et réessaie.");
  }
}

export function teardownIAP(): void {
  updateSub?.remove();
  errorSub?.remove();
  updateSub = null;
  errorSub = null;
  if (IAP_AVAILABLE && initPromise) endConnection();
  initPromise = null;
}

/** Server-verified only: reads the entitlement row that `verify-purchase`
 * writes, never a locally-reported StoreKit status — see supabase/schema.sql
 * for why the app has no write access to that table. */
export async function getIsPremium(): Promise<boolean> {
  if (!IAP_AVAILABLE) {
    return (await AsyncStorage.getItem(SIMULATED_KEY)) === 'true';
  }

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabase
      .from('premium_entitlements')
      .select('is_active, expires_at, original_transaction_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) throw new Error(error.message);

    let active =
      Boolean(data?.is_active) && (!data?.expires_at || new Date(data.expires_at) > new Date());

    // The row only knows the expiry of the last transaction the server saw,
    // but the subscription renews on its own (monthly; every few minutes in
    // the sandbox App Review tests in) and StoreKit only reports renewals
    // while the app happens to run. An expired row for someone who has
    // subscribed is therefore re-checked with Apple before being believed —
    // otherwise a renewed subscriber would hit the paywall, and the server's
    // premium checks (RLS, edit-clothing-photo) would refuse their additions.
    if (!active && data?.original_transaction_id) {
      active = await refreshSubscriptionStatus().catch((refreshError) => {
        console.warn('[premium] re-vérification de l’abonnement a échoué', refreshError);
        return false;
      });
    }

    await cachePremium(active);
    return active;
  } catch (error) {
    console.warn('[premium] lecture premium_entitlements a échoué, utilisation du cache local', error);
    return (await AsyncStorage.getItem(CACHE_KEY)) === 'true';
  }
}

/** Starts the real StoreKit purchase sheet and resolves only once
 * `verify-purchase` has confirmed the transaction with Apple — see
 * waitForVerifiedPurchase() above. Throws if Apple never confirms it. */
export async function purchaseMonthly(): Promise<void> {
  if (!IAP_AVAILABLE) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await AsyncStorage.setItem(SIMULATED_KEY, 'true');
    return;
  }

  await ensureIAPConnected();

  const subscriptions = await getSubscriptions({ skus: [MONTHLY_SKU] });
  if (subscriptions.length === 0) {
    throw new Error(
      `Produit "${MONTHLY_SKU}" introuvable côté App Store Connect (pas encore validé ?)`
    );
  }

  const verified = waitForVerifiedPurchase();
  try {
    await requestSubscription({ sku: MONTHLY_SKU });
  } catch (error) {
    // Cancel/failure: the error listener already rejected `verified` too —
    // swallow that duplicate so it isn't reported as an unhandled rejection.
    verified.promise.catch(() => {});
    throw error;
  }
  // The sheet is closed and Apple has the payment — what's left is
  // finishTransaction + our server's call to Apple, which is quick.
  verified.startTimeout(60000);
  const active = await verified.promise;

  if (!active) {
    throw new Error("La vérification de l'abonnement a échoué côté serveur");
  }
}

export async function restorePurchases(): Promise<boolean> {
  if (!IAP_AVAILABLE) {
    return (await AsyncStorage.getItem(SIMULATED_KEY)) === 'true';
  }

  await ensureIAPConnected();

  const purchases = await getAvailablePurchases();
  const purchase = purchases.find((candidate) => candidate.productId === MONTHLY_SKU);
  if (!purchase?.transactionId) return false;

  const active = await verifyPurchase(purchase.transactionId);
  await cachePremium(active);
  return active;
}

/** Dev/web-only: lets the "Résilier (simulation)" button keep working where
 * there's no real subscription to manage. Real cancellation always happens
 * in iOS Settings — see openManageSubscriptions() in paywall-modal.tsx. */
export async function setSimulatedPremium(active: boolean): Promise<void> {
  await AsyncStorage.setItem(SIMULATED_KEY, active ? 'true' : 'false');
}

/** The monthly plan's price as the App Store shows it in the user's own
 * storefront and currency (e.g. "6,99 €"), or null when StoreKit can't be
 * reached — callers then fall back to the static price in the translations. */
export async function getMonthlyLocalizedPrice(): Promise<string | null> {
  if (!IAP_AVAILABLE) return null;

  try {
    await ensureIAPConnected();
    const [subscription] = await getSubscriptions({ skus: [MONTHLY_SKU] });
    return subscription && 'localizedPrice' in subscription ? subscription.localizedPrice : null;
  } catch (error) {
    console.warn('[premium] lecture du prix StoreKit a échoué', error);
    return null;
  }
}

export const isRealIAPAvailable = IAP_AVAILABLE;
