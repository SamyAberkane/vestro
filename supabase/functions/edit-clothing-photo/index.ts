// Runs Vestro's sticker generation through Gemini server-side, so the real
// Gemini API key only ever lives in this function's environment — never in
// the app bundle, where it would be extractable by anyone who downloads the
// app. `verify_jwt` (the Supabase Functions default) already rejects any
// request without a valid signed-in user's token before this code runs; this
// function additionally checks the caller has an active, server-verified
// subscription (see public.has_active_premium() in supabase/schema.sql) —
// Vestro has no free tier, and this call is the actual cost driver, so it's
// gated the same way the database rows are, not just "is signed in".
//
// This does NOT try to cut out the exact photographed pixels — it asks
// Gemini to *redraw* the item as a clean, flat, catalog-style product shot
// (unwrinkled, symmetrical, forward-facing), the way clothing looks in
// reference apps like keyloush, even when the source photo shows it worn or
// crumpled. The client (utils/remove-background.ts) then strips the flat
// white background this produces down to real transparency.
import { createClient } from 'npm:@supabase/supabase-js@2';

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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BACKGROUND_HEX = '#FFFFFF';
const BACKGROUND_RGB = 'RGB(255,255,255)';

const REDRAW_INSTRUCTION =
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
  'flat, and sharp photographic focus. The result must look like a real, professionally-shot ' +
  'product photo of that item, exactly like a high-end e-commerce listing — never a vector ' +
  'illustration, line drawing, sketch, clip art, or cartoon. Never let anything from the photo — ' +
  'a hand, a phone, a fold, a ' +
  'shadow, the body underneath, the angle it was held at — carve a notch, gap, or hole into the ' +
  'template shape; the template\'s own outline is always a single, solid, unbroken piece, full ' +
  'stop, regardless of what was hidden or awkward in the photo. The white background must never ' +
  'appear inside that outline either — no gap between a sleeve and the body, no gap between pant ' +
  'legs, nothing — every part of the template touches or overlaps its neighboring part. Center ' +
  'the item on a background that is a completely flat, ' +
  `solid fill of pure white, hex code ${BACKGROUND_HEX}, ${BACKGROUND_RGB}, exactly like a blank ` +
  'white canvas or a color swatch. Absolutely no gradient, no vignette, no shadow, no light ' +
  'falloff, no off-white or gray tint anywhere in the background — every single background pixel ' +
  'must be pure white.';

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

function classificationInstruction(language: Language, precedesImage: boolean): string {
  return (
    (precedesImage
      ? 'Before the image, output exactly one line of raw JSON — no markdown code fences, no ' +
        'commentary before or after — '
      : 'Output exactly one line of raw JSON — no markdown code fences, no commentary before or ' +
        'after — ') +
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
    'near-matching color to its background (e.g. a white or cream item on a white background) — ' +
    'redraw its silhouette and shading as best you can instead of rejecting it; the item is shown ' +
    'as a matching pair or set the way it is normally sold or worn (e.g. two shoes, a pair of ' +
    'gloves, a set of earrings) — that is one listing, not multiple items, so redraw one ' +
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

function buildPrompt(language: Language): string {
  return `${REDRAW_INSTRUCTION} ${classificationInstruction(language, true)}`;
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
    "identifying the item itself. " + classificationInstruction(language, false)
  );
}

type RequestBody = {
  language?: Language;
  mimeType: string;
  base64: string;
  // Skips the (slow) image redraw and only asks Gemini to classify the photo
  // it's already shown — see buildClassifyOnlyPrompt.
  classifyOnly?: boolean;
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

async function callGemini(mimeType: string, base64: string, prompt: string, includeImage: boolean) {
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
            responseModalities: includeImage ? ['TEXT', 'IMAGE'] : ['TEXT'],
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
        return { status: 'error' as const, message: `HTTP ${response.status} — ${detail}` };
      }

      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((part: any) => part.inlineData || part.inline_data);
      const inline = imagePart?.inlineData ?? imagePart?.inline_data;
      const textPart = parts.find((part: any) => typeof part.text === 'string')?.text;

      if (includeImage && !inline?.data) {
        return {
          status: 'error' as const,
          message: `Réponse Gemini sans image${textPart ? ` — texte reçu: "${textPart.slice(0, 200)}"` : ''}`,
        };
      }

      if (!includeImage && !textPart) {
        return { status: 'error' as const, message: 'Réponse Gemini sans texte' };
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
    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ status: 'error', message: 'Non authentifié' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const { data: isPremium, error: premiumError } = await callerClient.rpc('has_active_premium');
    if (premiumError || !isPremium) {
      return new Response(JSON.stringify({ status: 'error', message: 'Abonnement requis' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const body: RequestBody = await req.json();

    if (!body.mimeType || !body.base64) {
      return new Response(JSON.stringify({ status: 'error', message: 'Requête invalide' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const periodStart = currentPeriodStart();

    if (!body.classifyOnly) {
      const { data: usage } = await adminClient
        .from('photo_usage')
        .select('count, period_start')
        .eq('user_id', user.id)
        .maybeSingle();

      const usedThisMonth = usage?.period_start === periodStart ? usage.count : 0;
      if (usedThisMonth >= MONTHLY_PHOTO_LIMIT) {
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

    const prompt = body.classifyOnly
      ? buildClassifyOnlyPrompt(body.language ?? 'fr')
      : buildPrompt(body.language ?? 'fr');
    const result = await callGemini(body.mimeType, body.base64, prompt, !body.classifyOnly);

    // Only a redraw call (not classifyOnly) that actually produced an image is
    // billed by Gemini — that's the event to count, regardless of whether the
    // model later flagged the item "usable: false" in its own classification.
    if (!body.classifyOnly && result.status === 'success' && result.image) {
      const { error: usageError } = await adminClient.rpc('increment_photo_usage', {
        p_user_id: user.id,
        p_period_start: periodStart,
      });
      if (usageError) console.error('[edit-clothing-photo] échec incrément photo_usage', usageError);
    }

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
