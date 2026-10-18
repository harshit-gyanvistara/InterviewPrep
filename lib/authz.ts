import { LOCAL_USER, type AuthUser } from "./auth";
import { ApiError } from "./liveAgent";
import { DEFAULT_SHARE_LEVEL, isShareLevel, roleCan, shareAllows, type Permission, type ShareLevel } from "./permissions";
import { getSupabaseAdmin } from "./supabase";

// Server-only. The one place that answers "may this person do this in this org?"
// (plans/org-ready-schema.md). Org routes (M2-Org) call can() / canViewMember() before touching org
// data with the secret key; row-level security only ever lets a user read their own rows and
// their orgs' shared tables, never another member's practice.

export interface Membership {
  orgId: string;
  userId: string;
  role: string;
  status: string;
}

/** Where org facts are read. The database in production (secret key); tests pass an in-memory one. */
export interface OrgStore {
  membership(orgId: string, userId: string): Promise<Membership | null>;
  /** The member's latest unrevoked `org_share` consent for this org, as stored (`value.shareLevel`). */
  shareLevel(orgId: string, userId: string): Promise<unknown>;
}

/** The org tables via the secret-key client; null without SUPABASE_SECRET_KEY, and then every check denies. */
export function orgStore(): OrgStore | null {
  const db = getSupabaseAdmin();
  if (!db) return null;
  return {
    async membership(orgId, userId) {
      const { data, error } = await db.from("memberships").select("org_id, user_id, role, status").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(`memberships read failed: ${error.message}`);
      return data && { orgId: data.org_id, userId: data.user_id, role: data.role, status: data.status };
    },
    async shareLevel(orgId, userId) {
      const { data, error } = await db
        .from("consents")
        .select("value")
        .eq("user_id", userId)
        .eq("org_id", orgId)
        .eq("kind", "org_share")
        .is("revoked_at", null)
        .order("granted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`consents read failed: ${error.message}`);
      return (data?.value as { shareLevel?: unknown } | undefined)?.shareLevel;
    },
  };
}

async function activeMembership(store: OrgStore, orgId: string, userId: string): Promise<Membership | null> {
  const m = await store.membership(orgId, userId);
  return m?.status === "active" ? m : null;
}

/** May `user` use `permission` in `orgId`? Needs an active membership whose role grants it. Fails closed. */
export async function can(user: AuthUser, permission: Permission, orgId: string, store: OrgStore | null = orgStore()): Promise<boolean> {
  if (user === LOCAL_USER || !store) return false;
  const m = await activeMembership(store, orgId, user.id);
  return !!m && roleCan(m.role, permission);
}

/** Throws ApiError 403 unless can(). */
export async function requirePermission(user: AuthUser, permission: Permission, orgId: string, store?: OrgStore | null): Promise<void> {
  if (await can(user, permission, orgId, store === undefined ? orgStore() : store)) return;
  throw new ApiError(403, "You don't have access to this.");
}

/**
 * May `viewer` see `memberId`'s practice at `level` in `orgId`? Your own is always visible. For
 * anyone else: the viewer can view reports in this org, the member is active in it, and the member's
 * share level allows `level` (default "scores" when they never chose, D11). Leaving the org, or
 * revoking consent, ends access.
 */
export async function canViewMember(
  viewer: AuthUser,
  memberId: string,
  orgId: string,
  level: ShareLevel,
  store: OrgStore | null = orgStore(),
): Promise<boolean> {
  if (viewer.id === memberId && viewer !== LOCAL_USER) return true;
  if (!(await can(viewer, "members.view_reports", orgId, store))) return false;
  if (!store || !(await activeMembership(store, orgId, memberId))) return false;
  const stored = await store.shareLevel(orgId, memberId);
  return shareAllows(isShareLevel(stored) ? stored : DEFAULT_SHARE_LEVEL, level);
}
