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

let didInit = false;
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
  const { data, error } = await supabase.functions.invoke<{
    isPremium: boolean;
    expiresAt: string | null;
    message?: string;
  }>('verify-purchase', { body: { transactionId } });

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
function waitForVerifiedPurchase(timeoutMs = 30000): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const entry: PendingVerification = { resolve, reject };
    pendingVerifications.push(entry);

    setTimeout(() => {
      pendingVerifications = pendingVerifications.filter((pending) => pending !== entry);
      reject(new Error('Délai dépassé en attendant la confirmation StoreKit'));
    }, timeoutMs);
  });
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
}

export function teardownIAP(): void {
  updateSub?.remove();
  errorSub?.remove();
  updateSub = null;
  errorSub = null;
  if (IAP_AVAILABLE && didInit) endConnection();
  didInit = false;
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
      .select('is_active, expires_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) throw new Error(error.message);

    const active =
      Boolean(data?.is_active) && (!data?.expires_at || new Date(data.expires_at) > new Date());
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

  const subscriptions = await getSubscriptions({ skus: [MONTHLY_SKU] });
  if (subscriptions.length === 0) {
    throw new Error(
      `Produit "${MONTHLY_SKU}" introuvable côté App Store Connect (pas encore validé ?)`
    );
  }

  const verified = waitForVerifiedPurchase();
  await requestSubscription({ sku: MONTHLY_SKU });
  const active = await verified;

  if (!active) {
    throw new Error("La vérification de l'abonnement a échoué côté serveur");
  }
}

export async function restorePurchases(): Promise<boolean> {
  if (!IAP_AVAILABLE) {
    return (await AsyncStorage.getItem(SIMULATED_KEY)) === 'true';
  }

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

export const isRealIAPAvailable = IAP_AVAILABLE;
