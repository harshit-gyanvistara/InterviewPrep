import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "./auth";
import { INVITE_DAYS, inviteLink, newInviteToken } from "./invites";
import { ApiError } from "./liveAgent";
import type { Entitlement, OrgCreateBody } from "./schemas";
import { getSupabaseAdmin } from "./supabase";

// Server-only. What the super-admin page does to orgs (plans/m2-org.md O.1): create them, set their
// plan (entitlements) and settings, and name owners. Callers have already passed requireSuperAdmin();
// everything runs on the secret-key client and every change is written to audit_logs.

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  kind: string;
  createdAt: string;
  activeMembers: number;
  entitlements: Entitlement[];
}

export interface OrgDetail extends OrgSummary {
  settings: Record<string, unknown>;
  people: { userId: string; email: string | null; role: string; status: string }[];
  pendingInvites: { id: string; email: string | null; role: string; expiresAt: string | null }[];
  audit: { action: string; actorEmail: string | null; details: unknown; createdAt: string }[];
}

/** The secret-key client, or 503 when SUPABASE_SECRET_KEY isn't set. */
export function adminDb(): SupabaseClient {
  const db = getSupabaseAdmin();
  if (!db) throw new ApiError(503, "Organisation admin needs SUPABASE_SECRET_KEY on the server.");
  return db;
}

const fail = (what: string, error: { message: string; code?: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

interface EntRow {
  org_id: string;
  key: string;
  limit: number | null;
  period: string;
}

const toEnt = (r: EntRow): Entitlement => ({ key: r.key, limit: r.limit, period: r.period as Entitlement["period"] });

export async function audit(db: SupabaseClient, row: { orgId: string | null; actor: AuthUser; action: string; targetUserId?: string; details?: unknown }) {
  const { error } = await db.from("audit_logs").insert({
    org_id: row.orgId,
    actor_id: row.actor.id,
    action: row.action,
    target_user_id: row.targetUserId ?? null,
    details: row.details ?? {},
  });
  fail("audit_logs insert", error);
}

export async function listOrgs(db: SupabaseClient): Promise<OrgSummary[]> {
  const [orgs, members, ents] = await Promise.all([
    db.from("organizations").select("id, name, slug, kind, created_at").order("created_at", { ascending: false }),
    db.from("memberships").select("org_id").eq("status", "active"),
    db.from("entitlements").select("org_id, key, limit, period").order("key"),
  ]);
  fail("organizations read", orgs.error);
  fail("memberships read", members.error);
  fail("entitlements read", ents.error);
  return (orgs.data ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    kind: o.kind,
    createdAt: o.created_at,
    activeMembers: (members.data ?? []).filter((m) => m.org_id === o.id).length,
    entitlements: ((ents.data ?? []) as EntRow[]).filter((e) => e.org_id === o.id).map(toEnt),
  }));
}

export async function getOrg(db: SupabaseClient, orgId: string): Promise<OrgDetail> {
  const { data: org, error } = await db.from("organizations").select("id, name, slug, kind, settings, created_at").eq("id", orgId).maybeSingle();
  fail("organizations read", error);
  if (!org) throw new ApiError(404, "Organisation not found.");
  const [people, ents, invites, logs] = await Promise.all([
    db.from("memberships").select("user_id, role, status, users(email)").eq("org_id", orgId).order("joined_at"),
    db.from("entitlements").select("org_id, key, limit, period").eq("org_id", orgId).order("key"),
    db.from("invites").select("id, email, role, expires_at, max_uses, uses").eq("org_id", orgId).order("created_at", { ascending: false }),
    db.from("audit_logs").select("action, details, created_at, users!audit_logs_actor_id_fkey(email)").eq("org_id", orgId).order("created_at", { ascending: false }).limit(50),
  ]);
  fail("memberships read", people.error);
  fail("entitlements read", ents.error);
  fail("invites read", invites.error);
  fail("audit_logs read", logs.error);
  const email = (u: unknown) => (u && typeof u === "object" && "email" in u ? ((u as { email: string | null }).email ?? null) : null);
  const now = Date.now();
  const peopleRows = people.data ?? [];
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    kind: org.kind,
    createdAt: org.created_at,
    settings: (org.settings ?? {}) as Record<string, unknown>,
    activeMembers: peopleRows.filter((p) => p.status === "active").length,
    entitlements: ((ents.data ?? []) as EntRow[]).map(toEnt),
    people: peopleRows.map((p) => ({ userId: p.user_id, email: email(p.users), role: p.role, status: p.status })),
    pendingInvites: (invites.data ?? [])
      .filter((i) => (!i.expires_at || Date.parse(i.expires_at) > now) && (i.max_uses === null || i.uses < i.max_uses))
      .map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expires_at })),
    audit: (logs.data ?? []).map((l) => ({ action: l.action, actorEmail: email(l.users), details: l.details, createdAt: l.created_at })),
  };
}

