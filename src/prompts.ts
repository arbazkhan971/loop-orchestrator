import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LoadedConfig } from "./config/load.js";
import { ProjectConfig, RoleConfig } from "./config/schema.js";
import { getSmeRole } from "./sme.js";

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/**
 * The coordination protocol every SME shares. This is what makes the team a team:
 * the shared blackboard contract for claiming work, handing off, and signaling done.
 * The autonomy loop detects completion from the `events.jsonl` lines described here.
 */
export function boardProtocol(runId: string): string {
  return [
    `## Shared Blackboard Protocol`,
    `The team coordinates through append-only logs under \`.loop/board/\`. Never edit these files in place — only append one JSON object per line.`,
    ``,
    `- **Read work:** the open tasks assigned to you live in \`.loop/board/tasks.jsonl\` (objects with \`assignee\` = your role key).`,
    `- **Claim a task:** append to \`.loop/board/events.jsonl\`:`,
    `  \`{"ts":"<iso>","role":"<your-role>","taskId":"<id>","status":"claimed"}\``,
    `- **Hand off / request work** from another SME: append a task to \`.loop/board/tasks.jsonl\` with that SME's role key as \`assignee\`, plus a note in \`.loop/board/messages.jsonl\`.`,
    `- **Signal completion** (the orchestrator polls this to advance the run): append to \`.loop/board/events.jsonl\`:`,
    `  \`{"ts":"<iso>","role":"<your-role>","taskId":"<id>","status":"done|blocked|needs-review","summary":"<one line>"}\``,
    `- A task is only \`done\` when its acceptance criteria are met AND the project's test/build commands pass.`,
    `- Run ID for this session is \`${runId}\`. Include it in commit messages where helpful.`,
    ``
  ].join("\n");
}

function smeSection(role: RoleConfig): string {
  if (!role.sme) {
    // Hand-authored role: use the configured responsibilities verbatim.
    return [
      `## Responsibilities`,
      role.responsibilities.map((item) => `- ${item}`).join("\n") || "- Follow the project brief.",
      ``
    ].join("\n");
  }

  const sme = getSmeRole(role.sme);
  const extraResponsibilities = role.responsibilities.length
    ? `\n### Additional project-specific responsibilities\n${role.responsibilities.map((i) => `- ${i}`).join("\n")}\n`
    : "";

  return [
    `## Who You Are`,
    sme.identity,
    ``,
    `## Operating Loop (run this every iteration)`,
    sme.operatingLoop.map((step, i) => `${i + 1}. ${step}`).join("\n"),
    ``,
    `## Definition of Done`,
    sme.definitionOfDone.map((item) => `- ${item}`).join("\n"),
    extraResponsibilities,
    ``
  ].join("\n");
}

export function buildRolePrompt(loaded: LoadedConfig, project: ProjectConfig, role: RoleConfig, runId: string): string {
  const briefPath = resolve(loaded.rootDir, project.brief);
  const brief = readIfExists(briefPath)?.trim() ?? "(no brief.md found — operate from the goal and project intelligence.)";

  const intelPath = resolve(
    loaded.rootDir,
    project.workingDir || ".",
    project.intelligence || "PROJECT-INTELLIGENCE.md"
  );
  const intel = readIfExists(intelPath);

  const repos = project.repositories.filter((repo) => role.repositories.includes(repo.name));
  const sme = role.sme ? getSmeRole(role.sme) : undefined;

  const globalGuardrails = [
    ...role.guardrails,
    ...(sme?.guardrails ?? []),
    "Do not delete production data or run destructive database commands.",
    "Keep changes scoped to your claimed task and assigned repositories.",
    "Create focused commits; open a pull request when implementation is complete.",
    "Always use the test/build/lint commands from PROJECT-INTELLIGENCE.md — never invent commands."
  ];

  return [
    `# ${role.title}`,
    ``,
    `Run ID: ${runId}`,
    `Project: ${project.name}`,
    `Role: ${role.name}${sme ? ` (SME: ${sme.title})` : ""}`,
    `Provider: ${role.provider}`,
    `Safety mode: ${project.safetyMode}`,
    ``,
    smeSection(role),
    `## Project Brief`,
    brief,
    ``,
    `## Project Intelligence (you are trained on this project)`,
    intel
      ? `The following is auto-detected knowledge of this codebase. Ground every decision in it — especially the commands.\n\n${intel.trim()}`
      : "_No PROJECT-INTELLIGENCE.md found. Run \`loop learn\` first, or inspect the repo before acting._",
    ``,
    `## Assigned Repositories`,
    repos.length
      ? repos.map((repo) => `- ${repo.name}: ${repo.path} (${repo.role}, default ${repo.defaultBranch}, protected: ${repo.protectedBranches.join(", ")})`).join("\n")
      : "- Working directory only (no extra repositories assigned).",
    ``,
    boardProtocol(runId),
    `## Guardrails`,
    globalGuardrails.map((item) => `- ${item}`).join("\n"),
    ``
  ].join("\n");
}
