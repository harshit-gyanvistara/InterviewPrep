import { z } from "zod";
import { ROUND_TYPES } from "./types";

/**
 * Request bodies for every POST /api route (implementationPlan D4). Parsed by `parseBody` in
 * lib/route.ts, which turns a failure into a 400 with field errors. Unknown keys are stripped, so
 * the browser can keep sending whole objects (a Profile with id/createdAt/...) and only the fields
 * below reach liveAgent.
 *
 * The caps are abuse guards, set well above anything the app sends; liveAgent's prompts do their
 * own, tighter truncation. No server imports here: the client can share these schemas.
 */

export const LIMITS = {
  /** Whole request body, checked before parsing. */
  bodyBytes: 1_000_000,
  /** Names, titles, roles, ids. */
  short: 500,
  /** Pack descriptions and styles (a Quick Mock concatenates several). */
  medium: 10_000,
  /** Resume, job description, notes being improved. */
  long: 50_000,
  /** One interview message. */
  message: 10_000,
  messages: 400,
  code: 50_000,
  listItems: 50,
  digests: 20,
} as const;

const short = z.string().max(LIMITS.short);
const medium = z.string().max(LIMITS.medium);
const long = z.string().max(LIMITS.long);

export const PersonaSchema = z.enum(["friendly", "neutral", "tough"]);

export const ProfileSchema = z.object({
  name: short.default(""),
  targetRole: short.default(""),
  targetCompanies: short.default(""),
  jobDescription: long.default(""),
  // Validated string, not an enum, so new experience levels don't break old requests (D15).
  experience: short.default(""),
  domain: short.optional(),
  resume: long.default(""),
});

export const PackSchema = z.object({
  title: short,
  company: short.default(""),
  role: short.default(""),
  roundType: z.enum(ROUND_TYPES),
  description: medium.default(""),
  topics: z.array(short).min(1).max(LIMITS.listItems),
  rubric: z.array(short).min(1).max(LIMITS.listItems),
  style: medium.default(""),
});

// ---- Organisation rounds (plans/b2b-college.md B.5) ----

// Unlike the loose Pack schema used for interview requests, an org round is authored by hand: no blank titles or list items.
const filled = short.trim().min(1, { message: "Don't leave this blank." });
const orgPackTopics = z.array(filled).min(1).max(LIMITS.listItems);
const orgDuration = z.number().int().min(5).max(120);

/** A new org round: everything a Pack needs, with the optional text fields defaulting to empty. */
export const OrgPackCreateBodySchema = z.object({
  title: filled,
  company: short.default(""),
  role: short.default(""),
  roundType: z.enum(ROUND_TYPES),
  description: medium.default(""),
  durationMin: orgDuration,
  topics: orgPackTopics,
  rubric: orgPackTopics,
  style: medium.default(""),
});

