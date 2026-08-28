import { toByteArray, fromByteArray } from 'base64-js';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as UPNG from 'upng-js';

import { VestroCategories, VestroPalette } from '@/constants/theme';
import { Language } from '@/i18n/translations';
import { supabase } from '@/lib/supabase';

// Clothing photos are never displayed above ~340px in the app; shrinking
// before upload cuts network time and the payload sent to the edit function.
const MAX_UPLOAD_WIDTH = 1024;

// The photorealistic redraw Gemini now produces (real fabric texture, sheen,
// shading — see the edge function's prompt) compresses far worse than the
// old flat/cartoon renders, and the app still only ever shows it at ~340px,
// so the final image is shrunk to a real display size (2x for retina) before
// it's ever stored.
const MAX_OUTPUT_WIDTH = 700;

// Lossless PNG (what UPNG.encode below produces) still lands at 300-800KB
// for this kind of textured, gradient-heavy content even once resized —
// the format itself, not just the resolution, is the bottleneck. WebP keeps
// the alpha channel (unlike JPEG) but compresses photographic detail far
// more efficiently, so every stored sticker is re-encoded to WebP as its
// last step, whether or not it also needed a resize.
const OUTPUT_COMPRESS = 0.85;

// Reasons a source photo can't produce a clean isolated sticker — surfaced to
// the user (via i18n `photoIssue.<code>`) so a rejected photo comes with a
// concrete "try again because X" instead of a silent bad result.
export const PHOTO_ISSUE_CODES = [
  'multiple_items',
  'cropped',
  'too_dark_or_blurry',
  'no_item_detected',
  'other',
  // Never returned by Gemini itself (parseClothingMetadata only ever matches
  // it against the model's own JSON, which can't produce this value) — set
  // directly in analyzeClothingPhoto() below when the server's own monthly
  // quota gate rejects the call before Gemini is even called.
  'quota_exceeded',
] as const;

export type PhotoIssue = (typeof PHOTO_ISSUE_CODES)[number];

type ClothingMetadata = {
  name?: string;
  category?: string;
  color?: string;
  /** Defaults to true (fail open) whenever the model doesn't explicitly say otherwise. */
  usable?: boolean;
  issue?: PhotoIssue;
};

function parseClothingMetadata(text: string | undefined, tag: string): ClothingMetadata {
  if (!text) return {};

  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) {
    console.warn(`${tag} pas de JSON trouvé dans la réponse texte: "${text.slice(0, 200)}"`);
    return {};
  }

  try {
    const parsed = JSON.parse(match[0]);
    const category = VestroCategories.find(
      (option) => option.toLowerCase() === String(parsed.category ?? '').toLowerCase()
    );
    const colorSwatch = VestroPalette.find(
      (swatch) => swatch.label.toLowerCase() === String(parsed.color ?? '').toLowerCase()
    );
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : undefined;
    const usable = parsed.usable !== false;
    const issue = usable
      ? undefined
      : PHOTO_ISSUE_CODES.find((code) => code === parsed.issue) ?? 'other';

    return {
      name: name || undefined,
      category,
      color: colorSwatch?.hex,
      usable,
      issue,
    };
  } catch (error) {
    console.warn(`${tag} JSON invalide dans la réponse texte: "${match[0].slice(0, 200)}"`, error);
    return {};
  }
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function uriToDataUri(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return blobToDataUri(blob);
}

async function resizeForUpload(uri: string, tag: string): Promise<string> {
  try {
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: MAX_UPLOAD_WIDTH, height: null });
    const renderedImage = await context.renderAsync();
    const result = await renderedImage.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    console.log(`${tag} photo redimensionnée à ${MAX_UPLOAD_WIDTH}px de large avant envoi`);
    return result.uri;
  } catch (error) {
    console.warn(`${tag} échec du redimensionnement, envoi de la photo originale`, error);
    return uri;
  }
}

export function splitDataUri(dataUri: string): { mimeType: string; base64: string } {
  const match = dataUri.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (!match) {
    throw new Error('Format de data URI non reconnu (attendu "data:<mime>;base64,...")');
  }
  return { mimeType: match[1], base64: match[2] };
}

