-- A free credit used to be spent on the Gemini redraw even when the
-- clothing_items insert policy (premium, or fewer than 4 items) was going to
-- reject the result — e.g. a lapsed subscriber with dozens of items got a
-- redraw, then "new row violates row-level security policy". Only hand out a
-- credit when the item it produces can actually be saved.
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
     and (select count(*) from public.clothing_items where user_id = p_user_id) >= 4 then
    return false;
  end if;

  insert into public.free_photo_credits (user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.free_photo_credits
     set used = used + 1
   where user_id = p_user_id
     and used < 4
  returning true into reserved;
  return coalesce(reserved, false);
end;
$$;

revoke all on function public.consume_free_credit(uuid) from public, anon, authenticated;
grant execute on function public.consume_free_credit(uuid) to service_role;
