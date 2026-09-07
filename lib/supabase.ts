import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY manquants — vérifie ton fichier .env'
  );
}

// Every request this client makes — every screen's data fetch, every save,
// sign-in, storage upload — goes through plain `fetch` with no timeout of
// its own. If the network drops mid-request (a dead wifi handoff, airplane
// mode toggled at the wrong moment), the promise that call is awaiting never
// resolves or rejects; it just hangs forever, and whatever screen was
// waiting on it hangs with it. This one wrapper is what makes that
// impossible everywhere at once, instead of needing every call site in the
// app to remember to add its own timeout.
//
// A caller that already attached its own `signal` (see the `timeout` option
// on supabase.functions.invoke, used for the Gemini calls in
// utils/remove-background.ts, which legitimately take longer than this
// default) is trusted to have already bounded itself — this only fills in
// the default for requests that didn't.
const DEFAULT_REQUEST_TIMEOUT_MS = 20000;

const fetchWithDefaultTimeout: typeof fetch = (input, init) => {
  if (init?.signal) return fetch(input, init);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
};

// On web (including Expo Router's Node-side static rendering, where `window`
// doesn't exist) leave `storage` undefined so supabase-js falls back to its
// own SSR-safe localStorage adapter instead of AsyncStorage, which crashes
// outside a real DOM.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: fetchWithDefaultTimeout,
  },
});