// Gemini never returns a pixel-perfect #FFFFFF background — it's always off by
// a few RGB units, and often the backdrop isn't even flat (a soft studio
// vignette, darker in the corners than the center, is common). Instead of one
// global comparison, the flood-fill below grows outward from the border and
// re-checks tolerance against each newly-cleared neighbor's own color (not
// the original global sample) — so it can walk a slowly drifting gradient
// step by step. A separate, looser cap against the original sampled color
// still stops it from drifting arbitrarily far, so it can't eat through a
// garment of gradually-changing shading far from the border.
//
// Known limitation: this is plain chroma-keying, not real segmentation, so it
// cannot tell a near-background pixel apart from a garment of a similar color
// (e.g. a white t-shirt or sneakers) touching it. No bail-out on how much gets
// cleared: a visible leftover background is worse than an over-aggressive cut
// on a light garment, by design.
const LOCAL_STEP_TOLERANCE = 16;
const MAX_DRIFT_FROM_SAMPLE = 46;

type Rgb = { r: number; g: number; b: number };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// The border is overwhelmingly background pixels (the redraw prompt centers
// the item away from the edges), so the median border color is a robust
// stand-in for "the background color Gemini actually rendered" — a median,
// unlike a mean, isn't dragged off by the minority of border pixels that do
// belong to the item.
function sampleBackgroundColor(rgba: Uint8Array, width: number, height: number): Rgb {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];

  function sample(x: number, y: number) {
    const offset = (y * width + x) * 4;
    reds.push(rgba[offset]);
    greens.push(rgba[offset + 1]);
    blues.push(rgba[offset + 2]);
  }

  for (let x = 0; x < width; x++) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    sample(0, y);
    sample(width - 1, y);
  }

  return { r: median(reds), g: median(greens), b: median(blues) };
}

function withinTolerance(rgba: Uint8Array, pixelIndex: number, ref: Rgb, tolerance: number): boolean {
  const offset = pixelIndex * 4;
  return (
    Math.abs(rgba[offset] - ref.r) <= tolerance &&
    Math.abs(rgba[offset + 1] - ref.g) <= tolerance &&
    Math.abs(rgba[offset + 2] - ref.b) <= tolerance
  );
}

function pixelRgb(rgba: Uint8Array, pixelIndex: number): Rgb {
  const offset = pixelIndex * 4;
  return { r: rgba[offset], g: rgba[offset + 1], b: rgba[offset + 2] };
}

function snapBorderToTransparent(rgba: Uint8Array, width: number, height: number): number {
  const background = sampleBackgroundColor(rgba, width, height);
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  let cleared = 0;

  function maybePush(x: number, y: number, ref: Rgb) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) return;
    visited[pixelIndex] = 1;
    if (
      withinTolerance(rgba, pixelIndex, ref, LOCAL_STEP_TOLERANCE) &&
      withinTolerance(rgba, pixelIndex, background, MAX_DRIFT_FROM_SAMPLE)
    ) {
      stack.push(pixelIndex);
    }
  }

  for (let x = 0; x < width; x++) {
    maybePush(x, 0, background);
    maybePush(x, height - 1, background);
  }
  for (let y = 0; y < height; y++) {
    maybePush(0, y, background);
    maybePush(width - 1, y, background);
  }

  while (stack.length > 0) {
    const pixelIndex = stack.pop()!;
    const ref = pixelRgb(rgba, pixelIndex);
    rgba[pixelIndex * 4 + 3] = 0;
    cleared++;

    const x = pixelIndex % width;
    const y = (pixelIndex - x) / width;
    maybePush(x - 1, y, ref);
    maybePush(x + 1, y, ref);
    maybePush(x, y - 1, ref);
    maybePush(x, y + 1, ref);
  }

  return cleared;
}

