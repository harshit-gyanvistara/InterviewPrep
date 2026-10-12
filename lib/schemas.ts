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

export const TurnBodySchema = z.object({
  config: SessionConfigSchema,
  profile: ProfileSchema,
  pack: PackSchema,
  messages,
  elapsedSec: z.number().nonnegative().max(24 * 3600).default(0),
  code,
});

export const ReportBodySchema = z.object({
  config: SessionConfigSchema,
  profile: ProfileSchema,
  pack: PackSchema,
  messages,
  code,
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
export type PackGenerateBody = z.infer<typeof PackGenerateBodySchema>;
export type RoadmapBody = z.infer<typeof RoadmapBodySchema>;
export type AssistBody = z.infer<typeof AssistBodySchema>;
