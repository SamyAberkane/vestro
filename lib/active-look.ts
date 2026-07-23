import { supabase } from '@/lib/supabase';
import type { ActiveLook } from '@/types/clothing';

export async function fetchActiveLook(): Promise<ActiveLook | null> {
  const { data, error } = await supabase.from('active_looks').select('*').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { itemIds: data.item_ids, layout: data.layout ?? {} };
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

  if (error) throw error;
}
