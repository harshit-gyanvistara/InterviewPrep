-- Org quotas (plans/m2-org.md O.4): an organisation's total use of a meter since a time, summed over
-- every member's practice for that org (usage_ledger rows stamped with org_id). Compared with the
-- org's `entitlements` row for the same key. Only the server calls it.

create or replace function public.usage_total_org(p_org uuid, p_meter text, p_since timestamptz)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(amount), 0)::bigint
  from public.usage_ledger
  where org_id = p_org and meter = p_meter and created_at >= p_since;
$$;

revoke execute on function public.usage_total_org(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.usage_total_org(uuid, text, timestamptz) to service_role;
