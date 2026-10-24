-- Details an organisation asks members for when they join (branch, year, ...), plans/b2b-college.md B.1.
--   invites.attributes     values the invite pre-fills; they are locked (the member can't change them)
--   memberships.attributes what the member ended up with: the invite's values plus their own answers
-- Which keys exist is org.settings.studentFields; the server validates keys and required fields
-- (lib/orgInvites.ts). join_org re-applies the invite's values last, so they always win.

alter table public.invites     add column attributes jsonb not null default '{}'::jsonb;
alter table public.memberships add column attributes jsonb not null default '{}'::jsonb;

-- The signature changes (one new argument), so the old function is replaced, not overloaded.
drop function public.join_org(text, uuid, text, text, text);

create or replace function public.join_org(
  p_token_hash text,
  p_user uuid,
  p_email text,
  p_share_level text,
  p_consent_version text,
  p_attributes jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv     public.invites%rowtype;
  org     public.organizations%rowtype;
  existing public.memberships%rowtype;
  domains jsonb;
  seats   integer;
  used    integer;
  attrs   jsonb;
begin
  select * into inv from public.invites where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Lock the org first: every join to this org waits here, so the seat count below can't race.
  select * into org from public.organizations where id = inv.org_id for update;

  select * into existing from public.memberships where org_id = org.id and user_id = p_user;
  if found and existing.status = 'active' then
    return jsonb_build_object('status', 'already_member', 'orgId', org.id, 'slug', org.slug);
  end if;

  if inv.expires_at is not null and inv.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    return jsonb_build_object('status', 'used_up');
  end if;
  if inv.email is not null and lower(inv.email) <> lower(p_email) then
    return jsonb_build_object('status', 'wrong_email');
  end if;

  -- Join codes (no email) can be limited to the org's email domains.
  domains := org.settings -> 'allowedEmailDomains';
  if inv.email is null and jsonb_typeof(domains) = 'array' and jsonb_array_length(domains) > 0
     and not exists (
       select 1 from jsonb_array_elements_text(domains) d
       where lower(d) = lower(split_part(p_email, '@', 2))
     ) then
    return jsonb_build_object('status', 'domain_not_allowed');
  end if;

  select "limit" into seats from public.entitlements where org_id = org.id and key = 'seats';
  if seats is not null then
    select count(*) into used from public.memberships where org_id = org.id and status = 'active';
    if used >= seats then
      return jsonb_build_object('status', 'no_seats');
    end if;
  end if;

  -- The member's answers first, then the invite's values on top (jsonb || lets the right side win).
  attrs := case when jsonb_typeof(p_attributes) = 'object' then p_attributes else '{}'::jsonb end || inv.attributes;

  insert into public.memberships (org_id, user_id, role, status, cohort_id, attributes)
  values (org.id, p_user, inv.role, 'active', inv.cohort_id, attrs)
  on conflict (org_id, user_id) do update
    set role = excluded.role, status = 'active', cohort_id = excluded.cohort_id, attributes = excluded.attributes, joined_at = now();

  update public.invites set uses = uses + 1 where id = inv.id;

  insert into public.consents (user_id, org_id, kind, value, version)
  values (p_user, org.id, 'org_share', jsonb_build_object('shareLevel', p_share_level), p_consent_version);

  insert into public.audit_logs (org_id, actor_id, action, target_user_id, details)
  values (org.id, p_user, 'member.joined', p_user, jsonb_build_object('role', inv.role, 'inviteId', inv.id, 'shareLevel', p_share_level));

  return jsonb_build_object('status', 'joined', 'orgId', org.id, 'slug', org.slug, 'role', inv.role);
end;
$$;

revoke execute on function public.join_org(text, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.join_org(text, uuid, text, text, text, jsonb) to service_role;
