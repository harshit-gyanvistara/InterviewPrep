import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import type { OrgRef } from "./orgInvites";
import { leaveOrg, myOrgs, setShareLevel } from "./orgMembership";

// A member's own side of an org (plans/m2-org.md O.3): list, change sharing, leave.

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn(() => null) }));

const me: AuthUser = { id: "me", email: "me@college.edu" };
const org = (role: string): OrgRef => ({ id: "org-1", name: "Sunrise", slug: "sunrise", settings: {}, role });

/** Answers selects per table and records writes as "table.op". */
function fakeDb(answers: { memberships?: unknown[]; consents?: unknown[]; ownerCount?: number } = {}) {
  const writes: { table: string; op: string; payload?: unknown }[] = [];
  const db = {
    from(table: string) {
      let op = "select";
      let head = false;
      const q = {
        select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
        insert: (p: unknown) => ((op = "insert"), writes.push({ table, op, payload: p }), q),
        update: (p: unknown) => ((op = "update"), writes.push({ table, op, payload: p }), q),
        eq: () => q,
        is: () => q,
        in: () => q,
        order: () => q,
        then: (ok: (v: unknown) => void) =>
          ok(head ? { count: answers.ownerCount ?? 0, error: null } : { data: op === "select" ? ((answers as Record<string, unknown[]>)[table] ?? []) : null, error: null }),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

describe("myOrgs", () => {
  it("lists active orgs with the latest share level, defaulting to scores", async () => {
    const { db } = fakeDb({
      memberships: [
        { role: "member", organizations: { id: "a", name: "A", slug: "a" } },
        { role: "admin", organizations: { id: "b", name: "B", slug: "b" } },
      ],
      // Newest first, as the query orders them.
      consents: [
        { org_id: "a", value: { shareLevel: "full" } },
        { org_id: "a", value: { shareLevel: "activity" } },
      ],
    });
    expect(await myOrgs(db, me)).toEqual([
      { id: "a", name: "A", slug: "a", role: "member", shareLevel: "full" },
      { id: "b", name: "B", slug: "b", role: "admin", shareLevel: "scores" },
    ]);
  });
});

describe("setShareLevel", () => {
  it("revokes the old consent, records the new one, and audits it", async () => {
    const { db, writes } = fakeDb();
    await setShareLevel(db, me, org("member"), "activity");
    expect(writes.map((w) => `${w.table}.${w.op}`)).toEqual(["consents.update", "consents.insert", "audit_logs.insert"]);
    expect(writes[0].payload).toMatchObject({ revoked_at: expect.any(String) });
    expect(writes[1].payload).toMatchObject({ user_id: "me", org_id: "org-1", kind: "org_share", value: { shareLevel: "activity" } });
  });
});

describe("leaveOrg", () => {
  it("removes the membership and revokes sharing", async () => {
    const { db, writes } = fakeDb();
    await leaveOrg(db, me, org("member"));
    expect(writes.map((w) => `${w.table}.${w.op}`)).toEqual(["memberships.update", "consents.update", "audit_logs.insert"]);
    expect(writes[0].payload).toEqual({ status: "removed" });
  });

  it("stops the last owner from leaving, but not one of several", async () => {
    await expect(leaveOrg(fakeDb({ ownerCount: 1 }).db, me, org("owner"))).rejects.toMatchObject({ status: 409 });
    await expect(leaveOrg(fakeDb({ ownerCount: 2 }).db, me, org("owner"))).resolves.toBeUndefined();
  });
});
