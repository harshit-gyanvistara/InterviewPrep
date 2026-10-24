import { describe, expect, it } from "vitest";
import { fieldLines, lockedFor, parseFieldLines, resolveAttributes, unknownKeys } from "./memberAttributes";
import { orgSettings, type StudentField } from "./orgSettings";

const FIELDS: StudentField[] = [
  { key: "branch", label: "Branch", required: true },
  { key: "year", label: "Graduation year", required: false },
];

describe("orgSettings.studentFields", () => {
  it("defaults to none and ignores malformed entries", () => {
    expect(orgSettings({}).studentFields).toEqual([]);
    expect(orgSettings({ settings: { studentFields: "nope" } }).studentFields).toEqual([]);
    const messy = [
      { key: "branch", label: " Branch ", required: true },
      { key: "branch", label: "Duplicate", required: false },
      { key: "Bad Key", label: "x", required: false },
      { key: "year", label: "", required: false },
      { key: "program", label: "Program" },
      null,
      "text",
    ];
    expect(orgSettings({ settings: { studentFields: messy } }).studentFields).toEqual([
      { key: "branch", label: "Branch", required: true },
      { key: "program", label: "Program", required: false },
    ]);
  });

  it("keeps at most six", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, required: false }));
    expect(orgSettings({ settings: { studentFields: many } }).studentFields).toHaveLength(6);
  });
});

describe("resolveAttributes", () => {
  it("merges the member's answers with locked values, locked winning", () => {
    expect(resolveAttributes(FIELDS, { branch: "CSE" }, { branch: "ECE", year: " 2027 " })).toEqual({ ok: true, attributes: { branch: "CSE", year: "2027" } });
  });

  it("lists required fields still empty", () => {
    expect(resolveAttributes(FIELDS, {}, { year: "2027" })).toEqual({ ok: false, missing: [FIELDS[0]] });
    expect(resolveAttributes(FIELDS, {}, { branch: "   " })).toMatchObject({ ok: false });
  });

  it("drops keys the org doesn't ask for and caps length", () => {
    const out = resolveAttributes(FIELDS, {}, { branch: "x".repeat(200), hobby: "chess" });
    expect(out.ok && Object.keys(out.attributes)).toEqual(["branch"]);
    expect(out.ok && out.attributes.branch).toHaveLength(80);
  });

  it("needs nothing from an org with no fields", () => {
    expect(resolveAttributes([], {}, { anything: "x" })).toEqual({ ok: true, attributes: {} });
  });
});

describe("invite helpers", () => {
  it("finds keys the org doesn't define", () => {
    expect(unknownKeys(FIELDS, { branch: "CSE", hobby: "chess" })).toEqual(["hobby"]);
    expect(unknownKeys(FIELDS, {})).toEqual([]);
  });

  it("reads an invite's values against the org's current fields", () => {
    expect(lockedFor(FIELDS, { branch: "CSE", removedLater: "x" })).toEqual({ branch: "CSE" });
    expect(lockedFor(FIELDS, null)).toEqual({});
  });
});

describe("admin field text", () => {
  it("reads one field per line, with * for required", () => {
    expect(parseFieldLines("Branch*\nGraduation year\n\n  Roll No. *  \nbranch")).toEqual([
      { key: "branch", label: "Branch", required: true },
      { key: "graduation_year", label: "Graduation year", required: false },
      { key: "roll_no", label: "Roll No.", required: true },
    ]);
  });

  it("skips lines that make no valid key and caps at six", () => {
    expect(parseFieldLines("123\n***\n!!!")).toEqual([]);
    expect(parseFieldLines(Array.from({ length: 9 }, (_, i) => `Field ${String.fromCharCode(97 + i)}`).join("\n"))).toHaveLength(6);
  });

  it("round-trips", () => {
    expect(parseFieldLines(fieldLines(FIELDS), FIELDS)).toEqual(FIELDS);
  });

  it("keeps an existing field's key when its label is unchanged, so saved answers stay attached", () => {
    expect(parseFieldLines("Graduation year\nBranch*", FIELDS)).toEqual([
      { key: "year", label: "Graduation year", required: false },
      { key: "branch", label: "Branch", required: true },
    ]);
    expect(parseFieldLines("graduation YEAR", FIELDS)[0].key).toBe("year");
  });
});
