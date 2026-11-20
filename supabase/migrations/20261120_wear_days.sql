-- Daily streak: one row per day the user wore an outfit ("Porter aujourd'hui").
-- The day is the user's local calendar date, sent by the app. Insert-only:
-- only today (±1 day for time zones) can be recorded, so a streak can't be backfilled.
create table if not exists public.wear_days (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day        date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.wear_days enable row level security;

create policy "wear_days: read own"
  on public.wear_days for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "wear_days: record today"
  on public.wear_days for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and day between (current_date - 1) and (current_date + 1)
  );

revoke all on public.wear_days from anon;
revoke update, delete, truncate, references, trigger on public.wear_days from authenticated;
grant select, insert on public.wear_days to authenticated;
