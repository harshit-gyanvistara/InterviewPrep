import { NextResponse } from "next/server";
import { authMode } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { getSupabaseForRequest } from "@/lib/supabase-server";

/** Ends this device's session and clears the cookies. */
export async function POST() {
  try {
    if (authMode() === "supabase") await (await getSupabaseForRequest()).auth.signOut({ scope: "local" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
