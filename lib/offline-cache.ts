import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

const PREFIX = 'offline-cache:';

// A per-group counter, bumped by every invalidateCache call and never itself
// wiped by one (see the exclusion in invalidateCache below) — see
// readThroughCache for why a plain wipe-on-delete isn't actually enough.
const GENERATION_SUFFIX = ':__generation';

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
//
// That alone isn't enough on its own, though: readThroughCache below writes
// its result to storage in the background, without waiting for it, so a
// *slower* fetch that started before this delete can still finish and write
// *after* this wipe runs — silently resurrecting the very row this call just
// deleted, with no network hiccup needed at all. Bumping a generation counter
// that a write checks before landing (and that this wipe deliberately leaves
// alone, so it only ever goes up) is what lets a write recognize its own
// data is now stale and skip itself instead.
export async function invalidateCache(keyPrefix: string): Promise<void> {
  const userPrefix = await storageKeyFor(keyPrefix);
  const allKeys = await AsyncStorage.getAllKeys();
  const matching = allKeys.filter((k) => k.startsWith(userPrefix) && !k.endsWith(GENERATION_SUFFIX));
  if (matching.length > 0) await AsyncStorage.multiRemove(matching);

  const generationKey = `${userPrefix}${GENERATION_SUFFIX}`;
  const current = Number((await AsyncStorage.getItem(generationKey)) ?? '0') || 0;
  await AsyncStorage.setItem(generationKey, String(current + 1));
}

// Runs `fetcher` against the network and remembers the result under `key`,
// so that the next call falls back to that last-known-good result instead
// of throwing when the network fails (no connection, request timeout, etc).
// Only for read paths — inserts/updates/deletes always go straight to the
// network, since those need the server's RLS/entitlement checks to be real.
//
// `group` identifies which invalidateCache prefix this key lives under (it
// defaults to `key` itself, which is right for every plain list key — only a
// key *derived* from a shared prefix, like clothing.ts's
// "clothing-items-by-ids:...", needs to pass the shared group explicitly) —
// see invalidateCache's comment for why this check exists at all.
export async function readThroughCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  group: string = key
): Promise<T> {
  const storageKey = await storageKeyFor(key);
  const generationKey = `${await storageKeyFor(group)}${GENERATION_SUFFIX}`;
  const generationBefore = await AsyncStorage.getItem(generationKey);

  try {
    const result = await fetcher();
    AsyncStorage.getItem(generationKey)
      .then((generationAfter) => {
        if (generationAfter !== generationBefore) return;
        return AsyncStorage.setItem(storageKey, JSON.stringify(result));
      })
      .catch(() => {});
    return result;
  } catch (error) {
    const cached = await AsyncStorage.getItem(storageKey);
    if (cached != null) return JSON.parse(cached) as T;
    throw error;
  }
}
