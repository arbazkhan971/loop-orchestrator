import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addEvent,
  addTask,
  BoardTask,
  boardSummary,
  foldBoard,
  initBoard,
  isComplete,
  openTasksFor,
  TaskView
} from "./board.js";
import { LoadedConfig } from "./config/load.js";
import { LoopConfig, ProjectConfig, RoleConfig } from "./config/schema.js";
import { analyzeProject, writeIntelligence } from "./intelligence.js";
import { buildHeadlessCommand, commandToShell, shellQuote } from "./providers.js";
import { buildRolePrompt } from "./prompts.js";
import { ensureWindow, paneTitle, runCommandInPane, sessionName } from "./tmux.js";

export type RunContext = {
  loaded: LoadedConfig;
  project: ProjectConfig;
  loop: LoopConfig;
  runId: string;
  goal: string;
  cwd: string;
  runDir: string;
  boardDir: string;
  promptDir: string;
  session: string;
};

export function nowIso(): string {
  return new Date().toISOString();
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export function prepareRun(
  loaded: LoadedConfig,
  project: ProjectConfig,
  runId: string,
  goal: string
): RunContext {
  const loop = project.loops[0] ?? {
    name: "delivery-loop",
    cadenceMinutes: 30,
    maxIterations: 8,
    stopWhen: ["tests pass", "all tasks done"],
    idleSeconds: 20,
    pollSeconds: 8,
    orchestrator: "pm"
  };
  const cwd = resolve(loaded.rootDir, project.workingDir);
  const runDir = resolve(loaded.rootDir, loaded.config.defaults.runDir, runId);
  const boardDir = resolve(runDir, "board");
  const promptDir = resolve(runDir, "prompts");
  mkdirSync(promptDir, { recursive: true });
  initBoard(boardDir);

  const session = sessionName(loaded.config.defaults.namespace, project.name, runId, "team");

  return { loaded, project, loop, runId, goal, cwd, runDir, boardDir, promptDir, session };
}

/** Write each role's persistent system prompt (SME + project intelligence + protocol). */
export function writeRolePrompts(ctx: RunContext): Record<string, string> {
  const files: Record<string, string> = {};
  for (const role of ctx.project.roles) {
    const file = resolve(ctx.promptDir, `${role.name}.md`);
    writeFileSync(file, buildRolePrompt(ctx.loaded, ctx.project, role, ctx.runId));
    files[role.name] = file;
  }
  return files;
}

/**
 * Decompose the goal into board tasks using the orchestrator role (a Claude planner).
 * If the orchestrator CLI is unavailable, fall back to a single task assigned to the
 * first non-orchestrator role so the run still proceeds.
 */
export function decomposeGoal(ctx: RunContext): BoardTask[] {
  const orchestratorRole = ctx.project.roles.find((r) => r.name === ctx.loop.orchestrator)
    ?? ctx.project.roles[0];
  const provider = ctx.project.providers[orchestratorRole.provider];
  const assignableRoles = ctx.project.roles
    .filter((r) => r.name !== orchestratorRole.name)
    .map((r) => ({ key: r.name, sme: r.sme ?? "engineer", title: r.title }));

  const planPrompt = [
    `You are the orchestrator for an autonomous engineering team. Decompose this GOAL into a small set of well-scoped, independent tasks.`,
    ``,
    `GOAL: ${ctx.goal}`,
    ``,
    `Available SMEs (use the "key" as the assignee):`,
    ...assignableRoles.map((r) => `- ${r.key} (${r.title}, discipline: ${r.sme})`),
    ``,
    `Output ONLY a JSON array. Each element:`,
    `{"title": str, "assignee": "<one of the keys above>", "description": str, "acceptanceCriteria": [str], "dependsOn": [], "priority": int}`,
    `Keep it to the few tasks that actually deliver the goal. No prose, no markdown fences.`
  ].join("\n");

  let tasks: BoardTask[] = [];
  if (provider && commandExists(provider.command ?? provider.type)) {
    const raw = runPlannerHeadless(ctx, orchestratorRole, planPrompt);
    tasks = parsePlanTasks(raw, orchestratorRole.name, assignableRoles.map((r) => r.key));
  }

  if (!tasks.length) {
    const fallbackAssignee = assignableRoles[0]?.key ?? orchestratorRole.name;
    tasks = [
      {
        id: "t1",
        title: ctx.goal.slice(0, 80),
        assignee: fallbackAssignee,
        createdBy: orchestratorRole.name,
        description: ctx.goal,
        acceptanceCriteria: ["The goal is implemented and the project's tests/build pass."],
        dependsOn: [],
        priority: 10,
        createdAt: nowIso()
      }
    ];
  }

  for (const task of tasks) addTask(ctx.boardDir, task);
  return tasks;
}

function runPlannerHeadless(ctx: RunContext, role: RoleConfig, prompt: string): string {
  const provider = ctx.project.providers[role.provider];
  const promptFile = resolve(ctx.promptDir, `${role.name}.md`);
  const cmd = buildHeadlessCommand(provider, prompt, promptFile);
  const result = spawnSync(cmd.command, cmd.args, {
    cwd: ctx.cwd,
    encoding: "utf8",
    env: { ...process.env, ...cmd.env },
    timeout: 180_000
  });
  return result.stdout ?? "";
}

function parsePlanTasks(raw: string, createdBy: string, validAssignees: string[]): BoardTask[] {
  const json = extractJsonArray(raw);
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as Array<Record<string, unknown>>;
    return arr.map((item, i) => {
      const assignee = String(item.assignee ?? "");
      return {
        id: `t${i + 1}`,
        title: String(item.title ?? `Task ${i + 1}`),
        assignee: validAssignees.includes(assignee) ? assignee : validAssignees[0] ?? createdBy,
        createdBy,
        description: String(item.description ?? item.title ?? ""),
        acceptanceCriteria: Array.isArray(item.acceptanceCriteria)
          ? item.acceptanceCriteria.map(String)
          : ["Meets the task description; project tests/build pass."],
        dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.map(String) : [],
        priority: typeof item.priority === "number" ? item.priority : 5,
        createdAt: nowIso()
      } satisfies BoardTask;
    });
  } catch {
    return [];
  }
}

