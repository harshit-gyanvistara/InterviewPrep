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
