import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { ApiError } from "./liveAgent";
import { audit } from "./orgAdmin";
import { requireRole, type OrgRef } from "./orgInvites";
import type { OrgPackCreateBody, OrgPackUpdateBody } from "./schemas";
import type { Pack } from "./types";

// Server-only. Rounds an organisation owns (plans/b2b-college.md B.5). Staff with packs.create make
// and edit them; every member of the org can read them. A round is stored as the Pack's own fields
// in `data`; its id, owner and archived flag come from the row.

interface Row {
  id: string;
  org_id: string;
  data: Omit<Pack, "id" | "source" | "orgId" | "archived">;
  archived: boolean | null;
}

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

export const toOrgPack = (r: Row): Pack => ({ ...r.data, domains: r.data.domains ?? "all", id: r.id, source: "org", orgId: r.org_id, archived: !!r.archived });

/** Every round of this org, archived ones too (flagged), for the people who manage them. */
export async function listOrgPacks(db: SupabaseClient, org: OrgRef): Promise<Pack[]> {
  requireRole(org, "packs.create");
  const { data, error } = await db.from("org_packs").select("id, org_id, data, archived").eq("org_id", org.id).order("created_at");
  fail("org_packs read", error);
  return ((data ?? []) as Row[]).map(toOrgPack);
}

export async function createOrgPack(db: SupabaseClient, user: AuthUser, org: OrgRef, body: OrgPackCreateBody): Promise<{ id: string }> {
  requireRole(org, "packs.create");
  const id = `org-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const { error } = await db.from("org_packs").insert({ id, org_id: org.id, data: { ...body, domains: "all" }, created_by: user.id });
  fail("org_packs insert", error);
  await audit(db, { orgId: org.id, actor: user, action: "pack.created", details: { packId: id, title: body.title } });
  return { id };
}

export async function updateOrgPack(db: SupabaseClient, user: AuthUser, org: OrgRef, packId: string, patch: OrgPackUpdateBody) {
  requireRole(org, "packs.create");
  const { data: found, error } = await db.from("org_packs").select("id, org_id, data, archived").eq("org_id", org.id).eq("id", packId).maybeSingle();
  fail("org_packs read", error);
  if (!found) throw new ApiError(404, "Round not found.");
  const { archived, ...fields } = patch;
  const row = found as Row;
  const update: Record<string, unknown> = {};
  if (Object.values(fields).some((v) => v !== undefined)) update.data = { ...row.data, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
  if (archived !== undefined) update.archived = archived;
  const res = await db.from("org_packs").update(update).eq("org_id", org.id).eq("id", packId);
  fail("org_packs update", res.error);
  await audit(db, { orgId: org.id, actor: user, action: "pack.updated", details: { packId, fields: Object.keys(patch) } });
}

/** The rounds of every org the user belongs to (archived ones flagged), so titles resolve on old reports. */
export async function myOrgPacks(db: SupabaseClient, user: AuthUser): Promise<Pack[]> {
  const { data: mems, error } = await db.from("memberships").select("org_id").eq("user_id", user.id).eq("status", "active");
  fail("memberships read", error);
  const orgIds = (mems ?? []).map((m) => m.org_id as string);
  if (!orgIds.length) return [];
  const { data, error: e2 } = await db.from("org_packs").select("id, org_id, data, archived").in("org_id", orgIds).order("created_at");
  fail("org_packs read", e2);
  return ((data ?? []) as Row[]).map(toOrgPack);
}

/** Is this an active (not archived) round of this org? Used when setting assignments. */
export async function orgPackExists(db: SupabaseClient, orgId: string, packId: string): Promise<boolean> {
  const { data, error } = await db.from("org_packs").select("id").eq("org_id", orgId).eq("id", packId).eq("archived", false).maybeSingle();
  fail("org_packs read", error);
  return !!data;
}
