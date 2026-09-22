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

// Without this, a request that never gets a response (dropped connection
// mid-flight, an edge function that hangs) leaves callEditClothingPhoto's
// awaited invoke() pending forever — the try/catch below only ever catches a
// REJECTED promise, never one that simply never resolves. That left the
// full-screen ProcessingOverlay (see components/processing-overlay.tsx)
// stuck up with no cancel button, blocking the whole app with no way back to
// any tab. supabase-js's own `timeout` option aborts the underlying fetch
// after this many ms, turning a silent hang into a real, catchable
// FunctionsFetchError instead.
//
// The non-classifyOnly call now runs the redraw and the classification as
// two separate, sequential Gemini calls server-side (see
// edit-clothing-photo/index.ts) instead of one combined call — more
// reliable (see that file's comment on why the combined call kept dropping
// the image), but the happy path can now take close to twice as long. This
// was 45s; raised so a normal two-call round trip doesn't get cut off right
// as it was about to succeed.
const EDGE_FUNCTION_TIMEOUT_MS = 75000;

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
  // Also never returned by Gemini — set when the call to edit-clothing-photo
  // itself failed (network error, timeout, auth/premium check, Gemini down,
  // malformed response) rather than the model looking at the photo and
  // rejecting it. Kept distinct from 'other' on purpose: telling a user
  // "this photo won't work, try another" when the real problem is a network
  // blip or their subscription not being recognized sends them retrying with
  // different photos forever, none of which can ever succeed.
  'technical_error',
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

// The backdrop Gemini is asked to draw is a synthetic, fully-saturated
// chroma-key color — magenta by default, or green when the edge function
// measured that the garment itself is close to magenta (a pink or purple
// item; see BackgroundKey in the edit-clothing-photo edge function). It tells
// us which one it used via `backgroundHex`, so the garment is always far from
// the key being cut against — and unlike the old plain-white backdrop, there's
// no meaningful risk in testing every pixel in the image directly against it,
// tolerance included for Gemini's own rendering drift (it never returns a
// pixel-perfect hex match, and the fill is rarely perfectly flat).
//
// This used to instead be a flood-fill that only grew outward from the
// image's outer border, because back when the backdrop was white, a
// near-white pixel could legitimately belong to a pale garment, and the
// border/hop-distance bookkeeping was how it avoided eating into one. That
// bookkeeping has a structural blind spot a plain per-pixel test doesn't: any
// item whose own silhouette has an enclosed loop or hole — a bag's handle, a
// belt buckle, hoop earrings, glasses lenses — creates a pocket of background
// pixels that a flood fill seeded from the frame can topologically never
// reach, since it can never cross the opaque ring of the item itself. A
// single anti-aliased or noisy pixel astride an otherwise-open, narrow
// channel can silently wall off an entire legitimate background region the
// same way. A tote bag photo surfaced exactly this: the whole area inside its
// handle loop, and a strip near its base, stayed solid, glaring magenta
// because the flood fill simply never visited them — a defect that existed
// before the backdrop became magenta too, just invisible against white.
// Comparing every pixel directly against the key color has no such blind
// spot, and since the server only ever keeps a key the garment is measurably
// far from, this tolerance can be generous without mistaking garment for
// background.
const BACKGROUND_COLOR_TOLERANCE = 80;

// The flat per-pixel test above catches solid background but not the thin
// ring of anti-aliased/blended pixels Gemini renders where the magenta
// backdrop meets the garment — a 50/50 blend pixel there can be far enough
// from pure magenta (per BACKGROUND_COLOR_TOLERANCE) to stay opaque, showing
// up as a visible magenta fringe around every item. This second pass erodes
// that fringe by walking outward from every pixel the first pass already
// cleared, allowing a small per-step color drift (like the old border-seeded
// flood fill used to) so it can follow a soft gradient — but capped at
// EDGE_ERODE_HOP_LIMIT hops so it only ever nibbles a few pixels in from a
// confirmed background region. That cap is what keeps this from
// reintroducing the tunnel-into-texture bug the old algorithm had (see
// history above): a real anti-aliased fringe is 1-3px wide, while a loose
// knit's yarn-gap shadows or a sheer weave's texture extend far deeper than
// this pass is ever allowed to walk.
const EDGE_ERODE_HOP_LIMIT = 6;
const EDGE_ERODE_LOCAL_TOLERANCE = 16;
const EDGE_ERODE_MAX_DRIFT = 130;

type Rgb = { r: number; g: number; b: number };

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

