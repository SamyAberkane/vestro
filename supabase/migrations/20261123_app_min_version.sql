-- Force-update gate: the app (2.3.0+) compares its version with min_version at
-- launch and shows a blocking "Update" screen when it is older.
-- Raise min_version ONLY after the new version is live on the App Store
-- (never while it is in review, or App Review gets blocked).
create table if not exists public.app_config (
  platform    text primary key,
  min_version text not null,
  updated_at  timestamptz not null default now()
);
alter table public.app_config enable row level security;
create policy "app_config: public read" on public.app_config for select to anon, authenticated using (true);
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to anon, authenticated;
insert into public.app_config (platform, min_version) values ('ios', '2.2.0')
  on conflict (platform) do nothing;
