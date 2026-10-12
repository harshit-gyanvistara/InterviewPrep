import { describe, expect, it } from "vitest";
import { BASELINE_PACK_ID, PACKS, buildMixedPack, getPack, isTechnical, isValidPack, visibleBuiltInPacks } from "./packs";
import type { Pack } from "./types";

const profile = (targetRole: string, extra: { jobDescription?: string; domain?: string } = {}) => ({ jobDescription: "", ...extra, targetRole });
const ids = (packs: Pack[]) => packs.map((p) => p.id);

describe("built-in library", () => {
  it("has unique ids and only valid packs", () => {
    expect(new Set(ids(PACKS)).size).toBe(PACKS.length);
    PACKS.forEach((p) => expect(isValidPack(p), p.id).toBe(true));
  });

  it("contains the baseline pack", () => {
    expect(getPack(BASELINE_PACK_ID)?.id).toBe(BASELINE_PACK_ID);
    expect(getPack("does-not-exist")).toBeUndefined();
  });
});

describe("isTechnical", () => {
  it("is true for software roles", () => {
    expect(isTechnical(profile("Backend Developer"))).toBe(true);
    expect(isTechnical(profile("SDE2"))).toBe(true);
  });

  it("is false for medical and general roles", () => {
    expect(isTechnical(profile("MBBS intern"))).toBe(false);
    expect(isTechnical(profile("Product Manager"))).toBe(false);
  });

  it("falls back to the job description when the role is ambiguous", () => {
    expect(isTechnical(profile("Associate", { jobDescription: "Build REST API services in Go" }))).toBe(true);
  });

  it("honours an explicitly picked field over the guess", () => {
    expect(isTechnical(profile("Software Engineer", { domain: "general" }))).toBe(false);
    expect(isTechnical(profile("Analyst", { domain: "software" }))).toBe(true);
  });
});

describe("visibleBuiltInPacks", () => {
  const universal = ids(PACKS.filter((p) => p.domains === "all"));

  it("shows universal packs plus the profile's field packs", () => {
    const sw = ids(visibleBuiltInPacks(profile("Frontend developer")));
    expect(sw).toEqual(expect.arrayContaining([...universal, "cs-fundamentals", "live-coding"]));
    expect(sw).not.toContain("med-clinical-viva");

    const med = ids(visibleBuiltInPacks(profile("Surgery resident")));
    expect(med).toEqual(expect.arrayContaining([...universal, "med-clinical-viva", "med-mmi-ethics", "med-pg-selection"]));
    expect(med).not.toContain("live-coding");
  });

  it("shows only universal packs for the general field", () => {
    expect(ids(visibleBuiltInPacks(profile("Sales lead")))).toEqual(universal);
  });

  it("lets the org's field override the profile", () => {
    const p = ids(visibleBuiltInPacks(profile("Software Engineer"), undefined, "medical"));
    expect(p).toContain("med-clinical-viva");
    expect(p).not.toContain("live-coding");
  });
});

describe("isValidPack", () => {
  const valid = { title: "T", roundType: "hr", topics: ["a"], rubric: ["b"] };

  it("accepts the minimum shape", () => {
    expect(isValidPack(valid)).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "pack"],
    ["missing title", { ...valid, title: undefined }],
    ["non-string roundType", { ...valid, roundType: 3 }],
    ["empty topics", { ...valid, topics: [] }],
    ["topics not an array", { ...valid, topics: "a" }],
    ["empty rubric", { ...valid, rubric: [] }],
  ])("rejects %s", (_, value) => {
    expect(isValidPack(value)).toBe(false);
  });
});

describe("buildMixedPack", () => {
  const base = (id: string, roundType: Pack["roundType"], topics: string[], rubric: string[]): Pack => ({
    id,
    title: id.toUpperCase(),
    company: `${id}-co`,
    role: `${id}-role`,
    roundType,
    description: "",
    durationMin: 45,
    topics,
    rubric,
    style: `${id} style.`,
    domains: ["software"],
  });
  const opts = { questionCount: 3, durationMin: 15 };

  it("throws with nothing selected", () => {
    expect(() => buildMixedPack([], opts)).toThrow(/at least one/);
  });

  it("builds a short version of a single round", () => {
    const p = buildMixedPack([base("hr", "hr", ["a", "b"], ["x"])], opts);
    expect(p).toMatchObject({
      title: "Quick Mock — HR",
      company: "hr-co",
      role: "hr-role",
      roundType: "hr",
      domains: "all",
      durationMin: 15,
      topics: ["a", "b"],
      rubric: ["x"],
      style: "hr style.",
    });
    expect(p.description).toBe("A quick 3-question, 15-minute version of HR.");
  });

  it("combines several rounds and takes metadata from the first", () => {
    const p = buildMixedPack([base("hr", "hr", ["a"], ["x"]), base("beh", "behavioural", ["b"], ["y"])], opts);
    expect(p.title).toBe("Quick Mock — HR + BEH");
    expect(p.company).toBe("hr-co");
    expect(p.roundType).toBe("hr");
    expect(p.description).toContain("HR, BEH");
    expect(p.style).toContain("For hr-style topics: hr style.");
    expect(p.style).toContain("For beh-style topics: beh style.");
  });

  it("runs the whole session as coding if any round is coding", () => {
    const p = buildMixedPack([base("hr", "hr", ["a"], ["x"]), base("code", "coding", ["b"], ["y"])], opts);
    expect(p.roundType).toBe("coding");
  });

  it("dedupes topics and rubric case-insensitively, trimming whitespace and dropping blanks", () => {
    const p = buildMixedPack([base("a", "hr", [" Teamwork ", "Conflict", ""], ["Clarity"]), base("b", "hr", ["teamwork", "Goals"], ["clarity ", "Depth"])], opts);
    expect(p.topics).toEqual(["Teamwork", "Conflict", "Goals"]);
    expect(p.rubric).toEqual(["Clarity", "Depth"]);
  });

  it("caps topics at max(2 × questions, 8) and rubric at 6", () => {
    const many = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);
    const selected = [base("a", "hr", many("t", 30), many("r", 10))];
    expect(buildMixedPack(selected, { questionCount: 2, durationMin: 10 }).topics).toHaveLength(8);
    expect(buildMixedPack(selected, { questionCount: 6, durationMin: 10 }).topics).toHaveLength(12);
    expect(buildMixedPack(selected, opts).rubric).toHaveLength(6);
  });
});