/**
 * Extract the first JSON array from possibly-noisy CLI output.
 *
 * Providers wrap the model's answer in their own envelope. `claude --output-format json`
 * returns `{"result":"<text>"}` where `<text>` (which holds our task array) is *escaped
 * inside a JSON string* — so a naive `[`..`]` slice of the raw bytes grabs backslash-
 * escaped garbage. We therefore unwrap the envelope first:
 *   1. Parse the whole thing as JSON; if it has a `.result`/`.response`/`.text` string,
 *      recurse into that decoded string.
 *   2. Otherwise scan for the first balanced top-level `[...]` and return it.
 */
export function extractJsonArray(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // 1. Unwrap a provider JSON envelope so the inner array is properly unescaped.
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return JSON.stringify(parsed);
    if (parsed && typeof parsed === "object") {
      const inner = parsed.result ?? parsed.response ?? parsed.text ?? parsed.content;
      if (typeof inner === "string") {
        const nested = extractJsonArray(inner);
        if (nested) return nested;
      }
    }
  } catch {
    // not a single JSON document (e.g. stream-json) — fall through to scanning
  }

  // 2. Scan for the first balanced top-level array in the (now unescaped) text.
  const start = trimmed.indexOf("[");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  // Unbalanced — best effort to the last bracket.
  const end = trimmed.lastIndexOf("]");
  return end > start ? trimmed.slice(start, end + 1) : undefined;
}

function commandExists(command: string): boolean {
  return spawnSync("bash", ["-lc", `command -v ${shellQuote(command)}`], { stdio: "ignore" }).status === 0;
}

/** A task is dispatchable when all its dependencies are done. */
function dependenciesMet(task: TaskView, all: TaskView[]): boolean {
  if (!task.dependsOn.length) return true;
  const byId = new Map(all.map((t) => [t.id, t]));
  return task.dependsOn.every((dep) => byId.get(dep)?.status === "done");
}

