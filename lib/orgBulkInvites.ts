import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { inviteLink, newInviteToken } from "./invites";
import { ApiError } from "./liveAgent";
import { unknownKeys } from "./memberAttributes";
import { audit } from "./orgAdmin";
import { cohortNodes } from "./orgCohorts";
import { requireRole, type OrgRef } from "./orgInvites";
import { checkParent, findByPath, pathLabel, type CohortNode } from "./orgSections";
import { orgSettings } from "./orgSettings";
import { roleCan } from "./permissions";
import type { BulkInviteBody } from "./schemas";

// Server-only. Invite many people at once, placing each in a section (plans/b2b-college.md B.3).
// All-or-nothing on the checks that can be made up front (details, seats, who may create sections);
// missing sections in a path are created from the top down.

export interface BulkInviteResult {
  invites: { email: string; link: string; section: string | null }[];
  sectionsCreated: number;
}

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

export async function createBulkInvites(db: SupabaseClient, user: AuthUser, org: OrgRef, body: BulkInviteBody): Promise<BulkInviteResult> {
  requireRole(org, "members.manage");
  if (body.role === "owner") requireRole(org, "org.billing");

  const fields = orgSettings(org).studentFields;
  for (const row of body.rows) {
    const unknown = unknownKeys(fields, row.attributes);
    if (unknown.length) throw new ApiError(400, `${row.email}: this organisation doesn't ask for ${unknown.join(", ")}.`);
  }
  const emails = new Set<string>();
  for (const row of body.rows) {
    if (emails.has(row.email)) throw new ApiError(400, `${row.email} appears more than once.`);
    emails.add(row.email);
  }

  // Seats: people already in, plus invites still waiting, plus this file, must fit.
  const [seatRow, active, open] = await Promise.all([
    db.from("entitlements").select("limit").eq("org_id", org.id).eq("key", "seats").maybeSingle(),
    db.from("memberships").select("user_id").eq("org_id", org.id).eq("status", "active"),
    db.from("invites").select("email, uses, max_uses, expires_at").eq("org_id", org.id),
  ]);
  fail("entitlements read", seatRow.error);
  fail("memberships read", active.error);
  fail("invites read", open.error);
  const seats = (seatRow.data as { limit: number | null } | null)?.limit ?? null;
  if (seats !== null) {
    const now = Date.now();
    const waiting = (open.data ?? []).filter((i) => i.email && (i.max_uses === null || i.uses < i.max_uses) && (!i.expires_at || Date.parse(i.expires_at) > now)).length;
    const used = (active.data ?? []).length + waiting;
    if (used + body.rows.length > seats) {
      throw new ApiError(409, `This would use ${used + body.rows.length} of ${seats} seats (${used} already in use or invited). Invite fewer people or ask for more seats.`);
    }
  }

  // Sections: find each path, creating what is missing.
  const nodes: CohortNode[] = await cohortNodes(db, org.id);
  const canCreate = roleCan(org.role, "cohorts.manage");
  let sectionsCreated = 0;
  const resolved = new Map<string, string>();
  const sectionFor = async (parts: string[]): Promise<string> => {
    const key = parts.map((p) => p.toLowerCase()).join("\u0000");
    const known = resolved.get(key);
    if (known) return known;
    let parent: string | null = null;
    for (let i = 0; i < parts.length; i++) {
      const existing = findByPath(nodes, parts.slice(0, i + 1));
      if (existing) {
        parent = existing.id;
        continue;
      }
      if (!canCreate) throw new ApiError(403, `The section "${parts.slice(0, i + 1).join(" / ")}" doesn't exist, and you can't create sections.`);
      const problem = checkParent(nodes, null, parent);
      if (problem) throw new ApiError(400, problem);
      const created = await db.from("cohorts").insert({ org_id: org.id, name: parts[i], parent_id: parent }).select("id").single<{ id: string }>();
      fail("cohorts insert", created.error);
      const id: string = created.data!.id;
      nodes.push({ id, name: parts[i], parentId: parent });
      sectionsCreated++;
      parent = id;
    }
    resolved.set(key, parent!);
    return parent!;
  };

  const expires_at = new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString();
  const made: { email: string; token: string; hash: string; cohortId: string | null; attributes: Record<string, string> }[] = [];
  for (const row of body.rows) {
    const cohortId = row.section?.length ? await sectionFor(row.section) : null;
    made.push({ email: row.email, ...newInviteToken(), cohortId, attributes: row.attributes });
  }
  fail(
    "invites insert",
    (await db.from("invites").insert(made.map((m) => ({ org_id: org.id, email: m.email, token_hash: m.hash, role: body.role, cohort_id: m.cohortId, expires_at, max_uses: 1, attributes: m.attributes, created_by: user.id })))).error,
  );
  await audit(db, { orgId: org.id, actor: user, action: "invite.bulk_created", details: { role: body.role, count: made.length, sectionsCreated, expiresInDays: body.expiresInDays } });
  return {
    invites: made.map((m) => ({ email: m.email, link: inviteLink(m.token), section: m.cohortId ? pathLabel(nodes, m.cohortId) : null })),
    sectionsCreated,
  };
}
