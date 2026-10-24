-- Organisation context for interviews (plans/b2b-college.md B.8). The org's own context lives in
-- organizations.settings.context; each section (cohort) can add to or override it. When a session is
-- first stamped for an org, the merged context is copied onto the session and never recomputed, so
-- editing the context later doesn't change interviews or reports already under way.

alter table public.cohorts
  add column context jsonb not null default '{}'::jsonb;

alter table public.sessions
  add column context_snapshot jsonb;
