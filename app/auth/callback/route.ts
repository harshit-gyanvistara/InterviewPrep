import { NextResponse } from "next/server";
import { isBetaAllowed } from "@/lib/emailPolicy";
import { getSupabaseForRequest } from "@/lib/supabase-server";
import { ensureTermsConsent } from "@/lib/userData";

/**
 * Google, and the link in a sign-in email, send the user back here: swap the code for a session
 * (PKCE, so only in the browser that started sign-in), record terms consent, go home.
 */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  const failed = new URL("/sign-in?error=callback", req.url);
  if (!code) return NextResponse.redirect(failed);

  const supabase = await getSupabaseForRequest();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(failed);
  if (!isBetaAllowed(data.user.email)) {
    // Google can create the account before we see the email; end the session so it can't be used.
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/sign-in?error=beta", req.url));
  }

  await ensureTermsConsent(supabase, data.user.id);
  return NextResponse.redirect(new URL("/", req.url));
}
