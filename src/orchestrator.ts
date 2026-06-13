import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addEvent,
  addMessage,
  addTask,
  BoardTask,
  boardSummary,
  foldBoard,
  gatherContext,
  initBoard,
  isComplete,
  openTasksFor,
  retryableTasksFor,
  TaskView
} from "./board.js";
import { LoadedConfig } from "./config/load.js";
import { LoopConfig, ProjectConfig, RoleConfig } from "./config/schema.js";
import { initCostLedger, parseCost, recordCost, totalSpend } from "./cost.js";
import {
  discoverTestFiles,
  hashFiles,
  headSha,
  hasChanges,
  isGitRepo,
  revertWorkingTree,
  workingDiff
} from "./git.js";
import { analyzeProject, writeIntelligence } from "./intelligence.js";
import { buildHeadlessCommand, commandToShell, shellQuote } from "./providers.js";
import { buildRolePrompt } from "./prompts.js";
import { ensureWindow, paneTitle, runCommandInPane, sessionName } from "./tmux.js";
import {
  cleanupRunWorktrees,
  ensureWorktree,
  mergeWorktree,
  Worktree,
  worktreesSupported
} from "./worktree.js";

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
  /** role -> isolated worktree, populated when isolation is enabled. */
  worktrees?: Record<string, Worktree>;
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
  verifyCmd: string | undefined,
  workCwd: string = ctx.cwd
): Promise<void> {
  const provider = ctx.project.providers[role.provider];
  const promptFile = resolve(ctx.promptDir, `${role.name}.md`);
  const isRepair = task.attempts > 0 || task.status === "blocked" || task.status === "rejected";

  addEvent(ctx.boardDir, { ts: nowIso(), role: role.name, taskId: task.id, status: "claimed" });

  // #3 Snapshot the world BEFORE the agent touches it: HEAD for diff/revert, test-file
  // hashes to detect reward-hacking, and the baseline test result so we only revert true
  // regressions (not a suite that was already red). All scoped to this role's worktree.
  const git = isGitRepo(workCwd);
  const baseSha = git ? headSha(workCwd) : undefined;
  const testFiles = git ? discoverTestFiles(workCwd) : [];
  const testHashBefore = git ? hashFiles(workCwd, testFiles) : "";
  const baselineGreen = verifyCmd ? runVerify(workCwd, verifyCmd).ok : true;

  // #4 Give the SME the inbox + upstream results so coordination is real, and #2 inject
  // the prior failure so a repair attempt doesn't repeat the same mistake.
  const context = gatherContext(ctx.boardDir, role.name, task);
  const taskText = [
    isRepair ? `REPAIR ATTEMPT ${task.attempts + 1} for TASK ${task.id}` : `TASK ${task.id}: ${task.title}`,
    task.description,
    ``,
    `Acceptance criteria:`,
    ...task.acceptanceCriteria.map((c) => `- ${c}`),
    context ? `\n${context}` : "",
    isRepair && task.lastSummary
      ? `\nPREVIOUS ATTEMPT FAILED: ${task.lastSummary}\nDo NOT repeat the failed approach. Fix the root cause.`
      : "",
    ``,
    `Do not modify test files or CI config to make checks pass — that is treated as tampering and will be rejected.`,
    `When finished, append your done/blocked/needs-review event to .loop/board/events.jsonl as instructed in your role prompt.`
  ].join("\n");

  const cmd = buildHeadlessCommand(provider, taskText, promptFile);
  runCommandInPane(paneId, `# ${role.name} → ${task.id}: ${task.title}${isRepair ? " (repair)" : ""}`);

  const result = await runHeadlessChild(ctx, cmd.command, cmd.args, cmd.env, paneId, workCwd);

  // #7 Record whatever spend the agent reported.
  const cost = parseCost(result.stdout);
  if (cost.usd > 0 || cost.outputTokens) {
    recordCost(ctx.boardDir, {
      ts: nowIso(),
      role: role.name,
      taskId: task.id,
      usd: cost.usd,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens
    });
  }

  // #3 Reward-hacking guard: if the agent altered its own grader, hard-block regardless
  // of what the suite now reports.
  if (git && testFiles.length && hashFiles(workCwd, testFiles) !== testHashBefore) {
    revertWorkingTree(workCwd);
    addEvent(ctx.boardDir, {
      ts: nowIso(),
      role: role.name,
      taskId: task.id,
      status: "blocked",
      summary: "Rejected: agent modified test/CI files (tampering with the grader)."
    });
    return;
  }

  if (!result.ok) {
    if (git) revertWorkingTree(workCwd);
    addEvent(ctx.boardDir, {
      ts: nowIso(),
      role: role.name,
      taskId: task.id,
      status: "blocked",
      summary: `Agent failed: ${failureTail(result.stdout, result.stderr) || "exited non-zero / no result"}`
    });
    return;
  }

  if (git && !hasChanges(workCwd)) {
    addEvent(ctx.boardDir, {
      ts: nowIso(),
      role: role.name,
      taskId: task.id,
      status: "blocked",
      summary: "Agent reported success but made no changes to the working tree."
    });
    return;
  }

  let verifyOutput = "";
  let verified = true;
  if (verifyCmd) {
    const v = runVerify(workCwd, verifyCmd);
    verified = v.ok;
    verifyOutput = v.output;
  }

  // #3 Revert a regression: only when the suite was green before and is red now. Never
  // let a regression persist on disk for the next task to inherit.
  if (baselineGreen && !verified) {
    if (git) revertWorkingTree(workCwd);
    addEvent(ctx.boardDir, {
      ts: nowIso(),
      role: role.name,
      taskId: task.id,
      status: "blocked",
      summary: `Verification (${verifyCmd}) regressed — reverted. ${failureTail(verifyOutput, "")}`
    });
    return;
  }

  addEvent(ctx.boardDir, {
    ts: nowIso(),
    role: role.name,
    taskId: task.id,
    status: verified ? "needs-review" : "blocked",
    summary: verified
      ? `Implemented; ${verifyCmd ? "verification passed" : "no verify cmd"}.`
      : `Implemented but verification (${verifyCmd}) failed. ${failureTail(verifyOutput, "")}`
  });
}

