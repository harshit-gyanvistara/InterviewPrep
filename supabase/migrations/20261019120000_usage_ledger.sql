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
