import { NextResponse } from "next/server";
import { authMode, requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { myOrgs } from "@/lib/orgMembership";

// The organisations the signed-in user belongs to, with their role and sharing choice (plans/m2-org.md O.3).

export async function GET() {
  try {
    const user = await requireUser();
    if (authMode() !== "supabase") return NextResponse.json({ orgs: [] });
    return NextResponse.json({ orgs: await myOrgs(adminDb(), user) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
