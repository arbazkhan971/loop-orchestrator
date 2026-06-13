import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addEvent,
  addMessage,
  addTask,
  foldBoard,
  gatherContext,
  initBoard,
  isComplete,
  retryableTasksFor,
  type BoardTask
} from "../src/board.js";
import { parseVerdict, failureTail } from "../src/orchestrator.js";
import { parseCost, recordCost, totalSpend, initCostLedger } from "../src/cost.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "loop-sota-"));
}

function task(id: string, assignee: string, extra: Partial<BoardTask> = {}): BoardTask {
  return {
    id,
    title: `task ${id}`,
    assignee,
    createdBy: "pm",
    description: "do the thing",
    acceptanceCriteria: ["works"],
    dependsOn: [],
    priority: 5,
    createdAt: new Date(0).toISOString(),
    ...extra
  };
}

describe("board: attempts + retry", () => {
  it("counts failed attempts and exposes retryable tasks under the cap", () => {
    const dir = tmp();
    initBoard(dir);
    addTask(dir, task("t1", "be"));
    // two failures
    addEvent(dir, { ts: "1", role: "be", taskId: "t1", status: "claimed" });
    addEvent(dir, { ts: "2", role: "be", taskId: "t1", status: "blocked", summary: "boom" });
    addEvent(dir, { ts: "3", role: "be", taskId: "t1", status: "claimed" });
    addEvent(dir, { ts: "4", role: "be", taskId: "t1", status: "rejected", summary: "nope" });

    const view = foldBoard(dir).find((t) => t.id === "t1")!;
    expect(view.attempts).toBe(2);
    expect(view.status).toBe("rejected");

    // cap of 3 → still retryable; cap of 2 → exhausted
    expect(retryableTasksFor(dir, "be", 3).map((t) => t.id)).toContain("t1");
    expect(retryableTasksFor(dir, "be", 2)).toHaveLength(0);
  });

  it("isComplete treats escalated as terminal", () => {
    const dir = tmp();
    initBoard(dir);
    addTask(dir, task("t1", "be"));
    expect(isComplete(dir)).toBe(false);
    addEvent(dir, { ts: "1", role: "pm", taskId: "t1", status: "escalated" });
    expect(isComplete(dir)).toBe(true);
  });
});

describe("board: gatherContext (real coordination)", () => {
  it("surfaces inbox messages and upstream dependency results", () => {
    const dir = tmp();
    initBoard(dir);
    addTask(dir, task("api", "be"));
    addTask(dir, task("ui", "fe", { dependsOn: ["api"] }));
    addEvent(dir, { ts: "1", role: "be", taskId: "api", status: "done", summary: "POST /login shipped" });
    addMessage(dir, { ts: "2", from: "qa", to: "fe", taskId: "ui", body: "use the new endpoint" });
    addMessage(dir, { ts: "3", from: "x", to: "be", body: "not for fe" });

    const ctx = gatherContext(dir, "fe", task("ui", "fe", { dependsOn: ["api"] }));
    expect(ctx).toContain("use the new endpoint"); // inbox to fe
    expect(ctx).toContain("POST /login shipped"); // upstream api summary
    expect(ctx).not.toContain("not for fe"); // message addressed to be, not fe
  });
});

describe("parseVerdict (critic output)", () => {
  it("parses a clean accept/reject JSON", () => {
    expect(parseVerdict('{"verdict":"accept","reasons":["meets criteria"]}').verdict).toBe("accept");
    expect(parseVerdict('{"verdict":"reject","reasons":["missing tests"]}').verdict).toBe("reject");
  });

  it("unwraps a claude envelope around the verdict", () => {
    const env = JSON.stringify({ result: 'Verdict: {"verdict":"reject","reasons":["bug"]}', is_error: false });
    const v = parseVerdict(env);
    expect(v.verdict).toBe("reject");
    expect(v.reasons).toContain("bug");
  });

  it("defaults to reject when no clear verdict (safe default)", () => {
    expect(parseVerdict("I think it is probably fine maybe").verdict).toBe("reject");
  });
});

describe("failureTail", () => {
  it("returns a trimmed tail of stderr+stdout for error re-injection", () => {
    const tail = failureTail("line1\nline2\nFAIL: expected 5 got 4", "warning: x");
    expect(tail).toContain("FAIL: expected 5 got 4");
  });
});

describe("cost ledger + budget", () => {
  it("parses total_cost_usd and token usage from agent output", () => {
    const out = '{"total_cost_usd":0.0123,"usage":{"input_tokens":100,"output_tokens":50}}';
    const c = parseCost(out);
    expect(c.usd).toBeCloseTo(0.0123);
    expect(c.inputTokens).toBe(100);
    expect(c.outputTokens).toBe(50);
  });

  it("accumulates spend in the ledger", () => {
    const dir = tmp();
    initBoard(dir);
    initCostLedger(dir);
    recordCost(dir, { ts: "1", role: "be", taskId: "t1", usd: 0.01 });
    recordCost(dir, { ts: "2", role: "fe", taskId: "t2", usd: 0.02 });
    expect(totalSpend(dir)).toBeCloseTo(0.03);
  });
});
