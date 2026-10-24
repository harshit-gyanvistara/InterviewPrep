import { NextResponse } from "next/server";
import { authMode, requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { adminDb } from "@/lib/orgAdmin";
import { myPlans } from "@/lib/orgTrajectories";

// The signed-in member's plans: each stage with their progress and what to do next (plans/b2b-college.md B.6).

export async function GET() {
  try {
    const user = await requireUser();
    if (authMode() !== "supabase") return NextResponse.json({ plans: [] });
    return NextResponse.json({ plans: await myPlans(adminDb(), user) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
