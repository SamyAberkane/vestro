import { toByteArray } from 'base64-js';

import { supabase } from '@/lib/supabase';
import { splitDataUri } from '@/utils/remove-background';

const BUCKET = 'clothing-images';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function extensionForMimeType(mimeType: string): string {
  return mimeType === 'image/png' ? 'png' : 'jpg';
}

// Clothing photos are stored as data URIs in memory (see utils/remove-background.ts)
// and uploaded straight to a private, per-user folder in Storage — the DB only ever
// keeps the storage path, never the raw bytes.
export async function uploadClothingImage(userId: string, dataUri: string): Promise<string> {
  const { mimeType, base64 } = splitDataUri(dataUri);
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extensionForMimeType(mimeType)}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, toByteArray(base64), { contentType: mimeType, upsert: false });

  if (error) throw error;
  return path;
}

// The bucket is private, so every screen that renders images fetches short-lived
// signed URLs on load rather than storing a permanent public URL in the DB.
export async function getSignedImageUrls(paths: string[]): Promise<Record<string, string>> {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) return {};

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(uniquePaths, SIGNED_URL_TTL_SECONDS);

  if (error) throw error;

  const result: Record<string, string> = {};
  data?.forEach((entry) => {
    if (entry.signedUrl && entry.path) result[entry.path] = entry.signedUrl;
  });
  return result;
}
