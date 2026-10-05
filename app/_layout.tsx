import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
} from '@expo-google-fonts/archivo';
import {
  PlayfairDisplay_500Medium,
  PlayfairDisplay_500Medium_Italic,
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_600SemiBold_Italic,
} from '@expo-google-fonts/playfair-display';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '@/auth/context';
import { AlertHost } from '@/components/alert-host';
import { LaunchLoader } from '@/components/launch-loader';
import { Onboarding } from '@/components/onboarding';
import { I18nProvider } from '@/i18n/context';
import { optimizeStoredImages, recutStoredImageBackgrounds } from '@/lib/clothing';
import { initIAP, teardownIAP } from '@/lib/premium';
import { AppThemeProvider, useAppTheme } from '@/theme/context';

const ONBOARDING_KEY = 'vestro-onboarding-seen';
// One-time, silent pass over already-stored clothing photos so anything
// saved before WebP output existed (see MAX_OUTPUT_WIDTH / OUTPUT_COMPRESS
// in utils/remove-background.ts) gets caught up automatically — no UI, no
// user action, runs once per account and never again once it succeeds.
const IMAGES_OPTIMIZED_KEY = 'vestro-images-optimized-v2';
// Same one-time, silent pattern as above, for a different cleanup: any photo
// cut by the old border-seeded flood fill (see keyOutBackground in
// utils/remove-background.ts) can have leftover solid magenta trapped inside
// an enclosed shape — a bag handle, glasses lenses — that fill could never
// reach. This re-keys every stored photo with the current algorithm; no new
// Gemini call, so no quota cost either way.
//
// Bumped to v2 on 2026-09-07: keyOutBackground itself changed (added a
// bounded edge-erosion pass to clear the anti-aliased magenta fringe the
// flat per-pixel test alone left behind — see utils/remove-background.ts).
// The v1 flag had already been set on some devices by the OLD, fringe-prone
// version of that function before this fix landed, which would otherwise
// permanently skip re-running this cleanup with the corrected algorithm —
// bumping the key forces every device to redo this pass once more.
const MAGENTA_RECUT_KEY = 'vestro-magenta-recut-v2';

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { isSignedIn, isLoading } = useAuth();
  const { scheme } = useAppTheme();
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then((value) => setOnboardingSeen(value === 'true'));
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;

    AsyncStorage.getItem(IMAGES_OPTIMIZED_KEY).then((done) => {
      if (done === 'true') return;

      optimizeStoredImages()
        .then(() => AsyncStorage.setItem(IMAGES_OPTIMIZED_KEY, 'true'))
        .catch((error) => console.warn('[imageOptimization] échec, nouvel essai au prochain lancement', error));
    });

    AsyncStorage.getItem(MAGENTA_RECUT_KEY).then((done) => {
      if (done === 'true') return;

      recutStoredImageBackgrounds()
        .then(() => AsyncStorage.setItem(MAGENTA_RECUT_KEY, 'true'))
        .catch((error) => console.warn('[magentaRecut] échec, nouvel essai au prochain lancement', error));
    });
  }, [isSignedIn]);

  function finishOnboarding() {
    setOnboardingSeen(true);
    AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  }

  // The whole app is browsable without a subscription now — premium is only
  // asked for at the specific actions that need it (see useAddClothing and
  // wishlist.tsx's addWishlistItem), enforced for real by Postgres RLS
  // (has_active_premium() — see supabase/schema.sql), not by this gate. Only
  // onboarding's one-time seen-flag still blocks the first paint.
  if (isLoading || onboardingSeen === null) {
    return <LaunchLoader />;
  }

  return (
    <NavigationThemeProvider value={scheme === 'light' ? DefaultTheme : DarkTheme}>
      <Stack>
        <Stack.Protected guard={isSignedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          <Stack.Screen
            name="create-outfit"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen name="account" options={{ headerShown: false, presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Protected guard={!isSignedIn}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
        {/* Reachable whether signed in or not: linked from both the login screen and the paywall. */}
        <Stack.Screen name="legal/mentions" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="legal/privacy" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="legal/terms" options={{ headerShown: false, presentation: 'modal' }} />
      </Stack>

      {isSignedIn && !onboardingSeen && <Onboarding onDone={finishOnboarding} />}

      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />

      <AlertHost />
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    PlayfairDisplay_500Medium,
    PlayfairDisplay_500Medium_Italic,
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_600SemiBold_Italic,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    initIAP();
    return teardownIAP;
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </I18nProvider>
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}