/** Changes to an org round: any of the fields, or archiving it. (No defaults here, or an edit would blank what it left out.) */
export const OrgPackUpdateBodySchema = z
  .object({
    title: filled.optional(),
    company: short.optional(),
    role: short.optional(),
    roundType: z.enum(ROUND_TYPES).optional(),
    description: medium.optional(),
    durationMin: orgDuration.optional(),
    topics: orgPackTopics.optional(),
    rubric: orgPackTopics.optional(),
    style: medium.optional(),
    archived: z.boolean().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Nothing to update." });

export type OrgPackCreateBody = z.infer<typeof OrgPackCreateBodySchema>;
export type OrgPackUpdateBody = z.infer<typeof OrgPackUpdateBodySchema>;

// ---- Trajectories (plans/b2b-college.md B.6) ----

export const TrajectoryStageSchema = z.object({
  title: filled.max(120),
  packId: z.string().trim().min(1).max(100),
  targetCount: z.number().int().min(1).max(50).default(1),
  /** Days after the plan is given out that this stage is due; null = no due date. */
  dueDays: z.number().int().min(0).max(730).nullable().default(null),
  /** Score to reach for a mock to count (0 to 100); null = any mock counts. */
  gateScore: z.number().int().min(0).max(100).nullable().default(null),
  mandatory: z.boolean().default(true),
});

export const TrajectoryBodySchema = z.object({
  name: filled.max(120),
  description: medium.default(""),
  stages: z.array(TrajectoryStageSchema).min(1).max(12),
});

export const TrajectoryUpdateBodySchema = z
  .object({ name: filled.max(120).optional(), description: medium.optional(), stages: z.array(TrajectoryStageSchema).min(1).max(12).optional(), archived: z.boolean().optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Nothing to update." });

/** Give a plan to everyone, a cohort (and the sections below it) or a group. */
export const TrajectoryAssignBodySchema = z
  .object({
    cohortId: z.uuid().nullable().default(null),
    groupId: z.uuid().nullable().default(null),
    /** ISO date-time the plan starts; defaults to now. Stage due dates count from here. */
    startsAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((b) => !(b.cohortId && b.groupId), { message: "Pick a cohort or a group, not both." });

export type TrajectoryBody = z.infer<typeof TrajectoryBodySchema>;
export type TrajectoryAssignBody = z.infer<typeof TrajectoryAssignBodySchema>;

export const SessionConfigSchema = z.object({
  persona: PersonaSchema,
  durationMin: z.number().positive().max(240),
  pressure: z.boolean().default(false),
  questionCount: z.number().int().positive().max(LIMITS.listItems).optional(),
});

export const MessageSchema = z.object({
  role: z.enum(["interviewer", "candidate"]),
  text: z.string().max(LIMITS.message),
});

const messages = z.array(MessageSchema).max(LIMITS.messages).default([]);
const code = z.string().max(LIMITS.code).default("");

/**
 * The interview's context as the browser holds it. Sent only when sign-in is off (no server copy);
 * signed in, the routes load it from the database and ignore this (M2.6, plans/session-versioning-and-trusted-context.md).
 */
export const InterviewContextSchema = z.object({
  config: SessionConfigSchema,
  profile: ProfileSchema,
  pack: PackSchema,
  messages,
});

const sessionId = z.string().min(1).max(100);

export const TurnBodySchema = z.object({
  sessionId,
  /** The candidate's new message; absent for the opening greeting. Ids make a retried turn safe. */
  answer: z.object({ id: z.string().min(1).max(100), text: z.string().trim().min(1).max(LIMITS.message), at: z.number().nonnegative() }).optional(),
  elapsedSec: z.number().nonnegative().max(24 * 3600).default(0),
  code,
  context: InterviewContextSchema.optional(),
});

export const ReportBodySchema = z.object({
  sessionId,
  code,
  context: InterviewContextSchema.optional(),
});

export const PackGenerateBodySchema = z.object({
  profile: ProfileSchema.refine((p) => p.targetRole.trim(), { message: "Missing target role.", path: ["targetRole"] }),
});

export const RoadmapBodySchema = z.object({
  profile: ProfileSchema,
  weeks: z.number().int().min(1).max(12).optional(),
  // Report digests go to the model verbatim as JSON; the body size cap bounds their content.
  digests: z.array(z.record(z.string(), z.unknown())).max(LIMITS.digests).default([]),
});

export const AssistBodySchema = z
  .object({
    mode: z.enum(["improve", "generate"]),
    text: long.nullish(),
    instruction: z.string().max(2_000).nullish(),
    contextTitle: short.nullish(),
  })
  // Same rules and wording as liveAgent's /v1/assist, checked here so they cost no round trip.
  .refine((b) => b.mode !== "improve" || b.text?.trim(), { message: "Nothing to improve yet — write something first.", path: ["text"] })
  .refine((b) => b.mode !== "generate" || b.instruction?.trim() || b.contextTitle?.trim(), { message: "Say what you'd like written.", path: ["instruction"] });

export type TurnBody = z.infer<typeof TurnBodySchema>;
export type ReportBody = z.infer<typeof ReportBodySchema>;
export type InterviewContext = z.infer<typeof InterviewContextSchema>;
export type PackGenerateBody = z.infer<typeof PackGenerateBodySchema>;
export type RoadmapBody = z.infer<typeof RoadmapBodySchema>;
export type AssistBody = z.infer<typeof AssistBodySchema>;

// ---- Accounts (plans/auth.md) ----

const email = z.string().trim().toLowerCase().pipe(z.email({ message: "Enter a valid email address." }).max(320));

export const EmailOtpBodySchema = z.object({ email });

export const DevLoginBodySchema = z.object({ email });

export const VerifyOtpBodySchema = z.object({
  email,
  // Supabase codes are 6 digits by default; the project can configure up to 10.
  code: z.string().trim().regex(/^\d{6,10}$/, { message: "Enter the code from the email." }),
});

/**
 * A stored Profile (lib/types.ts), for the server copy in `profiles.data`. Known fields are
 * checked; unknown ones are kept, so an older server doesn't drop fields a newer client adds.
 */
export const StoredProfileSchema = z.looseObject({
  id: short,
  name: short,
  targetRole: short,
  targetCompanies: short.default(""),
  jobDescription: long.default(""),
  experience: short,
  domain: short.optional(),
  resume: long.default(""),
  interviewDate: short.optional(),
  weeklyGoal: z.number().int().min(0).max(50),
  onboarded: z.boolean(),
  createdAt: z.number(),
});

export type StoredProfile = z.infer<typeof StoredProfileSchema>;

// ---- Organisations: super-admin (plans/m2-org.md O.1) ----

/** Same rule as the `organizations.slug` check in the database. */
export const ORG_SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
/** Entitlement keys are free text validated here, so marketing can add one without a migration (D15). */
export const ENTITLEMENT_KEY = /^[a-z][a-z0-9_]{0,39}$/;
export const ENTITLEMENT_PERIODS = ["none", "day", "month", "year"] as const;

const orgName = z.string().trim().min(1, { message: "Enter a name." }).max(120);
const orgKind = z.string().trim().toLowerCase().min(1).max(40);

export const OrgCreateBodySchema = z.object({
  name: orgName,
  slug: z.string().trim().toLowerCase().regex(ORG_SLUG, { message: "Use 2-63 lowercase letters, digits or hyphens, starting with a letter or digit." }),
  kind: orgKind.default("other"),
  ownerEmail: email.optional(),
  /** A starter kit to apply straight away (lib/starterKits.ts). */
  kitId: z.string().trim().min(1).max(60).optional(),
});

/** The four context fields an org (or one of its sections) can set; anything left out is cleared. */
export const ContextBodySchema = z.object({
  context: z.object({
    companies: z.string().max(1500).default(""),
    roles: z.string().max(1500).default(""),
    techStack: z.string().max(1500).default(""),
    notes: z.string().max(1500).default(""),
  }),
});

export const NudgeBodySchema = z.object({
  targets: z.array(z.object({ userId: z.string().min(1).max(64), assignmentId: z.uuid() })).min(1).max(50),
});

export const WaiverBodySchema = z.object({ assignmentId: z.uuid(), reason: z.string().trim().min(3, { message: "Give a reason." }).max(300) });
export const WaiverRemoveBodySchema = z.object({ assignmentId: z.uuid() });

export const KitBodySchema = z.object({ kitId: z.string().trim().min(1).max(60) });

export const OrgUpdateBodySchema = z
  .object({ name: orgName.optional(), kind: orgKind.optional(), settings: z.looseObject({}).optional() })
  .refine((b) => b.name !== undefined || b.kind !== undefined || b.settings !== undefined, { message: "Nothing to update." });

export const EntitlementSchema = z.object({
  key: z.string().trim().regex(ENTITLEMENT_KEY, { message: "Use lowercase letters, digits and underscores." }),
  /** null = unlimited. */
  limit: z.number().int().min(0).max(10_000_000).nullable(),
  period: z.enum(ENTITLEMENT_PERIODS),
});

export const EntitlementsBodySchema = z.object({
  entitlements: z
    .array(EntitlementSchema)
    .max(30)
    .refine((list) => new Set(list.map((e) => e.key)).size === list.length, { message: "Each key can appear once." }),
});

export const OrgOwnerBodySchema = z.object({ email });

export type OrgCreateBody = z.infer<typeof OrgCreateBodySchema>;
export type Entitlement = z.infer<typeof EntitlementSchema>;

// ---- Organisations: invites and joining (plans/m2-org.md O.2) ----

/** Roles an invite can grant. Owners can be invited only by owners (checked in lib/orgInvites.ts). */
export const INVITE_ROLES = ["member", "coach", "admin", "owner"] as const;

const inviteRole = z.enum(INVITE_ROLES).default("member");
const expiresInDays = z.number().int().min(1).max(365).default(14);

/** Member details by field key (branch, year, ...). Which keys are allowed depends on the org, so the server checks that. */
const attributes = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), z.string().trim().max(80))
  .refine((a) => Object.keys(a).length <= 6, { message: "Too many details." })
  .default({});

export const InviteCreateBodySchema = z.discriminatedUnion("kind", [
  // One invite per email, each usable once by that email. Also what a CSV upload sends.
  z.object({ kind: z.literal("email"), emails: z.array(email).min(1).max(500), role: inviteRole, expiresInDays, attributes }),
  // A reusable code; optionally capped. Join codes can be limited to the org's email domains.
  z.object({ kind: z.literal("code"), role: inviteRole, expiresInDays, maxUses: z.number().int().min(1).max(100_000).nullable().default(null), attributes }),
]);

/** Many people at once, each optionally placed in a section (a path from the top) and with details pre-filled. */
export const BulkInviteBodySchema = z.object({
  rows: z
    .array(z.object({ email, section: z.array(z.string().trim().min(1).max(120)).max(3).nullable().default(null), attributes }))
    .min(1)
    .max(500),
  role: inviteRole,
  expiresInDays,
});

export const JoinBodySchema = z.object({ shareLevel: z.enum(["activity", "scores", "full"]), attributes });

export type InviteCreateBody = z.infer<typeof InviteCreateBodySchema>;
export type BulkInviteBody = z.infer<typeof BulkInviteBodySchema>;

// ---- Organisations: cohorts and assignments (plans/m2-org.md O.5) ----

export const CohortCreateBodySchema = z.object({ name: z.string().trim().min(1, { message: "Enter a name." }).max(120), parentId: z.uuid().nullable().default(null) });
export const CohortUpdateBodySchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional(), parentId: z.uuid().nullable().optional() })
  .refine((b) => b.name !== undefined || b.archived !== undefined || b.parentId !== undefined, { message: "Nothing to update." });

/** Ad-hoc groups: a name, and optionally the full list of members (replaces the current list). */
export const GroupCreateBodySchema = z.object({ name: z.string().trim().min(1, { message: "Enter a name." }).max(120), memberIds: z.array(z.uuid()).max(2000).default([]) });
export const GroupUpdateBodySchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional(), memberIds: z.array(z.uuid()).max(2000).optional() })
  .refine((b) => b.name !== undefined || b.archived !== undefined || b.memberIds !== undefined, { message: "Nothing to update." });
export const MemberCohortBodySchema = z.object({ cohortId: z.uuid().nullable() });
/** Role and/or cohort for one member (plans/m2-org.md O.6). */
export const MemberUpdateBodySchema = z
  .object({ role: z.enum(INVITE_ROLES).optional(), cohortId: z.uuid().nullable().optional() })
  .refine((b) => b.role !== undefined || b.cohortId !== undefined, { message: "Nothing to update." });

export const AssignmentCreateBodySchema = z.object({
  title: z.string().trim().min(1, { message: "Enter a title." }).max(200),
  packId: z.string().trim().min(1).max(100),
  /** null = everyone in the org (unless a group is chosen). A cohort covers its sections below it too. */
  cohortId: z.uuid().nullable().default(null),
  /** A group instead of a cohort. */
  groupId: z.uuid().nullable().default(null),
  /** ISO date-time; null = no due date. */
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
  targetMockCount: z.number().int().min(1).max(50).default(1),
}).refine((b) => !(b.cohortId && b.groupId), { message: "Pick a cohort or a group, not both." });

export type AssignmentCreateBody = z.infer<typeof AssignmentCreateBodySchema>;
