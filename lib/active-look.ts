import { invalidateCache, readThroughCache } from '@/lib/offline-cache';
import { supabase } from '@/lib/supabase';
import type { ActiveLook } from '@/types/clothing';

type Listener = () => void;
const listeners = new Set<Listener>();

// The home screen only loads the active look once (see index.tsx) instead of
// on every tab focus, so switching tabs mid-edit never wipes out unsaved
// board changes — this is how the home screen still finds out when the
// active look actually changed somewhere else, like "wear this outfit" on
// the create-outfit screen.
export function notifyActiveLookChanged() {
  listeners.forEach((listener) => listener());
}

export function subscribeToActiveLookChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function fetchActiveLook(): Promise<ActiveLook | null> {
  return readThroughCache('active-look', async () => {
    const { data, error } = await supabase.from('active_looks').select('*').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { itemIds: data.item_ids, layout: data.layout ?? {} };
  });
}

export async function saveActiveLook(look: ActiveLook): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { error } = await supabase.from('active_looks').upsert({
    user_id: user.id,
    item_ids: look.itemIds,
    layout: look.layout,
    updated_at: new Date().toISOString(),
  });

  if (error) throw new Error(error.message);
  await invalidateCache('active-look');
  notifyActiveLookChanged();
}
