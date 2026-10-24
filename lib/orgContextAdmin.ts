import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { ApiError } from "./liveAgent";
import { audit } from "./orgAdmin";
import { cohortNodes } from "./orgCohorts";
import { readContext, type ContextFields } from "./orgContext";
import { requireRole, type OrgRef } from "./orgInvites";
import { pathLabel, treeOrder } from "./orgSections";

// Server-only. Editing the context an organisation's interviews carry (plans/b2b-college.md B.8): the
// org's own, and one per section. Owners and admins (settings.manage). It applies to practice started
// afterwards; interviews already under way keep the copy they were stamped with.

export interface ContextView {
  org: ContextFields;
  sections: { id: string; path: string; archived: boolean; context: ContextFields }[];
}

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

export async function getContexts(db: SupabaseClient, org: OrgRef): Promise<ContextView> {
  requireRole(org, "settings.manage");
  const [nodes, rows] = await Promise.all([cohortNodes(db, org.id), db.from("cohorts").select("id, context").eq("org_id", org.id)]);
  fail("cohorts read", rows.error);
  const context = new Map((rows.data ?? []).map((r) => [r.id as string, r.context]));
  return {
    org: readContext((org.settings as { context?: unknown } | null)?.context),
    sections: treeOrder(nodes).map((n) => ({ id: n.id, path: pathLabel(nodes, n.id), archived: !!n.archived, context: readContext(context.get(n.id)) })),
  };
}

export async function setOrgContext(db: SupabaseClient, user: AuthUser, org: OrgRef, value: ContextFields) {
  requireRole(org, "settings.manage");
  const settings = { ...((org.settings as Record<string, unknown> | null) ?? {}), context: readContext(value) };
  fail("organizations update", (await db.from("organizations").update({ settings }).eq("id", org.id)).error);
  await audit(db, { orgId: org.id, actor: user, action: "org.context_updated", details: {} });
}

export async function setSectionContext(db: SupabaseClient, user: AuthUser, org: OrgRef, cohortId: string, value: ContextFields) {
  requireRole(org, "settings.manage");
  const { data, error } = await db.from("cohorts").update({ context: readContext(value) }).eq("org_id", org.id).eq("id", cohortId).select("id");
  fail("cohorts update", error);
  if (!data?.length) throw new ApiError(404, "Section not found.");
  await audit(db, { orgId: org.id, actor: user, action: "section.context_updated", details: { cohortId } });
}
