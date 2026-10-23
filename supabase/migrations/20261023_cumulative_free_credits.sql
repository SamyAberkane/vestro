-- Free credits now stack with Premium: the app advertises "50 + free left",
-- so a subscriber keeps the free credits they haven't used and spends them
-- once the month's 50 are gone. Only the counter decides what's spent — the
-- old "rows held" rule wiped a subscriber's free credits as soon as their
-- closet reached 4 items.

create or replace function public.free_credits_remaining()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, 4 - coalesce((select used from public.free_photo_credits where user_id = auth.uid()), 0));
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
  insert into public.free_photo_credits (user_id) values (p_user_id) on conflict (user_id) do nothing;
  -- Row lock + re-checked WHERE: concurrent requests can't both take the last credit.
  update public.free_photo_credits
     set used = used + 1
   where user_id = p_user_id
     and used < 4
  returning true into reserved;
  return coalesce(reserved, false);
end;
$$;

revoke all on function public.free_credits_remaining() from public, anon;
grant execute on function public.free_credits_remaining() to authenticated;

revoke all on function public.consume_free_credit(uuid) from public, anon, authenticated;
