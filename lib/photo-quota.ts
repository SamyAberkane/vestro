import { supabase } from '@/lib/supabase';

export const MONTHLY_PHOTO_LIMIT = 50;

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Server-verified only: reads the same photo_usage row the edit-clothing-photo
 * edge function writes after each billed Gemini call — see supabase/schema.sql
 * for why the app has no write access to that table. Used only for a UX
 * pre-check (skip opening the picker when already at 0); the edge function's
 * own check is what actually enforces the cap. */
export async function getRemainingPhotoQuota(): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return MONTHLY_PHOTO_LIMIT;

  const { data, error } = await supabase
    .from('photo_usage')
    .select('count, period_start')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.warn('[photo-quota] lecture photo_usage a échoué', error);
    return MONTHLY_PHOTO_LIMIT;
  }

  const usedThisMonth = data?.period_start === currentPeriodStart() ? data.count : 0;
  return Math.max(0, MONTHLY_PHOTO_LIMIT - usedThisMonth);
}
