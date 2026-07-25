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

import { View } from 'react-native';

import { AuthProvider, useAuth } from '@/auth/context';
import { Onboarding } from '@/components/onboarding';
import { PaywallModal } from '@/components/paywall-modal';
import { I18nProvider } from '@/i18n/context';
import { getIsPremium, initIAP, teardownIAP } from '@/lib/premium';
import { AppThemeProvider, useAppTheme } from '@/theme/context';

const ONBOARDING_KEY = 'vestro-onboarding-seen';

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { isSignedIn, isLoading, signOut } = useAuth();
  const { scheme, colors } = useAppTheme();
  const [isPremium, setIsPremium] = useState<boolean | null>(null);
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      setIsPremium(null);
      return;
    }

    let cancelled = false;
    getIsPremium().then((active) => {
      if (!cancelled) setIsPremium(active);
    });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then((value) => setOnboardingSeen(value === 'true'));
  }, []);

  function finishOnboarding() {
    setOnboardingSeen(true);
    AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  }

  // Block on the premium check too — Vestro has no free tier, so nothing
  // behind the gate should flash on screen before we know the entitlement.
  if (isLoading || (isSignedIn && isPremium === null) || onboardingSeen === null) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <NavigationThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
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

      {isSignedIn && isPremium === false && (
        <PaywallModal
          visible
          dismissible={false}
          onClose={() => {}}
          onPremiumChange={setIsPremium}
          onSignOut={signOut}
        />
      )}

      {isSignedIn && isPremium === true && !onboardingSeen && (
        <Onboarding onDone={finishOnboarding} />
      )}

      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
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
