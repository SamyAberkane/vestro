// Runs Vestro's sticker generation through Gemini server-side, so the real
// Gemini API key only ever lives in this function's environment — never in
// the app bundle, where it would be extractable by anyone who downloads the
// app. `verify_jwt` (the Supabase Functions default) already rejects any
// request without a valid signed-in user's token before this code runs; this
// function additionally checks the caller has an active, server-verified
// subscription (see public.has_active_premium() in supabase/schema.sql), or
// else consumes one of the account's 4 lifetime free credits (see
// public.consume_free_credit) — this call is the actual cost driver, so it's
// gated server-side, not just "is signed in".
//
// This does NOT try to cut out the exact photographed pixels — it asks
// Gemini to *redraw* the item as a clean, flat, catalog-style product shot
// (unwrinkled, symmetrical, forward-facing), the way clothing looks in
// reference apps like keyloush, even when the source photo shows it worn or
// crumpled. The client (utils/remove-background.ts) then strips the flat
// chroma-key backdrop this produces (see BackgroundKey below) down to real
// transparency.
import { createClient } from 'npm:@supabase/supabase-js@2';
import jpeg from 'npm:jpeg-js@0.4.4';
import UPNG from 'npm:upng-js@2.1.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_MODEL = 'gemini-3.1-flash-lite-image';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Each redraw call is a real Gemini image-generation cost (~$0.03), so even a
// paying subscriber gets a monthly cap rather than unlimited calls — see
// public.photo_usage in supabase/schema.sql. A classifyOnly retry doesn't
// count (no new image generated), but a redraw call that the model itself
// flagged "usable: false" still does — Gemini already generated (and billed)
// the image before making that call, so the cost happened either way.
const MONTHLY_PHOTO_LIMIT = 50;

