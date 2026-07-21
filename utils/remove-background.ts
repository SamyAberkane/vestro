import { toByteArray, fromByteArray } from 'base64-js';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as UPNG from 'upng-js';

import { VestroCategories, VestroPalette } from '@/constants/theme';
import { Language } from '@/i18n/translations';

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-image';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const TIMEOUT_MS = 45000;
const MAX_RETRIES_ON_RATE_LIMIT = 1;
const DEFAULT_RETRY_DELAY_MS = 15000;

// Clothing photos are never displayed above ~340px in the app; shrinking
// before upload cuts network time and the tokens Gemini has to process.
const MAX_UPLOAD_WIDTH = 1024;

// Matches styles.canvas.backgroundColor in components/outfit-canvas.tsx —
// the square where items get placed when building an outfit.
const BACKGROUND_HEX = '#FFFFFF';
const BACKGROUND_RGB = 'RGB(255,255,255)';

const REDRAW_INSTRUCTION =
  'This image shows a single clothing item or accessory, possibly photographed in a ' +
  'messy or cluttered environment. Redraw the item exactly as-is — same shape, colors, ' +
  'textures, proportions, framing and orientation — but place it centered on a background ' +
  `that is a completely flat, solid fill of pure white, hex code ${BACKGROUND_HEX}, ` +
  `${BACKGROUND_RGB}, exactly like a blank white canvas or a color swatch. Absolutely no ` +
  'gradient, no vignette, no shadow, no light falloff, no off-white or gray tint anywhere in ' +
  'the background — every single background pixel must be pure white. Do not add, remove, ' +
  'crop, or alter any part of the item itself.';

const PROMPT = REDRAW_INSTRUCTION;

const CATEGORY_OPTIONS = VestroCategories.join(', ');
const COLOR_OPTIONS = VestroPalette.map((swatch) => swatch.label).join(', ');

// The name Gemini invents should match whatever language the user has the app
// set to (constants/theme.ts categories/colors stay French internally either
// way — see i18n/context.tsx tCategory/tColor — only this free-text "name"
// field is actually generated in a specific language).
const METADATA_NAME_LANGUAGE: Record<Language, string> = {
  fr: 'French',
  en: 'English',
  es: 'Spanish',
  it: 'Italian',
};

const METADATA_NAME_EXAMPLE: Record<Language, string> = {
  fr: '"Chemise blanche", "Jean droit bleu"',
  en: '"White shirt", "Straight blue jeans"',
  es: '"Camisa blanca", "Vaqueros rectos azules"',
  it: '"Camicia bianca", "Jeans dritti blu"',
};

function buildPromptWithMetadata(language: Language): string {
  return (
    `${REDRAW_INSTRUCTION} Before the image, output exactly one line of raw JSON — no ` +
    'markdown code fences, no commentary before or after — describing the item, in this ' +
    'exact shape: {"name": string, "category": string, "color": string}. "name" is a short ' +
    `natural product name in ${METADATA_NAME_LANGUAGE[language]} (2-4 words, e.g. ` +
    `${METADATA_NAME_EXAMPLE[language]}). ` +
    `"category" must be exactly one of: ${CATEGORY_OPTIONS}. "color" must be exactly one of: ` +
    `${COLOR_OPTIONS} — pick the single closest match to the item's dominant color.`
  );
}

