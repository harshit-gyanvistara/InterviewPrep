import { describe, expect, it } from "vitest";
import { CONTEXT_MAX_CHARS, hasContext, mergeContext, readContext } from "./orgContext";

describe("readContext", () => {
  it("keeps only known string fields, trimmed and capped", () => {
    expect(readContext({ companies: "  TCS ", roles: 7, techStack: "x".repeat(5000), extra: "no" })).toEqual({ companies: "TCS", roles: "", techStack: "x".repeat(CONTEXT_MAX_CHARS), notes: "" });
    expect(readContext(null)).toEqual({ companies: "", roles: "", techStack: "", notes: "" });
    expect(readContext("text")).toEqual({ companies: "", roles: "", techStack: "", notes: "" });
  });

  it("knows when nothing is set", () => {
    expect(hasContext(readContext({}))).toBe(false);
    expect(hasContext(readContext({ notes: "x" }))).toBe(true);
    expect(hasContext(readContext({ notes: "   " }))).toBe(false);
  });
});

describe("mergeContext", () => {
  it("lets the more specific layer win field by field and keeps the rest from above", () => {
    const org = { companies: "TCS, Infosys", roles: "Trainee", techStack: "", notes: "Be kind" };
    const dept = { techStack: "Java, SQL", notes: "" };
    const section = { companies: "Amazon" };
    expect(mergeContext("Sunrise", [org, dept, section])).toEqual({ orgName: "Sunrise", companies: "Amazon", roles: "Trainee", techStack: "Java, SQL", notes: "Be kind" });
  });

  it("is null when no layer sets anything, so interviews carry no context", () => {
    expect(mergeContext("Sunrise", [])).toBeNull();
    expect(mergeContext("Sunrise", [{}, { companies: " " }, null, "junk"])).toBeNull();
  });

  it("ignores junk layers and trims the org name", () => {
    expect(mergeContext("  Sunrise College ", [undefined, { roles: "Analyst" }])).toMatchObject({ orgName: "Sunrise College", roles: "Analyst" });
  });
});
