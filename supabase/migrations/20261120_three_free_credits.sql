-- Free accounts get 3 lifetime AI credits instead of 4, and can keep up to 3
-- items. Apply together with the app release that advertises 3: app versions
-- up to 2.1.0 say "4 free AI credits" and show "x / 4".
--
-- Accounts that already used 4 keep what they have; nothing is deleted.

create or replace function public.free_credits_remaining()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, 3 - coalesce((select used from public.free_photo_credits where user_id = auth.uid()), 0));
$$;

create or replace function public.consume_free_credit(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved boolean;
begin
  if not exists (
       select 1 from public.premium_entitlements
        where user_id = p_user_id and is_active and (expires_at is null or expires_at > now())
     )
     and (select count(*) from public.clothing_items where user_id = p_user_id) >= 3 then
    return false;
  end if;

  insert into public.free_photo_credits (user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.free_photo_credits
     set used = used + 1
   where user_id = p_user_id
     and used < 3
  returning true into reserved;
  return coalesce(reserved, false);
end;
$$;

revoke all on function public.consume_free_credit(uuid) from public, anon, authenticated;
grant execute on function public.consume_free_credit(uuid) to service_role;

drop policy if exists "clothing_items_insert_own" on public.clothing_items;
create policy "clothing_items_insert_own" on public.clothing_items
  for insert
  with check (
    auth.uid() = user_id
    and (
      public.has_active_premium()
      or (select count(*) from public.clothing_items c where c.user_id = auth.uid()) < 3
    )
  );
