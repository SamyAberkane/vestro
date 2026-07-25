import { toByteArray, fromByteArray } from 'base64-js';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as UPNG from 'upng-js';

import { VestroCategories, VestroPalette } from '@/constants/theme';
import { Language } from '@/i18n/translations';
import { supabase } from '@/lib/supabase';

// Clothing photos are never displayed above ~340px in the app; shrinking
// before upload cuts network time and the payload sent to the edit function.
const MAX_UPLOAD_WIDTH = 1024;

// Reasons a source photo can't produce a clean isolated sticker — surfaced to
// the user (via i18n `photoIssue.<code>`) so a rejected photo comes with a
// concrete "try again because X" instead of a silent bad result. Mirrors the
// same list in supabase/functions/edit-clothing-photo/index.ts.
export const PHOTO_ISSUE_CODES = [
  'multiple_items',
  'cropped',
  'too_dark_or_blurry',
  'no_item_detected',
  'other',
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

async function uriToDataUri(uri: string): Promise<string> {
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

// Gemini never returns a pixel-perfect #FFFFFF background — it's always off by a
// few RGB units, which showed up as a faint mismatched rectangle around each item
// once placed on the (real) pure-white outfit canvas. Rather than trust the model
// to hit an exact hex value, we flood-fill every near-white pixel reachable from
// the image border and make it fully transparent, so the border color can never
// mismatch again — items render as true cutout "stickers" on any background.
//
// Known limitation: this is plain chroma-keying, not real segmentation, so it
// cannot tell a near-white *background* apart from a near-white *garment*
// (e.g. a white t-shirt or sneakers) touching it — both are "close to white".
// Kept deliberately tight to minimize that risk, and MAX_CLEARED_FRACTION below
// bails out to the original opaque image if it looks like a garment got eaten.
const BACKGROUND_MATCH_TOLERANCE = 14;

// If flood fill wipes out almost the entire image, it almost certainly ate a
// light-colored garment along with the background rather than just the frame —
// better to keep the (mismatched but visible) opaque original than an
// accidentally-blank item.
const MAX_CLEARED_FRACTION = 0.9;

function isNearWhite(rgba: Uint8Array, pixelIndex: number): boolean {
  const offset = pixelIndex * 4;
  return (
    255 - rgba[offset] <= BACKGROUND_MATCH_TOLERANCE &&
    255 - rgba[offset + 1] <= BACKGROUND_MATCH_TOLERANCE &&
    255 - rgba[offset + 2] <= BACKGROUND_MATCH_TOLERANCE
  );
}

function snapBorderToTransparent(rgba: Uint8Array, width: number, height: number): number {
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  let cleared = 0;

  function maybePush(x: number, y: number) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) return;
    visited[pixelIndex] = 1;
    if (isNearWhite(rgba, pixelIndex)) stack.push(pixelIndex);
  }

  for (let x = 0; x < width; x++) {
    maybePush(x, 0);
    maybePush(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    maybePush(0, y);
    maybePush(width - 1, y);
  }

  while (stack.length > 0) {
    const pixelIndex = stack.pop()!;
    rgba[pixelIndex * 4 + 3] = 0;
    cleared++;

    const x = pixelIndex % width;
    const y = (pixelIndex - x) / width;
    maybePush(x - 1, y);
    maybePush(x + 1, y);
    maybePush(x, y - 1);
    maybePush(x, y + 1);
  }

  return cleared;
}

async function makeBackgroundTransparent(pngDataUri: string, tag: string): Promise<string> {
  try {
    const { mimeType, base64 } = splitDataUri(pngDataUri);
    if (mimeType !== 'image/png') {
      console.warn(`${tag} type ${mimeType} non pris en charge pour le détourage, image conservée telle quelle`);
      return pngDataUri;
    }

    const pngBytes = toByteArray(base64);
    const decoded = UPNG.decode(pngBytes.buffer);
    const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
    const totalPixels = decoded.width * decoded.height;

    const cleared = snapBorderToTransparent(rgba, decoded.width, decoded.height);

    if (cleared / totalPixels > MAX_CLEARED_FRACTION) {
      console.warn(
        `${tag} détourage suspect (${cleared}/${totalPixels} pixels effacés) — probablement un vêtement clair, image blanche conservée`
      );
      return pngDataUri;
    }

    const encoded = UPNG.encode([rgba.buffer], decoded.width, decoded.height, 0);
    const outBase64 = fromByteArray(new Uint8Array(encoded));
    console.log(
      `${tag} fond détouré: ${cleared}/${decoded.width * decoded.height} pixels rendus transparents (${decoded.width}x${decoded.height})`
    );
    return `data:image/png;base64,${outBase64}`;
  } catch (error) {
    console.warn(`${tag} échec du détourage transparent, image blanche conservée`, error);
    return pngDataUri;
  }
}

type EditClothingPhotoResponse =
  | { status: 'success'; image: { mimeType: string; base64: string }; text?: string; message: string }
  | { status: 'error'; message: string };

type GeminiImageEditOutcome = {
  image: string;
  text?: string;
  status: 'success' | 'error';
  message: string;
};

/**
 * Sends a photo to the `edit-clothing-photo` Supabase Edge Function, which
 * holds the real Gemini ("Nano Banana") API key server-side and forwards the
 * given mode/language to build the right prompt — the client never sees or
 * ships that key. Returns a diagnostic outcome instead of failing silently so
 * callers can log/report exactly what happened.
 */
async function callEditClothingPhoto(
  sourceDataUri: string,
  mode: 'sticker' | 'metadata',
  language: Language | undefined,
  tag: string
): Promise<GeminiImageEditOutcome> {
  const { mimeType, base64 } = splitDataUri(sourceDataUri);
  console.log(`${tag} image source: type=${mimeType}, ~${Math.round((base64.length * 3) / 4)} octets`);

  try {
    console.log(`${tag} envoi à edit-clothing-photo (mode=${mode})…`);

    const { data, error } = await supabase.functions.invoke<EditClothingPhotoResponse>(
      'edit-clothing-photo',
      { body: { mode, language, mimeType, base64 } }
    );

    if (error) throw error;
    if (!data) throw new Error('Réponse vide de edit-clothing-photo');
    if (data.status !== 'success') throw new Error(data.message);

    const resultBytes = Math.round((data.image.base64.length * 3) / 4);
    console.log(`${tag} image reçue: type=${data.image.mimeType}, ~${resultBytes} octets`);

    const rawImage = `data:${data.image.mimeType};base64,${data.image.base64}`;
    const image = await makeBackgroundTransparent(rawImage, tag);

    return { image, text: data.text, status: 'success', message: `OK — ~${resultBytes} octets reçus` };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.warn(`${tag} ÉCHEC: ${message}`, error);
    return { image: sourceDataUri, status: 'error', message };
  }
}

/**
 * Converts a freshly-picked photo into a "Vestro friendly" sticker: same
 * clothing item, background cut to full transparency. Falls back to the
 * original photo if the edit function fails, so adding clothes still works.
 */
export async function removeBackground(imageUri: string): Promise<string> {
  const tag = '[removeBackground]';

  const uploadUri = imageUri.startsWith('data:') ? imageUri : await resizeForUpload(imageUri, tag);
  const sourceDataUri = uploadUri.startsWith('data:') ? uploadUri : await uriToDataUri(uploadUri);
  const outcome = await callEditClothingPhoto(sourceDataUri, 'sticker', undefined, tag);
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
 * Same "sticker" cutout as removeBackground, but in one call also asks for a
 * short name, category and palette color guessed from the photo — used when
 * bulk-adding clothes so the user doesn't have to fill those in by hand. Any
 * field the model doesn't confidently return is just left undefined.
 */
export async function analyzeClothingPhoto(
  imageUri: string,
  language: Language = 'fr'
): Promise<ClothingAnalysis> {
  const tag = '[analyzeClothingPhoto]';

  const uploadUri = imageUri.startsWith('data:') ? imageUri : await resizeForUpload(imageUri, tag);
  const sourceDataUri = uploadUri.startsWith('data:') ? uploadUri : await uriToDataUri(uploadUri);
  const outcome = await callEditClothingPhoto(sourceDataUri, 'metadata', language, tag);

  if (outcome.status !== 'success') return { image: outcome.image };

  return { image: outcome.image, ...parseClothingMetadata(outcome.text, tag) };
}
