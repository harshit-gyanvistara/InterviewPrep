import { describe, expect, it } from "vitest";
import { LOCAL_USER, type AuthUser } from "./auth";
import { can, canViewMember, requirePermission, type Membership, type OrgStore } from "./authz";
import { PERMISSIONS, ROLE_PERMISSIONS } from "./permissions";
import { DEFAULT_ORG_SETTINGS, orgSettings } from "./policies";

// Org permissions (plans/org-ready-schema.md) against an in-memory store.

const u = (id: string): AuthUser => ({ id, email: `${id}@example.test` });
const [owner, admin, coach, member, other, outsider] = ["owner", "admin", "coach", "member", "other", "outsider"].map(u);

function store(members: Membership[], shares: Record<string, unknown> = {}): OrgStore {
  return {
    membership: async (orgId, userId) => members.find((x) => x.orgId === orgId && x.userId === userId) ?? null,
    shareLevel: async (orgId, userId) => shares[`${orgId}:${userId}`],
  };
}

const A = "org-a";
const B = "org-b";
const m = (userId: string, role: string, orgId = A, status = "active"): Membership => ({ orgId, userId, role, status });
const orgA = store([m("owner", "owner"), m("admin", "admin"), m("coach", "coach"), m("member", "member"), m("other", "member"), m("outsider", "owner", B)]);

describe("can", () => {
  it("grants what each role's permissions say, nothing more", async () => {
    expect(await can(owner, "org.billing", A, orgA)).toBe(true);
    expect(await can(admin, "org.billing", A, orgA)).toBe(false);
    expect(await can(admin, "members.manage", A, orgA)).toBe(true);
    expect(await can(coach, "members.manage", A, orgA)).toBe(false);
    expect(await can(coach, "assignments.create", A, orgA)).toBe(true);
    expect(await can(member, "practice", A, orgA)).toBe(true);
    expect(await can(member, "analytics.view", A, orgA)).toBe(false);
  });

  it("never crosses orgs", async () => {
    expect(await can(outsider, "practice", A, orgA)).toBe(false);
    expect(await can(owner, "practice", B, orgA)).toBe(false);
  });

  it("denies invited, removed and unknown roles", async () => {
    const s = store([m("member", "admin", A, "invited"), m("other", "admin", A, "removed"), m("coach", "superuser")]);
    expect(await can(member, "practice", A, s)).toBe(false);
    expect(await can(other, "practice", A, s)).toBe(false);
    expect(await can(coach, "practice", A, s)).toBe(false);
  });

  it("fails closed without a store and for the local user", async () => {
    expect(await can(owner, "practice", A, null)).toBe(false);
    expect(await can(LOCAL_USER, "practice", A, orgA)).toBe(false);
  });

  it("requirePermission throws 403", async () => {
    await expect(requirePermission(member, "members.manage", A, orgA)).rejects.toMatchObject({ status: 403 });
    await expect(requirePermission(admin, "members.manage", A, orgA)).resolves.toBeUndefined();
  });

  it("maps every role to known permissions, and the owner has them all", () => {
    for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) expect(PERMISSIONS).toContain(p);
    expect([...ROLE_PERMISSIONS.owner].sort()).toEqual([...PERMISSIONS].sort());
  });
});

describe("canViewMember", () => {
  it("lets anyone see their own practice", async () => {
    expect(await canViewMember(member, "member", A, "full", null)).toBe(true);
  });

  it("follows the member's share level, default scores", async () => {
    const s = store([m("coach", "coach"), m("member", "member"), m("other", "member")], { [`${A}:other`]: "full" });
    expect(await canViewMember(coach, "member", A, "scores", s)).toBe(true);
    expect(await canViewMember(coach, "member", A, "full", s)).toBe(false);
    expect(await canViewMember(coach, "other", A, "full", s)).toBe(true);
  });

  it("hides scores when a member shares activity only", async () => {
    const s = store([m("admin", "admin"), m("member", "member")], { [`${A}:member`]: "activity" });
    expect(await canViewMember(admin, "member", A, "activity", s)).toBe(true);
    expect(await canViewMember(admin, "member", A, "scores", s)).toBe(false);
  });

  it("keeps members from seeing each other, and hides removed members", async () => {
    expect(await canViewMember(member, "other", A, "activity", orgA)).toBe(false);
    const s = store([m("admin", "admin"), m("member", "member", A, "removed")], { [`${A}:member`]: "full" });
    expect(await canViewMember(admin, "member", A, "activity", s)).toBe(false);
  });

  it("gives an admin of another org nothing", async () => {
    expect(await canViewMember(outsider, "member", A, "activity", orgA)).toBe(false);
    expect(await canViewMember(owner, "member", B, "activity", orgA)).toBe(false);
  });

  it("treats an unknown stored share level as the default", async () => {
    const s = store([m("admin", "admin"), m("member", "member")], { [`${A}:member`]: "everything" });
    expect(await canViewMember(admin, "member", A, "scores", s)).toBe(true);
    expect(await canViewMember(admin, "member", A, "full", s)).toBe(false);
  });
});

describe("orgSettings", () => {
  it("fills defaults and ignores malformed keys", () => {
    expect(orgSettings({})).toEqual(DEFAULT_ORG_SETTINGS);
    expect(orgSettings({ settings: { allowedPackIds: "all", defaultShareLevel: "everything", allowedEmailDomains: [1], features: { screening: "yes", beta: true } } })).toEqual({
      ...DEFAULT_ORG_SETTINGS,
      features: { beta: true },
    });
  });

  it("reads valid values", () => {
    expect(orgSettings({ settings: { allowedPackIds: ["behavioural"], defaultShareLevel: "full", allowedEmailDomains: ["IITB.ac.in"] } })).toMatchObject({
      allowedPackIds: ["behavioural"],
      defaultShareLevel: "full",
      allowedEmailDomains: ["iitb.ac.in"],
    });
  });
});
