import { supabase } from '@/lib/supabase';

/**
 * Deletes the signed-in user's account and all their data (clothing items,
 * outfits, active look, stored photos) via the `delete_own_account` Postgres
 * function (see supabase/schema.sql) — no service-role key needed, since the
 * function runs server-side scoped to the caller's own auth.uid(). Signs the
 * user out locally afterward since their session is no longer valid.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_own_account');
  if (error) throw error;

  await supabase.auth.signOut();
}
