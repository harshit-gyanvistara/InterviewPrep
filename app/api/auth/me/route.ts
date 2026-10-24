import { NextResponse } from "next/server";
import { authMode, getUser, googleEnabled } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/authz";
import { devLoginEnabled } from "@/lib/devLogin";
import { errorResponse } from "@/lib/liveAgent";

/** Who is signed in, and how sign-in works on this server. Read once per page load by lib/db.ts. */
export async function GET() {
  try {
    const user = await getUser();
    return NextResponse.json({ mode: authMode(), user, google: googleEnabled(), devLogin: devLoginEnabled(), superAdmin: isSuperAdmin(user?.email) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