/**
 * Makes `email` an owner of the org: straight away if they already have an account, otherwise an
 * owner invite bound to that email (link shown once; joining arrives in O.2).
 */
export async function addOwner(db: SupabaseClient, actor: AuthUser, orgId: string, email: string): Promise<{ added: true } | { invited: true; link: string }> {
  const { data: user, error } = await db.from("users").select("id").eq("email", email).maybeSingle();
  fail("users read", error);
  if (user) {
    const { error: e } = await db.from("memberships").upsert({ org_id: orgId, user_id: user.id, role: "owner", status: "active" }, { onConflict: "org_id,user_id" });
    fail("memberships upsert", e);
    await audit(db, { orgId, actor, action: "owner.added", targetUserId: user.id, details: { email } });
    return { added: true };
  }
  const { token, hash } = newInviteToken();
  const { error: e } = await db.from("invites").insert({
    org_id: orgId,
    email,
    token_hash: hash,
    role: "owner",
    max_uses: 1,
    expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
    created_by: actor.id,
  });
  fail("invites insert", e);
  await audit(db, { orgId, actor, action: "owner.invited", details: { email } });
  return { invited: true, link: inviteLink(token) };
}

export async function createOrg(db: SupabaseClient, actor: AuthUser, body: OrgCreateBody) {
  const { data, error } = await db.from("organizations").insert({ name: body.name, slug: body.slug, kind: body.kind }).select("id").single();
  if (error?.code === "23505") throw new ApiError(409, `The address "${body.slug}" is taken. Pick another.`);
  fail("organizations insert", error);
  await audit(db, { orgId: data!.id, actor, action: "org.created", details: { name: body.name, slug: body.slug, kind: body.kind } });
  const owner = body.ownerEmail ? await addOwner(db, actor, data!.id, body.ownerEmail) : null;
  return { id: data!.id as string, owner };
}

export async function updateOrg(db: SupabaseClient, actor: AuthUser, orgId: string, patch: { name?: string; kind?: string; settings?: Record<string, unknown> }) {
  const { data, error } = await db.from("organizations").update(patch).eq("id", orgId).select("id");
  fail("organizations update", error);
  if (!data?.length) throw new ApiError(404, "Organisation not found.");
  await audit(db, { orgId, actor, action: "org.updated", details: patch });
}

/** What to upsert and which keys to delete so the org's entitlements become exactly `next`. */
export function entitlementChanges(current: Entitlement[], next: Entitlement[]): { upsert: Entitlement[]; remove: string[] } {
  const same = (a: Entitlement, b: Entitlement) => a.limit === b.limit && a.period === b.period;
  return {
    upsert: next.filter((n) => {
      const c = current.find((x) => x.key === n.key);
      return !c || !same(c, n);
    }),
    remove: current.filter((c) => !next.some((n) => n.key === c.key)).map((c) => c.key),
  };
}

/** Replaces the org's plan with `next` (set by hand now, D13; billing writes the same rows in M6). */
export async function setEntitlements(db: SupabaseClient, actor: AuthUser, orgId: string, next: Entitlement[]) {
  const { data: org, error: orgError } = await db.from("organizations").select("id").eq("id", orgId).maybeSingle();
  fail("organizations read", orgError);
  if (!org) throw new ApiError(404, "Organisation not found.");
  const { data, error } = await db.from("entitlements").select("org_id, key, limit, period").eq("org_id", orgId);
  fail("entitlements read", error);
  const { upsert, remove } = entitlementChanges(((data ?? []) as EntRow[]).map(toEnt), next);
  if (upsert.length) {
    const rows = upsert.map((e) => ({ org_id: orgId, key: e.key, limit: e.limit, period: e.period, source: "manual" }));
    fail("entitlements upsert", (await db.from("entitlements").upsert(rows, { onConflict: "org_id,key" })).error);
  }
  if (remove.length) fail("entitlements delete", (await db.from("entitlements").delete().eq("org_id", orgId).in("key", remove)).error);
  if (upsert.length || remove.length) await audit(db, { orgId, actor, action: "entitlements.set", details: { upsert, remove } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `[orgId]` route param, or 404 when it isn't a uuid (so it never reaches the database). */
export async function orgIdFrom(ctx: { params: Promise<{ orgId: string }> }): Promise<string> {
  const { orgId } = await ctx.params;
  if (!UUID.test(orgId)) throw new ApiError(404, "Organisation not found.");
  return orgId;
}
