-- Free tier: 4 lifetime AI redraws per account, enforced server-side.
-- edit-clothing-photo reserves a credit (consume_free_credit) before calling
-- Gemini and refunds it (refund_free_credit) if no image comes back. A credit
-- is "spent" if either the counter or the rows the account holds say so, so a
-- lapsed subscriber with a full closet doesn't get extra free redraws, and
-- deleting clothes never gives credits back.

create table if not exists public.free_photo_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  used int not null default 0 check (used >= 0),
  created_at timestamptz not null default now()
);

alter table public.free_photo_credits enable row level security;

drop policy if exists "free_photo_credits_select_own" on public.free_photo_credits;
create policy "free_photo_credits_select_own" on public.free_photo_credits
  for select using (auth.uid() = user_id);

create or replace function public.free_credits_remaining()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, 4 - greatest(
    coalesce((select used from public.free_photo_credits where user_id = auth.uid()), 0),
    (select count(*)::int from public.clothing_items where user_id = auth.uid())
  ));
$$;

create or replace function public.consume_free_credit(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  rows_held int;
  reserved boolean;
begin
  select count(*) into rows_held from public.clothing_items where user_id = p_user_id;
  insert into public.free_photo_credits (user_id) values (p_user_id) on conflict (user_id) do nothing;
  -- Row lock + re-checked WHERE: concurrent requests can't both take the last credit.
  update public.free_photo_credits
     set used = used + 1
   where user_id = p_user_id
     and greatest(used, rows_held) < 4
  returning true into reserved;
  return coalesce(reserved, false);
end;
$$;

create or replace function public.refund_free_credit(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.free_photo_credits set used = greatest(used - 1, 0) where user_id = p_user_id;
$$;

-- Uploads a free account may make: one per credit spent since its first free credit.
create or replace function public.free_upload_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select exists (
    select 1
      from public.free_photo_credits c
     where c.user_id = auth.uid()
       and (
         select count(*)
           from storage.objects o
          where o.bucket_id = 'clothing-images'
            and (storage.foldername(o.name))[1] = auth.uid()::text
            and o.created_at >= c.created_at
       ) < c.used
  );
$$;

revoke all on function public.free_credits_remaining() from public, anon;
grant execute on function public.free_credits_remaining() to authenticated;

revoke all on function public.consume_free_credit(uuid) from public, anon, authenticated;
revoke all on function public.refund_free_credit(uuid) from public, anon, authenticated;
grant execute on function public.consume_free_credit(uuid) to service_role;
grant execute on function public.refund_free_credit(uuid) to service_role;

revoke all on function public.free_upload_allowed() from public, anon;
grant execute on function public.free_upload_allowed() to authenticated;

-- Was callable by any client for any user id (could burn someone else's monthly quota).
revoke all on function public.increment_photo_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.increment_photo_usage(uuid, date) to service_role;

drop policy if exists "clothing_images_insert_own" on storage.objects;
create policy "clothing_images_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'clothing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.has_active_premium() or public.free_upload_allowed())
  );
