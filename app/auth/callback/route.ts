import { NextResponse } from "next/server";
import { getSupabaseForRequest } from "@/lib/supabase-server";
import { ensureTermsConsent } from "@/lib/userData";

/** Google sends the user back here: swap the code for a session, record terms consent, go home. */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  const failed = new URL("/sign-in?error=google", req.url);
  if (!code) return NextResponse.redirect(failed);

  const supabase = await getSupabaseForRequest();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(failed);

  await ensureTermsConsent(supabase, data.user.id);
  return NextResponse.redirect(new URL("/", req.url));
}
