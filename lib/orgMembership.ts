import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { ApiError } from "./liveAgent";
import { audit } from "./orgAdmin";
import { lockedFor, type Attributes } from "./memberAttributes";
import { orgSettings, type StudentField } from "./orgSettings";
import { ORG_SHARE_CONSENT_VERSION, type OrgRef } from "./orgInvites";
import { DEFAULT_SHARE_LEVEL, SHARE_LEVEL_TEXT, isShareLevel, shareAllows, type ShareLevel } from "./permissions";

// Server-only. A member's own side of an organisation (plans/m2-org.md O.3, D11): see the orgs
// they're in, change what each may see, and leave. The member owns these choices; nobody else
// can change them. Runs on the secret-key client; the caller is the member themselves.

export interface MyOrg {
  id: string;
  name: string;
  slug: string;
  role: string;
  shareLevel: ShareLevel;
  /** Rounds the org allows (null = all), so /practice can show only those when practising for it. */
  allowedPackIds: string[] | null;
  /** The least this org lets members share ("activity" = no minimum). */
  minShareLevel: ShareLevel;
  /** What the org asks members for, and this member's answers (plans/b2b-college.md B.1). */
  studentFields: StudentField[];
  attributes: Attributes;
}

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

/** The member's latest unrevoked sharing choice per org, or the default when they never chose. */
async function shareLevels(db: SupabaseClient, userId: string, orgIds: string[]): Promise<Map<string, ShareLevel>> {
  if (!orgIds.length) return new Map();
  const { data, error } = await db
    .from("consents")
    .select("org_id, value, granted_at")
    .eq("user_id", userId)
    .eq("kind", "org_share")
    .is("revoked_at", null)
    .in("org_id", orgIds)
    .order("granted_at", { ascending: false });
  fail("consents read", error);
  const out = new Map<string, ShareLevel>();
  for (const c of data ?? []) {
    const level = (c.value as { shareLevel?: unknown } | null)?.shareLevel;
    if (!out.has(c.org_id) && isShareLevel(level)) out.set(c.org_id, level);
  }
  return out;
}

/** Every org the user is an active member of, with their role and current share level. */
export async function myOrgs(db: SupabaseClient, user: AuthUser): Promise<MyOrg[]> {
  const { data, error } = await db.from("memberships").select("role, attributes, organizations(id, name, slug, settings)").eq("user_id", user.id).eq("status", "active").order("joined_at");
  fail("memberships read", error);
  const rows = (data ?? []).flatMap((m) => {
    const o = m.organizations as unknown as { id: string; name: string; slug: string; settings: unknown } | null;
    if (!o) return [];
    const settings = orgSettings(o);
    return [{ id: o.id, name: o.name, slug: o.slug, role: m.role as string, allowedPackIds: settings.allowedPackIds, minShareLevel: settings.minShareLevel, studentFields: settings.studentFields, attributes: lockedFor(settings.studentFields, m.attributes) }];
  });
  const levels = await shareLevels(db, user.id, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, shareLevel: levels.get(r.id) ?? DEFAULT_SHARE_LEVEL }));
}

/** Ends the member's current sharing consent for the org (kept, marked revoked, for the record). */
async function revokeShare(db: SupabaseClient, userId: string, orgId: string) {
  const { error } = await db.from("consents").update({ revoked_at: new Date().toISOString() }).eq("user_id", userId).eq("org_id", orgId).eq("kind", "org_share").is("revoked_at", null);
  fail("consents revoke", error);
}

/** Changes what the org may see. Takes effect at once: canViewMember() reads the latest consent. */
export async function setShareLevel(db: SupabaseClient, user: AuthUser, org: OrgRef, shareLevel: ShareLevel) {
  const { minShareLevel } = orgSettings(org);
  if (!shareAllows(shareLevel, minShareLevel)) throw new ApiError(400, `${org.name} needs you to share at least: ${SHARE_LEVEL_TEXT[minShareLevel].title}.`);
  await revokeShare(db, user.id, org.id);
  const { error } = await db.from("consents").insert({ user_id: user.id, org_id: org.id, kind: "org_share", value: { shareLevel }, version: ORG_SHARE_CONSENT_VERSION });
  fail("consents insert", error);
  await audit(db, { orgId: org.id, actor: user, action: "member.share_changed", targetUserId: user.id, details: { shareLevel } });
}

/**
 * Leaves the org: membership removed, sharing consent revoked, so the org loses access to
 * everything from now on. The member's own history stays theirs. The last owner can't leave, or
 * nobody could manage the org; they hand ownership over first.
 */
export async function leaveOrg(db: SupabaseClient, user: AuthUser, org: OrgRef) {
  if (org.role === "owner") {
    const { count, error } = await db.from("memberships").select("user_id", { count: "exact", head: true }).eq("org_id", org.id).eq("role", "owner").eq("status", "active");
    fail("memberships count", error);
    if ((count ?? 0) <= 1) throw new ApiError(409, "You're the only owner. Make someone else an owner before you leave.");
  }
  const { error } = await db.from("memberships").update({ status: "removed" }).eq("org_id", org.id).eq("user_id", user.id);
  fail("memberships update", error);
  await revokeShare(db, user.id, org.id);
  await audit(db, { orgId: org.id, actor: user, action: "member.left", targetUserId: user.id });
}
