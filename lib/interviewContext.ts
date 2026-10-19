import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authMode, type AuthUser } from "./auth";
import { getCatalog } from "./catalog-server";
import { ApiError, type AgentMeta } from "./liveAgent";
import { checkOrgPractice } from "./orgPractice";
import { InterviewContextSchema, type InterviewContext } from "./schemas";
import { getSupabaseForRequest } from "./supabase-server";
import type { Message, Pack } from "./types";

// Server-only. The context of one interview for /api/interview/turn and /report (M2.3, M2.6,
// plans/session-versioning-and-trusted-context.md). Signed in, everything comes from the database:
// the session row, the profile, and the pack frozen on the session's first AI call. The browser's
// copy is used only with AUTH_MODE=off, where there is no server copy.

/** Which call is versioned: a key of `sessions.prompt_versions`. */
export type InterviewCall = "turn" | "report";

export interface LoadedInterview extends Omit<InterviewContext, "messages"> {
  messages: Message[];
  /** The org this interview is practised for (server-stamped), or null for solo practice. */
  orgId: string | null;
  /** Saves the transcript and code, and stamps the versions that produced this call. No-op with sign-in off. */
  save(change: { messages?: Message[]; code: string; call: InterviewCall; meta: AgentMeta }): Promise<void>;
}

interface SessionRow {
  data: Record<string, unknown> & { config?: { packId?: unknown; orgId?: unknown }; messages?: unknown };
  org_id: string | null;
  pack_snapshot: Pack | null;
  prompt_versions: Partial<Record<InterviewCall, string>> | null;
  model_ids: string[] | null;
}

/** Short, stable id for a rubric, so reports scored against different rubrics can be told apart. */
export const rubricVersion = (rubric: string[]) => createHash("sha256").update(JSON.stringify(rubric)).digest("hex").slice(0, 12);

export async function loadInterview(user: AuthUser, sessionId: string, browserContext: InterviewContext | undefined): Promise<LoadedInterview> {
  if (authMode() !== "supabase") {
    if (!browserContext) throw new ApiError(400, "Missing interview context.");
    // The browser's messages carry no ids here; the turn route only needs them for retries, which save nothing.
    const messages = browserContext.messages.map((m, i) => ({ ...m, id: `local-${i}`, at: 0 }));
    return { ...browserContext, messages, orgId: null, save: async () => {} };
  }

  const supabase = await getSupabaseForRequest();
  const [session, profile] = await Promise.all([
    supabase.from("sessions").select("data, org_id, pack_snapshot, prompt_versions, model_ids").eq("user_id", user.id).eq("id", sessionId).maybeSingle<SessionRow>(),
    supabase.from("profiles").select("data").eq("user_id", user.id).maybeSingle<{ data: unknown }>(),
  ]);
  if (session.error) throw new Error(`sessions read failed: ${session.error.message}`);
  if (profile.error) throw new Error(`profiles read failed: ${profile.error.message}`);
  // Usually the session's first save is still in the browser's retry queue; the client retries.
  if (!session.data) throw new ApiError(409, "Still saving your interview. Try again in a moment.");
  if (!profile.data) throw new ApiError(400, "Finish your profile before starting an interview.");

  const row = session.data;
  const pack = row.pack_snapshot ?? (await resolvePack(supabase, user.id, row.data.config?.packId));
  const parsed = InterviewContextSchema.safeParse({ config: row.data.config, profile: profile.data.data, pack, messages: row.data.messages });
  if (!parsed.success) throw new ApiError(422, "This interview's saved data is invalid.");
  // Keep the stored messages whole (ids, timestamps); the parsed copy drops them.
  const stored = (Array.isArray(row.data.messages) ? row.data.messages : []) as Message[];

  // Practising for an org (plans/m2-org.md O.4): checked and stamped once, on the first AI call.
  // Afterwards the stamped column is the truth; the browser's config can't move a session.
  const requested = row.data.config?.orgId;
  const stampOrg = !row.org_id && stored.length === 0 && typeof requested === "string" && requested ? requested : null;
  if (stampOrg) await checkOrgPractice(user, stampOrg, pack);
  const orgId = row.org_id ?? stampOrg;

  return {
    ...parsed.data,
    messages: stored,
    orgId,
    async save({ messages, code, call, meta }) {
      const data = { ...row.data, code, ...(messages ? { messages } : {}) };
      const { error } = await supabase
        .from("sessions")
        .update({
          data,
          pack_snapshot: pack,
          rubric_version: rubricVersion(pack.rubric),
          prompt_versions: meta.promptVersion ? { ...row.prompt_versions, [call]: meta.promptVersion } : row.prompt_versions,
          model_ids: [...new Set([...(row.model_ids ?? []), ...meta.models])],
          ...(stampOrg ? { org_id: stampOrg } : {}),
        })
        .eq("user_id", user.id)
        .eq("id", sessionId);
      if (error) throw new Error(`sessions write failed: ${error.message}`);
    },
  };
}

/** The pack a session names: the built-in catalog first, then the user's own rounds. */
async function resolvePack(supabase: SupabaseClient, userId: string, packId: unknown): Promise<Pack> {
  if (typeof packId !== "string") throw new ApiError(422, "This interview's saved data is invalid.");
  const builtIn = (await getCatalog()).packs.find((p) => p.id === packId);
  if (builtIn) return builtIn;
  const { data, error } = await supabase.from("custom_packs").select("data").eq("user_id", userId).eq("id", packId).maybeSingle<{ data: Pack }>();
  if (error) throw new Error(`custom_packs read failed: ${error.message}`);
  if (!data) throw new ApiError(404, "This interview's round no longer exists.");
  return data.data;
}