// Gemini is asked to redraw the item on a flat background, but it commonly
// answers with a JPEG regardless — JPEG has no alpha channel at all, so the
// flood-fill below would have nothing to make transparent and the photo's
// own (never quite pure) background would stay fully opaque and visible no
// matter how good the color-matching gets. Re-encoding through the device's
// own image pipeline first guarantees a real PNG (with an alpha channel) to
// work with, regardless of whatever format Gemini actually sent.
async function ensurePngDataUri(dataUri: string, tag: string): Promise<string> {
  const { mimeType } = splitDataUri(dataUri);
  if (mimeType === 'image/png') return dataUri;

  console.log(`${tag} conversion ${mimeType} → PNG avant détourage`);
  const rendered = await ImageManipulator.manipulate(dataUri).renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.PNG });
  return uriToDataUri(result.uri);
}

// Re-encodes a (still-transparent) PNG data URI as WebP — which keeps the
// alpha channel, unlike JPEG, but compresses photographic detail far better
// than lossless PNG — resizing down to MAX_OUTPUT_WIDTH first if needed.
async function finalizeSticker(pngDataUri: string, width: number, tag: string): Promise<string> {
  try {
    const context = ImageManipulator.manipulate(pngDataUri);
    if (width > MAX_OUTPUT_WIDTH) context.resize({ width: MAX_OUTPUT_WIDTH, height: null });
    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({ format: SaveFormat.WEBP, compress: OUTPUT_COMPRESS });
    return await uriToDataUri(result.uri);
  } catch (error) {
    console.warn(`${tag} échec de la finalisation, PNG conservé`, error);
    return pngDataUri;
  }
}

// Re-encodes an already-processed sticker (one stored before WebP output
// existed) to the current format/size — used for the one-time migration of
// existing clothing photos, as opposed to makeBackgroundTransparent below
// which also re-does the flood-fill cutout for a freshly-generated image.
export async function resizeStoredImageIfNeeded(
  dataUri: string,
  tag: string
): Promise<{ image: string; resized: boolean }> {
  try {
    const { mimeType, base64 } = splitDataUri(dataUri);
    // Only Gemini stickers (always PNG, for the transparency) are in scope —
    // forcing an older plain JPEG photo through this makes it bigger, not
    // smaller, since it was never in the bloated-PNG situation to begin with.
    if (mimeType !== 'image/png') return { image: dataUri, resized: false };

    const decoded = UPNG.decode(toByteArray(base64).buffer);
    const finalized = await finalizeSticker(dataUri, decoded.width, tag);
    return { image: finalized, resized: true };
  } catch (error) {
    console.warn(`${tag} échec de vérification de taille, image conservée telle quelle`, error);
    return { image: dataUri, resized: false };
  }
}

async function makeBackgroundTransparent(rawImageDataUri: string, tag: string): Promise<string> {
  try {
    const pngDataUri = await ensurePngDataUri(rawImageDataUri, tag);
    const { base64 } = splitDataUri(pngDataUri);

    const pngBytes = toByteArray(base64);
    const decoded = UPNG.decode(pngBytes.buffer);
    const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);

    const cleared = snapBorderToTransparent(rgba, decoded.width, decoded.height);

    const encoded = UPNG.encode([rgba.buffer], decoded.width, decoded.height, 0);
    const outBase64 = fromByteArray(new Uint8Array(encoded));
    console.log(
      `${tag} fond détouré: ${cleared}/${decoded.width * decoded.height} pixels rendus transparents (${decoded.width}x${decoded.height})`
    );
    const transparentDataUri = `data:image/png;base64,${outBase64}`;

    return await finalizeSticker(transparentDataUri, decoded.width, tag);
  } catch (error) {
    console.warn(`${tag} échec du détourage transparent, image conservée telle quelle`, error);
    return rawImageDataUri;
  }
}

type EditClothingPhotoResponse =
  | { status: 'success'; image?: { mimeType: string; base64: string }; text?: string; message: string }
  | { status: 'error'; message: string; code?: string };

type GeminiStickerOutcome = {
  image: string;
  text?: string;
  status: 'success' | 'error';
  message: string;
  /** Set only for the server's monthly quota rejection — see analyzeClothingPhoto. */
  code?: string;
};

