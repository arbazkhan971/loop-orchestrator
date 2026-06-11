import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LoadedConfig } from "../src/config/load.js";
import { RootConfig } from "../src/config/schema.js";
import { buildRolePrompt } from "../src/prompts.js";

describe("prompt generation", () => {
  it("includes role, repository scope, and guardrails", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "loop-test-"));
    writeFileSync(join(rootDir, "brief.md"), "Ship a reliable product.");

    const config: RootConfig = {
      version: 1,
      defaults: {
        namespace: "loop",
        dashboardPort: 4318,
        promptDir: ".loop/prompts",
        runDir: ".loop/runs"
      },
      projects: [
        {
          name: "demo",
          brief: "brief.md",
          workingDir: ".",
          safetyMode: "workspace-write",
          providers: {
            dev: { type: "codex", args: [], dangerouslySkipPermissions: false, yolo: false, promptMode: "interactive", env: {} }
          },
          repositories: [
            {
              name: "backend-api",
              path: "~/work/backend-api",
              role: "backend",
              defaultBranch: "main",
              protectedBranches: ["main"]
            }
          ],
          roles: [
            {
              name: "be1",
              title: "Backend engineer",
              provider: "dev",
              repositories: ["backend-api"],
              responsibilities: ["Implement APIs."],
              guardrails: ["Use tests."],
              autoStart: true
            }
          ],
          loops: []
        }
      ]
    };

    const loaded: LoadedConfig = { config, path: join(rootDir, "loop.config.yaml"), rootDir };
    const prompt = buildRolePrompt(loaded, config.projects[0], config.projects[0].roles[0], "run-1");

    expect(prompt).toContain("Backend engineer");
    expect(prompt).toContain("backend-api");
    expect(prompt).toContain("Do not delete production data");
  });
});
