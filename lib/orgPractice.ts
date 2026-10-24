import { orgStore, type OrgStore } from "./authz";
import type { AuthUser } from "./auth";
import { ApiError } from "./liveAgent";
import { inScope, type CohortNode } from "./orgSections";
import { orgSettings } from "./orgSettings";
import { roleCan } from "./permissions";
import { getSupabaseAdmin } from "./supabase";
import type { Pack } from "./types";

// Server-only. Practising for an organisation (plans/m2-org.md O.4). A session asks for an org in
// its config ("Practising for" switcher); the server checks it here on the session's first AI
// call and only then stamps `sessions.org_id`, a column the browser can't write.

export interface OrgPracticeDeps {
  store: OrgStore | null;
  /** The org's settings JSON, or null when the org doesn't exist. */
  settings(orgId: string): Promise<unknown | null>;
  /** One assignment, or null when it doesn't exist. */
  assignment?(assignmentId: string): Promise<{ org_id: string; cohort_id: string | null; group_id: string | null; pack_id: string } | null>;
  /** The org's cohort tree, to tell whether a member's section is inside an assignment's. */
  cohorts?(orgId: string): Promise<CohortNode[]>;
  /** Is this user in the group? */
  inGroup?(groupId: string, userId: string): Promise<boolean>;
}

function defaultDeps(): OrgPracticeDeps {
  const db = getSupabaseAdmin();
  return {
    store: orgStore(),
    async settings(orgId) {
      if (!db) return null;
      const { data, error } = await db.from("organizations").select("settings").eq("id", orgId).maybeSingle();
      if (error) throw new Error(`organizations read failed: ${error.message}`);
      return data ? (data.settings ?? {}) : null;
    },
    async assignment(assignmentId) {
      if (!db) return null;
      const { data, error } = await db.from("assignments").select("org_id, cohort_id, group_id, pack_id").eq("id", assignmentId).maybeSingle();
      if (error) throw new Error(`assignments read failed: ${error.message}`);
      return data;
    },
    async cohorts(orgId) {
      if (!db) return [];
      const { data, error } = await db.from("cohorts").select("id, name, parent_id").eq("org_id", orgId);
      if (error) throw new Error(`cohorts read failed: ${error.message}`);
      return (data ?? []).map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id ?? null }));
    },
    async inGroup(groupId, userId) {
      if (!db) return false;
      const { data, error } = await db.from("group_members").select("user_id").eq("group_id", groupId).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(`group_members read failed: ${error.message}`);
      return !!data;
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Throws unless `user` may practise `pack` for `orgId`: an active member whose role grants
 * "practice", and the pack allowed by the org's `allowedPackIds` (Quick Mock packs, assembled by the
 * member from rounds the page already filtered, are allowed). 403 otherwise; 503 without the secret key.
 */
export async function checkOrgPractice(user: AuthUser, orgId: string, pack: Pack, deps: OrgPracticeDeps = defaultDeps()): Promise<void> {
  if (!UUID.test(orgId)) throw new ApiError(403, "You can't practise for that organisation.");
  if (!deps.store) throw new ApiError(503, "Practising for an organisation needs SUPABASE_SECRET_KEY on the server.");
  const [membership, settings] = await Promise.all([deps.store.membership(orgId, user.id), deps.settings(orgId)]);
  if (settings === null || membership?.status !== "active" || !roleCan(membership.role, "practice")) {
    throw new ApiError(403, "You're not a member of that organisation any more. Switch to practising as yourself.");
  }
  // An org's own rounds are always allowed for that org, and for no other.
  if (pack.source === "org") {
    if (pack.orgId !== orgId) throw new ApiError(403, "This round belongs to a different organisation. Pick another, or practise as yourself.");
    return;
  }
  const allowed = orgSettings({ settings }).allowedPackIds;
  if (allowed && pack.source !== "quick" && !allowed.includes(pack.id)) {
    throw new ApiError(403, "Your organisation doesn't include this round. Pick another, or practise as yourself.");
  }
}

/**
 * Throws unless this session may count toward `assignmentId`: an assignment of `orgId`, for the
 * member's cohort or a section above it (or a group they're in, or everyone), practising the
 * assigned round. Called after checkOrgPractice.
 */
export async function checkAssignment(user: AuthUser, orgId: string, assignmentId: string, pack: Pack, deps: OrgPracticeDeps = defaultDeps()): Promise<void> {
  const nope = new ApiError(403, "This assignment isn't yours to practise. Start the round without it.");
  if (!UUID.test(assignmentId) || !deps.assignment || !deps.store) throw nope;
  const [a, membership] = await Promise.all([deps.assignment(assignmentId), deps.store.membership(orgId, user.id)]);
  if (!a || a.org_id !== orgId || a.pack_id !== pack.id) throw nope;
  if (a.group_id) {
    if (!deps.inGroup || !(await deps.inGroup(a.group_id, user.id))) throw nope;
  } else if (a.cohort_id) {
    const nodes = deps.cohorts ? await deps.cohorts(orgId) : [];
    if (!inScope(nodes, membership?.cohortId ?? null, a.cohort_id)) throw nope;
  }
}