/**
 * Sends a photo to the `edit-clothing-photo` Supabase Edge Function, which
 * holds the real Gemini API key server-side. Gemini doesn't cut out the
 * photographed pixels as-is — it *redraws* the item as a clean, flat,
 * catalog-style product shot on a white background (see the prompt server-
 * side), which is then stripped down to real transparency here on the
 * client. Returns a diagnostic outcome instead of failing silently so
 * callers can log/report exactly what happened.
 */
async function callEditClothingPhoto(
  sourceDataUri: string,
  language: Language | undefined,
  tag: string
): Promise<GeminiStickerOutcome> {
  const { mimeType, base64 } = splitDataUri(sourceDataUri);
  console.log(`${tag} image source: type=${mimeType}, ~${Math.round((base64.length * 3) / 4)} octets`);

  try {
    console.log(`${tag} envoi à edit-clothing-photo…`);

    const { data, error } = await supabase.functions.invoke<EditClothingPhotoResponse>(
      'edit-clothing-photo',
      { body: { language, mimeType, base64 } }
    );

    if (error) {
      // supabase-js's own error.message is just the generic "Edge Function
      // returned a non-2xx status code" — the actual reason the function
      // threw is in the response body, reachable only via error.context.
      if (error instanceof FunctionsHttpError) {
        const body: { message?: string; code?: string } | null = await error.context.json().catch(() => null);
        throw Object.assign(new Error(body?.message ?? error.message), { code: body?.code });
      }
      throw error;
    }
    if (!data) throw new Error('Réponse vide de edit-clothing-photo');
    if (data.status !== 'success') throw Object.assign(new Error(data.message), { code: data.code });
    if (!data.image) throw new Error('Réponse de edit-clothing-photo sans image');

    const resultBytes = Math.round((data.image.base64.length * 3) / 4);
    console.log(`${tag} image reçue: type=${data.image.mimeType}, ~${resultBytes} octets`);

    const rawImage = `data:${data.image.mimeType};base64,${data.image.base64}`;
    const image = await makeBackgroundTransparent(rawImage, tag);

    return { image, text: data.text, status: 'success', message: `OK — ~${resultBytes} octets reçus` };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    console.warn(`${tag} ÉCHEC: ${message}`, error);
    return { image: sourceDataUri, status: 'error', message, code };
  }
}

type ClassifyOnlyOutcome = { status: 'success' | 'error'; text?: string; message: string };

// Re-asks Gemini for just the JSON classification, without regenerating the
// image — used to retry a call that produced a usable sticker but dropped
// the name/category, since redoing the whole redraw a second time for a
// text-only miss roughly doubles the wait for no benefit.
async function classifyOnly(
  sourceDataUri: string,
  language: Language | undefined,
  tag: string
): Promise<ClassifyOnlyOutcome> {
  const { mimeType, base64 } = splitDataUri(sourceDataUri);

  try {
    const { data, error } = await supabase.functions.invoke<EditClothingPhotoResponse>(
      'edit-clothing-photo',
      { body: { language, mimeType, base64, classifyOnly: true } }
    );

    if (error) {
      if (error instanceof FunctionsHttpError) {
        const body: { message?: string } | null = await error.context.json().catch(() => null);
        throw new Error(body?.message ?? error.message);
      }
      throw error;
    }
    if (!data) throw new Error('Réponse vide de edit-clothing-photo');
    if (data.status !== 'success') throw new Error(data.message);

    return { status: 'success', text: data.text, message: data.message };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.warn(`${tag} ÉCHEC classification légère: ${message}`, error);
    return { status: 'error', message };
  }
}

