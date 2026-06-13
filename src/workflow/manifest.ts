// Read back the workflow manifests written by run.ts. This is the auditable
// "what did the team do?" surface for past and in-flight runs.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { LoadedConfig } from "../config/load.js";
import { StageState, WorkflowOutcome } from "./engine.js";

export type RunManifest = {
  run: string;
  project: string;
  workflow: string;
  updatedAt: string;
  iteration: number;
  done: boolean;
  outcome?: WorkflowOutcome;
  stages: StageState[];
};

export type RunSummary = {
  run: string;
  project?: string;
  workflow?: string;
  outcome?: WorkflowOutcome;
  done?: boolean;
  iteration?: number;
  updatedAt?: string;
};

export function runsDir(loaded: LoadedConfig): string {
  return resolve(loaded.rootDir, loaded.config.defaults.runDir);
}

export function readManifest(loaded: LoadedConfig, runId: string): RunManifest | null {
  const path = resolve(runsDir(loaded), runId, "workflow.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as RunManifest;
}

export function listRuns(loaded: LoadedConfig): RunSummary[] {
  const dir = runsDir(loaded);
  if (!existsSync(dir)) return [];

  const summaries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifest = readManifest(loaded, entry.name);
      if (!manifest) return { run: entry.name } as RunSummary;
      return {
        run: entry.name,
        project: manifest.project,
        workflow: manifest.workflow,
        outcome: manifest.outcome,
        done: manifest.done,
        iteration: manifest.iteration,
        updatedAt: manifest.updatedAt
      } as RunSummary;
    });

  return summaries.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}
