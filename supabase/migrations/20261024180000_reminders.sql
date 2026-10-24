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
