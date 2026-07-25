// Confirms a StoreKit subscription transaction directly with Apple's App
// Store Server API — never trusts the client's own report of "I'm premium"
// (a patched client could lie about that). Only this function, using the
// service-role key, is allowed to write public.premium_entitlements; see
// supabase/schema.sql. The three SUPABASE_* vars below are auto-injected by
// the Edge Functions runtime — only the APPLE_* ones need to be set with
// `supabase secrets set`.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const APPLE_ISSUER_ID = Deno.env.get('APPLE_ISSUER_ID')!;
const APPLE_KEY_ID = Deno.env.get('APPLE_KEY_ID')!;
const APPLE_PRIVATE_KEY = Deno.env.get('APPLE_PRIVATE_KEY')!;

const APPLE_BUNDLE_ID = 'com.tailor.vestro';
const MONTHLY_SKU = 'com.tailor.vestro.monthly';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecodeToJson<T>(segment: string): T {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return JSON.parse(atob(padded + pad));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// App Store Server API auth: a short-lived ES256 JWT signed with the .p8 key
// from App Store Connect (Users and Access > Integrations). WebCrypto's
// ECDSA signature is already raw r||s, which is exactly what JWS expects —
// no DER conversion needed like with most other ES256 tooling.
async function buildAppleJWT(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: APPLE_KEY_ID, typ: 'JWT' };
  const payload = {
    iss: APPLE_ISSUER_ID,
    iat: now,
    exp: now + 60 * 20,
    aud: 'appstoreconnect-v1',
    bid: APPLE_BUNDLE_ID,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(APPLE_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64url(signature)}`;
}

type AppleTransactionInfo = {
  bundleId: string;
  productId: string;
  transactionId: string;
  originalTransactionId?: string;
  expiresDate?: number;
  revocationDate?: number;
};

// Transactions from a TestFlight/sandbox build only exist on Apple's sandbox
// host, real purchases only on production — Apple's own guidance is to just
// try production first and fall back to sandbox on a 404, rather than
// tracking which environment a given build is in.
async function fetchTransactionInfo(transactionId: string, appleJwt: string): Promise<AppleTransactionInfo> {
  const hosts = ['https://api.storekit.itunes.apple.com', 'https://api.storekit-sandbox.itunes.apple.com'];

  for (const host of hosts) {
    const response = await fetch(`${host}/inApps/v1/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${appleJwt}` },
    });

    if (response.status === 404) continue;
    if (!response.ok) {
      throw new Error(`Apple a répondu HTTP ${response.status} (${host})`);
    }

    const { signedTransactionInfo } = await response.json();
    const [, payload] = String(signedTransactionInfo).split('.');
    return base64urlDecodeToJson<AppleTransactionInfo>(payload);
  }

  throw new Error('Transaction introuvable côté Apple (ni production ni sandbox)');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ message: 'Non authentifié' }, 401);

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();
    if (userError || !user) return json({ message: 'Non authentifié' }, 401);

    const { transactionId } = await req.json();
    if (!transactionId || typeof transactionId !== 'string') {
      return json({ message: 'transactionId manquant' }, 400);
    }

    const appleJwt = await buildAppleJWT();
    const info = await fetchTransactionInfo(transactionId, appleJwt);

    if (info.bundleId !== APPLE_BUNDLE_ID || info.productId !== MONTHLY_SKU) {
      return json({ message: 'Cette transaction ne correspond pas à cette app/produit' }, 400);
    }

    const isActive = !info.revocationDate && (!info.expiresDate || info.expiresDate > Date.now());
    const expiresAt = info.expiresDate ? new Date(info.expiresDate).toISOString() : null;

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: upsertError } = await adminClient.from('premium_entitlements').upsert({
      user_id: user.id,
      is_active: isActive,
      original_transaction_id: info.originalTransactionId ?? info.transactionId,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });
    if (upsertError) throw upsertError;

    return json({ isPremium: isActive, expiresAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ message }, 500);
  }
});
