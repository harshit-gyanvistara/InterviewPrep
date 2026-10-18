-- User collections (plans/server-history.md, implementationPlan M2.2): everything a signed-in user
-- keeps besides their profile. One table per collection, all the same shape: the item exactly as the
-- app stores it (`data`), keyed by user and the client's id. Real columns can be added later with a
-- backfill from `data` without changing the API. org_id on sessions and reports gets its foreign key
-- when organizations lands (M2.10).
-- The app reads and writes these with the user's own session (publishable key) through
-- /api/db/[collection], so the RLS policies below keep one user out of another's rows.

create table public.sessions (
  user_id    uuid not null references public.users (id) on delete cascade,
  id         text not null,
  org_id     uuid,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create trigger sessions_set_updated_at before update on public.sessions
  for each row execute function public.set_updated_at();

alter table public.sessions enable row level security;

create policy "sessions: read own" on public.sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "sessions: insert own" on public.sessions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "sessions: update own" on public.sessions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "sessions: delete own" on public.sessions
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.sessions from anon, authenticated;
grant select, insert, update, delete on public.sessions to authenticated;

create table public.reports (
  user_id    uuid not null references public.users (id) on delete cascade,
  id         text not null,
  org_id     uuid,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create trigger reports_set_updated_at before update on public.reports
  for each row execute function public.set_updated_at();

alter table public.reports enable row level security;

create policy "reports: read own" on public.reports
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "reports: insert own" on public.reports
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "reports: update own" on public.reports
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "reports: delete own" on public.reports
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.reports from anon, authenticated;
grant select, insert, update, delete on public.reports to authenticated;

create table public.roadmaps (
  user_id    uuid not null references public.users (id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create trigger roadmaps_set_updated_at before update on public.roadmaps
  for each row execute function public.set_updated_at();

alter table public.roadmaps enable row level security;

create policy "roadmaps: read own" on public.roadmaps
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "roadmaps: insert own" on public.roadmaps
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "roadmaps: update own" on public.roadmaps
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "roadmaps: delete own" on public.roadmaps
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.roadmaps from anon, authenticated;
grant select, insert, update, delete on public.roadmaps to authenticated;

create table public.stories (
  user_id    uuid not null references public.users (id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create trigger stories_set_updated_at before update on public.stories
  for each row execute function public.set_updated_at();

alter table public.stories enable row level security;

create policy "stories: read own" on public.stories
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "stories: insert own" on public.stories
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "stories: update own" on public.stories
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "stories: delete own" on public.stories
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.stories from anon, authenticated;
grant select, insert, update, delete on public.stories to authenticated;

create table public.settings (
  user_id    uuid not null references public.users (id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create trigger settings_set_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

alter table public.settings enable row level security;

create policy "settings: read own" on public.settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "settings: insert own" on public.settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "settings: update own" on public.settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "settings: delete own" on public.settings
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.settings from anon, authenticated;
grant select, insert, update, delete on public.settings to authenticated;

create table public.custom_packs (
  user_id    uuid not null references public.users (id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create trigger custom_packs_set_updated_at before update on public.custom_packs
  for each row execute function public.set_updated_at();

alter table public.custom_packs enable row level security;

create policy "custom_packs: read own" on public.custom_packs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "custom_packs: insert own" on public.custom_packs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "custom_packs: update own" on public.custom_packs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "custom_packs: delete own" on public.custom_packs
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.custom_packs from anon, authenticated;
grant select, insert, update, delete on public.custom_packs to authenticated;

create table public.notes (
  user_id    uuid not null references public.users (id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create trigger notes_set_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

alter table public.notes enable row level security;

create policy "notes: read own" on public.notes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "notes: insert own" on public.notes
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "notes: update own" on public.notes
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "notes: delete own" on public.notes
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.notes from anon, authenticated;
grant select, insert, update, delete on public.notes to authenticated;

create table public.binders (
  user_id    uuid not null references public.users (id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create trigger binders_set_updated_at before update on public.binders
  for each row execute function public.set_updated_at();

alter table public.binders enable row level security;

create policy "binders: read own" on public.binders
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "binders: insert own" on public.binders
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "binders: update own" on public.binders
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "binders: delete own" on public.binders
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.binders from anon, authenticated;
grant select, insert, update, delete on public.binders to authenticated;

create table public.cortex_pages (
  user_id    uuid not null references public.users (id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create trigger cortex_pages_set_updated_at before update on public.cortex_pages
  for each row execute function public.set_updated_at();

alter table public.cortex_pages enable row level security;

create policy "cortex_pages: read own" on public.cortex_pages
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "cortex_pages: insert own" on public.cortex_pages
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "cortex_pages: update own" on public.cortex_pages
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "cortex_pages: delete own" on public.cortex_pages
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.cortex_pages from anon, authenticated;
grant select, insert, update, delete on public.cortex_pages to authenticated;
