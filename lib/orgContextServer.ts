import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeContext, type MergedContext } from "./orgContext";
import { ancestry, type CohortNode } from "./orgSections";

// Server-only. The context an org member's interviews carry (plans/b2b-college.md B.8): the org's, then
// each section from the top down to the member's own, merged. Read once, when a session is first
// stamped for the org, and frozen on the session.

export async function memberContext(db: SupabaseClient, orgId: string, userId: string): Promise<MergedContext | null> {
  const [org, mem, cohorts] = await Promise.all([
    db.from("organizations").select("name, settings").eq("id", orgId).maybeSingle<{ name: string; settings: { context?: unknown } | null }>(),
    db.from("memberships").select("cohort_id").eq("org_id", orgId).eq("user_id", userId).eq("status", "active").maybeSingle<{ cohort_id: string | null }>(),
    db.from("cohorts").select("id, name, parent_id, context").eq("org_id", orgId),
  ]);
  for (const [what, error] of [["organizations", org.error], ["memberships", mem.error], ["cohorts", cohorts.error]] as const) {
    if (error) throw new Error(`${what} read failed: ${error.message}`);
  }
  if (!org.data) return null;
  const rows = (cohorts.data ?? []) as { id: string; name: string; parent_id: string | null; context: unknown }[];
  const nodes: CohortNode[] = rows.map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id ?? null }));
  const chain = mem.data?.cohort_id ? ancestry(nodes, mem.data.cohort_id) : [];
  const contexts = new Map(rows.map((c) => [c.id, c.context]));
  return mergeContext(org.data.name, [org.data.settings?.context, ...chain.map((c) => contexts.get(c.id))]);
}
