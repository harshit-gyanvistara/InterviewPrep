import { NextResponse } from "next/server";
import { devLoginAllowed, devLoginEnabled } from "@/lib/devLogin";
import { ApiError, errorResponse } from "@/lib/liveAgent";
import { parseBody } from "@/lib/route";
import { DevLoginBodySchema } from "@/lib/schemas";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSupabaseForRequest } from "@/lib/supabase-server";
import { ensureTermsConsent } from "@/lib/userData";

/**
 * Local development only (DEV_LOGIN=on, never in production): sign in a super-admin email without an
 * email round-trip. Asks Supabase for a one-time token for that address and redeems it here, so the
 * session is a normal one. Every other case answers 404, as if the route didn't exist.
 */
export async function POST(req: Request) {
  try {
    if (!devLoginEnabled()) throw new ApiError(404, "Not found.");
    const { email } = await parseBody(req, DevLoginBodySchema);
    if (!devLoginAllowed(email)) throw new ApiError(403, "That email isn't in SUPER_ADMIN_EMAILS.");

    const admin = getSupabaseAdmin();
    if (!admin) throw new ApiError(503, "Dev sign-in needs SUPABASE_SECRET_KEY.");
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link.data?.properties?.hashed_token;
    if (link.error || !tokenHash) throw new ApiError(502, `Couldn't prepare a sign-in: ${link.error?.message ?? "no token returned"}.`);

    const supabase = await getSupabaseForRequest();
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (error || !data.user) throw new ApiError(502, `Couldn't finish the sign-in: ${error?.message ?? "no user"}.`);
    await ensureTermsConsent(supabase, data.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
