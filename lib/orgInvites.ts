import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { can, orgStore, requirePermission, type OrgStore } from "./authz";
import { hashInviteToken, inviteLink, newInviteToken, newJoinCode, normalizeJoinValue } from "./invites";
import { ApiError } from "./liveAgent";
import { audit } from "./orgAdmin";
import { orgSettings } from "./orgSettings";
import { PERMISSIONS, type Permission, type ShareLevel } from "./permissions";
import type { InviteCreateBody } from "./schemas";

// Server-only. Invites, join codes and joining (plans/m2-org.md O.2). Every function runs on the
// secret-key client after the caller's permission is checked here; the join itself is the
// `join_org` database function, so the seat limit holds under concurrent joins.

/** Version of the sharing consent text on the join screen; bump it when that text changes. */
export const ORG_SHARE_CONSENT_VERSION = "2026-10-19";

export interface OrgRef {
  id: string;
  name: string;
  slug: string;
  settings: unknown;
}

export interface InviteView {
  id: string;
  kind: "email" | "code";
  email: string | null;
  role: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  createdAt: string;
}

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

/** The org with this slug, if `user` is an active member of it; 404 otherwise (non-members can't probe slugs). */
export async function orgForMember(db: SupabaseClient, user: AuthUser, slug: string, store: OrgStore | null = orgStore()): Promise<OrgRef & { permissions: Permission[] }> {
  const { data, error } = await db.from("organizations").select("id, name, slug, settings").eq("slug", slug).maybeSingle();
  fail("organizations read", error);
  const membership = data && store ? await store.membership(data.id, user.id) : null;
  if (!data || membership?.status !== "active") throw new ApiError(404, "Organisation not found.");
  const permissions: Permission[] = [];
  for (const p of PERMISSIONS) if (await can(user, p, data.id, store)) permissions.push(p);
  return { ...data, permissions };
}

/** Owners invite owners; anyone with members.manage invites the other roles. */
async function checkCanGrant(user: AuthUser, orgId: string, role: string, store: OrgStore | null) {
  await requirePermission(user, "members.manage", orgId, store);
  if (role === "owner") await requirePermission(user, "org.billing", orgId, store);
}

export async function listInvites(db: SupabaseClient, user: AuthUser, org: OrgRef, store: OrgStore | null = orgStore()): Promise<InviteView[]> {
  await requirePermission(user, "members.manage", org.id, store);
  const { data, error } = await db.from("invites").select("id, email, role, uses, max_uses, expires_at, created_at").eq("org_id", org.id).order("created_at", { ascending: false });
  fail("invites read", error);
  const now = Date.now();
  return (data ?? [])
    .filter((i) => (!i.expires_at || Date.parse(i.expires_at) > now) && (i.max_uses === null || i.uses < i.max_uses))
    .map((i) => ({ id: i.id, kind: i.email ? "email" : "code", email: i.email, role: i.role, uses: i.uses, maxUses: i.max_uses, expiresAt: i.expires_at, createdAt: i.created_at }));
}

/** Creates invites. The links and code are returned once and never stored (only their hashes are). */
export async function createInvites(
  db: SupabaseClient,
  user: AuthUser,
  org: OrgRef,
  body: InviteCreateBody,
  store: OrgStore | null = orgStore(),
): Promise<{ invites: { email: string | null; link: string; code?: string }[] }> {
  await checkCanGrant(user, org.id, body.role, store);
  const expires_at = new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString();

  if (body.kind === "code") {
    const { code, hash } = newJoinCode();
    fail("invites insert", (await db.from("invites").insert({ org_id: org.id, email: null, token_hash: hash, role: body.role, expires_at, max_uses: body.maxUses, created_by: user.id })).error);
    await audit(db, { orgId: org.id, actor: user, action: "invite.code_created", details: { role: body.role, maxUses: body.maxUses, expiresInDays: body.expiresInDays } });
    return { invites: [{ email: null, link: inviteLink(code), code }] };
  }

  const emails = [...new Set(body.emails)];
  const made = emails.map((email) => ({ email, ...newInviteToken() }));
  const rows = made.map((m) => ({ org_id: org.id, email: m.email, token_hash: m.hash, role: body.role, expires_at, max_uses: 1, created_by: user.id }));
  fail("invites insert", (await db.from("invites").insert(rows)).error);
  await audit(db, { orgId: org.id, actor: user, action: "invite.created", details: { role: body.role, count: emails.length, expiresInDays: body.expiresInDays } });
  return { invites: made.map((m) => ({ email: m.email, link: inviteLink(m.token) })) };
}

