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
