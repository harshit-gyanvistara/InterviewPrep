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
