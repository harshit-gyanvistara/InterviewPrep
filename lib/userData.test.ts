import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { putItem } from "./userData";

// Reports take their org from their session on the server (plans/m2-org.md O.4).

function fakeDb(session: Record<string, unknown> | null) {
  const upserts: { table: string; row: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: table === "sessions" ? session : null, error: null }),
        upsert: async (row: Record<string, unknown>) => (upserts.push({ table, row }), { error: null }),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, upserts };
}

describe("putItem for reports", () => {
  it("copies org and assignment from the report's session", async () => {
    const { db, upserts } = fakeDb({ org_id: "org-1", assignment_id: "as-1" });
    await putItem(db, "reports", "u1", { id: "r1", sessionId: "s1" } as { id: string });
    expect(upserts[0].row).toMatchObject({ user_id: "u1", id: "r1", org_id: "org-1", assignment_id: "as-1" });
  });

  it("leaves solo reports without an org, and ignores an org the browser sends", async () => {
    const { db, upserts } = fakeDb({ org_id: null, assignment_id: null });
    await putItem(db, "reports", "u1", { id: "r1", sessionId: "s1", org_id: "forged" } as { id: string });
    expect(upserts[0].row).not.toHaveProperty("org_id");
    expect((upserts[0].row.data as Record<string, unknown>).org_id).toBe("forged"); // stays inside data only, never the column
  });

  it("doesn't touch other collections", async () => {
    const { db, upserts } = fakeDb({ org_id: "org-1" });
    await putItem(db, "notes", "u1", { id: "n1", sessionId: "s1" } as { id: string });
    expect(upserts[0].row).not.toHaveProperty("org_id");
  });
});