export type ChildResult = { ok: boolean; stdout: string; stderr: string; code: number | null };

function runHeadlessChild(
  ctx: RunContext,
  command: string,
  args: string[],
  env: Record<string, string>,
  paneId: string,
  cwd: string = ctx.cwd
): Promise<ChildResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
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
      resolvePromise({ ok: false, stdout: out, stderr: err, code: null });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolvePromise({ ok: code === 0 && agentReportedSuccess(out), stdout: out, stderr: err, code });
    });
  });
}

/** A short, prompt-injectable tail of a failure for the repair loop's error re-injection. */
export function failureTail(stdout: string, stderr: string, max = 600): string {
  const combined = `${stderr}\n${stdout}`
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const tail = combined.slice(-12).join(" ");
  return tail.length > max ? tail.slice(-max) : tail;
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

function runVerify(cwd: string, verifyCmd: string): { ok: boolean; output: string } {
  const result = spawnSync("bash", ["-lc", verifyCmd], { cwd, encoding: "utf8", timeout: 300_000 });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
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
  initCostLedger(ctx.boardDir);
  const panes = ensureWindow(
    ctx.session,
    ctx.cwd,
    ctx.project.roles.map((r) => ({ name: r.name, title: paneTitle(r.title) }))
  );

  const reports: IterationReport[] = [];
  const budget = ctx.loop.budgetUsd ?? 0;
  // #5/#6 Isolation enables real parallelism. Worktrees require a git repo; without one we
  // force serial execution so concurrent agents can't clobber the shared working dir.
  const isolate = ctx.loop.isolate && worktreesSupported(ctx.cwd);
  const maxParallel = isolate ? Math.max(1, ctx.loop.maxParallel) : 1;
  // Track each role's worktree across iterations so the critic can merge accepted work back.
  ctx.worktrees = ctx.worktrees ?? {};

  for (let iteration = 1; iteration <= ctx.loop.maxIterations; iteration++) {
    const all = foldBoard(ctx.boardDir);

    // Select at most one task per role this iteration (a role works one thing at a time),
    // skipping roles that already have work awaiting review.
    const pendingReview = new Set(
      all.filter((t) => t.status === "needs-review").map((t) => t.claimedBy ?? t.assignee)
    );
    const selected: { role: RoleConfig; task: TaskView }[] = [];
    for (const role of ctx.project.roles) {
      if (pendingReview.has(role.name)) continue;
      const open = openTasksFor(ctx.boardDir, role.name).filter((t) => dependenciesMet(t, all));
      const retryable = retryableTasksFor(ctx.boardDir, role.name, ctx.loop.maxRepairs).filter((t) =>
        dependenciesMet(t, all)
      );
      const next = [...retryable, ...open].sort((a, b) => b.priority - a.priority)[0];
      if (next && panes[role.name]) selected.push({ role, task: next });
    }

    // #6 Dispatch the selected SMEs CONCURRENTLY in batches bounded by maxParallel, each in
    // its own worktree. This is the team working in true parallel end-to-end.
    const dispatched: { role: string; taskId: string }[] = [];
    for (let i = 0; i < selected.length; i += maxParallel) {
      if (budget > 0 && totalSpend(ctx.boardDir) >= budget) break;
      const batch = selected.slice(i, i + maxParallel);
      await Promise.allSettled(
        batch.map(({ role, task }) => {
          dispatched.push({ role: role.name, taskId: task.id });
          if (!options.execute) {
            addEvent(ctx.boardDir, { ts: nowIso(), role: role.name, taskId: task.id, status: "claimed" });
            addEvent(ctx.boardDir, {
              ts: nowIso(),
              role: role.name,
              taskId: task.id,
              status: "needs-review",
              summary: "(prompt-only mode — no agent executed)"
            });
            return Promise.resolve();
          }
          const wt = isolate ? ensureWorktree(ctx.cwd, ctx.runId, role.name) : undefined;
          if (wt) ctx.worktrees![role.name] = wt;
          return dispatchTask(ctx, role, task, panes[role.name], verifyCmd, wt?.path ?? ctx.cwd);
        })
      );
    }

    // #1 Independent critic review of every needs-review task; #2 escalate exhausted ones.
    await reviewPass(ctx, panes, options.execute, verifyCmd);
    escalateExhausted(ctx);

    const summary = boardSummary(ctx.boardDir);
    const report: IterationReport = { iteration, dispatched, summary };
    reports.push(report);
    options.onIteration?.(report);

    if (stopConditionMet(ctx)) break;
    if (budget > 0 && totalSpend(ctx.boardDir) >= budget) break;
    if (!dispatched.length) break; // nothing left to do
    await delay(ctx.loop.pollSeconds * 1000);
  }

  if (isolate) cleanupRunWorktrees(ctx.cwd, ctx.runId, ctx.project.roles.map((r) => r.name));
  return reports;
}

export type Verdict = { verdict: "accept" | "reject"; reasons: string[] };

/**
 * #1 Real critic pass. For every task awaiting review, an INDEPENDENT reviewer SME (a
 * different role/provider than the implementer wherever possible) reviews the actual git
 * diff against the acceptance criteria and returns accept/reject. Accept → done + a
 * hand-off message to the next role; reject → rejected + a repair task fed back to the
 * implementer. This replaces the old rubber-stamp that marked everything done.
 *
 * In prompt-only (dry-run) mode there is no diff and no spend, so we accept to keep the
 * loop observable — the real gate only runs under --execute.
 */
async function reviewPass(
  ctx: RunContext,
  panes: Record<string, string>,
  execute: boolean,
  verifyCmd: string | undefined
): Promise<void> {
  for (const task of foldBoard(ctx.boardDir)) {
    if (task.status !== "needs-review") continue;

    if (!execute) {
      addEvent(ctx.boardDir, {
        ts: nowIso(),
        role: ctx.loop.orchestrator,
        taskId: task.id,
        status: "done",
        summary: "Accepted (prompt-only mode — no independent review)."
      });
      continue;
    }

    const implementer = task.claimedBy ?? task.assignee;
    const wt = ctx.worktrees?.[implementer];
    const reviewerRole = pickReviewer(ctx, task);
    const verdict = await runReviewAgent(ctx, reviewerRole, task, panes[reviewerRole.name], wt?.path);

    if (verdict.verdict === "accept") {
      // #5 Merge the accepted work from the implementer's isolated worktree back to the
      // main branch. A conflict or failed merge sends it back for repair rather than
      // silently accepting un-merged work.
      let mergeNote = "";
      if (wt) {
        const merge = mergeWorktree(ctx.cwd, wt);
        if (!merge.ok) {
          addEvent(ctx.boardDir, {
            ts: nowIso(),
            role: reviewerRole.name,
            taskId: task.id,
            status: "rejected",
            summary: `Accepted but merge failed (${merge.reason ?? "conflict"}) — needs rebase.`.slice(0, 240)
          });
          addMessage(ctx.boardDir, {
            ts: nowIso(),
            from: reviewerRole.name,
            to: implementer,
            taskId: task.id,
            body: `Your change for ${task.id} conflicts on merge: ${merge.reason ?? "conflict"}. Rebase on main and resubmit.`
          });
          continue;
        }
        mergeNote = " Merged to main.";
      }
      addEvent(ctx.boardDir, {
        ts: nowIso(),
        role: reviewerRole.name,
        taskId: task.id,
        status: "done",
        summary: `Accepted by ${reviewerRole.name}.${mergeNote} ${verdict.reasons.join("; ")}`.slice(0, 240)
      });
      // #4 Hand off: tell the downstream dependents their input is ready.
      addMessage(ctx.boardDir, {
        ts: nowIso(),
        from: reviewerRole.name,
        to: "*",
        taskId: task.id,
        body: `Task ${task.id} (${task.title}) accepted and complete.${mergeNote}`
      });
    } else {
      const reasons = verdict.reasons.length ? verdict.reasons.join("; ") : "did not meet acceptance criteria";
      addEvent(ctx.boardDir, {
        ts: nowIso(),
        role: reviewerRole.name,
        taskId: task.id,
        status: "rejected",
        summary: `Rejected by ${reviewerRole.name}: ${reasons}`.slice(0, 240)
      });
      // #4 Send the rejection back to the implementer so the repair attempt has the why.
      addMessage(ctx.boardDir, {
        ts: nowIso(),
        from: reviewerRole.name,
        to: task.claimedBy ?? task.assignee,
        taskId: task.id,
        body: `Review REJECTED task ${task.id}: ${reasons}. Fix and resubmit.`
      });
    }
  }
}

/** Pick an independent reviewer: prefer the configured reviewer role, else any role whose
 *  provider differs from the implementer, else the orchestrator. Never self-review. */
function pickReviewer(ctx: RunContext, task: TaskView): RoleConfig {
  const implementerRole = ctx.project.roles.find((r) => r.name === (task.claimedBy ?? task.assignee));
  const implementerProvider = implementerRole?.provider;
  const configured = ctx.project.roles.find((r) => r.name === ctx.loop.reviewer);
  if (configured && configured.name !== implementerRole?.name) return configured;

  const independent = ctx.project.roles.find(
    (r) => r.name !== implementerRole?.name && r.provider !== implementerProvider
  );
  if (independent) return independent;

  return (
    ctx.project.roles.find((r) => r.name === ctx.loop.orchestrator) ??
    ctx.project.roles.find((r) => r.name !== implementerRole?.name) ??
    ctx.project.roles[0]
  );
}

async function runReviewAgent(
  ctx: RunContext,
  reviewer: RoleConfig,
  task: TaskView,
  paneId: string | undefined,
  reviewCwd: string = ctx.cwd
): Promise<Verdict> {
  const provider = ctx.project.providers[reviewer.provider];
  if (!provider) return { verdict: "reject", reasons: ["reviewer provider missing"] };

  // Diff the implementer's worktree (where the change actually lives) so the reviewer
  // sees the real change even before it's merged back to main.
  const diff = isGitRepo(reviewCwd) ? workingDiff(reviewCwd, undefined) : "(not a git repo — review by reading the working tree)";
  const promptFile = resolve(ctx.promptDir, `${reviewer.name}.md`);
  const reviewPrompt = [
    `You are an INDEPENDENT reviewer. You did NOT write this code. Review it adversarially.`,
    `Review the change for task ${task.id}: "${task.title}" against its acceptance criteria.`,
    ``,
    `Acceptance criteria:`,
    ...task.acceptanceCriteria.map((c) => `- ${c}`),
    ``,
    `The diff under review:`,
    "```diff",
    diff,
    "```",
    ``,
    `Reject if any criterion is unmet, if tests were weakened, or if the change is incorrect/unsafe.`,
    `Respond with ONLY a JSON object, no prose: {"verdict":"accept"|"reject","reasons":["..."]}`
  ].join("\n");

  if (paneId) runCommandInPane(paneId, `# review ${task.id} (${reviewer.name})`);
  const cmd = buildHeadlessCommand(provider, reviewPrompt, promptFile);
  const result = await runHeadlessChild(ctx, cmd.command, cmd.args, cmd.env, paneId ?? "", reviewCwd);

  const cost = parseCost(result.stdout);
  if (cost.usd > 0 || cost.outputTokens) {
    recordCost(ctx.boardDir, { ts: nowIso(), role: reviewer.name, taskId: task.id, usd: cost.usd, inputTokens: cost.inputTokens, outputTokens: cost.outputTokens });
  }

  return parseVerdict(result.stdout);
}

export function parseVerdict(raw: string): Verdict {
  // Unwrap provider envelope (claude wraps the model text in {"result":"..."}).
  let text = raw;
  try {
    const env = JSON.parse(raw.trim());
    if (env && typeof env === "object" && typeof env.result === "string") text = env.result;
  } catch {
    // not an envelope
  }
  const match = /\{[\s\S]*?"verdict"[\s\S]*?\}/.exec(text);
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as { verdict?: string; reasons?: unknown };
      const verdict = obj.verdict === "accept" ? "accept" : "reject";
      const reasons = Array.isArray(obj.reasons) ? obj.reasons.map(String) : [];
      return { verdict, reasons };
    } catch {
      // fall through
    }
  }
  // Heuristic fallback: explicit "accept" with no "reject" → accept; else reject (safe default).
  const lower = text.toLowerCase();
  if (lower.includes("accept") && !lower.includes("reject")) return { verdict: "accept", reasons: ["heuristic accept"] };
  return { verdict: "reject", reasons: ["could not parse a clear verdict — defaulting to reject"] };
}

/** #2 Tasks that have exhausted their repair budget are escalated (terminal), not stranded. */
function escalateExhausted(ctx: RunContext): void {
  for (const task of foldBoard(ctx.boardDir)) {
    if ((task.status === "blocked" || task.status === "rejected") && task.attempts >= ctx.loop.maxRepairs) {
      addEvent(ctx.boardDir, {
        ts: nowIso(),
        role: ctx.loop.orchestrator,
        taskId: task.id,
        status: "escalated",
        summary: `Escalated to human after ${task.attempts} failed attempts: ${task.lastSummary ?? ""}`.slice(0, 240)
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
