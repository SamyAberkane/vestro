-- In-app analytics for the Crystal Pulse dashboard.
-- The app only ever inserts; nobody reads through the API (no select policy).
-- Events before sign-in carry only the random install_id; after sign-in they
-- also carry user_id, which must be the caller's own.

create table if not exists public.analytics_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  install_id  uuid not null,
  user_id     uuid references auth.users (id) on delete cascade,
  event       text not null check (event ~ '^[a-z][a-z0-9_]{1,39}$'),
  props       jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 2048),
  app_version text check (char_length(app_version) <= 20),
  os_version  text check (char_length(os_version) <= 20)
);

create index if not exists analytics_events_event_time on public.analytics_events (event, created_at);
create index if not exists analytics_events_user on public.analytics_events (user_id, created_at);
create index if not exists analytics_events_install on public.analytics_events (install_id, created_at);

alter table public.analytics_events enable row level security;

revoke all on public.analytics_events from anon, authenticated;
grant insert (install_id, user_id, event, props, app_version, os_version) on public.analytics_events to anon, authenticated;

drop policy if exists "insert own analytics" on public.analytics_events;
create policy "insert own analytics" on public.analytics_events
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
