import { NextResponse } from "next/server";
import { authMode } from "@/lib/auth";
import { ApiError, errorResponse } from "@/lib/liveAgent";
import { enforceRateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/route";
import { VerifyOtpBodySchema } from "@/lib/schemas";
import { getSupabaseForRequest } from "@/lib/supabase-server";
import { ensureTermsConsent } from "@/lib/userData";

/** Step 2 of email sign-in: check the code, set the session cookies, record terms consent. */
export async function POST(req: Request) {
  try {
    if (authMode() !== "supabase") throw new ApiError(404, "Sign-in is turned off on this server.");
    await enforceRateLimit(req, "auth.verify");
    const { email, code } = await parseBody(req, VerifyOtpBodySchema);

    const supabase = await getSupabaseForRequest();
    const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error || !data.user) throw new ApiError(400, "That code is wrong or has expired.");

    // The sign-in page says that continuing means agreeing to the terms.
    await ensureTermsConsent(supabase, data.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
