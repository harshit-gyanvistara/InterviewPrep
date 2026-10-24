-- All Offerly migrations in order, generated from supabase/migrations/*.sql.
-- Paste into Supabase > SQL Editor and run once on an EMPTY project. Not safe to run twice.


-- ======== 20261003120000_catalog.sql ========

-- Catalog: data every user reads and only Offerly staff edit.
--   domains: fields (medicine, software, ...) and the prompt text that goes with each
--   packs:   the built-in interview round library
-- The app reads these on the server with the secret key (lib/catalog-server.ts) and serves them
-- through /api/catalog. RLS is on with no policies, so the publishable key can neither read nor
-- write them directly. Seed with `npm run db:seed` (copies lib/domains and lib/packs).

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.domains (
  id                  text primary key,
  label               text not null,
  -- Regex source, matched case-insensitively against target role, then job description.
  match_pattern       text,
  interviewer_context text not null default '',
  scoring_context     text not null default '',
  round_hints         text not null default '',
  roadmap_hints       text not null default '',
  allows_coding       boolean not null default false,
  -- Bump when any prompt text changes, so sessions can record the version they used.
  version             integer not null default 1,
  -- Inference order: lower is tried first. "general" has no pattern and is the fallback.
  sort_order          integer not null default 100,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.packs (
  id           text primary key,
  title        text not null,
  company      text not null,
  role         text not null,
  -- Validated in code (behavioural | technical | coding | hr), not a DB enum, so new types need no migration.
  round_type   text not null,
  description  text not null,
  duration_min integer not null check (duration_min between 5 and 120),
  topics       text[] not null check (cardinality(topics) > 0),
  rubric       text[] not null check (cardinality(rubric) > 0),
  style        text not null,
  -- Field ids this pack is shown for; null = every field.
  domains      text[],
  sort_order   integer not null default 100,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger domains_set_updated_at before update on public.domains
  for each row execute function public.set_updated_at();
create trigger packs_set_updated_at before update on public.packs
  for each row execute function public.set_updated_at();

alter table public.domains enable row level security;
alter table public.packs enable row level security;


-- ======== 20261014120000_accounts.sql ========

-- Accounts (plans/auth.md): one row per signed-in person, their profile, and what they agreed to.
--   users:    mirror of auth.users, created by trigger on sign-up
--   profiles: the Profile from lib/types.ts as JSONB, one per user (written via /api/db/profile)
--   consents: generic, versioned consent rows (kind 'terms' now; 'org_share', 'guardian', ... later,
--             see plans/organisations.md). org_id gets its foreign key when organizations lands (M2.10).
-- The app reads and writes these with the user's own session (publishable key), so the RLS
-- policies below are what keeps one user out of another's rows. Deleting the auth user cascades.

create table public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  -- Reserved for the minors / guardian-consent policy (D15); nothing reads it yet.
  birth_year   integer,
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create table public.profiles (
  user_id    uuid primary key references public.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.consents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  org_id     uuid,
  -- Validated string, not an enum, so new kinds need no migration (D15).
  kind       text not null,
  value      jsonb not null default '{}'::jsonb,
  version    text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index consents_user_kind_idx on public.consents (user_id, kind);

-- Row-level security: each signed-in user sees and changes only their own rows. Nothing for anon.
alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.consents enable row level security;

create policy "users: read own" on public.users
  for select to authenticated using ((select auth.uid()) = id);
create policy "users: update own" on public.users
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "profiles: read own" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles: insert own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles: update own" on public.profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "profiles: delete own" on public.profiles
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Consents are append-only for users; revoking goes through the server.
create policy "consents: read own" on public.consents
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "consents: insert own" on public.consents
  for insert to authenticated with check ((select auth.uid()) = user_id and revoked_at is null);

-- Explicit grants (RLS still applies on top of them). Revoke Supabase's default table-wide grants
-- first, so users can't change their own id or email and anon gets nothing.
revoke all on public.users, public.profiles, public.consents from anon, authenticated;
grant select, update (display_name, birth_year) on public.users to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert on public.consents to authenticated;


-- ======== 20261019120000_usage_ledger.sql ========

-- Usage ledger (plans/usage-limits.md): one row per counted use of a meter, the record that package
-- allowances are checked against and that billing (M6) and org quotas (O.5) will read.
--   meter:   validated string in code (lib/packages.ts: 'mocks', 'ai_calls'; later 'voice_minutes',
--            'tokens'), not an enum, so new meters need no migration (D15)
--   org_id:  gets its foreign key when organizations lands (M2.10)
-- Rows are written by the server with the secret key (lib/policies.ts). Users can read their own
-- rows and never write: otherwise anyone could delete theirs and reset their allowance.

create table public.usage_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.users (id) on delete cascade,
  org_id      uuid,
  meter       text not null,
  amount      integer not null default 1 check (amount > 0),
  -- liveAgent request id for AI calls, so a row can be matched to its ai.usage log line.
  request_id  text,
  created_at  timestamptz not null default now()
);

create index usage_ledger_user_meter_time_idx on public.usage_ledger (user_id, meter, created_at);

alter table public.usage_ledger enable row level security;

create policy "usage_ledger: read own" on public.usage_ledger
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.usage_ledger from anon, authenticated;
grant select on public.usage_ledger to authenticated;

-- Total use of a meter since a time, summed in the database. Only the server calls it.
create or replace function public.usage_total(p_user uuid, p_meter text, p_since timestamptz)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(amount), 0)::bigint
  from public.usage_ledger
  where user_id = p_user and meter = p_meter and created_at >= p_since;
$$;

revoke execute on function public.usage_total(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.usage_total(uuid, text, timestamptz) to service_role;


-- ======== 20261019130000_packages.sql ========

-- Packages (plans/usage-limits.md, phase 1b): what each package allows, editable without a deploy.
--   allowances: { "<meter>": { "limit": <int or null = unlimited>, "period": "day" | "month" | "none" } }
--               A meter missing from the object is unlimited. Meters are validated in code (D15).
-- The app reads this on the server with the secret key (lib/packages-server.ts, cached 60 s) and
-- falls back to PACKAGES in lib/packages.ts if it's empty or invalid. RLS on with no policies, so
-- the publishable key can neither read nor write it.

create table public.packages (
  id          text primary key,
  label       text not null,
  allowances  jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger packages_set_updated_at before update on public.packages
  for each row execute function public.set_updated_at();

alter table public.packages enable row level security;

insert into public.packages (id, label, allowances) values
  ('beta', 'Beta', '{"mocks": {"limit": 5, "period": "day"}, "ai_calls": {"limit": 150, "period": "day"}}'),
  ('free', 'Free', '{"mocks": {"limit": 3, "period": "month"}, "ai_calls": {"limit": 100, "period": "month"}}'),
  ('pro',  'Pro',  '{"mocks": {"limit": null, "period": "none"}, "ai_calls": {"limit": 2000, "period": "month"}}');


-- ======== 20261019140000_user_collections.sql ========

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


-- ======== 20261019150000_session_versions.sql ========

-- Session versioning (plans/session-versioning-and-trusted-context.md, implementationPlan M2.3).
-- Written only by the interview routes on the server. The client's PUT /api/db/sessions upserts
-- `data` alone, so it can't overwrite these. Kept as columns so analytics can query them.

alter table public.sessions
  add column pack_snapshot   jsonb,          -- the exact pack the session used, taken on its first AI call
  add column prompt_versions jsonb,          -- liveAgent prompt version per call, e.g. {"turn": "...", "report": "..."}
  add column rubric_version  text,           -- short hash of pack_snapshot's rubric
  add column model_ids       text[] not null default '{}';  -- every Gemini model that served this session


-- ======== 20261019160000_organizations.sql ========

-- Organisations (plans/org-ready-schema.md, implementationPlan M2.10; design in plans/organisations.md).
-- Tables only: no org UI or routes yet (M2-Org). Strings, not enums, for anything that will grow
-- (kind, role, status, key, action); code validates them (D15).
--
-- Row-level security gives membership-level reads only. A user sees the orgs they're an active
-- member of, their own memberships, and their orgs' cohorts and assignments. RLS never lets one user
-- read another's sessions, reports or transcripts, not even an org admin: admin views go through
-- server routes that check lib/authz.ts (can / canViewMember), use the secret key and write
-- audit_logs. All org writes go through the server too, so users get no insert/update/delete here.

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  kind        text not null default 'other',          -- college, company, institute, ...
  data_region text not null default 'default',        -- one region today (data residency later)
  settings    jsonb not null default '{}'::jsonb,     -- read through orgSettings() in lib/policies.ts
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.cohorts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  name       text not null,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  role       text not null default 'member',          -- permissions from ROLE_PERMISSIONS (lib/permissions.ts)
  status     text not null default 'active',          -- invited | active | removed
  cohort_id  uuid references public.cohorts (id) on delete set null,
  joined_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index memberships_user_idx on public.memberships (user_id);

-- Seats, mocks per period, and later voice minutes etc. Set by hand now (D13); billing writes them in M6.
create table public.entitlements (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  key        text not null,
  "limit"    integer check ("limit" is null or "limit" >= 0),   -- null = unlimited
  period     text not null default 'none',                       -- none | day | month | year
  source     text not null default 'manual',                     -- manual | billing
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  email       text,                                   -- null = a reusable join code
  token_hash  text not null unique,                   -- only the hash is stored
  role        text not null default 'member',
  cohort_id   uuid references public.cohorts (id) on delete set null,
  expires_at  timestamptz,
  max_uses    integer check (max_uses is null or max_uses > 0),
  uses        integer not null default 0,
  created_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.assignments (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  cohort_id         uuid references public.cohorts (id) on delete set null,
  pack_id           text not null,
  title             text not null,
  due_at            timestamptz,
  target_mock_count integer not null default 1 check (target_mock_count > 0),
  created_by        uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now()
);

-- Who in an org viewed or exported whose data, and other org actions. Append-only.
create table public.audit_logs (
  id             bigint generated always as identity primary key,
  org_id         uuid references public.organizations (id) on delete set null,
  actor_id       uuid references public.users (id) on delete set null,
  action         text not null,
  target_user_id uuid references public.users (id) on delete set null,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index audit_logs_org_time_idx on public.audit_logs (org_id, created_at);

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();
create trigger entitlements_set_updated_at before update on public.entitlements
  for each row execute function public.set_updated_at();

-- The org_id columns added earlier get their foreign keys. Deleting an org keeps members' data (D11).
alter table public.sessions
  add constraint sessions_org_fk foreign key (org_id) references public.organizations (id) on delete set null,
  add column assignment_id uuid references public.assignments (id) on delete set null;
alter table public.reports
  add constraint reports_org_fk foreign key (org_id) references public.organizations (id) on delete set null,
  add column assignment_id uuid references public.assignments (id) on delete set null;
alter table public.usage_ledger
  add constraint usage_ledger_org_fk foreign key (org_id) references public.organizations (id) on delete set null,
  add column assignment_id uuid references public.assignments (id) on delete set null;
alter table public.consents
  add constraint consents_org_fk foreign key (org_id) references public.organizations (id) on delete cascade;
alter table public.custom_packs
  add column org_id uuid references public.organizations (id) on delete set null;

create index usage_ledger_org_meter_time_idx on public.usage_ledger (org_id, meter, created_at) where org_id is not null;

-- Is the signed-in user an active member of `org`? Security definer so policies on memberships
-- (and tables that check membership) don't recurse through memberships' own RLS.
create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = org and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

revoke execute on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.cohorts enable row level security;
alter table public.memberships enable row level security;
alter table public.entitlements enable row level security;
alter table public.invites enable row level security;
alter table public.assignments enable row level security;
alter table public.audit_logs enable row level security;

create policy "organizations: read as member" on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy "cohorts: read as member" on public.cohorts
  for select to authenticated using (public.is_org_member(org_id));
create policy "memberships: read own" on public.memberships
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "assignments: read as member" on public.assignments
  for select to authenticated using (public.is_org_member(org_id));
-- entitlements, invites, audit_logs: no user policies (server only).

revoke all on public.organizations, public.cohorts, public.memberships, public.entitlements,
  public.invites, public.assignments, public.audit_logs from anon, authenticated;
grant select on public.organizations, public.cohorts, public.memberships, public.assignments to authenticated;


-- ======== 20261019170000_join_org.sql ========

-- Joining an organisation with an invite or join code (plans/m2-org.md O.2). One function does the
-- whole join atomically: invite checks, the email/domain rule, the seat limit, the membership, the
-- member's sharing consent and the audit entry. Locking the organisation row serialises joins per
-- org, so two people can't both take the last seat. Called only by the server (secret key).
--
-- Returns {"status": "..."}: joined | already_member | invalid | expired | used_up | wrong_email |
-- domain_not_allowed | no_seats. A missing `seats` entitlement means no seat limit.

create or replace function public.join_org(
  p_token_hash text,
  p_user uuid,
  p_email text,
  p_share_level text,
  p_consent_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv     public.invites%rowtype;
  org     public.organizations%rowtype;
  existing public.memberships%rowtype;
  domains jsonb;
  seats   integer;
  used    integer;
begin
  select * into inv from public.invites where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Lock the org first: every join to this org waits here, so the seat count below can't race.
  select * into org from public.organizations where id = inv.org_id for update;

  select * into existing from public.memberships where org_id = org.id and user_id = p_user;
  if found and existing.status = 'active' then
    return jsonb_build_object('status', 'already_member', 'orgId', org.id, 'slug', org.slug);
  end if;

  if inv.expires_at is not null and inv.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    return jsonb_build_object('status', 'used_up');
  end if;
  if inv.email is not null and lower(inv.email) <> lower(p_email) then
    return jsonb_build_object('status', 'wrong_email');
  end if;

  -- Join codes (no email) can be limited to the org's email domains.
  domains := org.settings -> 'allowedEmailDomains';
  if inv.email is null and jsonb_typeof(domains) = 'array' and jsonb_array_length(domains) > 0
     and not exists (
       select 1 from jsonb_array_elements_text(domains) d
       where lower(d) = lower(split_part(p_email, '@', 2))
     ) then
    return jsonb_build_object('status', 'domain_not_allowed');
  end if;

  select "limit" into seats from public.entitlements where org_id = org.id and key = 'seats';
  if seats is not null then
    select count(*) into used from public.memberships where org_id = org.id and status = 'active';
    if used >= seats then
      return jsonb_build_object('status', 'no_seats');
    end if;
  end if;

  insert into public.memberships (org_id, user_id, role, status, cohort_id)
  values (org.id, p_user, inv.role, 'active', inv.cohort_id)
  on conflict (org_id, user_id) do update
    set role = excluded.role, status = 'active', cohort_id = excluded.cohort_id, joined_at = now();

  update public.invites set uses = uses + 1 where id = inv.id;

  insert into public.consents (user_id, org_id, kind, value, version)
  values (p_user, org.id, 'org_share', jsonb_build_object('shareLevel', p_share_level), p_consent_version);

  insert into public.audit_logs (org_id, actor_id, action, target_user_id, details)
  values (org.id, p_user, 'member.joined', p_user, jsonb_build_object('role', inv.role, 'inviteId', inv.id, 'shareLevel', p_share_level));

  return jsonb_build_object('status', 'joined', 'orgId', org.id, 'slug', org.slug, 'role', inv.role);
end;
$$;

revoke execute on function public.join_org(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.join_org(text, uuid, text, text, text) to service_role;


-- ======== 20261019180000_org_usage.sql ========

-- Org quotas (plans/m2-org.md O.4): an organisation's total use of a meter since a time, summed over
-- every member's practice for that org (usage_ledger rows stamped with org_id). Compared with the
-- org's `entitlements` row for the same key. Only the server calls it.

create or replace function public.usage_total_org(p_org uuid, p_meter text, p_since timestamptz)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(amount), 0)::bigint
  from public.usage_ledger
  where org_id = p_org and meter = p_meter and created_at >= p_since;
$$;

revoke execute on function public.usage_total_org(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.usage_total_org(uuid, text, timestamptz) to service_role;

-- A user's own allowance counts only their own practice: mocks done for an org use the org's plan
-- (decision G3), so rows stamped with org_id are left out here.
create or replace function public.usage_total(p_user uuid, p_meter text, p_since timestamptz)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(amount), 0)::bigint
  from public.usage_ledger
  where user_id = p_user and meter = p_meter and created_at >= p_since and org_id is null;
$$;


-- ======== 20261024120000_member_attributes.sql ========

-- Details an organisation asks members for when they join (branch, year, ...), plans/b2b-college.md B.1.
--   invites.attributes     values the invite pre-fills; they are locked (the member can't change them)
--   memberships.attributes what the member ended up with: the invite's values plus their own answers
-- Which keys exist is org.settings.studentFields; the server validates keys and required fields
-- (lib/orgInvites.ts). join_org re-applies the invite's values last, so they always win.

alter table public.invites     add column attributes jsonb not null default '{}'::jsonb;
alter table public.memberships add column attributes jsonb not null default '{}'::jsonb;

-- The signature changes (one new argument), so the old function is replaced, not overloaded.
drop function public.join_org(text, uuid, text, text, text);

create or replace function public.join_org(
  p_token_hash text,
  p_user uuid,
  p_email text,
  p_share_level text,
  p_consent_version text,
  p_attributes jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv     public.invites%rowtype;
  org     public.organizations%rowtype;
  existing public.memberships%rowtype;
  domains jsonb;
  seats   integer;
  used    integer;
  attrs   jsonb;
begin
  select * into inv from public.invites where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Lock the org first: every join to this org waits here, so the seat count below can't race.
  select * into org from public.organizations where id = inv.org_id for update;

  select * into existing from public.memberships where org_id = org.id and user_id = p_user;
  if found and existing.status = 'active' then
    return jsonb_build_object('status', 'already_member', 'orgId', org.id, 'slug', org.slug);
  end if;

  if inv.expires_at is not null and inv.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    return jsonb_build_object('status', 'used_up');
  end if;
  if inv.email is not null and lower(inv.email) <> lower(p_email) then
    return jsonb_build_object('status', 'wrong_email');
  end if;

  -- Join codes (no email) can be limited to the org's email domains.
  domains := org.settings -> 'allowedEmailDomains';
  if inv.email is null and jsonb_typeof(domains) = 'array' and jsonb_array_length(domains) > 0
     and not exists (
       select 1 from jsonb_array_elements_text(domains) d
       where lower(d) = lower(split_part(p_email, '@', 2))
     ) then
    return jsonb_build_object('status', 'domain_not_allowed');
  end if;

  select "limit" into seats from public.entitlements where org_id = org.id and key = 'seats';
  if seats is not null then
    select count(*) into used from public.memberships where org_id = org.id and status = 'active';
    if used >= seats then
      return jsonb_build_object('status', 'no_seats');
    end if;
  end if;

  -- The member's answers first, then the invite's values on top (jsonb || lets the right side win).
  attrs := case when jsonb_typeof(p_attributes) = 'object' then p_attributes else '{}'::jsonb end || inv.attributes;

  insert into public.memberships (org_id, user_id, role, status, cohort_id, attributes)
  values (org.id, p_user, inv.role, 'active', inv.cohort_id, attrs)
  on conflict (org_id, user_id) do update
    set role = excluded.role, status = 'active', cohort_id = excluded.cohort_id, attributes = excluded.attributes, joined_at = now();

  update public.invites set uses = uses + 1 where id = inv.id;

  insert into public.consents (user_id, org_id, kind, value, version)
  values (p_user, org.id, 'org_share', jsonb_build_object('shareLevel', p_share_level), p_consent_version);

  insert into public.audit_logs (org_id, actor_id, action, target_user_id, details)
  values (org.id, p_user, 'member.joined', p_user, jsonb_build_object('role', inv.role, 'inviteId', inv.id, 'shareLevel', p_share_level));

  return jsonb_build_object('status', 'joined', 'orgId', org.id, 'slug', org.slug, 'role', inv.role);
end;
$$;

revoke execute on function public.join_org(text, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.join_org(text, uuid, text, text, text, jsonb) to service_role;


-- ======== 20261024130000_sections_groups.sql ========

-- Sections and groups (plans/b2b-college.md B.2).
--   cohorts.parent_id   cohorts become a tree (Department / Year / Section). A member still sits in one
--                       cohort (memberships.cohort_id); work for a node covers its descendants, which the
--                       server works out (lib/orgSections.ts). Depth is limited there too.
--   groups              ad-hoc, overlapping sets of members (e.g. "Amazon drive shortlist"); a member can
--                       be in many. Work can be assigned to a group instead of a cohort.

alter table public.cohorts
  add column parent_id uuid references public.cohorts (id) on delete set null,
  add constraint cohorts_not_own_parent check (parent_id is null or parent_id <> id);

create index cohorts_parent_idx on public.cohorts (parent_id) where parent_id is not null;

create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  name       text not null,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id  uuid not null references public.users (id) on delete cascade,
  org_id   uuid not null references public.organizations (id) on delete cascade,
  primary key (group_id, user_id)
);

create index group_members_user_idx on public.group_members (user_id, org_id);

-- An assignment goes to everyone, one cohort (and below), or one group, never both.
alter table public.assignments
  add column group_id uuid references public.groups (id) on delete cascade,
  add constraint assignments_one_audience check (cohort_id is null or group_id is null);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

create policy "groups: read as member" on public.groups
  for select to authenticated using (public.is_org_member(org_id));
-- group_members: no user policies (server only; who is in a group is for staff).

revoke all on public.groups, public.group_members from anon, authenticated;
grant select on public.groups to authenticated;


-- ======== 20261024140000_org_packs.sql ========

-- Rounds (mock templates) an organisation owns and edits (plans/b2b-college.md B.5). Admins and coaches
-- create them, usually by copying a built-in round; members of the org can read them and practise
-- them for the org. `data` is a Pack (lib/types.ts) without its id/source/orgId, which come from the row.
-- Archived rounds stay readable so old sessions and reports can still name them.

create table public.org_packs (
  id         text primary key,
  org_id     uuid not null references public.organizations (id) on delete cascade,
  data       jsonb not null,
  archived   boolean not null default false,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index org_packs_org_idx on public.org_packs (org_id);

create trigger org_packs_set_updated_at before update on public.org_packs
  for each row execute function public.set_updated_at();

alter table public.org_packs enable row level security;

create policy "org_packs: read as member" on public.org_packs
  for select to authenticated using (public.is_org_member(org_id));
-- Writes: server only (secret key), after a packs.create permission check.

revoke all on public.org_packs from anon, authenticated;
grant select on public.org_packs to authenticated;


-- ======== 20261024150000_trajectories.sql ========

-- Trajectories (plans/b2b-college.md B.6): an ordered plan of stages that an org builds once and gives
-- to a section or group. Giving it to an audience (a "run") copies each stage into an `assignments` row
-- (with the stage's order, gate and whether it is mandatory), so stamping, completion counts and the
-- member's list keep working unchanged, and editing the plan later never touches work already set.

create table public.trajectories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null,
  description text not null default '',
  archived    boolean not null default false,
  created_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.trajectory_stages (
  id            uuid primary key default gen_random_uuid(),
  trajectory_id uuid not null references public.trajectories (id) on delete cascade,
  position      integer not null check (position > 0),
  title         text not null,
  pack_id       text not null,                      -- a built-in round or one of the org's (org_packs)
  target_count  integer not null default 1 check (target_count between 1 and 50),
  due_days      integer check (due_days is null or due_days between 0 and 730),  -- days after the run starts
  gate_score    integer check (gate_score is null or gate_score between 0 and 100),
  mandatory     boolean not null default true,
  unique (trajectory_id, position)
);

create table public.trajectory_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  trajectory_id uuid references public.trajectories (id) on delete set null,
  name          text not null,                      -- the plan's name when it was given out
  cohort_id     uuid references public.cohorts (id) on delete set null,
  group_id      uuid references public.groups (id) on delete cascade,
  starts_at     timestamptz not null default now(),
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint trajectory_runs_one_audience check (cohort_id is null or group_id is null)
);

alter table public.assignments
  add column run_id    uuid references public.trajectory_runs (id) on delete cascade,
  add column position  integer,
  add column gate_score integer check (gate_score is null or gate_score between 0 and 100),
  add column mandatory boolean not null default true;

create index assignments_run_idx on public.assignments (run_id) where run_id is not null;
create index trajectory_runs_org_idx on public.trajectory_runs (org_id);

create trigger trajectories_set_updated_at before update on public.trajectories
  for each row execute function public.set_updated_at();

alter table public.trajectories enable row level security;
alter table public.trajectory_stages enable row level security;
alter table public.trajectory_runs enable row level security;
-- No user policies: the plans are managed by staff through the server, and members see their own
-- stages through `assignments` (already readable by org members) and /api/me/plan.

revoke all on public.trajectories, public.trajectory_stages, public.trajectory_runs from anon, authenticated;


-- ======== 20261024160000_org_context.sql ========

-- Organisation context for interviews (plans/b2b-college.md B.8). The org's own context lives in
-- organizations.settings.context; each section (cohort) can add to or override it. When a session is
-- first stamped for an org, the merged context is copied onto the session and never recomputed, so
-- editing the context later doesn't change interviews or reports already under way.

alter table public.cohorts
  add column context jsonb not null default '{}'::jsonb;

alter table public.sessions
  add column context_snapshot jsonb;


-- ======== 20261024170000_waivers.sql ========

-- Waivers (plans/b2b-college.md B.9): a coach or admin excuses one member from one assignment (a plan
-- stage), with a reason. A waived stage counts as done for that member and unlocks the next one. Kept
-- separate from reports so scores are never faked; the reason is shown to the member and audited.

create table public.assignment_waivers (
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  user_id       uuid not null references public.users (id) on delete cascade,
  org_id        uuid not null references public.organizations (id) on delete cascade,
  reason        text not null check (char_length(reason) between 3 and 300),
  waived_by     uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (assignment_id, user_id)
);

create index assignment_waivers_org_idx on public.assignment_waivers (org_id);

alter table public.assignment_waivers enable row level security;
-- No user policies: read and written by the server (the member sees theirs through /api/me/plan).
revoke all on public.assignment_waivers from anon, authenticated;


-- ======== 20261024180000_reminders.sql ========

-- Reminders (plans/b2b-college.md B.10): which reminder emails went to whom, so nobody gets the same one
-- twice. due_soon and overdue are sent automatically once per person per assignment; a nudge is a staff
-- member's manual reminder, at most once a day.

create table public.reminder_log (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  user_id       uuid not null references public.users (id) on delete cascade,
  kind          text not null check (kind in ('due_soon', 'overdue', 'nudge')),
  sent_by       uuid references public.users (id) on delete set null,   -- the staff member, for a nudge
  sent_at       timestamptz not null default now()
);

create index reminder_log_lookup_idx on public.reminder_log (assignment_id, user_id, kind, sent_at desc);

alter table public.reminder_log enable row level security;
-- No user policies: written and read by the server only.
revoke all on public.reminder_log from anon, authenticated;
