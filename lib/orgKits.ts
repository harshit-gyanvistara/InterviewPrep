import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { ApiError } from "./liveAgent";
import { audit } from "./orgAdmin";
import { requireRole, type OrgRef } from "./orgInvites";
import { kitById } from "./starterKits";

// Server-only. Applying a starter kit to an organisation (plans/b2b-college.md B.7): its rounds become the
// org's own, its plans the org's own, and its settings fill in what the org hasn't set. A copy, so the
// org's later edits never touch the kit or anyone else. Once per org; the org records which kit and version.

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

const isEmpty = (v: unknown) => v === undefined || v === null || (Array.isArray(v) && v.length === 0);

export interface KitResult {
  rounds: number;
  plans: number;
}

/** No permission check: callers decide (a super-admin creating the org, or an owner/admin from its page). */
export async function installKit(db: SupabaseClient, actor: AuthUser, orgId: string, kitId: string): Promise<KitResult> {
  const kit = kitById(kitId);
  if (!kit) throw new ApiError(404, "Unknown starter kit.");
  const { data: org, error } = await db.from("organizations").select("id, settings").eq("id", orgId).maybeSingle<{ id: string; settings: Record<string, unknown> | null }>();
  fail("organizations read", error);
  if (!org) throw new ApiError(404, "Organisation not found.");
  const settings = org.settings ?? {};
  if (settings.kit) throw new ApiError(409, "A starter kit has already been applied to this organisation.");

  const roundIds = new Map<string, string>();
  const planIds: string[] = [];
  try {
    const rows = kit.rounds.map((r) => {
      const id = `org-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      roundIds.set(r.key, id);
      const round: Record<string, unknown> = { ...r, domains: "all" };
      delete round.key;
      return { id, org_id: orgId, data: round, created_by: actor.id };
    });
    fail("org_packs insert", (await db.from("org_packs").insert(rows)).error);

    for (const plan of kit.plans) {
      const made = await db.from("trajectories").insert({ org_id: orgId, name: plan.name, description: plan.description, created_by: actor.id }).select("id").single<{ id: string }>();
      fail("trajectories insert", made.error);
      planIds.push(made.data!.id);
      const stages = plan.stages.map((s, i) => ({ trajectory_id: made.data!.id, position: i + 1, title: s.title, pack_id: roundIds.get(s.round)!, target_count: s.targetCount, due_days: s.dueDays, gate_score: s.gateScore, mandatory: s.mandatory }));
      fail("trajectory_stages insert", (await db.from("trajectory_stages").insert(stages)).error);
    }

    // The kit's settings fill gaps only: anything the org already chose stays.
    const merged: Record<string, unknown> = { ...settings };
    for (const [key, value] of Object.entries(kit.settings)) if (isEmpty(merged[key])) merged[key] = value;
    merged.kit = { id: kit.id, version: kit.version, appliedAt: new Date().toISOString() };
    fail("organizations update", (await db.from("organizations").update({ settings: merged }).eq("id", orgId)).error);
  } catch (e) {
    // Best effort, so a retry doesn't leave duplicates behind.
    if (roundIds.size) await db.from("org_packs").delete().in("id", [...roundIds.values()]);
    if (planIds.length) await db.from("trajectories").delete().in("id", planIds);
    throw e;
  }
  await audit(db, { orgId, actor, action: "kit.applied", details: { kitId: kit.id, version: kit.version, rounds: kit.rounds.length, plans: kit.plans.length } });
  return { rounds: kit.rounds.length, plans: kit.plans.length };
}

/** From the org's own page: owners and admins (settings.manage). */
export async function applyKit(db: SupabaseClient, user: AuthUser, org: OrgRef, kitId: string): Promise<KitResult> {
  requireRole(org, "settings.manage");
  return installKit(db, user, org.id, kitId);
}
