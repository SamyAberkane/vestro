import { supabase } from '@/lib/supabase';

/**
 * Deletes the signed-in user's account and all their data (clothing items,
 * outfits, active look, stored photos) via the `delete-account` edge function
 * (see supabase/functions/delete-account) — direct SQL deletion of storage
 * objects and auth.users isn't available from the client, so this needs the
 * service-role key server-side. Signs the user out locally afterward since
 * their session is no longer valid.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) throw new Error(error.message);

  await supabase.auth.signOut();
}
