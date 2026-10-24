import { NextResponse } from "next/server";
import { authMode, requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { myOrgPacks } from "@/lib/orgPacks";

// The rounds owned by the organisations the signed-in user belongs to (plans/b2b-college.md B.5).

export async function GET() {
  try {
    const user = await requireUser();
    if (authMode() !== "supabase") return NextResponse.json({ packs: [] });
    return NextResponse.json({ packs: await myOrgPacks(adminDb(), user) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
