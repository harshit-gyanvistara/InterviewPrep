import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cronAuth";
import { errorResponse } from "@/lib/liveAgent";
import { sendMail } from "@/lib/notify";
import { adminDb } from "@/lib/orgAdmin";
import { sendDueReminders } from "@/lib/orgReminders";

// The scheduled reminder run (plans/b2b-college.md B.10): due-soon and overdue emails, each once per person
// per assignment. Call it once a day from any scheduler with `Authorization: Bearer $CRON_SECRET` (Vercel
// Cron sends that header itself when CRON_SECRET is set). Fails closed without the secret.

async function run(req: Request) {
  try {
    requireCronSecret(req.headers.get("authorization"), process.env.CRON_SECRET);
    return NextResponse.json(await sendDueReminders(adminDb(), Date.now(), sendMail));
  } catch (e) {
    return errorResponse(e);
  }
}

export const GET = run;
export const POST = run;
