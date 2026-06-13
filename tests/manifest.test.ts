import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LoadedConfig, RootConfig } from "../src/config/load.js";
import { attachError } from "../src/tmux.js";
import { listRuns, readManifest } from "../src/workflow/manifest.js";

function loadedAt(rootDir: string): LoadedConfig {
  const config = {
    version: 1,
    defaults: { namespace: "loop", dashboardPort: 4318, promptDir: ".loop/prompts", runDir: ".loop/runs" },
    projects: []
  } as unknown as RootConfig;
  return { config, path: join(rootDir, "loop.config.yaml"), rootDir };
}

function writeManifest(rootDir: string, run: string, manifest: object) {
  const dir = join(rootDir, ".loop/runs", run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "workflow.json"), JSON.stringify(manifest));
}

describe("run manifests", () => {
  it("reads a manifest and returns null when absent", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "loop-runs-"));
    const loaded = loadedAt(rootDir);
    expect(readManifest(loaded, "missing")).toBeNull();
    writeManifest(rootDir, "r1", { run: "r1", project: "demo", workflow: "wf", updatedAt: "2026-01-01T00:00:00Z", iteration: 2, done: true, outcome: "completed", stages: [] });
    expect(readManifest(loaded, "r1")?.outcome).toBe("completed");
  });

  it("lists runs newest-first", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "loop-runs-"));
    const loaded = loadedAt(rootDir);
    writeManifest(rootDir, "old", { run: "old", project: "d", workflow: "w", updatedAt: "2026-01-01T00:00:00Z", iteration: 1, done: true, stages: [] });
    writeManifest(rootDir, "new", { run: "new", project: "d", workflow: "w", updatedAt: "2026-06-01T00:00:00Z", iteration: 5, done: false, stages: [] });
    expect(listRuns(loaded).map((r) => r.run)).toEqual(["new", "old"]);
  });

  it("returns empty when the runs dir does not exist", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "loop-runs-"));
    expect(listRuns(loadedAt(rootDir))).toEqual([]);
  });
});

describe("attach target resolution", () => {
  it("returns null for a live session and an error otherwise", () => {
    expect(attachError("loop-a", ["loop-a", "loop-b"])).toBeNull();
    expect(attachError("loop-x", ["loop-a"])).toBe('No session "loop-x". Live sessions: loop-a');
    expect(attachError("loop-x", [])).toContain("(none running)");
  });
});
