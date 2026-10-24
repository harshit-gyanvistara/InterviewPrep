import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOrg } from "./orgDashboard";
import { memberRow } from "./orgAnalytics";
import { requireRole, type OrgRef } from "./orgInvites";
import { overdueMembers, type OverdueMember } from "./orgReminders";

// Server-only. "Needs attention" on the org overview (plans/b2b-college.md B.10): the few people who need a
// nudge, so a placement officer isn't reading a table of everyone. Everything follows each member's
// sharing choice: a member who shares only activity is never listed by score.

/** A member whose readiness (average of their last 3 scored mocks) is below this is "at risk". */
export const AT_RISK_BELOW = 50;

export interface AtRiskMember {
  userId: string;
  email: string | null;
  readiness: number;
}

export interface Attention {
  atRisk: AtRiskMember[];
  overdue: OverdueMember[];
  threshold: number;
}

export async function attention(db: SupabaseClient, org: OrgRef, now: number): Promise<Attention> {
  requireRole(org, "analytics.view");
  const data = await loadOrg(db, org);
  const atRisk = data.members
    .filter((m) => m.role === "member")
    .map((m) => memberRow(m, data.reports))
    .filter((r): r is typeof r & { readiness: number } => r.readiness !== null && r.readiness < AT_RISK_BELOW)
    .sort((a, b) => a.readiness - b.readiness)
    .slice(0, 50)
    .map((r) => ({ userId: r.userId, email: r.email, readiness: r.readiness }));
  return { atRisk, overdue: await overdueMembers(db, org, now, data), threshold: AT_RISK_BELOW };
}
