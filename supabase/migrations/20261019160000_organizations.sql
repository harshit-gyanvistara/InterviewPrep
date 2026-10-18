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
