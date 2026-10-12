import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog-server";

/** Fields and the built-in pack library, from Supabase (or the code defaults). Read by useCatalog(). */
export async function GET() {
  return NextResponse.json(await getCatalog(), { headers: { "Cache-Control": "public, max-age=300" } });
}
