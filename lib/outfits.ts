import { supabase } from '@/lib/supabase';
import type { Outfit } from '@/types/clothing';

type OutfitRow = {
  id: number;
  name: string;
  item_ids: number[];
  layout: Outfit['layout'] | null;
  show_price: boolean | null;
};

function rowToOutfit(row: OutfitRow): Outfit {
  return {
    id: row.id,
    name: row.name,
    itemIds: row.item_ids,
    layout: row.layout ?? {},
    showPrice: row.show_price ?? false,
  };
}

async function requireUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  return user.id;
}

export async function fetchOutfits(): Promise<Outfit[]> {
  const { data, error } = await supabase
    .from('outfits')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(rowToOutfit);
}

export async function insertOutfit(outfit: {
  name: string;
  itemIds: number[];
  layout: Outfit['layout'];
  showPrice?: boolean;
}): Promise<Outfit> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('outfits')
    .insert({
      user_id: userId,
      name: outfit.name,
      item_ids: outfit.itemIds,
      layout: outfit.layout,
      show_price: outfit.showPrice ?? false,
    })
    .select()
    .single();

  if (error) throw error;
  return rowToOutfit(data);
}

export async function updateOutfit(
  id: number,
  patch: { name?: string; itemIds?: number[]; layout?: Outfit['layout']; showPrice?: boolean }
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.itemIds !== undefined) update.item_ids = patch.itemIds;
  if (patch.layout !== undefined) update.layout = patch.layout;
  if (patch.showPrice !== undefined) update.show_price = patch.showPrice;

  const { error } = await supabase.from('outfits').update(update).eq('id', id);
  if (error) throw error;
}

export async function deleteOutfit(id: number): Promise<void> {
  const { error } = await supabase.from('outfits').delete().eq('id', id);
  if (error) throw error;
}
