import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

const PREFIX = 'offline-cache:';

async function storageKeyFor(key: string): Promise<string> {
  // getSession() reads the locally persisted session and never hits the
  // network (unlike getUser()), so this still resolves while offline.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return `${PREFIX}${session?.user.id ?? 'anonymous'}:${key}`;
}

// Wipes every cached entry whose key starts with `keyPrefix` for the current
// user — call this after a successful insert/update/delete so a later
// network hiccup falls back to "no cache" (a visible error) instead of
// silently resurrecting the pre-mutation list, which is what let deleted
// clothing items reappear after a transient fetch failure. Matches both a
// plain list key (e.g. "clothing-items") and any derived keys sharing that
// prefix (e.g. "clothing-items-by-ids:1,2,3").
export async function invalidateCache(keyPrefix: string): Promise<void> {
  const userPrefix = await storageKeyFor(keyPrefix);
  const allKeys = await AsyncStorage.getAllKeys();
  const matching = allKeys.filter((k) => k.startsWith(userPrefix));
  if (matching.length > 0) await AsyncStorage.multiRemove(matching);
}

// Runs `fetcher` against the network and remembers the result under `key`,
// so that the next call falls back to that last-known-good result instead
// of throwing when the network fails (no connection, request timeout, etc).
// Only for read paths — inserts/updates/deletes always go straight to the
// network, since those need the server's RLS/entitlement checks to be real.
export async function readThroughCache<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const storageKey = await storageKeyFor(key);

  try {
    const result = await fetcher();
    AsyncStorage.setItem(storageKey, JSON.stringify(result)).catch(() => {});
    return result;
  } catch (error) {
    const cached = await AsyncStorage.getItem(storageKey);
    if (cached != null) return JSON.parse(cached) as T;
    throw error;
  }
}
