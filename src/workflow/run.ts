// IO orchestration for dynamic workflows. This is the thin layer that turns the
// pure engine + condition evaluator into real tmux sessions, pane captures, and
// an on-disk run manifest. Everything side-effecting is injected so the loop can
// be driven by fakes in tests.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LoadedConfig } from "../config/load.js";
import { ProjectConfig, WorkflowConfig } from "../config/schema.js";
import { capturePane, launchRoleSession, sessionName } from "../tmux.js";
import { ConditionContext, firstMet } from "./conditions.js";
import { initWorkflowState, StageEvaluation, StageState, tickWorkflow, WorkflowState } from "./engine.js";

export type WorkflowClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type WorkflowRunner = {
  launch: (stage: StageState) => string; // returns the session name
  capture: (stage: StageState, session: string) => string; // pane text
  signals?: (stage: StageState, session: string) => Record<string, boolean>;
  resolveSession?: (stage: StageState) => string; // deterministic name, used on resume
  onTick?: (state: WorkflowState) => void;
};

export const realClock: WorkflowClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms))
};

function reason(condition: string, evidence?: string): string {
  return evidence ? `${condition}: ${evidence}` : condition;
}

export async function runWorkflow(
  workflow: WorkflowConfig,
  runner: WorkflowRunner,
  clock: WorkflowClock = realClock,
  options: { maxTicks?: number; initialState?: WorkflowState } = {}
): Promise<WorkflowState> {
  let state = options.initialState ?? initWorkflowState(workflow);
  const sessions = new Map<string, string>();
  const snapshots = new Map<string, { text: string; changedAt: number }>();
  const startedAt = new Map<string, number>();
  // Failures observed outside the evaluation pass (e.g. a launch that threw)
  // are carried into the next tick so the engine's retry budget applies.
  let carry: Record<string, StageEvaluation> = {};
  let ticks = 0;

  // Resume: reattach to the deterministic sessions of stages already running.
  if (options.initialState && runner.resolveSession) {
    for (const stage of state.stages) {
      if (stage.status !== "running") continue;
      sessions.set(stage.name, runner.resolveSession(stage));
      startedAt.set(stage.name, clock.now());
      snapshots.set(stage.name, { text: "", changedAt: clock.now() });
    }
  }

  while (!state.done) {
    // Evaluate every running stage against its timeout, then its conditions.
    const evaluations: Record<string, StageEvaluation> = { ...carry };
    carry = {};
    for (const stage of state.stages) {
      if (stage.status !== "running") continue;
      if (evaluations[stage.name]) continue; // already decided by a carried failure
      const session = sessions.get(stage.name);
      if (!session) continue;

      const now = clock.now();
      const stageConfig = workflow.stages.find((item) => item.name === stage.name)!;
      const started = startedAt.get(stage.name) ?? now;
      if (stageConfig.timeoutSeconds && (now - started) / 1000 >= stageConfig.timeoutSeconds) {
        evaluations[stage.name] = { failed: true, reason: `timeout after ${stageConfig.timeoutSeconds}s` };
        continue;
      }

      const text = runner.capture(stage, session);
      const prev = snapshots.get(stage.name);
      const changedAt = !prev || prev.text !== text ? now : prev.changedAt;
      snapshots.set(stage.name, { text, changedAt });

      const ctx: ConditionContext = {
        paneText: text,
        secondsSinceChange: (now - changedAt) / 1000,
        signals: runner.signals?.(stage, session) ?? {}
      };

      const failed = firstMet(stageConfig.failWhen, ctx);
      if (failed) {
        evaluations[stage.name] = { failed: true, reason: reason(failed.condition, failed.evidence) };
        continue;
      }
      const complete = firstMet(stageConfig.completeWhen, ctx);
      if (complete) {
        evaluations[stage.name] = { complete: true, reason: reason(complete.condition, complete.evidence) };
      }
    }

    const tick = tickWorkflow(workflow, state, evaluations);
    state = tick.state;

    for (const stage of tick.launch) {
      try {
        const session = runner.launch(stage);
        sessions.set(stage.name, session);
        startedAt.set(stage.name, clock.now());
        snapshots.set(stage.name, { text: "", changedAt: clock.now() });
      } catch (error) {
        // A launch failure becomes a retryable failure on the next tick rather
        // than crashing the whole run.
        sessions.delete(stage.name);
        carry[stage.name] = { failed: true, reason: `launch failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    runner.onTick?.(state);

    ticks += 1;
    if (state.done) break;
    if (options.maxTicks && ticks >= options.maxTicks) break;

    await clock.sleep(workflow.cadenceSeconds * 1000);
  }

  return state;
}

// Real tmux-backed runner. Stage roles are resolved against the project; each
// stage launch starts (or reuses) a tmux session via the existing launcher.
export function createTmuxRunner(
  loaded: LoadedConfig,
  project: ProjectConfig,
  runId: string,
  execute: boolean
): WorkflowRunner {
  return {
    launch(stage) {
      const role = project.roles.find((item) => item.name === stage.role);
      if (!role) throw new Error(`Stage "${stage.name}" references unknown role "${stage.role}".`);
      return launchRoleSession(loaded, project, role, runId, execute).session;
    },
    capture(_stage, session) {
      try {
        return capturePane(session, 200);
      } catch {
        return "";
      }
    },
    resolveSession(stage) {
      return sessionName(loaded.config.defaults.namespace, project.name, runId, stage.role);
    }
  };
}

export function manifestPath(loaded: LoadedConfig, runId: string): string {
  return resolve(loaded.rootDir, loaded.config.defaults.runDir, runId, "workflow.json");
}

export function writeWorkflowManifest(
  loaded: LoadedConfig,
  project: ProjectConfig,
  runId: string,
  state: WorkflowState
): string {
  const path = manifestPath(loaded, runId);
  mkdirSync(resolve(path, ".."), { recursive: true });
  const manifest = {
    run: runId,
    project: project.name,
    workflow: state.workflow,
    updatedAt: new Date().toISOString(),
    iteration: state.iteration,
    done: state.done,
    outcome: state.outcome,
    stages: state.stages
  };
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  return path;
}
