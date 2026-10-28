-- Premium photo quota used to be read, checked, and only incremented after
-- Gemini answered, so parallel requests at 49/50 could all pass the check.
-- reserve_usage() takes the slot atomically (the conditional UPDATE locks the
-- row and re-checks the limit), and release_usage() hands it back when no
-- image comes out. classify_count caps classifyOnly calls the same way —
-- they had no counter at all.
alter table public.photo_usage add column if not exists classify_count integer not null default 0;

create or replace function public.reserve_usage(
  p_user_id uuid, p_period_start date, p_limit int, p_classify boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved boolean;
begin
  insert into public.photo_usage as u (user_id, period_start, count, classify_count)
  values (p_user_id, p_period_start, 0, 0)
  on conflict (user_id) do update
    set count = case when u.period_start = excluded.period_start then u.count else 0 end,
        classify_count = case when u.period_start = excluded.period_start then u.classify_count else 0 end,
        period_start = excluded.period_start;

  if p_classify then
    update public.photo_usage set classify_count = classify_count + 1
     where user_id = p_user_id and classify_count < p_limit
    returning true into reserved;
  else
    update public.photo_usage set count = count + 1
     where user_id = p_user_id and count < p_limit
    returning true into reserved;
  end if;

  return coalesce(reserved, false);
end;
$$;

create or replace function public.release_usage(p_user_id uuid, p_period_start date)
returns void
language sql
security definer
set search_path = public
as $$
  update public.photo_usage set count = greatest(count - 1, 0)
   where user_id = p_user_id and period_start = p_period_start;
$$;

revoke all on function public.reserve_usage(uuid, date, int, boolean) from public, anon, authenticated;
revoke all on function public.release_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.reserve_usage(uuid, date, int, boolean) to service_role;
grant execute on function public.release_usage(uuid, date) to service_role;

-- One App Store subscription backs at most one Crystal account at a time:
-- verify-purchase moves it to the account that last proved it, so a shared
-- transaction id can't make several accounts premium at once.
create unique index if not exists premium_entitlements_original_tx_key
  on public.premium_entitlements (original_transaction_id)
  where original_transaction_id is not null;
