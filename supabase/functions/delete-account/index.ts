// Self-service account deletion (Apple guideline 5.1.1(v)). Runs with the
// service-role key so it can go through the Storage API (Supabase now blocks
// deleting storage.objects rows directly via SQL, to avoid orphaning the
// underlying files) and the Auth Admin API to remove the user outright.
// clothing_items / outfits / active_looks / premium_entitlements all cascade
// automatically via their `on delete cascade` FK to auth.users.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: files, error: listError } = await adminClient.storage
      .from('clothing-images')
      .list(user.id, { limit: 1000 });
    if (listError) throw listError;

    if (files && files.length > 0) {
      const paths = files.map((file) => `${user.id}/${file.name}`);
      const { error: removeError } = await adminClient.storage.from('clothing-images').remove(paths);
      if (removeError) throw removeError;
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;

    return json({ success: true });
  } catch (error) {
    console.error('[delete-account]', error);
    const message = error instanceof Error ? error.message : String(error);
    return json({ message }, 500);
  }
});
