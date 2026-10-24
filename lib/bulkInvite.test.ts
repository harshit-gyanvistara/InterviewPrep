import { describe, expect, it } from "vitest";
import { MAX_BULK_ROWS, parseInviteRows, sectionPath, splitLine } from "./bulkInvite";
import type { StudentField } from "./orgSettings";

const FIELDS: StudentField[] = [
  { key: "branch", label: "Branch", required: true },
  { key: "year", label: "Graduation year", required: false },
];

describe("splitLine", () => {
  it("handles commas, tabs and quoted cells", () => {
    expect(splitLine('a@x.com, "CSE, 2027" ,A')).toEqual(["a@x.com", "CSE, 2027", "A"]);
    expect(splitLine("a@x.com\tCSE / 2027")).toEqual(["a@x.com", "CSE / 2027"]);
    expect(splitLine('a@x.com,"say ""hi"""')).toEqual(["a@x.com", 'say "hi"']);
  });
});

describe("sectionPath", () => {
  it("splits on slashes and arrows", () => {
    expect(sectionPath(" CSE / 2027 > A ")).toEqual(["CSE", "2027", "A"]);
    expect(sectionPath("")).toEqual([]);
  });
});

describe("parseInviteRows", () => {
  it("reads email and section without a header", () => {
    const out = parseInviteRows("A@College.edu, CSE / 2027 / A\nb@college.edu\n", FIELDS);
    expect(out.errors).toEqual([]);
    expect(out.rows).toEqual([
      { email: "a@college.edu", section: ["CSE", "2027", "A"], attributes: {} },
      { email: "b@college.edu", section: null, attributes: {} },
    ]);
  });

  it("maps header columns to section and the org's details, by label or key", () => {
    const csv = "Email,Section,Branch,graduation year\nasha@c.edu,CSE/2027,CSE,2027\nravi@c.edu,CSE/2027,,";
    const out = parseInviteRows(csv, FIELDS);
    expect(out.rows[0]).toEqual({ email: "asha@c.edu", section: ["CSE", "2027"], attributes: { branch: "CSE", year: "2027" } });
    expect(out.rows[1].attributes).toEqual({});
  });

  it("reports bad and repeated emails by line and keeps the good rows", () => {
    const out = parseInviteRows("email,section\nok@c.edu,A\nnot-an-email,A\nok@c.edu,B\n\nfine@c.edu,A", FIELDS);
    expect(out.rows.map((r) => r.email)).toEqual(["ok@c.edu", "fine@c.edu"]);
    expect(out.errors).toEqual([
      { line: 3, message: expect.stringContaining("isn't an email") },
      { line: 4, message: expect.stringContaining("more than once") },
    ]);
  });

  it("rejects sections deeper than three levels", () => {
    const out = parseInviteRows("a@c.edu,A/B/C/D", FIELDS);
    expect(out.rows).toEqual([]);
    expect(out.errors[0].message).toMatch(/3 levels/);
  });

  it("refuses a file over the limit", () => {
    const csv = Array.from({ length: MAX_BULK_ROWS + 1 }, (_, i) => `s${i}@c.edu`).join("\n");
    const out = parseInviteRows(csv, FIELDS);
    expect(out.rows).toEqual([]);
    expect(out.errors[0].message).toMatch(/at most/);
  });

  it("handles empty input and an email-only header-less list", () => {
    expect(parseInviteRows("  \n\n", FIELDS)).toEqual({ rows: [], errors: [] });
    expect(parseInviteRows("a@c.edu\nb@c.edu", FIELDS).rows).toHaveLength(2);
  });
});
