import { NextResponse } from "next/server";
import { authMode, requireUser } from "@/lib/auth";
import { ApiError, errorResponse } from "@/lib/liveAgent";
import { parseBody } from "@/lib/route";
import { getSupabaseForRequest } from "@/lib/supabase-server";
import { USER_COLLECTIONS, isUserCollection, listItems, putItem, removeItems } from "@/lib/userData";

// The signed-in user's server-side collections (implementationPlan M2.4), read and written by
// remoteCollection in lib/db.ts. Only `profile` lives here so far (plans/auth.md).

type Ctx = { params: Promise<{ collection: string }> };

async function open(ctx: Ctx) {
  if (authMode() !== "supabase") throw new ApiError(404, "Server storage needs sign-in, which is turned off on this server.");
  const { collection } = await ctx.params;
  if (!isUserCollection(collection)) throw new ApiError(404, `Unknown collection "${collection}".`);
  const user = await requireUser();
  return { collection, user, supabase: await getSupabaseForRequest() };
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { collection, user, supabase } = await open(ctx);
    return NextResponse.json({ items: await listItems(supabase, collection, user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { collection, user, supabase } = await open(ctx);
    const item = await parseBody(req, USER_COLLECTIONS[collection].schema);
    await putItem(supabase, collection, user.id, item);
    return NextResponse.json({ item });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { collection, user, supabase } = await open(ctx);
    await removeItems(supabase, collection, user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
