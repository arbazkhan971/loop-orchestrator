import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LoadedConfig } from "./config/load.js";
import { ProjectConfig, RoleConfig } from "./config/schema.js";

export function buildRolePrompt(loaded: LoadedConfig, project: ProjectConfig, role: RoleConfig, runId: string): string {
  const briefPath = resolve(loaded.rootDir, project.brief);
  const brief = readFileSync(briefPath, "utf8");
  const repos = project.repositories.filter((repo) => role.repositories.includes(repo.name));

  return [
    `# Loop Orchestrator Run`,
    ``,
    `Run ID: ${runId}`,
    `Project: ${project.name}`,
    `Role: ${role.name} - ${role.title}`,
    `Safety mode: ${project.safetyMode}`,
    ``,
    `## Project Brief`,
    brief.trim(),
    ``,
    `## Assigned Repositories`,
    repos.length
      ? repos.map((repo) => `- ${repo.name}: ${repo.path} (${repo.role}, default ${repo.defaultBranch})`).join("\n")
      : "- No repositories assigned. Ask the lead for scope before editing.",
    ``,
    `## Responsibilities`,
    role.responsibilities.map((item) => `- ${item}`).join("\n") || "- Follow the project brief.",
    ``,
    `## Guardrails`,
    [
      ...role.guardrails,
      "Do not delete production data or run destructive database commands.",
      "Keep changes scoped to the assigned task and repository.",
      "Create focused commits and a pull request when implementation is complete.",
      "Run relevant tests before reporting completion."
    ].map((item) => `- ${item}`).join("\n"),
    ``,
    `## Operating Loop`,
    `1. Inspect assigned code and current branch state.`,
    `2. Create or reuse a focused branch/worktree for the task.`,
    `3. Implement the smallest robust change.`,
    `4. Run tests/build/smoke checks.`,
    `5. Summarize status, risks, and PR link.`,
    ``
  ].join("\n");
}
