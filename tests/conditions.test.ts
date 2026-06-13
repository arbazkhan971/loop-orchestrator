import { describe, expect, it } from "vitest";
import { evaluateCondition, firstMet } from "../src/workflow/conditions.js";

const base = { paneText: "", secondsSinceChange: 0, signals: {} as Record<string, boolean> };

describe("condition evaluator", () => {
  it("matches a pane regex and returns evidence", () => {
    const result = evaluateCondition("pane-matches:PLAN COMPLETE", { ...base, paneText: "...\nPLAN COMPLETE\n" });
    expect(result.met).toBe(true);
    expect(result.evidence).toContain("PLAN COMPLETE");
  });

  it("treats invalid regex as unmet rather than throwing", () => {
    const result = evaluateCondition("pane-matches:[unclosed", { ...base, paneText: "anything" });
    expect(result.met).toBe(false);
    expect(result.evidence).toBe("invalid regex");
  });

  it("evaluates pane-idle against elapsed time", () => {
    expect(evaluateCondition("pane-idle:120", { ...base, secondsSinceChange: 119 }).met).toBe(false);
    expect(evaluateCondition("pane-idle:120", { ...base, secondsSinceChange: 121 }).met).toBe(true);
  });

  it("matches named test signals", () => {
    expect(evaluateCondition("tests-pass", { ...base, paneText: "All tests passed" }).met).toBe(true);
    expect(evaluateCondition("tests-fail", { ...base, paneText: "3 failing" }).met).toBe(true);
    expect(evaluateCondition("tests-pass", { ...base, paneText: "still working" }).met).toBe(false);
  });

  it("reads boolean signals for github-backed conditions", () => {
    expect(evaluateCondition("pr-opened", { ...base, signals: { prOpened: true } }).met).toBe(true);
    expect(evaluateCondition("review-approved", { ...base, signals: {} }).met).toBe(false);
  });

  it("falls back to case-insensitive substring for free text", () => {
    expect(evaluateCondition("merge ready", { ...base, paneText: "Status: MERGE READY" }).met).toBe(true);
  });

  it("firstMet returns the earliest matching condition", () => {
    const ctx = { ...base, paneText: "tests passed" };
    const result = firstMet(["pr-opened", "tests-pass"], ctx);
    expect(result?.condition).toBe("tests-pass");
    expect(firstMet(["pr-opened"], ctx)).toBeNull();
  });
});
