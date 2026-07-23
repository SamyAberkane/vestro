-- Vestro schema: clothing items, outfits, active look, storage for images
-- Paste into Supabase SQL Editor and run once.

create table if not exists public.clothing_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '',
  category text not null,
  color text,
  image_path text,
  price numeric(10,2),
  status text not null default 'owned' check (status in ('owned', 'wishlist')),
  available boolean not null default true,
  unavailable_reason text,
  created_at timestamptz not null default now()
);

create index if not exists clothing_items_user_id_idx on public.clothing_items (user_id);

create table if not exists public.outfits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  item_ids bigint[] not null default '{}',
  layout jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists outfits_user_id_idx on public.outfits (user_id);

create table if not exists public.active_looks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  item_ids bigint[] not null default '{}',
  layout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row Level Security: every user only ever sees their own rows
alter table public.clothing_items enable row level security;
alter table public.outfits enable row level security;
alter table public.active_looks enable row level security;

create policy "clothing_items_select_own" on public.clothing_items for select using (auth.uid() = user_id);
create policy "clothing_items_insert_own" on public.clothing_items for insert with check (auth.uid() = user_id);
create policy "clothing_items_update_own" on public.clothing_items for update using (auth.uid() = user_id);
create policy "clothing_items_delete_own" on public.clothing_items for delete using (auth.uid() = user_id);

create policy "outfits_select_own" on public.outfits for select using (auth.uid() = user_id);
create policy "outfits_insert_own" on public.outfits for insert with check (auth.uid() = user_id);
create policy "outfits_update_own" on public.outfits for update using (auth.uid() = user_id);
create policy "outfits_delete_own" on public.outfits for delete using (auth.uid() = user_id);

create policy "active_looks_select_own" on public.active_looks for select using (auth.uid() = user_id);
create policy "active_looks_insert_own" on public.active_looks for insert with check (auth.uid() = user_id);
create policy "active_looks_update_own" on public.active_looks for update using (auth.uid() = user_id);
create policy "active_looks_delete_own" on public.active_looks for delete using (auth.uid() = user_id);

-- Storage bucket for clothing photos (private, one folder per user: "<user_id>/<filename>")
insert into storage.buckets (id, name, public)
values ('clothing-images', 'clothing-images', false)
on conflict (id) do nothing;

create policy "clothing_images_select_own" on storage.objects for select
  using (bucket_id = 'clothing-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "clothing_images_insert_own" on storage.objects for insert
  with check (bucket_id = 'clothing-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "clothing_images_update_own" on storage.objects for update
  using (bucket_id = 'clothing-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "clothing_images_delete_own" on storage.objects for delete
  using (bucket_id = 'clothing-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- Self-service account deletion (Apple guideline 5.1.1(v)): lets a signed-in
-- user delete their own account from the app, with no admin/service-role key
-- involved. Safe because `auth.uid()` is derived server-side from the
-- caller's verified JWT and can't be spoofed to target another user.
-- `clothing_items` / `outfits` / `active_looks` cascade-delete automatically
-- via their `on delete cascade` FK to auth.users above; only the storage
-- bucket needs explicit cleanup first since it isn't FK-linked.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from storage.objects
    where bucket_id = 'clothing-images'
      and (storage.foldername(name))[1] = auth.uid()::text;

  delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function public.delete_own_account() to authenticated;
