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
