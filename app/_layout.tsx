import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
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
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { View } from 'react-native';

import { AuthProvider, useAuth } from '@/auth/context';
import { VestroColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { I18nProvider } from '@/i18n/context';
import { initIAP, teardownIAP } from '@/lib/premium';

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { isSignedIn, isLoading } = useAuth();

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: VestroColors.background }} />;
  }

  return (
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
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
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
      <I18nProvider>
        <AuthProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <RootNavigator />
            <StatusBar style="auto" />
          </ThemeProvider>
        </AuthProvider>
      </I18nProvider>
    </GestureHandlerRootView>
  );
}
