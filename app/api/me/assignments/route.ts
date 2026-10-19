import { NextResponse } from "next/server";
import { authMode, requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { myAssignments } from "@/lib/orgCohorts";

// The signed-in member's open assignments across their organisations, with their progress (plans/m2-org.md O.5).

export async function GET() {
  try {
    const user = await requireUser();
    if (authMode() !== "supabase") return NextResponse.json({ assignments: [] });
    return NextResponse.json({ assignments: await myAssignments(adminDb(), user) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
