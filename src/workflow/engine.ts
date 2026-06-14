// Pure dynamic-workflow state machine.
//
// The "dynamic" part: stages are not all launched up front. On every tick we
// recompute, from current runtime state, which pending stages have had all
// their dependencies satisfied and are therefore ready to launch now. Stages
// advance when their stop-conditions fire, which can in turn unblock others.
//
// This module performs no IO. The IO layer (run.ts) captures pane output,
// evaluates conditions, and feeds the results back in as `evaluations`.

import { WorkflowConfig } from "../config/schema.js";

export type StageStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export type StageState = {
  name: string;
  role: string;
  status: StageStatus;
  attempt: number;
  startedIteration?: number;
  completedIteration?: number;
  stopReason?: string;
};

export type WorkflowOutcome = "completed" | "failed" | "max-iterations" | "stalled";

export type WorkflowState = {
  workflow: string;
  iteration: number;
  stages: StageState[];
  done: boolean;
  outcome?: WorkflowOutcome;
};

// What the IO layer observed for a currently-running stage this tick.
export type StageEvaluation = {
  complete?: boolean;
  failed?: boolean;
  reason?: string;
};

export type WorkflowTick = {
  state: WorkflowState;
  launch: StageState[];
};

export function initWorkflowState(workflow: WorkflowConfig): WorkflowState {
  return {
    workflow: workflow.name,
    iteration: 0,
    done: false,
    stages: workflow.stages.map((stage) => ({
      name: stage.name,
      role: stage.role,
      status: "pending" as StageStatus,
      attempt: 0
    }))
  };
}

function isOptional(workflow: WorkflowConfig, name: string): boolean {
  return Boolean(workflow.stages.find((stage) => stage.name === name)?.optional);
}

// A dependency is "satisfied" if it completed, or if it was skipped/failed but
// declared optional (optional deps never block their dependents).
function depSatisfied(workflow: WorkflowConfig, dep: StageState): boolean {
  if (dep.status === "complete") return true;
  if ((dep.status === "failed" || dep.status === "skipped") && isOptional(workflow, dep.name)) return true;
  return false;
}

// A dependency "blocks" its dependents when it reached a terminal non-complete
// state and was required.
function depBlocks(workflow: WorkflowConfig, dep: StageState): boolean {
  return (dep.status === "failed" || dep.status === "skipped") && !isOptional(workflow, dep.name);
}

export function tickWorkflow(
  workflow: WorkflowConfig,
  current: WorkflowState,
  evaluations: Record<string, StageEvaluation>
): WorkflowTick {
  const iteration = current.iteration + 1;
  const stages = current.stages.map((stage) => ({ ...stage }));
  const byName = new Map(stages.map((stage) => [stage.name, stage]));
  const config = new Map(workflow.stages.map((stage) => [stage.name, stage]));

  // 1. Apply observed evaluations to running stages. A failure consumes a retry
  //    budget: while attempts remain the stage goes back to pending and will be
  //    relaunched, otherwise it is marked failed for good.
  for (const stage of stages) {
    if (stage.status !== "running") continue;
    const evaluation = evaluations[stage.name];
    if (!evaluation) continue;
    if (evaluation.failed) {
      const allowed = (config.get(stage.name)?.retries ?? 0) + 1;
      const reasonText = evaluation.reason ?? "failure condition met";
      if (stage.attempt < allowed) {
        stage.status = "pending";
        stage.startedIteration = undefined;
        stage.stopReason = `retrying (attempt ${stage.attempt + 1}/${allowed}): ${reasonText}`;
      } else {
        stage.status = "failed";
        stage.completedIteration = iteration;
        stage.stopReason = reasonText;
      }
    } else if (evaluation.complete) {
      stage.status = "complete";
      stage.completedIteration = iteration;
      stage.stopReason = evaluation.reason ?? "completion condition met";
    }
  }

  // 2. Propagate blocking: a pending stage with a required, terminal-failed
  //    dependency can never run, so skip it. Loop until the set is stable
  //    (skips can cascade down the DAG).
  let changed = true;
  while (changed) {
    changed = false;
    for (const stage of stages) {
      if (stage.status !== "pending") continue;
      const deps = config.get(stage.name)?.dependsOn ?? [];
      const blocker = deps.map((dep) => byName.get(dep)).find((dep) => dep && depBlocks(workflow, dep));
      if (blocker) {
        stage.status = "skipped";
        stage.completedIteration = iteration;
        stage.stopReason = `blocked by ${blocker.name} (${blocker.status})`;
        changed = true;
      }
    }
  }

  // 3. Launch pending stages whose dependencies are satisfied, bounded by the
  //    optional concurrency cap so a wide fan-out doesn't start everything at once.
  const launch: StageState[] = [];
  const runningCount = stages.filter((stage) => stage.status === "running").length;
  const slots = workflow.maxParallel ? Math.max(0, workflow.maxParallel - runningCount) : Number.POSITIVE_INFINITY;

  for (const stage of stages) {
    if (stage.status !== "pending") continue;
    if (launch.length >= slots) break;
    const deps = config.get(stage.name)?.dependsOn ?? [];
    const ready = deps.every((dep) => {
      const depState = byName.get(dep);
      return depState ? depSatisfied(workflow, depState) : false;
    });
    if (ready) {
      stage.status = "running";
      stage.startedIteration = iteration;
      stage.attempt += 1;
      launch.push(stage);
    }
  }

  // 4. Decide whether the workflow is done.
  const terminal = (status: StageStatus) => status === "complete" || status === "failed" || status === "skipped";
  const allTerminal = stages.every((stage) => terminal(stage.status));
  const anyRunning = stages.some((stage) => stage.status === "running");

  let done = false;
  let outcome: WorkflowOutcome | undefined;

  if (allTerminal) {
    const requiredFailure = stages.some(
      (stage) => (stage.status === "failed" || stage.status === "skipped") && !isOptional(workflow, stage.name)
    );
    outcome = requiredFailure ? "failed" : "completed";
    done = true;
  } else if (iteration >= workflow.maxIterations) {
    outcome = "max-iterations";
    done = true;
  } else if (!anyRunning && launch.length === 0) {
    // Pending work remains but nothing is running and nothing became ready:
    // a dependency cycle or unreachable stage. Stop rather than spin forever.
    outcome = "stalled";
    done = true;
  }

  return {
    state: { workflow: current.workflow, iteration, stages, done, outcome },
    launch
  };
}
