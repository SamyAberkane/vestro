import { invalidateCache, readThroughCache } from '@/lib/offline-cache';
import { supabase } from '@/lib/supabase';
import type { ClothingItem, ClothingStatus } from '@/types/clothing';
import { recutStoredSticker, resizeStoredImageIfNeeded, splitDataUri, uriToDataUri } from '@/utils/remove-background';
import { deleteClothingImage, getSignedImageUrls, uploadClothingImage } from '@/utils/storage';

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
    imagePath: row.image_path ?? undefined,
    price: row.price ?? undefined,
    status: row.status,
    available: row.available,
    unavailableReason: row.unavailable_reason ?? undefined,
  }));
}

type Listener = () => void;
const listeners = new Set<Listener>();

// Screens that keep their own fetched copy of the clothing list (Dressing,
// Wishlist, home preview, outfit builder) can't see an insert made from the
// tab bar's global "+" button — it lives outside their component tree, and
// if the insert's own post-insert navigation happens to land back on a
// screen that's already focused (e.g. adding a garment while already on the
// Dressing tab), no navigation-focus event fires either to prompt a
// refetch. This plain pub/sub lets any mounted screen react immediately
// instead of only on its next focus.
export function notifyClothingItemsChanged() {
  listeners.forEach((listener) => listener());
}

export function subscribeToClothingItemsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function requireUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  return user.id;
}

export async function fetchClothingItems(): Promise<ClothingItem[]> {
  return readThroughCache('clothing-items', async () => {
    const { data, error } = await supabase
      .from('clothing_items')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return rowsToItems(data ?? []);
  });
}

// Used where only a handful of specific items are needed (e.g. the home
// screen's saved outfit) — signs image URLs for just those rows instead of
// the whole wardrobe, which fetchClothingItems() would otherwise pay for on
// every load just to look up a few IDs.
export async function fetchClothingItemsByIds(ids: number[]): Promise<ClothingItem[]> {
  if (ids.length === 0) return [];

  const cacheKey = `clothing-items-by-ids:${[...ids].sort((a, b) => a - b).join(',')}`;
  return readThroughCache(
    cacheKey,
    async () => {
      const { data, error } = await supabase.from('clothing_items').select('*').in('id', ids);
      if (error) throw new Error(error.message);
      return rowsToItems(data ?? []);
    },
    'clothing-items'
  );
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
  if (error) throw new Error(error.message);
  await invalidateCache('clothing-items');
  notifyClothingItemsChanged();
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
  if (error) throw new Error(error.message);
  await invalidateCache('clothing-items');
  notifyClothingItemsChanged();
}

export async function deleteClothingItem(id: number): Promise<void> {
  const { error } = await supabase.from('clothing_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await invalidateCache('clothing-items');
  notifyClothingItemsChanged();
}

export type OptimizeImagesResult = { optimized: number; skipped: number; failed: number };

// One-time cleanup for clothing photos stored before WebP output existed
// (see utils/remove-background.ts) — downloads each old PNG, re-encodes it,
// and swaps the stored file, with no visible change since the app never
// renders these above ~340px anyway. Every already-optimized photo is a
// `.webp` file (see uploadClothingImage), so filtering on the `.png`
// extension at the query level means a repeat run costs one cheap DB query
// and downloads nothing — unlike checking each image's own bytes, which
// pays for a full download just to decide there's nothing to do.
export async function optimizeStoredImages(
  onProgress?: (done: number, total: number) => void
): Promise<OptimizeImagesResult> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('clothing_items')
    .select('id, image_path')
    .like('image_path', '%.png');
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { id: number; image_path: string }[];
  const result: OptimizeImagesResult = { optimized: 0, skipped: 0, failed: 0 };
  console.log(`[optimizeStoredImages] démarrage sur ${rows.length} articles`);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const tag = `[optimizeStoredImages #${row.id}]`;

    // This is a silent background pass (see the one-time trigger in
    // app/_layout.tsx) running while the user is actively using the app —
    // the PNG decode/re-encode below is synchronous, CPU-bound work on the
    // JS thread, the same thread that drives navigation and touch handling.
    // Without a yield between items, a wardrobe of any real size runs this
    // as one unbroken block and the whole app appears frozen for as long as
    // it takes — exactly the freeze reported after switching tabs shortly
    // after sign-in. A one-tick yield per item costs nothing to the job
    // itself but gives the JS thread a chance to handle a pending
    // navigation/gesture in between.
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      const urls = await getSignedImageUrls([row.image_path]);
      const signedUrl = urls[row.image_path];
      if (!signedUrl) {
        console.log(`${tag} pas d'URL signée, ignoré`);
        result.skipped++;
        continue;
      }

      const dataUri = await uriToDataUri(signedUrl);
      const beforeBytes = Math.round((splitDataUri(dataUri).base64.length * 3) / 4);
      const { image, resized } = await resizeStoredImageIfNeeded(dataUri, tag);

      if (!resized) {
        console.log(`${tag} déjà correct (${beforeBytes} octets), ignoré`);
        result.skipped++;
      } else {
        const afterBytes = Math.round((splitDataUri(image).base64.length * 3) / 4);
        const newPath = await uploadClothingImage(userId, image);
        const { error: updateError } = await supabase
          .from('clothing_items')
          .update({ image_path: newPath })
          .eq('id', row.id);
        if (updateError) throw updateError;

        await deleteClothingImage(row.image_path);
        console.log(`${tag} redimensionné: ${beforeBytes} → ${afterBytes} octets`);
        result.optimized++;
      }
    } catch (itemError) {
      console.warn(`${tag} échec`, itemError);
      result.failed++;
    }

    onProgress?.(i + 1, rows.length);
  }

  console.log(
    `[optimizeStoredImages] terminé: ${result.optimized} redimensionnées, ${result.skipped} ignorées, ${result.failed} échecs`
  );

  if (result.optimized > 0) {
    await invalidateCache('clothing-items');
    notifyClothingItemsChanged();
  }
  return result;
}

