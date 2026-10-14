import { NextResponse } from "next/server";
import { authMode, getUser, googleEnabled } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";

/** Who is signed in, and how sign-in works on this server. Read once per page load by lib/db.ts. */
export async function GET() {
  try {
    const user = await getUser();
    return NextResponse.json({ mode: authMode(), user, google: googleEnabled() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