// Fresh redraws use the full two-pass cut (see EDGE_ERODE_* above for why);
// recutStoredSticker passes `{ tolerance: RECUT_FLAT_TOLERANCE, erode: false }`
// instead — see its own comment.
function keyOutBackgroundCore(
  rgba: Uint8Array,
  width: number,
  height: number,
  background: Rgb,
  { tolerance = BACKGROUND_COLOR_TOLERANCE, erode = true }: { tolerance?: number; erode?: boolean } = {}
): number {
  const size = width * height;
  const settled = new Uint8Array(size);
  const hopOf = new Uint8Array(size);
  const queue: number[] = [];
  let head = 0;
  let cleared = 0;

  for (let pixelIndex = 0; pixelIndex < size; pixelIndex++) {
    const alreadyTransparent = rgba[pixelIndex * 4 + 3] === 0;
    if (alreadyTransparent || withinTolerance(rgba, pixelIndex, background, tolerance)) {
      if (!alreadyTransparent) {
        rgba[pixelIndex * 4 + 3] = 0;
        cleared++;
      }
      settled[pixelIndex] = 1;
      queue.push(pixelIndex);
    }
  }

  while (erode && head < queue.length) {
    const pixelIndex = queue[head];
    const hops = hopOf[pixelIndex];
    head++;
    if (hops >= EDGE_ERODE_HOP_LIMIT) continue;

    const ref = pixelRgb(rgba, pixelIndex);
    const x = pixelIndex % width;
    const y = (pixelIndex - x) / width;
    const neighbors: [number, number][] = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (settled[ni]) continue;

      const passesLocalStep = withinTolerance(rgba, ni, ref, EDGE_ERODE_LOCAL_TOLERANCE);
      const passesDriftFromBackground = withinTolerance(rgba, ni, background, EDGE_ERODE_MAX_DRIFT);
      if (passesLocalStep && passesDriftFromBackground) {
        rgba[ni * 4 + 3] = 0;
        cleared++;
        settled[ni] = 1;
        hopOf[ni] = hops + 1;
        queue.push(ni);
      }
    }
  }

  return cleared;
}

// The exact key colors the edge function can ask Gemini to draw (see
// BackgroundKey server-side). Cut against the known hex rather than a sample
// of the image's own border: a large or off-center item (a dress, a bag shot
// close-up) can run along a meaningful stretch of the border, skewing a
// sampled median away from the real key and leaving large swaths of
// background uncleared.
const MAGENTA_BACKGROUND: Rgb = { r: 255, g: 0, b: 255 };
const GREEN_BACKGROUND: Rgb = { r: 0, g: 255, b: 0 };
const SUPPORTED_BACKGROUND_KEYS = ['magenta', 'green'];

function parseBackgroundHex(hex: string | undefined): Rgb {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  if (!match) return MAGENTA_BACKGROUND;
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
}

// Only clears pixels that are unmistakably flat key color — no edge erosion,
// and a far tighter tolerance than a fresh cut. This pass runs unattended
// over every stored sticker, including ones cut against green because the
// garment is pink: the fresh-cut tolerance around magenta would eat straight
// into such a garment (pink sits ~80 from magenta per channel), whereas
// trapped leftover backdrop is flat key color, well within this.
const RECUT_FLAT_TOLERANCE = 40;

// A sticker cut by the old border-seeded flood fill (before keyOutBackground
// replaced it — see its own comment) can have solid, uncut magenta trapped
// wherever the item's own silhouette encloses a loop or hole: a bag handle,
// glasses lenses, a bracelet. Since the actual pixel data of the *already
// generated* redraw is unaffected by which cutout algorithm ran, no new
// Gemini call is needed to fix it — this just re-keys the same image with
// the current algorithm, comparing every still-opaque pixel against the
// known key colors rather than a border sample. Returns `cleared: 0` and the
// original image untouched when there's nothing left to clean up, so a
// caller can skip re-uploading a sticker that was already fine.
export async function recutStoredSticker(
  dataUri: string,
  tag: string
): Promise<{ image: string; cleared: number }> {
  const pngDataUri = await ensurePngDataUri(dataUri, tag);
  const { base64 } = splitDataUri(pngDataUri);
  const decoded = UPNG.decode(toByteArray(base64).buffer);
  const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);

  const cleared = [MAGENTA_BACKGROUND, GREEN_BACKGROUND].reduce(
    (total, key) =>
      total +
      keyOutBackgroundCore(rgba, decoded.width, decoded.height, key, { tolerance: RECUT_FLAT_TOLERANCE, erode: false }),
    0
  );
  if (cleared === 0) return { image: dataUri, cleared: 0 };

  const encoded = UPNG.encode([rgba.buffer], decoded.width, decoded.height, 0);
  const outBase64 = fromByteArray(new Uint8Array(encoded));
  console.log(`${tag} recadrage magenta: ${cleared} pixels supplémentaires rendus transparents`);
  const transparentDataUri = `data:image/png;base64,${outBase64}`;

  return { image: await finalizeSticker(transparentDataUri, decoded.width, tag), cleared };
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
// which also re-does the background keying for a freshly-generated image.
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

