import { NextResponse } from "next/server";
import { googleEnabled } from "@/lib/auth";
import { getSupabaseForRequest } from "@/lib/supabase-server";

/**
 * Starts Google sign-in (web only: Google blocks OAuth inside the mobile app's WebView, so the
 * sign-in page hides the button there). The PKCE verifier is stored in a cookie for /auth/callback.
 */
export async function GET(req: Request) {
  const signIn = new URL("/sign-in", req.url);
  if (!googleEnabled()) return NextResponse.redirect(signIn);

  const supabase = await getSupabaseForRequest();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: new URL("/auth/callback", req.url).toString(), skipBrowserRedirect: true },
  });
  if (error || !data.url) {
    signIn.searchParams.set("error", "callback");
    return NextResponse.redirect(signIn);
  }
  return NextResponse.redirect(data.url);
}
