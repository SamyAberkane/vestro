// Runs Vestro's "Nano Banana" (Gemini image edit) call server-side, so the
// real Gemini API key only ever lives in this function's environment — never
// in the app bundle, where it would be extractable by anyone who downloads
// the app. `verify_jwt` (the Supabase Functions default) already rejects any
// request without a valid signed-in user's token before this code runs; this
// function additionally checks the caller has an active, server-verified
// subscription (see public.has_active_premium() in supabase/schema.sql) —
// Vestro has no free tier, and this call is the actual cost driver, so it's
// gated the same way the database rows are, not just "is signed in".
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_MODEL = 'gemini-3.1-flash-lite-image';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const TIMEOUT_MS = 45000;
const MAX_RETRIES_ON_RATE_LIMIT = 1;
const DEFAULT_RETRY_DELAY_MS = 15000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

function buildPromptWithMetadata(language: Language): string {
  return (
    `${REDRAW_INSTRUCTION} Before the image, output exactly one line of raw JSON — no ` +
    'markdown code fences, no commentary before or after — describing the item, in this ' +
    'exact shape and exact field order: {"category": string, "color": string, "name": string, ' +
    '"usable": boolean, "issue": string | null}. Decide the fields in that same order — category ' +
    'first, then color, then name — and let each later field build on the ones already decided ' +
    '(the name should reflect the category and color you just picked, not contradict them). Look ' +
    'closely at the item\'s silhouette, material and how it is worn before deciding — do not guess ' +
    'from a quick glance. You must always give your single best answer for every field, even if ' +
    'you are not fully certain; never leave a field vague, hedge between two options, or leave it ' +
    'empty.\n\n' +
    `"category" must be exactly one of these labels (use the description in parentheses to ` +
    `pick the right one when the item could fit more than one): ${CATEGORY_GUIDE_TEXT}. ` +
    `${CATEGORY_DISAMBIGUATION_NOTES}\n\n` +
    `"color" must be exactly one of: ${VestroPaletteLabels.join(', ')} — pick the single ` +
    "closest match to the item's own dominant color, ignoring the background.\n\n" +
    `"name" is a short, natural, specific product name in ${METADATA_NAME_LANGUAGE[language]} ` +
    '(2-4 words) that a shopper would recognize — lead with the garment type and add the one ' +
    'or two most distinctive traits (cut, material, pattern), e.g. ' +
    `${METADATA_NAME_EXAMPLE[language]}. It must never be empty, never be a single generic word ` +
    'like "vêtement"/"item"/"clothing", and never just restate the category label verbatim — ' +
    'always add at least one distinctive trait beyond the category, and do not invent a brand ' +
    'name.\n\n' +
    '"usable" is true only if the photo clearly shows a single clothing item or accessory that ' +
    'can be cleanly isolated as instructed above; false if it cannot. Do not mark it false just ' +
    'because the background is busy or the item is worn on a person — you can still isolate it ' +
    'in those cases; only reject a real problem. When usable is true, "issue" must be null. ' +
    `When usable is false, "issue" must be exactly one of: ${PHOTO_ISSUE_CODES.join(', ')} — ` +
    '"multiple_items" when more than one distinct garment or accessory competes for attention, ' +
    '"cropped" when the item is cut off by the frame edge, "too_dark_or_blurry" when lighting or ' +
    'focus is too poor to make out the item\'s shape or color, "no_item_detected" when no ' +
    'clothing item or accessory is visible at all, and "other" for any other real problem.'
  );
}

type RequestBody = {
  mode: 'sticker' | 'metadata';
  language?: Language;
  mimeType: string;
  base64: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(message: string): number {
  const match = message.match(/retry in ([\d.]+)s/i);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : DEFAULT_RETRY_DELAY_MS;
}

async function callGemini(mimeType: string, base64: string, prompt: string, temperature?: number) {
  for (let attempt = 0; attempt <= MAX_RETRIES_ON_RATE_LIMIT; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            ...(temperature !== undefined ? { temperature } : {}),
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
        return { status: 'error' as const, message: `HTTP ${response.status} — ${detail}` };
      }

      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((part: any) => part.inlineData || part.inline_data);
      const inline = imagePart?.inlineData ?? imagePart?.inline_data;
      const textPart = parts.find((part: any) => typeof part.text === 'string')?.text;

      if (!inline?.data) {
        return {
          status: 'error' as const,
          message: `Réponse Gemini sans image${textPart ? ` — texte reçu: "${textPart.slice(0, 200)}"` : ''}`,
        };
      }

      return {
        status: 'success' as const,
        image: { mimeType: inline.mimeType ?? inline.mime_type ?? 'image/png', base64: inline.data as string },
        text: textPart as string | undefined,
        message: 'OK',
      };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return { status: 'error' as const, message };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { status: 'error' as const, message: 'Échec après nouvelle tentative sur limite de débit' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ status: 'error', message: 'GEMINI_API_KEY non configuré côté serveur' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ status: 'error', message: 'Non authentifié' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: isPremium, error: premiumError } = await callerClient.rpc('has_active_premium');
    if (premiumError || !isPremium) {
      return new Response(JSON.stringify({ status: 'error', message: 'Abonnement requis' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const body: RequestBody = await req.json();

    if (!body.mimeType || !body.base64 || (body.mode !== 'sticker' && body.mode !== 'metadata')) {
      return new Response(JSON.stringify({ status: 'error', message: 'Requête invalide' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const prompt =
      body.mode === 'metadata' ? buildPromptWithMetadata(body.language ?? 'fr') : REDRAW_INSTRUCTION;

    // Metadata mode needs a consistent, non-creative classifier, not a
    // freewheeling generator — a low temperature cuts down on the model
    // hedging into a vague name or the wrong category from run to run.
    const temperature = body.mode === 'metadata' ? 0.2 : undefined;
    const result = await callGemini(body.mimeType, body.base64, prompt, temperature);

    return new Response(JSON.stringify(result), {
      status: result.status === 'success' ? 200 : 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ status: 'error', message }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