const TIMEOUT_MS = 45000;
const MAX_RETRIES_ON_RATE_LIMIT = 1;
const DEFAULT_RETRY_DELAY_MS = 15000;
// A redraw call asks for both TEXT and IMAGE back — when Gemini answers with
// text only, that used to be treated as a final, non-retryable failure
// (NO_IMAGE), but there's no way from here to tell whether that means "this
// input is genuinely refused" (a safety block that will always recur) or
// "the model happened to produce a text-only turn this one time" (which a
// plain retry recovers, same idea as the 429 retry above). Retrying once
// costs nothing extra unless it was actually needed, and turns any purely
// stochastic misses into a success instead of a false rejection.
const MAX_RETRIES_ON_NO_IMAGE = 1;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Chroma-key backdrop, not white: a light or white garment (a cream sweater, a
// white sneaker) sits close enough to white in RGB terms that the client's
// color-distance cutout (utils/remove-background.ts) can't always tell garment
// from background, and testers saw exactly that — pale patches eaten out of
// the middle of a garment, worse on anything with a lot of folds (a full-body
// dress).
//
// But no single key color is safe for every garment: magenta was chosen as
// "a color no real fabric is", and then a hot-pink t-shirt came back with its
// edges and hem eaten away, because pink sits inside the cutout's tolerance
// around magenta. So the key is picked per garment instead: the redraw is
// done on magenta first, measureKeyCollision() below checks the actual
// rendered pixels for garment areas the client would mistake for that
// backdrop, and if there are any, the item is redrawn on chroma green — the
// color farthest from pink/purple/magenta. The key actually used is returned
// to the client, which cuts against exactly that color.
type BackgroundKey = { id: 'magenta' | 'green'; hex: string; label: string; rgb: [number, number, number] };

const MAGENTA_KEY: BackgroundKey = { id: 'magenta', hex: '#FF00FF', label: 'magenta', rgb: [255, 0, 255] };
const GREEN_KEY: BackgroundKey = { id: 'green', hex: '#00FF00', label: 'green', rgb: [0, 255, 0] };

// Mirrors the client's cutout (keyOutByDominance in
// utils/remove-background.ts), which scores each pixel by how much its key
// channels exceed its other channels: at or below KEY_DOMINANCE_OPAQUE it's
// kept as garment, at KEY_DOMINANCE_CLEAR and above it's backdrop, in
// between it's treated as an edge blend and made partly transparent. Such
// in-between pixels are only legitimate as the thin blend ring where
// backdrop meets garment — any further than KEY_FRINGE_WIDTH px from real
// backdrop are garment the cutout would fade out (a pink garment on magenta).
const KEY_DOMINANCE_OPAQUE = 50;
const KEY_DOMINANCE_CLEAR = 150;
const KEY_FRINGE_WIDTH = 4;
// Share of the image's pixels that may be at risk before switching key —
// ~500 px on a 1024² render, so even a small pink logo on an otherwise
// neutral garment switches rather than coming back faded. A false positive
// only costs one extra redraw; the lower-collision render always wins.
const KEY_COLLISION_MAX_SHARE = 0.0005;
// Only attempt the green redraw if the magenta one finished within this —
// one more redraw (<= TIMEOUT_MS) must still fit in the client's
// EDGE_FUNCTION_TIMEOUT_MS (utils/remove-background.ts).
const GREEN_RETRY_BUDGET_MS = 40000;

function decodeToRgba(image: { mimeType: string; base64: string }) {
  const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
  if (image.mimeType === 'image/png') {
    const decoded = UPNG.decode(bytes.buffer);
    return { rgba: new Uint8Array(UPNG.toRGBA8(decoded)[0]), width: decoded.width, height: decoded.height };
  }
  const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  return { rgba: decoded.data as Uint8Array, width: decoded.width, height: decoded.height };
}

/** Share of pixels, away from the backdrop/garment boundary, that the client
 * cutout could mistake for `key` — i.e. garment it would eat. */
function measureKeyCollision(image: { mimeType: string; base64: string }, key: BackgroundKey): number {
  const { rgba, width, height } = decodeToRgba(image);
  const size = width * height;
  const keyChannels = key.rgb.map((value) => value >= 128);
  const dominance = (i: number) => {
    let keyMin = 255;
    let otherMax = 0;
    for (let channel = 0; channel < 3; channel++) {
      if (keyChannels[channel]) keyMin = Math.min(keyMin, rgba[i * 4 + channel]);
      else otherMax = Math.max(otherMax, rgba[i * 4 + channel]);
    }
    return keyMin - otherMax;
  };

  // BFS distance (in px, capped) from the nearest real backdrop pixel.
  const distance = new Uint8Array(size).fill(255);
  const queue: number[] = [];
  for (let i = 0; i < size; i++) {
    if (dominance(i) >= KEY_DOMINANCE_CLEAR) {
      distance[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const next = distance[i] + 1;
    if (next > KEY_FRINGE_WIDTH) continue;
    const x = i % width;
    const neighbors = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width];
    for (const n of neighbors) {
      if (n < 0 || n >= size || distance[n] <= next) continue;
      distance[n] = next;
      queue.push(n);
    }
  }

  let atRisk = 0;
  for (let i = 0; i < size; i++) {
    const score = dominance(i);
    if (score > KEY_DOMINANCE_OPAQUE && score < KEY_DOMINANCE_CLEAR && distance[i] > KEY_FRINGE_WIDTH) atRisk++;
  }
  return atRisk / size;
}

function redrawInstruction(key: BackgroundKey): string {
  const BACKGROUND_HEX = key.hex;
  const BACKGROUND_RGB = `RGB(${key.rgb.join(',')})`;
  return (
  'This is not a photo-editing or cutout task — do not try to trace, segment, or reconstruct the ' +
  'exact contour visible in the source photo at all. The photo just shows a single clothing item ' +
  'or accessory, possibly worn on a person, wrinkled, folded, cropped, partially hidden behind a ' +
  'hand or phone, or seen at an odd angle — all of that is irrelevant noise to ignore, not a shape ' +
  'to reproduce. Step 1: identify what type of item it is (e.g. crew-neck sweater, zip track ' +
  'jacket, t-shirt, jeans, sneaker, handbag, cap...). Step 2: from the photo, note its ' +
  'color(s) and where each color sits (e.g. light blue body with white panels on the shoulders), ' +
  'its pattern and material texture, any clearly visible logo, print, text or stitching detail ' +
  'and roughly where it sits (e.g. small logo on the left chest) — and separately, any distinctive ' +
  'cut or silhouette the item itself deliberately has as part of its design (an asymmetric hem, a ' +
  'one-shoulder or off-shoulder neckline, a wrap-style closure, a peplum, gathered or draped fabric, ' +
  'a fishtail or trumpet shape, uneven layers): that is real design information to keep, not photo ' +
  'noise to discard. Step 3: render that item from ' +
  'scratch as a real photograph, using the plain, generic, universally-recognizable flat silhouette ' +
  'shape for that exact item type — the same simple, whole shape a clothing catalog ' +
  'photo would show for that type of item, laid flat and facing forward, symmetrical by default ' +
  'unless the item\'s own design is deliberately asymmetric (per step 2) — then keep that asymmetry, ' +
  'since it is what makes the piece recognizable, rather than flattening it into a generic symmetric ' +
  'shape. This applies just as much ' +
  'to structurally complex items — bags (straps, handles, buckles, hardware, pockets), shoes, or ' +
  'anything with several parts — as to a plain garment: simplify confidently to the generic, ' +
  'recognizable template shape for that item type rather than trying to reproduce its exact ' +
  'structure, while still keeping any deliberate asymmetry or distinctive cut from step 2. Exact ' +
  'geometric accuracy is never the goal — a shopper instantly recognizing what the ' +
  'item is matters far more than matching the source photo\'s precise proportions or part layout. ' +
  'Then render the colors, ' +
  'pattern, real fabric texture and logo from step 2 onto that clean silhouette with photographic ' +
  'realism: true material texture and sheen (knit, woven cotton, nylon, leather, etc. as ' +
  'appropriate), soft natural photographic shading and folds consistent with real fabric lying ' +
  'flat, and sharp photographic focus. Even when the source material is naturally sheer, gauzy, or ' +
  'translucent (chiffon, tulle, lace, organza) and the photo shows other layers or the background ' +
  'faintly through it, render every part of the template as fully opaque here — a believable ' +
  'sheer *look* through shading, highlights and layered folds is fine and encouraged, but no pixel ' +
  'of the template may actually let the background show or blend through it, and its outer edge ' +
  'must stay a crisp, fully-opaque line against the background, never fading, feathering, or ' +
  'softening into it. The result must look like a real, professionally-shot ' +
  'product photo of that item, exactly like a high-end e-commerce listing — never a vector ' +
  'illustration, line drawing, sketch, clip art, or cartoon. Never let anything from the photo — ' +
  'a hand, a phone, a fold, a ' +
  'shadow, the body underneath, the angle it was held at — carve a notch, gap, or hole into the ' +
  'template shape; the template\'s own outline is always a single, solid, unbroken piece, full ' +
  'stop, regardless of what was hidden or awkward in the photo. The background color must never ' +
  'appear inside that outline either — no gap between a sleeve and the body, no gap between pant ' +
  'legs, nothing — every part of the template touches or overlaps its neighboring part, including ' +
  'a garment that is itself white or very pale: render its highlights and lightest folds as a ' +
  'real, slightly-shaded off-white fabric tone, never as the flat background color itself, so the ' +
  'two stay visually distinct even at their palest. Center the item on a background that is a ' +
  `completely flat, solid fill of a bright, fully-saturated chroma-key ${key.label} — the kind used in ` +
  `film/photo compositing, not a color that occurs on real fabric — hex code ${BACKGROUND_HEX}, ` +
  `${BACKGROUND_RGB}, exactly like a solid color swatch. Absolutely no gradient, no vignette, no ` +
  'shadow, no light falloff, and no blending toward white, gray, or any of the garment\'s own ' +
  'colors anywhere in the background — every single background pixel must be that exact flat ' +
  `${key.label}, with a hard, fully-opaque cutoff where the garment begins: never a soft, fading, ` +
  'feathered, or semi-transparent transition, even along a naturally sheer or wispy edge (a ' +
  'chiffon ruffle, tulle, loose threads, fringe) — draw that edge crisp and fully opaque anyway, ' +
  'exactly on the true silhouette line. The garment\'s own fabric must meet the background ' +
  'directly: never draw any outline, contour line, stroke, white border, rim, glow, or ' +
  'sticker-style margin around the item — not white, not any other color, not even a thin one. ' +
  'This is a goal to ' +
  'aim for, not a reason to refuse the item: even on a pale, voluminous, or structurally complex ' +
  'garment where a perfectly crisp edge is hard to guarantee, still render your best ' +
  'silhouette and best attempt at a clean edge — an imperfect edge is always better than not ' +
  'attempting the item at all.'
  );
}

const VestroCategories = [
  'Hauts',
  'Bas',
  'Chaussures',
  'Accessoires',
  'Robes',
  'Montres',
  'Bijoux',
  'Sacs',
  'Couvre-chefs',
  'Lunettes',
] as const;

const VestroPaletteLabels = [
  'Blanc',
  'Noir',
  'Rouge',
  'Bleu',
  'Beige',
  'Vert',
  'Gris',
  'Marron',
  'Jaune',
];

const CATEGORY_GUIDE: Record<string, string> = {
  Hauts: 'tops worn on the upper body — t-shirts, shirts, sweaters, jackets, coats, blazers, denim jackets',
  Bas: 'bottoms only, covering just the legs — pants, jeans, skirts, shorts',
  Chaussures: 'footwear of any kind — sneakers, boots, heels, sandals, flats',
  Accessoires:
    'small accessories that are not a bag, jewelry, watch, headwear, or eyewear — belts, scarves, gloves, ties',
  Robes:
    'one-piece garments covering torso and legs together in a single item — dresses, jumpsuits, rompers, overalls',
  Montres: 'wristwatches only',
  Bijoux: 'jewelry — necklaces, earrings, bracelets, rings, brooches (not wristwatches)',
  Sacs: 'bags — handbags, backpacks, totes, clutches, purses',
  'Couvre-chefs': 'headwear — hats, caps, beanies, berets',
  Lunettes: 'eyewear of any kind — sunglasses, eyeglasses, reading glasses (not jewelry)',
};

const CATEGORY_GUIDE_TEXT = VestroCategories.map(
  (category) => `"${category}" (${CATEGORY_GUIDE[category]})`
).join('; ');

const CATEGORY_DISAMBIGUATION_NOTES =
  'Common mix-ups to avoid: a jacket or coat (even denim or leather) is "Hauts", never "Bas"; a jumpsuit, ' +
  'romper or overall is "Robes" because it covers legs and torso as one piece, not "Bas" or "Hauts"; ' +
  'sunglasses and eyeglasses are "Lunettes", never "Accessoires" or "Bijoux"; a belt is "Accessoires", ' +
  'never "Bas"; sneakers, boots and sandals are always "Chaussures", never "Accessoires".';

const PHOTO_ISSUE_CODES = [
  'multiple_items',
  'cropped',
  'too_dark_or_blurry',
  'no_item_detected',
  'other',
] as const;

type Language = 'fr' | 'en' | 'es' | 'it';

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

function classificationInstruction(language: Language): string {
  return (
    'Output exactly one line of raw JSON — no markdown code fences, no commentary before or ' +
    'after — ' +
    'describing the item, in this exact shape and ' +
    'exact field order: {"category": string, "color": string, "name": string, "usable": boolean, ' +
    '"issue": string | null}. Decide the fields in that same order — category first, then color, ' +
    'then name — and let each later field build on the ones already decided (the name should ' +
    'reflect the category and color you just picked, not contradict them). Look closely at the ' +
    'item\'s silhouette, material and how it is worn before deciding — do not guess from a quick ' +
    'glance. You must always give your single best answer for every field, even if you are not ' +
    'fully certain; never leave a field vague, hedge between two options, or leave it empty.\n\n' +
    `"category" must be exactly one of these labels (use the description in parentheses to ` +
    `pick the right one when the item could fit more than one): ${CATEGORY_GUIDE_TEXT}. ` +
    `${CATEGORY_DISAMBIGUATION_NOTES}\n\n` +
    `"color" must be exactly one of: ${VestroPaletteLabels.join(', ')} — pick the single ` +
    "closest match to the item's own dominant color, ignoring the background.\n\n" +
    `"name" is a short, natural, specific product name in ${METADATA_NAME_LANGUAGE[language]} ` +
    '(2-5 words) that a shopper would recognize. First, look closely for a visible brand marker on ' +
    'the item itself — a logo, wordmark, embroidered or printed brand name, a distinctive maker\'s ' +
    'mark (like a Nike swoosh or an Adidas trefoil), or a visible hangtag/label — anywhere on the ' +
    'photo. If you can identify the brand this way with real confidence, put it first in the name ' +
    '(e.g. "Nike Windbreaker Bleu", "Adidas Jean Droit"). If there is no visible brand marker, or ' +
    'you are not genuinely confident which brand it is, leave the brand out entirely — never guess ' +
    'a brand from style alone, never state a brand you are not sure of, and it is completely fine ' +
    'for most items to have no brand in the name. After the optional brand, add the garment type ' +
    'and the one or two most distinctive traits (cut, material, pattern), e.g. ' +
    `${METADATA_NAME_EXAMPLE[language]}. It must never be empty, never be a single generic word ` +
    'like "vêtement"/"item"/"clothing", and never just restate the category label verbatim — ' +
    'always add at least one distinctive trait beyond the category.\n\n' +
    '"usable" is true only if the photo clearly shows a single, identifiable clothing item or ' +
    'accessory that can be cleanly redrawn as instructed above; false if it cannot. Default to ' +
    'true and make your best attempt whenever the item type, its color and its shape are at all ' +
    'discernible — false is only for a real, blocking problem, never a cautious fallback when you ' +
    'are just not fully certain of every detail. In particular, none of these are reasons to mark ' +
    'it false: the background is busy; the item is worn on a person; the item is a similar or ' +
    'near-matching color to its background (e.g. a white or cream item on a white background, or ' +
    'a photo already shot on white/light like a commercial product photo) — redraw its silhouette ' +
    'and shading as best you can instead of rejecting it; the item is pale, white, or has a lot of ' +
    'volume, folds or drape (a full dress, anything structurally complex) that might make a ' +
    'perfectly crisp edge against the flat backdrop hard to guarantee — do your best ' +
    'approximate redraw and silhouette anyway, an imperfect edge is never a reason to refuse; the ' +
    'item is shown as a matching pair or set the way it is normally sold or worn (e.g. two shoes, a ' +
    'pair of gloves, a set of earrings) — that is one listing, not multiple items, so redraw one ' +
    'representative piece from it, never "multiple_items" for this; the item has a lot of visible ' +
    'structure (straps, buckles, hardware, pockets, a bag shown at an angle with several parts ' +
    'overlapping) — simplify it to a clean, generic version of that item type instead of rejecting ' +
    'it for being complex to redraw. When usable is true, "issue" must be ' +
    `null. When usable is false, "issue" must be exactly one of: ${PHOTO_ISSUE_CODES.join(', ')} — ` +
    '"multiple_items" when more than one distinct, different garment or accessory competes for ' +
    'attention (never for a matching pair/set of the same item, that\'s explained above), ' +
    '"cropped" when the item is cut off by the frame edge, "too_dark_or_blurry" when lighting or ' +
    'focus is too poor to make out the item\'s shape or color, "no_item_detected" when no ' +
    'clothing item or accessory is visible at all, and "other" for any other real problem.'
  );
}

// Used to retry just the JSON classification, without asking Gemini to redraw
// the item again — the redraw is the slow, expensive part of the call, and
// when the first pass already produced a usable image but dropped the name
// or category, redoing the whole image for a second time roughly doubles the
// user's wait for no benefit. The already-generated image is kept as-is; only
// the missing text fields are filled in from this lighter follow-up.
function buildClassifyOnlyPrompt(language: Language): string {
  return (
    'You are looking at a clothing item or accessory in a photo, the same kind of source photo ' +
    'used for the Vestro app\'s catalog — it may be worn on a person, wrinkled, folded, cropped, ' +
    'partially hidden, or seen at an odd angle; ignore all of that noise and focus only on ' +
    "identifying the item itself. " + classificationInstruction(language)
  );
}

type RequestBody = {
  language?: Language;
  mimeType: string;
  base64: string;
  // Skips the (slow) image redraw and only asks Gemini to classify the photo
  // it's already shown — see buildClassifyOnlyPrompt.
  classifyOnly?: boolean;
  // Backdrop keys this client can cut against. Builds from before
  // per-garment keys existed don't send it and only understand magenta, so
  // they must never be handed a green-backed image.
  backgroundKeys?: string[];
};

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(message: string): number {
  const match = message.match(/retry in ([\d.]+)s/i);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : DEFAULT_RETRY_DELAY_MS;
}

// `modalities` is explicit and single-purpose per call now — this function
// used to be asked for TEXT+IMAGE together in one call (image redraw plus
// its JSON classification, interleaved), which is what caused most of the
// NO_IMAGE failures reported: Gemini would satisfy the "output JSON" half of
// the prompt, treat that as a complete turn (finishReason "STOP", no safety
// block, just... stopping), and never get to the image at all. Every caller
// now asks for exactly one modality — an image-only redraw call, or a
// text-only classification call — removing the model's opportunity to
// consider a text-only response "done" when an image was actually required.
async function callGemini(
  mimeType: string,
  base64: string,
  prompt: string,
  modalities: ('TEXT' | 'IMAGE')[]
) {
  const wantsImage = modalities.includes('IMAGE');
  const wantsText = modalities.includes('TEXT');
  const maxAttempts = Math.max(MAX_RETRIES_ON_RATE_LIMIT, MAX_RETRIES_ON_NO_IMAGE);

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
          generationConfig: {
            responseModalities: modalities,
            // A consistent, non-creative classifier for the JSON fields
            // benefits from a low temperature, which cuts down on the model
            // hedging into a vague name or the wrong category from run to
            // run — the redraw itself still has enough freedom to reinterpret
            // the garment as a flat product shot.
            temperature: 0.3,
          },
        }),
        signal: controller.signal,
      });

      const json = await response.json();

      if (response.status === 429 && attempt < MAX_RETRIES_ON_RATE_LIMIT) {
        const retryDelayMs = parseRetryDelayMs(json?.error?.message ?? '');
        await delay(retryDelayMs);
        continue;
      }

      if (!response.ok) {
        const detail = json?.error?.message ?? JSON.stringify(json).slice(0, 300);
        // `code` is the Gemini HTTP status, surfaced to the end user as a
        // short reportable code (e.g. "429") instead of `detail`, which can
        // contain internal/billing detail (API quota, project billing state)
        // that shouldn't be shown to a tester — see PhotoIssue.technical_error.
        return {
          status: 'error' as const,
          message: `HTTP ${response.status} — ${detail}`,
          code: String(response.status),
        };
      }

      const candidate = json?.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const imagePart = parts.find((part: any) => part.inlineData || part.inline_data);
      const inline = imagePart?.inlineData ?? imagePart?.inline_data;
      const textPart = parts.find((part: any) => typeof part.text === 'string')?.text;

      if (wantsImage && !inline?.data) {
        // Distinguishes a genuine content/safety refusal (which will recur
        // identically on retry — no point spending one) from Gemini simply
        // producing a text-only turn this one time (which a retry usually
        // recovers, same logic as the 429 branch above). promptFeedback is
        // set when the INPUT itself got blocked before generation ever ran;
        // candidate.finishReason (e.g. "SAFETY", "RECITATION") is set when
        // generation started but was cut short — either one, when present,
        // means retrying is pointless and only wastes a call.
        const blockReason = json?.promptFeedback?.blockReason;
        const finishReason = candidate?.finishReason;
        const isRefusal = Boolean(blockReason) || (finishReason && finishReason !== 'STOP');
        const diagnostic = [blockReason && `blockReason=${blockReason}`, finishReason && `finishReason=${finishReason}`]
          .filter(Boolean)
          .join(', ');

        if (!isRefusal && attempt < MAX_RETRIES_ON_NO_IMAGE) {
          continue;
        }

        return {
          status: 'error' as const,
          message:
            `Réponse Gemini sans image${diagnostic ? ` (${diagnostic})` : ''}` +
            `${textPart ? ` — texte reçu: "${textPart.slice(0, 200)}"` : ''}`,
          code: 'NO_IMAGE',
        };
      }

      if (wantsText && !textPart) {
        return { status: 'error' as const, message: 'Réponse Gemini sans texte', code: 'NO_TEXT' };
      }

      return {
        status: 'success' as const,
        image: inline?.data
          ? { mimeType: inline.mimeType ?? inline.mime_type ?? 'image/png', base64: inline.data as string }
          : undefined,
        text: textPart as string | undefined,
        message: 'OK',
      };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const code = error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
      return { status: 'error' as const, message, code };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { status: 'error' as const, message: 'Échec après nouvelles tentatives', code: 'RETRY_EXHAUSTED' };
}

