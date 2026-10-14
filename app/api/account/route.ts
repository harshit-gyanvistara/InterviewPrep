import { NextResponse } from "next/server";
import { authMode, requireUser } from "@/lib/auth";
import { ApiError, errorResponse } from "@/lib/liveAgent";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSupabaseForRequest } from "@/lib/supabase-server";

/**
 * Deletes the signed-in user's account. Every user table references auth.users with
 * `on delete cascade`, so this removes their server data too; the browser clears its local copy.
 */
export async function DELETE() {
  try {
    if (authMode() !== "supabase") throw new ApiError(404, "There are no accounts on this server.");
    const user = await requireUser();
    const admin = getSupabaseAdmin();
    if (!admin) throw new ApiError(503, "Account deletion needs SUPABASE_SECRET_KEY on the server.");

    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new ApiError(502, `Couldn't delete the account: ${error.message}`);
    // The session is already invalid server-side; this clears the cookies.
    await (await getSupabaseForRequest()).auth.signOut({ scope: "local" }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
