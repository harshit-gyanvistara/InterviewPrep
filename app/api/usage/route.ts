import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { MeterSchema } from "@/lib/packages";
import { checkEntitlement, packageFor } from "@/lib/policies";

/** The signed-in user's allowances: used, limit and reset time per meter (plans/usage-limits.md). */
export async function GET() {
  try {
    const user = await requireUser();
    const meters = await Promise.all(MeterSchema.options.map((m) => checkEntitlement(user, m)));
    return NextResponse.json({ package: packageFor(user), meters }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
