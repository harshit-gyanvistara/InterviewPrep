import { NextResponse } from "next/server";
import { authMode } from "@/lib/auth";
import { BETA_CLOSED_MESSAGE, isBetaAllowed, isBlockedEmail } from "@/lib/emailPolicy";
import { ApiError, errorResponse } from "@/lib/liveAgent";
import { enforceRateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/route";
import { EmailOtpBodySchema } from "@/lib/schemas";
import { getSupabaseForRequest } from "@/lib/supabase-server";

/**
 * Step 1 of email sign-in: send a one-time code. Creates the account on first use. A code typed
 * into the page works the same in a browser and inside the mobile app's WebView (plans/auth.md A1).
 * The email's link also works, in the same browser: it lands on /auth/callback (PKCE; the verifier
 * cookie is set here). That keeps Supabase's default templates usable until they show the code.
 */
export async function POST(req: Request) {
  try {
    if (authMode() !== "supabase") throw new ApiError(404, "Sign-in is turned off on this server.");
    await enforceRateLimit(req, "auth.otp");
    const { email } = await parseBody(req, EmailOtpBodySchema);
    if (isBlockedEmail(email)) throw new ApiError(400, "Use a personal or work email. Temporary inboxes can't sign in.");
    if (!isBetaAllowed(email)) throw new ApiError(403, BETA_CLOSED_MESSAGE);

    const supabase = await getSupabaseForRequest();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: new URL("/auth/callback", req.url).toString() },
    });
    if (error) {
      console.error(JSON.stringify({ event: "auth.otp.error", status: error.status, code: error.code }));
      if (error.status === 429) throw new ApiError(429, "Too many codes requested. Wait a minute and try again.");
      throw new ApiError(502, "Couldn't send the code. Try again in a moment.");
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