/**
 * Run one headless SME child for a task inside its tmux pane (so a human watching the
 * window sees the work), detect completion by exit code + structured output, then run
 * the project's verification command as the final gate before marking the task done.
 */
async function dispatchTask(
  ctx: RunContext,
  role: RoleConfig,
  task: TaskView,
  paneId: string,
  verifyCmd: string | undefined
): Promise<void> {
  const provider = ctx.project.providers[role.provider];
  const promptFile = resolve(ctx.promptDir, `${role.name}.md`);

  addEvent(ctx.boardDir, { ts: nowIso(), role: role.name, taskId: task.id, status: "claimed" });

  const taskText = [
    `TASK ${task.id}: ${task.title}`,
    task.description,
    ``,
    `Acceptance criteria:`,
    ...task.acceptanceCriteria.map((c) => `- ${c}`),
    ``,
    `When finished, append your done/blocked/needs-review event to .loop/board/events.jsonl as instructed in your role prompt.`
  ].join("\n");

  const cmd = buildHeadlessCommand(provider, taskText, promptFile);
  // Show the command in the watching pane, then run the headless child ourselves so we
  // own exit-code detection (the pane is the viewport; the child is the source of truth).
  runCommandInPane(paneId, `# ${role.name} → ${task.id}: ${task.title}`);

  const ok = await runHeadlessChild(ctx, cmd.command, cmd.args, cmd.env, paneId);

  let verified = ok;
  if (ok && verifyCmd) {
    verified = runVerify(ctx.cwd, verifyCmd);
  }

  addEvent(ctx.boardDir, {
    ts: nowIso(),
    role: role.name,
    taskId: task.id,
    status: verified ? "needs-review" : "blocked",
    summary: verified
      ? `Implemented; ${verifyCmd ? "verification passed" : "no verify cmd"}.`
      : ok
        ? `Implemented but verification (${verifyCmd}) failed.`
        : `Agent exited non-zero or produced no result.`
  });
}

function runHeadlessChild(
  ctx: RunContext,
  command: string,
  args: string[],
  env: Record<string, string>,
  paneId: string
): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: ctx.cwd,
      env: { ...process.env, ...env }
    });
    let out = "";
    let err = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, ctx.loop.cadenceMinutes * 60_000);

    child.stdout.on("data", (d) => {
      out += d.toString();
      // Mirror a trimmed tail into the watching pane for the human viewport.
      mirrorToPane(paneId, d.toString());
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolvePromise(false);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolvePromise(code === 0 && agentReportedSuccess(out));
    });
  });
}

/**
 * Decide whether a headless agent actually succeeded, from its structured output.
 *
 * Critically, an exit code of 0 is NOT sufficient: `claude --output-format json` exits 0
 * even when it returns `{"is_error": true}` (e.g. an unavailable model or a refusal). We
 * therefore parse the structured result and treat an explicit error flag as failure.
 * Falls back to "non-empty output" only when no recognizable structured field is present.
 */
