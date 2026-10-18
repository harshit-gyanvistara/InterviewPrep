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
