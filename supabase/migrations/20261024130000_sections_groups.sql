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