export function agentReportedSuccess(stdout: string): boolean {
  const trimmed = stdout.trim();
  if (!trimmed) return false;

  // claude/gemini/codex JSON results expose an `is_error` boolean somewhere in the
  // stream. If we can find an explicit value, trust it.
  const errorMatch = /"is_error"\s*:\s*(true|false)/.exec(trimmed);
  if (errorMatch) return errorMatch[1] === "false";

  // codex `--json` emits a stream of events; a terminal error event marks failure.
  if (/"type"\s*:\s*"error"/.test(trimmed)) return false;
  if (/"error"\s*:\s*\{/.test(trimmed) && !/"result"/.test(trimmed)) return false;

  // No structured signal — accept any substantive output.
  return trimmed.length > 0;
}

function mirrorToPane(paneId: string, chunk: string): void {
  const line = chunk.split("\n").filter(Boolean).slice(-1)[0];
  if (!line) return;
  // display-message is non-destructive and shows in the pane's status without
  // interfering with the running viewport.
  spawnSync("tmux", ["display-message", "-t", paneId, "-d", "1", line.slice(0, 120)], { stdio: "ignore" });
}

function runVerify(cwd: string, verifyCmd: string): boolean {
  const result = spawnSync("bash", ["-lc", verifyCmd], { cwd, stdio: "ignore", timeout: 300_000 });
  return result.status === 0;
}

/** stopWhen evaluation: today we support the structural condition "all tasks done". */
function stopConditionMet(ctx: RunContext): boolean {
  return isComplete(ctx.boardDir);
}

export type IterationReport = {
  iteration: number;
  dispatched: { role: string; taskId: string }[];
  summary: ReturnType<typeof boardSummary>;
};

/**
 * The autonomy loop. Each iteration: for every SME, dispatch its highest-priority
 * dependency-satisfied open task as a headless child in its pane; PM/orchestrator
 * reviews needs-review tasks and accepts/rejects; check stopWhen; repeat until done
 * or maxIterations.
 */
export async function runAutonomyLoop(
  ctx: RunContext,
  roleFiles: Record<string, string>,
  options: { execute: boolean; onIteration?: (r: IterationReport) => void }
): Promise<IterationReport[]> {
  const verifyCmd = detectVerifyCommand(ctx);
  const panes = ensureWindow(
    ctx.session,
    ctx.cwd,
    ctx.project.roles.map((r) => ({ name: r.name, title: paneTitle(r.title) }))
  );

  const reports: IterationReport[] = [];

  for (let iteration = 1; iteration <= ctx.loop.maxIterations; iteration++) {
    const dispatched: { role: string; taskId: string }[] = [];
    const all = foldBoard(ctx.boardDir);

    for (const role of ctx.project.roles) {
      // The orchestrator/PM does review, not implementation dispatch, in this pass.
      const open = openTasksFor(ctx.boardDir, role.name)
        .filter((t) => dependenciesMet(t, all))
        .sort((a, b) => b.priority - a.priority);
      const next = open[0];
      if (!next) continue;
      const paneId = panes[role.name];
      if (!paneId) continue;

      if (options.execute) {
        await dispatchTask(ctx, role, next, paneId, verifyCmd);
      } else {
        // Prompt-only: claim + emit a needs-review so the loop is observable without spend.
        addEvent(ctx.boardDir, { ts: nowIso(), role: role.name, taskId: next.id, status: "claimed" });
        addEvent(ctx.boardDir, {
          ts: nowIso(),
          role: role.name,
          taskId: next.id,
          status: "needs-review",
          summary: "(prompt-only mode — no agent executed)"
        });
      }
      dispatched.push({ role: role.name, taskId: next.id });
    }

    // Orchestrator review: auto-accept needs-review tasks (a real PM agent can override).
    reviewPass(ctx);

    const summary = boardSummary(ctx.boardDir);
    const report: IterationReport = { iteration, dispatched, summary };
    reports.push(report);
    options.onIteration?.(report);

    if (stopConditionMet(ctx)) break;
    if (!dispatched.length) break; // nothing left to do
    await delay(ctx.loop.pollSeconds * 1000);
  }

  return reports;
}

/**
 * Review pass run by the orchestrator. Accepts needs-review tasks (marks done). A real
 * PM agent prompt can replace this with criteria-based accept/reject; for the engine we
 * advance the board so the loop converges.
 */
function reviewPass(ctx: RunContext): void {
  const orchestrator = ctx.loop.orchestrator;
  for (const task of foldBoard(ctx.boardDir)) {
    if (task.status === "needs-review") {
      addEvent(ctx.boardDir, {
        ts: nowIso(),
        role: orchestrator,
        taskId: task.id,
        status: "done",
        summary: "Accepted by orchestrator review."
      });
    }
  }
}

function detectVerifyCommand(ctx: RunContext): string | undefined {
  // Prefer test, then build, from the project intelligence we generated.
  const intelFile = resolve(ctx.cwd, ctx.project.intelligence);
  if (!existsSync(intelFile)) {
    try {
      writeIntelligence(ctx.cwd, intelFile);
    } catch {
      return undefined;
    }
  }
  // Re-derive commands from the analyzer (authoritative) rather than parsing markdown.
  const intel = analyzeProject(ctx.cwd);
  return intel.commands.test ?? intel.commands.build;
}