/** Revokes an invite by expiring it now (the row stays for the audit trail). */
export async function revokeInvite(db: SupabaseClient, user: AuthUser, org: OrgRef, inviteId: string, store: OrgStore | null = orgStore()) {
  await requirePermission(user, "members.manage", org.id, store);
  const { data, error } = await db.from("invites").update({ expires_at: new Date().toISOString() }).eq("org_id", org.id).eq("id", inviteId).select("id");
  fail("invites update", error);
  if (!data?.length) throw new ApiError(404, "Invite not found.");
  await audit(db, { orgId: org.id, actor: user, action: "invite.revoked", details: { inviteId } });
}

export type JoinPreview =
  | { status: "ok"; orgName: string; role: string; defaultShareLevel: ShareLevel; alreadyMember: boolean }
  | { status: "invalid" | "expired" | "used_up" | "wrong_email" };

/** What the join screen shows before the member agrees. Doesn't consume the invite. */
export async function previewInvite(db: SupabaseClient, user: AuthUser, value: string): Promise<JoinPreview> {
  const { data: inv, error } = await db
    .from("invites")
    .select("org_id, email, role, uses, max_uses, expires_at, organizations(name, settings)")
    .eq("token_hash", hashInviteToken(normalizeJoinValue(value)))
    .maybeSingle();
  fail("invites read", error);
  if (!inv) return { status: "invalid" };
  const org = inv.organizations as unknown as { name: string; settings: unknown } | null;
  if (!org) return { status: "invalid" };
  const { data: m } = await db.from("memberships").select("status").eq("org_id", inv.org_id).eq("user_id", user.id).maybeSingle();
  const alreadyMember = m?.status === "active";
  if (!alreadyMember) {
    if (inv.expires_at && Date.parse(inv.expires_at) <= Date.now()) return { status: "expired" };
    if (inv.max_uses !== null && inv.uses >= inv.max_uses) return { status: "used_up" };
    if (inv.email && inv.email.toLowerCase() !== (user.email ?? "").toLowerCase()) return { status: "wrong_email" };
  }
  return { status: "ok", orgName: org.name, role: inv.role, defaultShareLevel: orgSettings(org).defaultShareLevel, alreadyMember };
}

const JOIN_ERRORS: Record<string, [number, string]> = {
  invalid: [404, "This invite link isn't valid. Ask your organisation for a new one."],
  expired: [410, "This invite has expired. Ask your organisation for a new one."],
  used_up: [410, "This invite has already been used."],
  wrong_email: [403, "This invite is for a different email address. Sign in with the address it was sent to."],
  domain_not_allowed: [403, "This organisation only accepts members with its own email addresses."],
  no_seats: [409, "This organisation has no free seats. Ask your admin to add more."],
};

/** Joins the org through `join_org` (atomic). Returns the org's slug; an existing member just gets it back. */
export async function joinOrg(db: SupabaseClient, user: AuthUser, value: string, shareLevel: ShareLevel): Promise<{ slug: string; alreadyMember: boolean }> {
  const { data, error } = await db.rpc("join_org", {
    p_token_hash: hashInviteToken(normalizeJoinValue(value)),
    p_user: user.id,
    p_email: user.email ?? "",
    p_share_level: shareLevel,
    p_consent_version: ORG_SHARE_CONSENT_VERSION,
  });
  fail("join_org", error);
  const out = data as { status: string; slug?: string };
  if (out.status === "joined" || out.status === "already_member") return { slug: out.slug!, alreadyMember: out.status === "already_member" };
  const [status, message] = JOIN_ERRORS[out.status] ?? [500, "Couldn't join the organisation."];
  throw new ApiError(status, message);
}