export type RecutBackgroundsResult = { recut: number; skipped: number; failed: number };

// One-time cleanup pass over every stored clothing photo, catching leftover
// solid magenta that the old border-seeded cutout (replaced by
// keyOutBackground — see utils/remove-background.ts) could never reach:
// anywhere the item's own silhouette encloses a loop or hole, like a bag
// handle, glasses lenses, or a bracelet. No new Gemini call — the already
// generated image just gets re-keyed with the current algorithm, so this
// costs nothing against the monthly quota. Runs over every item rather than
// filtering by filename (unlike optimizeStoredImages above) because both the
// old and new algorithms produce the same .webp extension; recutStoredSticker
// itself is what decides per-image whether there's anything to redo.
export async function recutStoredImageBackgrounds(
  onProgress?: (done: number, total: number) => void
): Promise<RecutBackgroundsResult> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('clothing_items')
    .select('id, image_path')
    .not('image_path', 'is', null);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { id: number; image_path: string }[];
  const result: RecutBackgroundsResult = { recut: 0, skipped: 0, failed: 0 };
  console.log(`[recutStoredImageBackgrounds] démarrage sur ${rows.length} articles`);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const tag = `[recutStoredImageBackgrounds #${row.id}]`;

    // Same reason as the identical yield in optimizeStoredImages above —
    // this is the second silent one-time background pass triggered from
    // app/_layout.tsx, doing the same kind of synchronous decode/pixel-walk/
    // encode work per item.
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      const urls = await getSignedImageUrls([row.image_path]);
      const signedUrl = urls[row.image_path];
      if (!signedUrl) {
        console.log(`${tag} pas d'URL signée, ignoré`);
        result.skipped++;
        continue;
      }

      const dataUri = await uriToDataUri(signedUrl);
      const { image, cleared } = await recutStoredSticker(dataUri, tag);

      if (cleared === 0) {
        result.skipped++;
      } else {
        const newPath = await uploadClothingImage(userId, image);
        const { error: updateError } = await supabase
          .from('clothing_items')
          .update({ image_path: newPath })
          .eq('id', row.id);
        if (updateError) throw updateError;

        await deleteClothingImage(row.image_path);
        result.recut++;
      }
    } catch (itemError) {
      console.warn(`${tag} échec`, itemError);
      result.failed++;
    }

    onProgress?.(i + 1, rows.length);
  }

  console.log(
    `[recutStoredImageBackgrounds] terminé: ${result.recut} recadrées, ${result.skipped} ignorées, ${result.failed} échecs`
  );

  if (result.recut > 0) {
    await invalidateCache('clothing-items');
    notifyClothingItemsChanged();
  }
  return result;
}