// Redraws on magenta, then — when the client can cut against green — checks
// the render for garment the magenta cutout would eat and, if any, redraws
// on green and keeps whichever render collides less (see BackgroundKey).
// The green retry is skipped when the first redraw was already slow, so the
// whole request stays inside the client's timeout; a slow magenta result
// still beats a timeout.
async function redrawWithBestKey(mimeType: string, base64: string, allowGreen: boolean) {
  const startedAt = Date.now();
  let key = MAGENTA_KEY;
  let imageResult = await callGemini(mimeType, base64, redrawInstruction(key), ['IMAGE']);
  let magentaCollision: number | null = null;
  let greenCollision: number | null = null;

  if (imageResult.status === 'success' && imageResult.image && allowGreen) {
    try {
      magentaCollision = measureKeyCollision(imageResult.image, MAGENTA_KEY);
      const elapsed = Date.now() - startedAt;
      if (magentaCollision > KEY_COLLISION_MAX_SHARE && elapsed < GREEN_RETRY_BUDGET_MS) {
        console.log(`[edit-clothing-photo] garment collides with magenta (${magentaCollision}), redrawing on green`);
        const greenResult = await callGemini(mimeType, base64, redrawInstruction(GREEN_KEY), ['IMAGE']);
        if (greenResult.status === 'success' && greenResult.image) {
          greenCollision = measureKeyCollision(greenResult.image, GREEN_KEY);
          if (greenCollision < magentaCollision) {
            key = GREEN_KEY;
            imageResult = greenResult;
          }
        }
      }
    } catch (error) {
      // An undecodable image just means no key check — never a failure.
      console.error('[edit-clothing-photo] key collision check failed', error);
    }
  }

  return { key, imageResult, magentaCollision, greenCollision, ms: Date.now() - startedAt };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ status: 'error', message: 'GEMINI_API_KEY non configuré côté serveur', code: 'CONFIG' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  let refundFreeCredit: (() => Promise<void>) | null = null;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ status: 'error', message: 'Non authentifié', code: 'AUTH' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ status: 'error', message: 'Non authentifié', code: 'AUTH' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const { data: isPremium, error: premiumError } = await callerClient.rpc('has_active_premium');
    if (premiumError) {
      return new Response(
        JSON.stringify({ status: 'error', message: 'Vérification de l\'abonnement impossible', code: 'SERVER' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const body: RequestBody = await req.json();

    if (!body.mimeType || !body.base64) {
      return new Response(JSON.stringify({ status: 'error', message: 'Requête invalide', code: 'BAD_REQUEST' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const periodStart = currentPeriodStart();

    if (!isPremium) {
      if (body.classifyOnly) {
        return new Response(
          JSON.stringify({ status: 'error', message: 'Abonnement requis', code: 'SUBSCRIPTION' }),
          { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
      // Reserved atomically before the Gemini call so parallel requests can't
      // overspend the allowance; refunded below if no image comes back.
      const { data: reserved, error: reserveError } = await adminClient.rpc('consume_free_credit', {
        p_user_id: user.id,
      });
      if (reserveError || !reserved) {
        if (reserveError) console.error('[edit-clothing-photo] consume_free_credit failed', reserveError);
        return new Response(
          JSON.stringify({ status: 'error', message: 'Crédits gratuits épuisés', code: 'FREE_LIMIT' }),
          { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
      refundFreeCredit = async () => {
        const { error } = await adminClient.rpc('refund_free_credit', { p_user_id: user.id });
        if (error) console.error('[edit-clothing-photo] refund_free_credit failed', error);
      };
    } else if (!body.classifyOnly) {
      const { data: usage } = await adminClient
        .from('photo_usage')
        .select('count, period_start')
        .eq('user_id', user.id)
        .maybeSingle();

      const usedThisMonth = usage?.period_start === periodStart ? usage.count : 0;
      // Premium is 50 monthly credits plus whatever free credits are left, so
      // once the month's 50 are spent, fall back to those.
      const { data: reservedFree } =
        usedThisMonth >= MONTHLY_PHOTO_LIMIT
          ? await adminClient.rpc('consume_free_credit', { p_user_id: user.id })
          : { data: false };
      if (reservedFree) {
        refundFreeCredit = async () => {
          const { error } = await adminClient.rpc('refund_free_credit', { p_user_id: user.id });
          if (error) console.error('[edit-clothing-photo] refund_free_credit failed', error);
        };
      } else if (usedThisMonth >= MONTHLY_PHOTO_LIMIT) {
        return new Response(
          JSON.stringify({
            status: 'error',
            code: 'quota_exceeded',
            message: `Limite de ${MONTHLY_PHOTO_LIMIT} photos par mois atteinte — réessaie le mois prochain.`,
          }),
          { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (body.classifyOnly) {
      const result = await callGemini(
        body.mimeType,
        body.base64,
        buildClassifyOnlyPrompt(body.language ?? 'fr'),
        ['TEXT']
      );
      return new Response(JSON.stringify(result), {
        status: result.status === 'success' ? 200 : 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Redraw and classification are two separate calls, deliberately never
    // combined into one TEXT+IMAGE request — see callGemini's own comment
    // for why that combination was unreliable. The redraw is the one that
    // matters for billing and for whether this counts as a usable result at
    // all; classification is best-effort on top of it, and runs in parallel
    // so a possible second redraw (below) doesn't push past the client's
    // timeout.
    const classifyPromise = callGemini(
      body.mimeType,
      body.base64,
      buildClassifyOnlyPrompt(body.language ?? 'fr'),
      ['TEXT']
    );

    const { key, imageResult } = await redrawWithBestKey(
      body.mimeType,
      body.base64,
      Boolean(body.backgroundKeys?.includes(GREEN_KEY.id))
    );

    if (imageResult.status !== 'success' || !imageResult.image) {
      await refundFreeCredit?.();
      return new Response(JSON.stringify(imageResult), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    refundFreeCredit = null;

    const { error: usageError } = await adminClient.rpc('increment_photo_usage', {
      p_user_id: user.id,
      p_period_start: periodStart,
    });
    if (usageError) console.error('[edit-clothing-photo] échec incrément photo_usage', usageError);

    // Best-effort: a failed classification here still leaves a perfectly
    // usable image — the client already retries classification-only on a
    // missing name/category (see analyzeClothingPhoto in
    // utils/remove-background.ts), so there's no need to fail the whole
    // request over this half.
    const classifyResult = await classifyPromise;

    const result = {
      status: 'success' as const,
      image: imageResult.image,
      backgroundHex: key.hex,
      text: classifyResult.status === 'success' ? classifyResult.text : undefined,
      message: 'OK',
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    await refundFreeCredit?.();
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ status: 'error', message, code: 'SERVER' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
