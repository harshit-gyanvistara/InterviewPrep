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
