import { describe, expect, it } from "vitest";
import { OrgPackCreateBodySchema, TrajectoryBodySchema } from "./schemas";
import { STARTER_KITS, kitById, kitProblems } from "./starterKits";
import { orgSettings } from "./orgSettings";

describe("starter kits", () => {
  it.each(STARTER_KITS.map((k) => [k.id, k] as const))("%s is internally consistent", (_id, kit) => {
    expect(kitProblems(kit)).toEqual([]);
  });

  it.each(STARTER_KITS.map((k) => [k.id, k] as const))("%s: every round passes the same checks an admin's would", (_id, kit) => {
    for (const r of kit.rounds) {
      expect(OrgPackCreateBodySchema.safeParse(r).success, r.key).toBe(true); // `key` is an extra field, which the schema ignores
    }
  });

  it.each(STARTER_KITS.map((k) => [k.id, k] as const))("%s: every plan passes the plan schema once its rounds exist", (_id, kit) => {
    for (const p of kit.plans) {
      const body = { name: p.name, description: p.description, stages: p.stages.map((s) => ({ title: s.title, packId: `org-${s.round}`, targetCount: s.targetCount, dueDays: s.dueDays, gateScore: s.gateScore, mandatory: s.mandatory })) };
      expect(TrajectoryBodySchema.safeParse(body).success, p.name).toBe(true);
    }
  });

  it("the college kit sets details students are asked for, and asks for scores to be shared", () => {
    const kit = kitById("college-placement")!;
    const read = orgSettings({ settings: kit.settings });
    expect(read.studentFields.map((f) => f.key)).toEqual(["branch", "graduation_year", "roll_number"]);
    expect(read.minShareLevel).toBe("scores");
  });

  it("spots a plan that names a round the kit doesn't have", () => {
    const kit = kitById("college-placement")!;
    const broken = { ...kit, plans: [{ ...kit.plans[0], stages: [{ ...kit.plans[0].stages[0], round: "nope" }] }] };
    expect(kitProblems(broken)).toEqual([expect.stringContaining("unknown round nope")]);
  });

  it("knows nothing about an unknown kit id", () => {
    expect(kitById("nope")).toBeUndefined();
  });
});
