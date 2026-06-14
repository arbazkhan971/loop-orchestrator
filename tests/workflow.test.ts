import { describe, expect, it } from "vitest";
import { WorkflowConfig } from "../src/config/schema.js";
import { initWorkflowState, tickWorkflow } from "../src/workflow/engine.js";
import { runWorkflow, WorkflowClock, WorkflowRunner } from "../src/workflow/run.js";
import { StageState } from "../src/workflow/engine.js";

function workflow(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  return {
    name: "delivery",
    cadenceSeconds: 30,
    maxIterations: 50,
    stages: [
      { name: "plan", role: "cto", dependsOn: [], completeWhen: ["pane-matches:PLAN DONE"], failWhen: [], optional: false },
      { name: "be", role: "be1", dependsOn: ["plan"], completeWhen: ["tests-pass"], failWhen: ["tests-fail"], optional: false },
      { name: "fe", role: "fe1", dependsOn: ["plan"], completeWhen: ["pr-opened"], failWhen: [], optional: false },
      { name: "qa", role: "qa1", dependsOn: ["be", "fe"], completeWhen: ["review-approved"], failWhen: [], optional: false }
    ],
    ...overrides
  };
}

function statusOf(stages: StageState[], name: string) {
  return stages.find((stage) => stage.name === name)?.status;
}

describe("workflow engine (pure)", () => {
  it("launches only dependency-free stages first", () => {
    const tick = tickWorkflow(workflow(), initWorkflowState(workflow()), {});
    expect(tick.launch.map((stage) => stage.name)).toEqual(["plan"]);
    expect(statusOf(tick.state.stages, "be")).toBe("pending");
  });

  it("unblocks dependents only after a dependency completes", () => {
    const wf = workflow();
    let state = tickWorkflow(wf, initWorkflowState(wf), {}).state; // plan running
    // plan still running, nothing new launches
    let tick = tickWorkflow(wf, state, {});
    expect(tick.launch).toHaveLength(0);
    // plan completes -> be and fe become ready together (dynamic fan-out)
    tick = tickWorkflow(wf, tick.state, { plan: { complete: true } });
    expect(tick.launch.map((stage) => stage.name).sort()).toEqual(["be", "fe"]);
  });

  it("skips dependents when a required dependency fails", () => {
    const wf = workflow();
    let state = tickWorkflow(wf, initWorkflowState(wf), {}).state;
    state = tickWorkflow(wf, state, { plan: { failed: true, reason: "tests-fail" } }).state;
    expect(statusOf(state.stages, "plan")).toBe("failed");
    expect(statusOf(state.stages, "be")).toBe("skipped");
    expect(statusOf(state.stages, "qa")).toBe("skipped");
    expect(state.done).toBe(true);
    expect(state.outcome).toBe("failed");
  });

  it("stops at maxIterations when conditions never fire", () => {
    const wf = workflow({ maxIterations: 3 });
    let state = initWorkflowState(wf);
    for (let i = 0; i < 5 && !state.done; i += 1) state = tickWorkflow(wf, state, {}).state;
    expect(state.outcome).toBe("max-iterations");
    expect(state.iteration).toBe(3);
  });

  it("retries a failed stage until its budget is exhausted", () => {
    const wf = workflow({
      stages: [{ name: "x", role: "be1", dependsOn: [], completeWhen: [], failWhen: [], optional: false, retries: 1 }]
    });
    let tick = tickWorkflow(wf, initWorkflowState(wf), {}); // attempt 1 running
    expect(tick.state.stages[0].attempt).toBe(1);
    tick = tickWorkflow(wf, tick.state, { x: { failed: true, reason: "boom" } }); // fail -> retry -> relaunch same tick
    expect(tick.launch.map((stage) => stage.name)).toEqual(["x"]);
    expect(tick.state.stages[0].attempt).toBe(2);
    expect(statusOf(tick.state.stages, "x")).toBe("running");
    tick = tickWorkflow(wf, tick.state, { x: { failed: true, reason: "boom" } }); // budget gone -> failed
    expect(statusOf(tick.state.stages, "x")).toBe("failed");
    expect(tick.state.outcome).toBe("failed");
  });

  it("respects maxParallel and launches in config order", () => {
    const wf = workflow({
      maxParallel: 1,
      stages: [
        { name: "a", role: "cto", dependsOn: [], completeWhen: [], failWhen: [], optional: false, retries: 0 },
        { name: "b", role: "be1", dependsOn: [], completeWhen: [], failWhen: [], optional: false, retries: 0 }
      ]
    });
    const tick = tickWorkflow(wf, initWorkflowState(wf), {});
    expect(tick.launch.map((stage) => stage.name)).toEqual(["a"]);
    expect(statusOf(tick.state.stages, "b")).toBe("pending");
  });
});

