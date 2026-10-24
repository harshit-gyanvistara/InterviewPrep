import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/liveAgent";
import { sendMail } from "@/lib/notify";
import { adminDb } from "@/lib/orgAdmin";
import { orgForMember } from "@/lib/orgInvites";
import { nudge } from "@/lib/orgReminders";
import { enforceRateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/route";
import { NudgeBodySchema } from "@/lib/schemas";

// Email a reminder to members who are behind (plans/b2b-college.md B.10). Needs assignments.create; a coach
// only for members in their own part. At most once a day per person per assignment; audited.

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const user = await requireUser();
    await enforceRateLimit(req, "org.nudge", { userId: user.id });
    const db = adminDb();
    const org = await orgForMember(db, user, (await ctx.params).slug);
    const { targets } = await parseBody(req, NudgeBodySchema);
    return NextResponse.json(await nudge(db, user, org, targets, Date.now(), sendMail));
  } catch (e) {
    return errorResponse(e);
  }
}
