import { z } from "zod";

// Server-only. Who used which model, and how much (plans/usage-capture.md). liveAgent measures every
// Gemini call and returns the records in the `X-LLM-Usage` response header; Core knows the user, so
// it records them here. `recordUsage` is the one place M2 changes to write `usage_ledger` rows.

const LlmUsageSchema = z.object({
  task: z.string(),
  model: z.string(),
  ms: z.number(),
  inputTokens: z.number(),
  /** Part of the input served from Gemini's prompt cache at a discount. */
  cachedTokens: z.number(),
  outputTokens: z.number(),
  /** Thinking tokens, billed as output. */
  thoughtTokens: z.number(),
  /** False when the call failed; a response that failed validation was still billed. */
  ok: z.boolean(),
});

export type LlmUsage = z.infer<typeof LlmUsageSchema>;

export interface UsageContext {
  userId: string;
  /** The liveAgent path, e.g. `/v1/interview/turn`. */
  route: string;
  /** Sent to liveAgent as `X-Request-Id`; its `llm.usage` lines carry the same id. */
  requestId: string;
  /** liveAgent's HTTP status. */
  status: number;
}

/** The records in an `X-LLM-Usage` header. Never throws: a bad header must not fail the user's request. */
export function parseUsageHeader(value: string | null): LlmUsage[] {
  if (!value) return [];
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    json = undefined;
  }
  const parsed = z.array(LlmUsageSchema).safeParse(json);
  if (parsed.success) return parsed.data;
  console.error(JSON.stringify({ event: "ai.usage.invalid", header: value.slice(0, 200) }));
  return [];
}

/** One `ai.usage` log line per Gemini call. M2: insert into `usage_ledger` instead. */
export function recordUsage(ctx: UsageContext, calls: LlmUsage[]) {
  for (const call of calls) console.log(JSON.stringify({ event: "ai.usage", ...ctx, ...call }));
}
