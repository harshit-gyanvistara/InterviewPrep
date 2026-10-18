import { authMode, requireUser } from "./auth";
import { ApiError } from "./liveAgent";
import { getSupabaseForRequest } from "./supabase-server";
import { isUserCollection } from "./userData";

// Server-only. Shared by /api/db/[collection] and /api/db/[collection]/[id].

/** The signed-in user, a known collection, and their session-scoped Supabase client (404 / 401 otherwise). */
export async function openUserCollection(ctx: { params: Promise<{ collection: string }> }) {
  if (authMode() !== "supabase") throw new ApiError(404, "Server storage needs sign-in, which is turned off on this server.");
  const { collection } = await ctx.params;
  if (!isUserCollection(collection)) throw new ApiError(404, `Unknown collection "${collection}".`);
  const user = await requireUser();
  return { collection, user, supabase: await getSupabaseForRequest() };
}
