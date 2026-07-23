import { supabase } from '@/lib/supabase';
import type { ClothingItem, ClothingStatus } from '@/types/clothing';
import { getSignedImageUrls, uploadClothingImage } from '@/utils/storage';

type ClothingRow = {
  id: number;
  name: string;
  category: string;
  color: string | null;
  image_path: string | null;
  price: number | null;
  status: ClothingStatus;
  available: boolean;
  unavailable_reason: string | null;
};

async function rowsToItems(rows: ClothingRow[]): Promise<ClothingItem[]> {
  const paths = rows
    .map((row) => row.image_path)
    .filter((path): path is string => Boolean(path));
  const urls = await getSignedImageUrls(paths);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    color: row.color ?? undefined,
    image: row.image_path ? urls[row.image_path] : undefined,
    price: row.price ?? undefined,
    status: row.status,
    available: row.available,
    unavailableReason: row.unavailable_reason ?? undefined,
  }));
}

async function requireUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  return user.id;
}

export async function fetchClothingItems(): Promise<ClothingItem[]> {
  const { data, error } = await supabase
    .from('clothing_items')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return rowsToItems(data ?? []);
}

export type NewClothingItem = {
  name: string;
  category: string;
  color?: string;
  price?: number;
  status: ClothingStatus;
  available: boolean;
  imageDataUri?: string;
};

export async function insertClothingItems(newItems: NewClothingItem[]): Promise<ClothingItem[]> {
  const userId = await requireUserId();

  const rows = await Promise.all(
    newItems.map(async (item) => ({
      user_id: userId,
      name: item.name,
      category: item.category,
      color: item.color ?? null,
      price: item.price ?? null,
      status: item.status,
      available: item.available,
      image_path: item.imageDataUri ? await uploadClothingImage(userId, item.imageDataUri) : null,
    }))
  );

  const { data, error } = await supabase.from('clothing_items').insert(rows).select();
  if (error) throw error;
  return rowsToItems(data ?? []);
}

export type ClothingItemPatch = {
  name?: string;
  category?: string;
  color?: string | undefined;
  price?: number | undefined;
  status?: ClothingStatus;
  available?: boolean;
  unavailableReason?: string | undefined;
  imageDataUri?: string;
};

export async function updateClothingItem(id: number, patch: ClothingItemPatch): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.category !== undefined) update.category = patch.category;
  if ('color' in patch) update.color = patch.color ?? null;
  if ('price' in patch) update.price = patch.price ?? null;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.available !== undefined) update.available = patch.available;
  if ('unavailableReason' in patch) update.unavailable_reason = patch.unavailableReason ?? null;

  if (patch.imageDataUri) {
    const userId = await requireUserId();
    update.image_path = await uploadClothingImage(userId, patch.imageDataUri);
  }

  const { error } = await supabase.from('clothing_items').update(update).eq('id', id);
  if (error) throw error;
}

export async function deleteClothingItem(id: number): Promise<void> {
  const { error } = await supabase.from('clothing_items').delete().eq('id', id);
  if (error) throw error;
}
