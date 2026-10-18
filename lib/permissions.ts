// Client-safe. What each org role may do (plans/organisations.md § Roles, plans/org-ready-schema.md).
// Code checks a permission with can() in lib/authz.ts, never a role name (D15), so custom roles
// later only replace this map (with a per-org `roles` table) and no caller changes.

export const PERMISSIONS = [
  "org.billing", // seats, entitlements, delete the org
  "members.manage", // invite, remove, change roles
  "cohorts.manage",
  "settings.manage",
  "assignments.create",
  "packs.create", // org-authored packs
  "analytics.view", // cohort and org aggregates
  "members.view_reports", // a member's own reports, further limited by their share level
  "practice", // take mocks, see assignments
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: ["members.manage", "cohorts.manage", "settings.manage", "assignments.create", "packs.create", "analytics.view", "members.view_reports", "practice"],
  coach: ["assignments.create", "packs.create", "analytics.view", "members.view_reports", "practice"],
  member: ["practice"],
};

/** Unknown roles (a typo, or one from a newer deploy) get no permissions: fail closed. */
export const roleCan = (role: string, permission: Permission) => (ROLE_PERMISSIONS[role] ?? []).includes(permission);

/**
 * How much of a member's practice an org may see, set by the member when joining (D11):
 * activity (mocks taken) < scores (+ scores and verdicts) < full (+ transcripts and resume).
 */
export const SHARE_LEVELS = ["activity", "scores", "full"] as const;
export type ShareLevel = (typeof SHARE_LEVELS)[number];
export const DEFAULT_SHARE_LEVEL: ShareLevel = "scores";

export const isShareLevel = (v: unknown): v is ShareLevel => typeof v === "string" && (SHARE_LEVELS as readonly string[]).includes(v);

/** Does a member who shares `granted` allow a viewer to see `needed`? */
export const shareAllows = (granted: ShareLevel, needed: ShareLevel) => SHARE_LEVELS.indexOf(granted) >= SHARE_LEVELS.indexOf(needed);
