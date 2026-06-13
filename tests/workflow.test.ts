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
});
