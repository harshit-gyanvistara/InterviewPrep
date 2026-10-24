import { describe, expect, it } from "vitest";
import { ancestry, checkParent, depthOf, descendantIds, findByPath, inScope, pathLabel, pathNames, treeOrder, type CohortNode } from "./orgSections";

const n = (id: string, parentId: string | null = null, extra: Partial<CohortNode> = {}): CohortNode => ({ id, name: id.toUpperCase(), parentId, ...extra });
// cse > 2027 > a, b ;  cse > 2028 ;  ece
const TREE = [n("cse"), n("y27", "cse", { name: "2027" }), n("a", "y27"), n("b", "y27"), n("y28", "cse", { name: "2028" }), n("ece")];

describe("tree reads", () => {
  it("builds paths and depth", () => {
    expect(pathLabel(TREE, "a")).toBe("CSE / 2027 / A");
    expect(pathLabel(TREE, "ece")).toBe("ECE");
    expect(pathLabel(TREE, "missing")).toBe("");
    expect(depthOf(TREE, "a")).toBe(3);
  });

  it("lists a node and everything below it", () => {
    expect(descendantIds(TREE, "cse").sort()).toEqual(["a", "b", "cse", "y27", "y28"]);
    expect(descendantIds(TREE, "a")).toEqual(["a"]);
  });

  it("orders parents before children and keeps orphans", () => {
    expect(treeOrder([TREE[2], TREE[0], TREE[1]]).map((x) => x.id)).toEqual(["cse", "y27", "a"]);
    expect(treeOrder([n("kid", "gone")]).map((x) => x.id)).toEqual(["kid"]);
  });

  it("survives a corrupt cycle without looping", () => {
    const loop = [n("x", "y"), n("y", "x")];
    expect(pathNames(loop, "x")).toHaveLength(2);
    expect(descendantIds(loop, "x").sort()).toEqual(["x", "y"]);
  });
});

describe("ancestry", () => {
  it("lists the node and its parents from the top down", () => {
    expect(ancestry(TREE, "a").map((x) => x.id)).toEqual(["cse", "y27", "a"]);
    expect(ancestry(TREE, "ece").map((x) => x.id)).toEqual(["ece"]);
    expect(ancestry(TREE, "missing")).toEqual([]);
    expect(ancestry([n("x", "y"), n("y", "x")], "x")).toHaveLength(2);
  });
});

describe("scope", () => {
  it("covers a node's descendants but not siblings or parents", () => {
    expect(inScope(TREE, "a", "cse")).toBe(true);
    expect(inScope(TREE, "a", "y27")).toBe(true);
    expect(inScope(TREE, "a", "a")).toBe(true);
    expect(inScope(TREE, "a", "b")).toBe(false);
    expect(inScope(TREE, "cse", "a")).toBe(false);
    expect(inScope(TREE, "ece", "cse")).toBe(false);
  });

  it("applies everyone-work to everyone, placed or not, and nothing to the unplaced for a node", () => {
    expect(inScope(TREE, null, null)).toBe(true);
    expect(inScope(TREE, null, "cse")).toBe(false);
  });
});

describe("checkParent", () => {
  it("allows top level and valid nesting", () => {
    expect(checkParent(TREE, null, null)).toBeNull();
    expect(checkParent(TREE, "ece", "cse")).toBeNull();
    expect(checkParent(TREE, null, "y27")).toBeNull();
  });

  it("rejects a missing parent, itself, and its own descendants", () => {
    expect(checkParent(TREE, null, "nope")).toMatch(/doesn't exist/);
    expect(checkParent(TREE, "cse", "cse")).toMatch(/inside itself/);
    expect(checkParent(TREE, "cse", "a")).toMatch(/inside itself/);
  });

  it("limits depth, counting the moved subtree", () => {
    expect(checkParent(TREE, null, "a")).toMatch(/3 levels/);
    expect(checkParent(TREE, "cse", "ece")).toMatch(/3 levels/); // cse brings 3 levels under ece
    expect(checkParent(TREE, "y28", "ece")).toBeNull();
  });
});

describe("findByPath", () => {
  it("finds a node by names, ignoring case and spaces", () => {
    expect(findByPath(TREE, [" cse ", "2027", "a"])?.id).toBe("a");
    expect(findByPath(TREE, ["cse", "2029"])).toBeNull();
    expect(findByPath(TREE, ["2027"])).toBeNull();
  });

  it("skips archived nodes", () => {
    expect(findByPath([n("cse", null, { archived: true })], ["cse"])).toBeNull();
  });
});
