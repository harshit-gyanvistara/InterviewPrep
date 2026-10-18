import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/liveAgent";
import { removeItems } from "@/lib/userData";
import { openUserCollection as open } from "@/lib/userCollectionRoute";

type Ctx = { params: Promise<{ collection: string; id: string }> };

/** Deletes one of the signed-in user's items (plans/server-history.md). */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { collection, user, supabase } = await open(ctx);
    const { id } = await ctx.params;
    await removeItems(supabase, collection, user.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
