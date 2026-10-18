import { NextResponse } from "next/server";
import type { AuthUser } from "./auth";
import type { DomainProfile } from "./domains";
import type { components } from "./liveAgent.types";
import { PERSONAS } from "./packs";
import type { Persona } from "./types";
import { parseUsageHeader, recordUsage } from "./usage";

// Server-only. Client for liveAgent, the Python AI service (liveAgent/ in this repo). Every Gemini
// call goes through it; this app never holds the Gemini key. The request/response types are
// generated from liveAgent/openapi.json (`npm run agent:types`).

export type Agent = components["schemas"];

export class ApiError extends Error {
  /** Per-field validation errors (see parseBody in lib/route.ts). */
  issues?: { path: string; message: string }[];
  /** Sent as the Retry-After header (see lib/rateLimit.ts). */
  retryAfterSec?: number;

  constructor(
    public status: number,
    message: string,
    opts: { issues?: ApiError["issues"]; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.issues = opts.issues;
    this.retryAfterSec = opts.retryAfterSec;
  }
}

/**
 * POST `body` (or GET when undefined) to liveAgent and return its JSON. Errors keep liveAgent's
 * status and message. The Gemini usage liveAgent reports is recorded against `user`, on errors too.
 */
export async function callAgent<T>(path: string, body: unknown, opts: { user: AuthUser; timeoutMs?: number }): Promise<T> {
  const base = process.env.LIVE_AGENT_URL;
  if (!base) throw new ApiError(503, "LIVE_AGENT_URL is not set. Add it to .env.local and restart the dev server.");

  const requestId = crypto.randomUUID();
  let res: Response;
  try {
    res = await fetch(new URL(path, base), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LIVE_AGENT_TOKEN ?? ""}`,
        "X-Request-Id": requestId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") throw new ApiError(504, "The AI service took too long to answer. Try again.");
    throw new ApiError(503, `AI service unreachable at ${base}. Is liveAgent running (npm run agent)?`);
  }

  recordUsage({ userId: opts.user.id, route: path, requestId, status: res.status }, parseUsageHeader(res.headers.get("X-LLM-Usage")));

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string }).error || `AI service error (${res.status})`);
  return json as T;
}

/** The field-profile text liveAgent needs; the catalog and field inference stay in this app. */
export const agentDomain = (d: DomainProfile): Agent["DomainIn"] => ({
  id: d.id,
  interviewerContext: d.interviewerContext,
  scoringContext: d.scoringContext,
  roundHints: d.roundHints,
  roadmapHints: d.roadmapHints,
  version: d.version,
});

export const agentPersona = (p: Persona): Agent["PersonaIn"] => ({ name: PERSONAS[p].name, tone: PERSONAS[p].tone });

/** The `{ error, issues? }` + status shape every /api route returns on failure (plus Retry-After on 429). */
export function errorResponse(e: unknown) {
  const status = e instanceof ApiError ? e.status : 500;
  const issues = e instanceof ApiError ? e.issues : undefined;
  const retryAfter = e instanceof ApiError ? e.retryAfterSec : undefined;
  return NextResponse.json(
    { error: e instanceof Error ? e.message : "Unknown error", ...(issues && { issues }) },
    { status, headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined },
  );
}
