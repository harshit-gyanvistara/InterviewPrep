-- Joining an organisation with an invite or join code (plans/m2-org.md O.2). One function does the
-- whole join atomically: invite checks, the email/domain rule, the seat limit, the membership, the
-- member's sharing consent and the audit entry. Locking the organisation row serialises joins per
-- org, so two people can't both take the last seat. Called only by the server (secret key).
--
-- Returns {"status": "..."}: joined | already_member | invalid | expired | used_up | wrong_email |
-- domain_not_allowed | no_seats. A missing `seats` entitlement means no seat limit.

create or replace function public.join_org(
  p_token_hash text,
  p_user uuid,
  p_email text,
  p_share_level text,
  p_consent_version text
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

  insert into public.memberships (org_id, user_id, role, status, cohort_id)
  values (org.id, p_user, inv.role, 'active', inv.cohort_id)
  on conflict (org_id, user_id) do update
    set role = excluded.role, status = 'active', cohort_id = excluded.cohort_id, joined_at = now();

  update public.invites set uses = uses + 1 where id = inv.id;

  insert into public.consents (user_id, org_id, kind, value, version)
  values (p_user, org.id, 'org_share', jsonb_build_object('shareLevel', p_share_level), p_consent_version);

  insert into public.audit_logs (org_id, actor_id, action, target_user_id, details)
  values (org.id, p_user, 'member.joined', p_user, jsonb_build_object('role', inv.role, 'inviteId', inv.id, 'shareLevel', p_share_level));

  return jsonb_build_object('status', 'joined', 'orgId', org.id, 'slug', org.slug, 'role', inv.role);
end;
$$;

revoke execute on function public.join_org(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.join_org(text, uuid, text, text, text) to service_role;
