-- Session versioning (plans/session-versioning-and-trusted-context.md, implementationPlan M2.3).
-- Written only by the interview routes on the server. The client's PUT /api/db/sessions upserts
-- `data` alone, so it can't overwrite these. Kept as columns so analytics can query them.

alter table public.sessions
  add column pack_snapshot   jsonb,          -- the exact pack the session used, taken on its first AI call
  add column prompt_versions jsonb,          -- liveAgent prompt version per call, e.g. {"turn": "...", "report": "..."}
  add column rubric_version  text,           -- short hash of pack_snapshot's rubric
  add column model_ids       text[] not null default '{}';  -- every Gemini model that served this session
