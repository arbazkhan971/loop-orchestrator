import { describe, expect, it } from "vitest";
import { ProjectConfig } from "../src/config/schema.js";
import { validateProject } from "../src/config/validate.js";

function project(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "demo",
    brief: "brief.md",
    workingDir: ".",
    safetyMode: "workspace-write",
    providers: {
      dev: { type: "claude", args: [], dangerouslySkipPermissions: false, yolo: false, promptMode: "interactive", env: {}, auth: { mode: "auto", configured: false } }
    },
    repositories: [{ name: "api", path: "~/api", role: "backend", defaultBranch: "main", protectedBranches: ["main"] }],
    roles: [{ name: "be1", title: "Backend", provider: "dev", repositories: ["api"], responsibilities: [], guardrails: [], autoStart: true }],
    loops: [],
    workflows: [],
    ...overrides
  };
}

describe("config reference validation", () => {
  it("accepts a consistent project", () => {
    expect(validateProject(project())).toEqual([]);
  });

  it("flags a role pointing at a missing provider", () => {
    const config = project({
      roles: [{ name: "be1", title: "Backend", provider: "ghost", repositories: ["api"], responsibilities: [], guardrails: [], autoStart: true }]
    });
    expect(validateProject(config)).toContain('Role "be1" references unknown provider "ghost".');
  });

  it("flags a role pointing at a missing repository", () => {
    const config = project({
      roles: [{ name: "be1", title: "Backend", provider: "dev", repositories: ["nope"], responsibilities: [], guardrails: [], autoStart: true }]
    });
    expect(validateProject(config)).toContain('Role "be1" references unknown repository "nope".');
  });

  it("flags workflow stages with unknown roles and bad dependencies", () => {
    const config = project({
      workflows: [
        {
          name: "wf",
          cadenceSeconds: 30,
          maxIterations: 50,
          stages: [
            { name: "a", role: "ghost", dependsOn: [], completeWhen: [], failWhen: [], optional: false },
            { name: "b", role: "be1", dependsOn: ["missing", "b"], completeWhen: [], failWhen: [], optional: false }
          ]
        }
      ]
    });
    const errors = validateProject(config);
    expect(errors).toContain('[workflow wf] Stage "a" references unknown role "ghost".');
    expect(errors).toContain('[workflow wf] Stage "b" depends on unknown stage "missing".');
    expect(errors).toContain('[workflow wf] Stage "b" depends on itself.');
  });

  it("flags a dependency cycle", () => {
    const config = project({
      workflows: [
        {
          name: "wf",
          cadenceSeconds: 30,
          maxIterations: 50,
          stages: [
            { name: "a", role: "be1", dependsOn: ["b"], completeWhen: [], failWhen: [], optional: false, retries: 0 },
            { name: "b", role: "be1", dependsOn: ["a"], completeWhen: [], failWhen: [], optional: false, retries: 0 }
          ]
        }
      ]
    });
    expect(validateProject(config).some((error) => error.includes("Dependency cycle"))).toBe(true);
  });

  it("flags duplicate stage names", () => {
    const config = project({
      workflows: [
        {
          name: "wf",
          cadenceSeconds: 30,
          maxIterations: 50,
          stages: [
            { name: "a", role: "be1", dependsOn: [], completeWhen: [], failWhen: [], optional: false, retries: 0 },
            { name: "a", role: "be1", dependsOn: [], completeWhen: [], failWhen: [], optional: false, retries: 0 }
          ]
        }
      ]
    });
    expect(validateProject(config)).toContain('[workflow wf] Duplicate stage name "a".');
  });
});
