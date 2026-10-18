import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/liveAgent";
import { openUserCollection as open } from "@/lib/userCollectionRoute";
import { parseBody } from "@/lib/route";
import { USER_COLLECTIONS, listItems, putItem, removeItems } from "@/lib/userData";

// The signed-in user's server-side collections (implementationPlan M2.4, plans/server-history.md),
// read and written by remoteCollection / remoteSingleton in lib/db.ts. GET lists, PUT upserts one
// item by id, DELETE clears the collection (the profile); /api/db/[collection]/[id] deletes one item.

type Ctx = { params: Promise<{ collection: string }> };

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