describe("runWorkflow (with fakes)", () => {
  it("drives stages to completion as panes emit signals", async () => {
    const wf = workflow();
    let clock = 0;
    const fakeClock: WorkflowClock = {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      }
    };

    // Pane text per stage evolves over wall-clock so conditions fire in order.
    const paneFor = (name: string): string => {
      if (name === "plan") return clock >= 30_000 ? "PLAN DONE" : "planning";
      if (name === "be") return clock >= 90_000 ? "all tests passed" : "coding";
      if (name === "fe") return "working"; // completes via pr-opened signal
      if (name === "qa") return "reviewing";
      return "";
    };

    const launched: string[] = [];
    const runner: WorkflowRunner = {
      launch: (stage) => {
        launched.push(stage.name);
        return `session-${stage.name}`;
      },
      capture: (stage) => paneFor(stage.name),
      signals: (stage) => {
        if (stage.name === "fe") return { prOpened: clock >= 90_000 };
        if (stage.name === "qa") return { reviewApproved: clock >= 150_000 };
        return {};
      }
    };

    const final = await runWorkflow(wf, runner, fakeClock);
    expect(final.done).toBe(true);
    expect(final.outcome).toBe("completed");
    expect(launched.sort()).toEqual(["be", "fe", "plan", "qa"]);
    expect(final.stages.every((stage) => stage.status === "complete")).toBe(true);
  });

  it("--once style single tick launches roots without finishing", async () => {
    const wf = workflow();
    const launched: string[] = [];
    const runner: WorkflowRunner = {
      launch: (stage) => {
        launched.push(stage.name);
        return stage.name;
      },
      capture: () => "nothing yet"
    };
    const final = await runWorkflow(wf, runner, { now: () => 0, sleep: async () => {} }, { maxTicks: 1 });
    expect(launched).toEqual(["plan"]);
    expect(final.done).toBe(false);
  });

  it("times out a stuck stage", async () => {
    let clock = 0;
    const fakeClock: WorkflowClock = { now: () => clock, sleep: async (ms) => { clock += ms; } };
    const wf = workflow({
      cadenceSeconds: 10,
      stages: [{ name: "x", role: "be1", dependsOn: [], completeWhen: ["pane-matches:DONE"], failWhen: [], optional: false, retries: 0, timeoutSeconds: 25 }]
    });
    const runner: WorkflowRunner = { launch: (stage) => stage.name, capture: () => "still working" };
    const final = await runWorkflow(wf, runner, fakeClock);
    expect(final.outcome).toBe("failed");
    expect(final.stages[0].stopReason).toContain("timeout");
  });

  it("retries a launch that throws, then completes", async () => {
    let clock = 0;
    const fakeClock: WorkflowClock = { now: () => clock, sleep: async (ms) => { clock += ms; } };
    const wf = workflow({
      stages: [{ name: "x", role: "be1", dependsOn: [], completeWhen: ["pane-matches:DONE"], failWhen: [], optional: false, retries: 3 }]
    });
    let attempts = 0;
    const runner: WorkflowRunner = {
      launch: (stage) => {
        attempts += 1;
        if (attempts === 1) throw new Error("tmux busy");
        return stage.name;
      },
      capture: () => "DONE"
    };
    const final = await runWorkflow(wf, runner, fakeClock);
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(final.outcome).toBe("completed");
  });

  it("resumes from a manifest and reattaches running stages", async () => {
    const wf = workflow({
      stages: [{ name: "x", role: "be1", dependsOn: [], completeWhen: ["pane-matches:DONE"], failWhen: [], optional: false, retries: 0 }]
    });
    const initialState = {
      workflow: "delivery",
      iteration: 3,
      done: false,
      stages: [{ name: "x", role: "be1", status: "running" as const, attempt: 1, startedIteration: 1 }]
    };
    const resolved: string[] = [];
    const runner: WorkflowRunner = {
      launch: (stage) => stage.name,
      capture: () => "DONE",
      resolveSession: (stage) => {
        resolved.push(stage.name);
        return `sess-${stage.name}`;
      }
    };
    const final = await runWorkflow(wf, runner, { now: () => 0, sleep: async () => {} }, { initialState });
    expect(resolved).toEqual(["x"]);
    expect(statusOf(final.stages, "x")).toBe("complete");
    expect(final.iteration).toBe(4);
  });
});
