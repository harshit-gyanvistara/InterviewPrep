import { NextResponse } from "next/server";
import { authMode, getUser, googleEnabled } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/authz";
import { errorResponse } from "@/lib/liveAgent";

/** Who is signed in, and how sign-in works on this server. Read once per page load by lib/db.ts. */
export async function GET() {
  try {
    const user = await getUser();
    const mode = authMode();
    // Tells only the super-admin themselves, so their account menu can link to the admin console.
    const superAdmin = mode === "supabase" && isSuperAdmin(user?.email);
    return NextResponse.json({ mode, user, google: googleEnabled(), superAdmin }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