// Real, on-device instance segmentation — Vision's
// VNGenerateForegroundInstanceMaskRequest (iOS 17+), the same API behind
// Photos' "lift subject" long-press — via the local vestro-subject-lift
// module. SHELVED for now (2026-08-26): the user wants to prioritize actually
// getting a good sticker result, which the Gemini redraw pipeline below can
// already do and be tested live (no EAS build needed), while the native
// module still needs a real device build to verify (blocked on build quota
// until September). The module and its Swift code are untouched and ready to
// come back — see project_vestro_sticker_pipeline memory — this function is
// just not called from the active pipeline right now.
async function liftSubjectOrThrow(uri: string, tag: string): Promise<string> {
  if (Platform.OS !== 'ios') {
    throw new Error('Le détourage nécessite un appareil iOS.');
  }

  const { liftSubject } = await import('vestro-subject-lift');
  const resultUri = await liftSubject(uri);
  const dataUri = await uriToDataUri(resultUri);
  console.log(`${tag} détourage natif (Vision) réussi`);
  return dataUri;
}
// Referenced to avoid an "unused function" lint error while it's shelved —
// remove this line when liftSubjectOrThrow is wired back into the pipeline.
void liftSubjectOrThrow;

/**
 * Converts a freshly-picked photo into a "Vestro friendly" sticker: same
 * clothing item redrawn flat, background cut to full transparency. Falls
 * back to the original photo if the edit function fails, so adding clothes
 * still works.
 */
export async function removeBackground(imageUri: string): Promise<string> {
  const tag = '[removeBackground]';

  const uploadUri = imageUri.startsWith('data:') ? imageUri : await resizeForUpload(imageUri, tag);
  const sourceDataUri = uploadUri.startsWith('data:') ? uploadUri : await uriToDataUri(uploadUri);
  const outcome = await callEditClothingPhoto(sourceDataUri, undefined, tag);
  return outcome.image;
}

export type ClothingAnalysis = {
  image: string;
  name?: string;
  category?: string;
  color?: string;
  /** false only when the model flagged the source photo as unusable — see `issue`. */
  usable?: boolean;
  issue?: PhotoIssue;
};

/**
 * Same sticker redraw as removeBackground, but in one call also asks for a
 * short name, category and palette color guessed from the photo — used when
 * bulk-adding clothes so the user doesn't have to fill those in by hand. Any
 * field the model doesn't confidently return is just left undefined.
 *
 * The model occasionally drops the name or category on an otherwise-usable
 * photo (it's juggling the image redraw and the classification in the same
 * pass) — when that happens we retry the call once rather than immediately
 * falling back to a generic "Vêtement N" name, since a second pass usually
 * gets a complete answer.
 */
export async function analyzeClothingPhoto(
  imageUri: string,
  language: Language = 'fr'
): Promise<ClothingAnalysis> {
  const tag = '[analyzeClothingPhoto]';

  const uploadUri = imageUri.startsWith('data:') ? imageUri : await resizeForUpload(imageUri, tag);
  const sourceDataUri = uploadUri.startsWith('data:') ? uploadUri : await uriToDataUri(uploadUri);
  const outcome = await callEditClothingPhoto(sourceDataUri, language, tag);

  // A total call failure (network error, Gemini down, rate-limited, monthly
  // quota reached) must not silently become a usable item with an unprocessed
  // photo and a placeholder name — route it through the same "rejected" path
  // as a model-flagged bad photo, so the caller shows a real error instead of
  // a broken result. The quota case gets its own issue code so the alert
  // shown to the user says why, instead of the generic "other" message.
  if (outcome.status !== 'success') {
    return {
      image: outcome.image,
      usable: false,
      issue: outcome.code === 'quota_exceeded' ? 'quota_exceeded' : 'other',
    };
  }

  const metadata = parseClothingMetadata(outcome.text, tag);

  if (metadata.usable !== false && (!metadata.name || !metadata.category)) {
    console.warn(`${tag} nom ou catégorie manquant, nouvelle tentative (classification seule)…`);
    const retryOutcome = await classifyOnly(sourceDataUri, language, tag);
    if (retryOutcome.status === 'success') {
      const retryMetadata = parseClothingMetadata(retryOutcome.text, tag);
      return {
        image: outcome.image,
        ...metadata,
        name: metadata.name ?? retryMetadata.name,
        category: metadata.category ?? retryMetadata.category,
        color: metadata.color ?? retryMetadata.color,
      };
    }
  }

  return { image: outcome.image, ...metadata };
}