type ClothingMetadata = {
  name?: string;
  category?: string;
  color?: string;
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

    return {
      name: name || undefined,
      category,
      color: colorSwatch?.hex,
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

function splitDataUri(dataUri: string): { mimeType: string; base64: string } {
  const match = dataUri.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (!match) {
    throw new Error('Format de data URI non reconnu (attendu "data:<mime>;base64,...")');
  }
  return { mimeType: match[1], base64: match[2] };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(message: string): number {
  const match = message.match(/retry in ([\d.]+)s/i);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : DEFAULT_RETRY_DELAY_MS;
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

type GeminiImageEditOutcome = {
  image: string;
  text?: string;
  status: 'skipped-no-api-key' | 'success' | 'error';
  message: string;
};

/**
 * Sends a photo to Gemini 2.5 Flash Image ("Nano Banana") with the given
 * prompt and returns whatever image + text parts it responds with. Retries
 * once on HTTP 429 (the free tier has a very low requests-per-minute limit
 * for image generation) before giving up. Returns a diagnostic outcome
 * instead of failing silently so callers can log/report exactly what
 * happened.
 */
async function callGeminiImageEdit(
  sourceDataUri: string,
  prompt: string,
  tag: string
): Promise<GeminiImageEditOutcome> {
  if (!API_KEY) {
    const message = 'EXPO_PUBLIC_GEMINI_API_KEY non défini — Nano Banana non appelé';
    console.warn(`${tag} ${message}`);
    return { image: sourceDataUri, status: 'skipped-no-api-key', message };
  }

  const { mimeType, base64 } = splitDataUri(sourceDataUri);
  console.log(`${tag} image source: type=${mimeType}, ~${Math.round((base64.length * 3) / 4)} octets`);

  for (let attempt = 0; attempt <= MAX_RETRIES_ON_RATE_LIMIT; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      console.log(`${tag} envoi à Gemini (${GEMINI_MODEL}), tentative ${attempt + 1}/${MAX_RETRIES_ON_RATE_LIMIT + 1}…`);

      const response = await fetch(`${GEMINI_ENDPOINT}?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: base64 } },
              ],
            },
          ],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
        signal: controller.signal,
      });

      const json = await response.json();
      console.log(`${tag} réponse: HTTP ${response.status} ${response.statusText}`);

      if (response.status === 429 && attempt < MAX_RETRIES_ON_RATE_LIMIT) {
        const errorMessage = json?.error?.message ?? '';
        const retryDelayMs = parseRetryDelayMs(errorMessage);
        console.warn(`${tag} 429 quota atteint — nouvelle tentative dans ${retryDelayMs}ms`);
        await delay(retryDelayMs);
        continue;
      }

      if (!response.ok) {
        const detail = json?.error?.message ?? JSON.stringify(json).slice(0, 300);
        throw new Error(`HTTP ${response.status} — ${detail}`);
      }

      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((part: any) => part.inlineData || part.inline_data);
      const inline = imagePart?.inlineData ?? imagePart?.inline_data;
      const textPart = parts.find((part: any) => typeof part.text === 'string')?.text;

      if (!inline?.data) {
        throw new Error(
          `Réponse Gemini sans image${textPart ? ` — texte reçu: "${textPart.slice(0, 200)}"` : ''} : ${JSON.stringify(json).slice(0, 300)}`
        );
      }

      const resultMimeType = inline.mimeType ?? inline.mime_type ?? 'image/png';
      const resultBytes = Math.round((inline.data.length * 3) / 4);
      console.log(`${tag} image reçue: type=${resultMimeType}, ~${resultBytes} octets`);

      const rawImage = `data:${resultMimeType};base64,${inline.data}`;
      const image = await makeBackgroundTransparent(rawImage, tag);

      return {
        image,
        text: textPart,
        status: 'success',
        message: `OK — ~${resultBytes} octets reçus`,
      };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.warn(`${tag} ÉCHEC: ${message}`, error);
      return { image: sourceDataUri, status: 'error', message };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { image: sourceDataUri, status: 'error', message: 'Échec après nouvelle tentative sur limite de débit' };
}

/**
 * Converts a freshly-picked photo into a "Vestro friendly" sticker: same
 * clothing item, background cut to full transparency. Falls back to the
 * original photo if Nano Banana isn't configured or the request fails, so
 * adding clothes still works without the API.
 */
export async function removeBackground(imageUri: string): Promise<string> {
  const tag = '[removeBackground]';

  if (!API_KEY) return imageUri;

  const uploadUri = imageUri.startsWith('data:') ? imageUri : await resizeForUpload(imageUri, tag);
  const sourceDataUri = uploadUri.startsWith('data:') ? uploadUri : await uriToDataUri(uploadUri);
  const outcome = await callGeminiImageEdit(sourceDataUri, PROMPT, tag);
  return outcome.image;
}

export type ClothingAnalysis = {
  image: string;
  name?: string;
  category?: string;
  color?: string;
};

/**
 * Same "sticker" cutout as removeBackground, but in one Gemini call also asks
 * for a short name, category and palette color guessed from the photo — used
 * when bulk-adding clothes so the user doesn't have to fill those in by hand.
 * Any field the model doesn't confidently return is just left undefined.
 */
export async function analyzeClothingPhoto(
  imageUri: string,
  language: Language = 'fr'
): Promise<ClothingAnalysis> {
  const tag = '[analyzeClothingPhoto]';

  if (!API_KEY) return { image: imageUri };

  const uploadUri = imageUri.startsWith('data:') ? imageUri : await resizeForUpload(imageUri, tag);
  const sourceDataUri = uploadUri.startsWith('data:') ? uploadUri : await uriToDataUri(uploadUri);
  const outcome = await callGeminiImageEdit(sourceDataUri, buildPromptWithMetadata(language), tag);

  if (outcome.status !== 'success') return { image: outcome.image };

  return { image: outcome.image, ...parseClothingMetadata(outcome.text, tag) };
}