async function makeBackgroundTransparent(rawImageDataUri: string, background: Rgb, tag: string): Promise<string> {
  try {
    const pngDataUri = await ensurePngDataUri(rawImageDataUri, tag);
    const { base64 } = splitDataUri(pngDataUri);

    const pngBytes = toByteArray(base64);
    const decoded = UPNG.decode(pngBytes.buffer);
    const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);

    const cleared = keyOutBackgroundCore(rgba, decoded.width, decoded.height, background);

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
  | {
      status: 'success';
      image?: { mimeType: string; base64: string };
      /** The chroma-key color the item was drawn on — absent from older servers, which always used magenta. */
      backgroundHex?: string;
      text?: string;
      message: string;
    }
  | { status: 'error'; message: string; code?: string };

type GeminiStickerOutcome = {
  image: string;
  text?: string;
  status: 'success' | 'error';
  message: string;
  /**
   * A short, machine-readable reason for a non-success outcome — either the
   * server's own 'quota_exceeded' code, or a code from edit-clothing-photo's
   * response body (an HTTP status like "429", or a label like "NETWORK",
   * "TIMEOUT", "AUTH", "SUBSCRIPTION"...). See analyzeClothingPhoto.
   */
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
      {
        body: { language, mimeType, base64, backgroundKeys: SUPPORTED_BACKGROUND_KEYS },
        timeout: EDGE_FUNCTION_TIMEOUT_MS,
      }
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
    console.log(`${tag} fond de détourage: ${data.backgroundHex ?? '#FF00FF (par défaut)'}`);
    const image = await makeBackgroundTransparent(rawImage, parseBackgroundHex(data.backgroundHex), tag);

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
      { body: { language, mimeType, base64, classifyOnly: true }, timeout: EDGE_FUNCTION_TIMEOUT_MS }
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
  /**
   * Set only for issue === 'technical_error' — a short, reportable code
   * (an HTTP status like "429", or a label like "NETWORK"/"TIMEOUT") shown
   * to the user so they can tell us exactly what happened. Deliberately NOT
   * the raw internal error text (which can include detail that shouldn't be
   * shown to a tester, e.g. a billing/quota message) — just enough for
   * someone to say "I got error 429" and for us to know instantly what that
   * means, without exposing why.
   */
  errorCode?: string;
  /**
   * Set only for errorCode 'NO_IMAGE'/'NO_TEXT' — Gemini's own text response
   * when it was asked for an image but didn't return one (a content
   * refusal, a safety filter, or similar), truncated server-side. Unlike
   * other error codes this is safe and useful to show directly: it's never
   * billing/infra detail, and it's often the one thing that actually
   * explains why a specific photo keeps failing (e.g. Gemini declining to
   * redraw a person's photo for a safety reason).
   */
  errorDetail?: string;
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
 * gets a complete answer. A photo the model flags as outright "unusable" gets
 * the same kind of second look, but is always accepted regardless of the
 * outcome — a successful call always came with a real generated image, so
 * the only genuine rejections left are actual technical failures (see the
 * `outcome.status !== 'success'` branch below): no photo is ever turned away
 * on a content judgment call alone.
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
  // a broken result. But it must NOT reuse 'other' (a real, model-decided
  // "this photo won't work" verdict) — a call failure means Gemini never even
  // looked at the photo, so blaming the photo would send the user retrying
  // with different photos forever. Quota keeps its own code so the alert
  // explains that specifically; every other failure gets 'technical_error'.
  if (outcome.status !== 'success') {
    const isQuota = outcome.code === 'quota_exceeded';
    const showsDetail = outcome.code === 'NO_IMAGE' || outcome.code === 'NO_TEXT';
    return {
      image: outcome.image,
      usable: false,
      issue: isQuota ? 'quota_exceeded' : 'technical_error',
      errorCode: isQuota ? undefined : outcome.code ?? 'UNKNOWN',
      errorDetail: showsDetail ? outcome.message : undefined,
    };
  }

  const metadata = parseClothingMetadata(outcome.text, tag);

  // A successful redraw call always produced a real image — callGemini
  // itself returns NO_IMAGE (routed through the outcome.status !== 'success'
  // branch above, a genuine rejection) whenever Gemini didn't draw anything
  // at all. So a "usable: false" here never means "there is nothing to show
  // the user" — it's purely the model's own separate self-assessment,
  // written in the same pass where it was busy redrawing the item at a
  // non-zero temperature (see callGemini's generationConfig server-side),
  // and demonstrably inconsistent from one read of the same photo to the
  // next. Vestro's product decision is to never turn away a garment the
  // model was actually willing to draw: a free classifyOnly second opinion
  // (no new image, doesn't count against the monthly quota) gets one more
  // chance to fill in a clean name/category, but whether or not it flips the
  // verdict, the already-generated image is always accepted — the only
  // rejections left are the ones above, where there is truly no image to
  // fall back on (a real technical failure) or the model refused to draw
  // anything in the first place.
  if (metadata.usable === false) {
    console.warn(`${tag} photo jugée inexploitable par le modèle, second avis avant acceptation…`);
    const retryOutcome = await classifyOnly(sourceDataUri, language, tag);
    const retryMetadata = retryOutcome.status === 'success' ? parseClothingMetadata(retryOutcome.text, tag) : undefined;
    return {
      image: outcome.image,
      name: metadata.name ?? retryMetadata?.name,
      category: metadata.category ?? retryMetadata?.category,
      color: metadata.color ?? retryMetadata?.color,
    };
  }

  if (!metadata.name || !metadata.category) {
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
