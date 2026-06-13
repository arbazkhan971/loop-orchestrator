import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  boardSummary,
  readEvents,
  readMessages,
  TaskView,
  type BoardEvent,
  type BoardMessage
} from "../board.js";
import { costLedgerPath } from "../cost.js";
import { readFileSync } from "node:fs";
import type { ProjectConfig } from "../config/schema.js";

/**
 * Aggregations that turn the raw board/events/cost logs into the insightful, actionable
 * views the dashboard renders: run KPIs, per-agent swimlanes, an activity timeline, a
 * cost breakdown, and a "needs attention" list. All pure reads — safe to poll.
 */

const ACTIVE_STATUSES = new Set(["claimed", "in-progress"]);
const DONE_STATUSES = new Set(["done"]);
const ATTENTION_STATUSES = new Set(["blocked", "rejected", "escalated"]);

export type AgentCard = {
  role: string;
  title: string;
  sme?: string;
  provider: string;
  state: "working" | "review-pending" | "blocked" | "idle";
  currentTaskId?: string;
  currentTaskTitle?: string;
  lastActivity?: string;
  lastSummary?: string;
  attempts: number;
  spendUsd: number;
  done: number;
};

export type TimelineEntry = {
  ts: string;
  kind: "event" | "message";
  role: string;
  to?: string;
  taskId?: string;
  status?: string;
  text: string;
};

export type Overview = {
  project: string;
  totals: { total: number; done: number; inProgress: number; blocked: number; open: number; needsReview: number };
  byStatus: Record<string, number>;
  progressPct: number;
  agentsActive: number;
  agentsTotal: number;
  rejections: number;
  retries: number;
  escalated: number;
  spendUsd: number;
  budgetUsd: number;
  budgetPct: number | null;
  tokensIn: number;
  tokensOut: number;
  lastActivity?: string;
  /** Estimated ms to completion: avg done-task duration × remaining / parallelism. */
  estCompletionMs: number | null;
};

export type GraphNode = {
  id: string;
  title: string;
  status: string;
  assignee: string;
  priority: number;
  ready: boolean;
  blockedBy: string[];
  onCriticalPath: boolean;
};

export type Graph = {
  nodes: GraphNode[];
  edges: { from: string; to: string; satisfied: boolean }[];
  criticalPath: string[];
};

type CostRow = { ts: string; role: string; taskId: string; usd: number; inputTokens?: number; outputTokens?: number };

function readCosts(boardDir: string): CostRow[] {
  const path = costLedgerPath(boardDir);
  if (!existsSync(path)) return [];
  const out: CostRow[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as CostRow);
    } catch {
      /* skip torn line */
    }
  }
  return out;
}

export function buildOverview(boardDir: string, project: ProjectConfig): Overview {
  const { total, byStatus, views } = boardSummary(boardDir);
  const events = readEvents(boardDir);
  const costs = readCosts(boardDir);

  const done = views.filter((v) => DONE_STATUSES.has(v.status)).length;
  const inProgress = views.filter((v) => ACTIVE_STATUSES.has(v.status)).length;
  const blocked = views.filter((v) => ATTENTION_STATUSES.has(v.status)).length;
  const open = views.filter((v) => v.status === "open").length;

  const rejections = events.filter((e) => e.status === "rejected").length;
  const retries = views.reduce((sum, v) => sum + Math.max(0, v.attempts), 0);
  const escalated = views.filter((v) => v.status === "escalated").length;

  const spendUsd = costs.reduce((s, c) => s + (Number(c.usd) || 0), 0);
  const tokensIn = costs.reduce((s, c) => s + (c.inputTokens ?? 0), 0);
  const tokensOut = costs.reduce((s, c) => s + (c.outputTokens ?? 0), 0);
  const budgetUsd = project.loops[0]?.budgetUsd ?? 0;

  const lastActivity = events.length ? events[events.length - 1].ts : undefined;
  const activeRoles = new Set(
    views.filter((v) => ACTIVE_STATUSES.has(v.status)).map((v) => v.claimedBy ?? v.assignee)
  );

  const needsReview = views.filter((v) => v.status === "needs-review").length;
  const remaining = total - done - escalated;
  const maxParallel = Math.max(1, project.loops[0]?.maxParallel ?? 1);

  return {
    project: project.name,
    totals: { total, done, inProgress, blocked, open, needsReview },
    byStatus,
    progressPct: total ? Math.round((done / Math.max(1, total - escalated)) * 100) : 0,
    agentsActive: activeRoles.size,
    agentsTotal: project.roles.length,
    rejections,
    retries,
    escalated,
    spendUsd: round(spendUsd),
    budgetUsd,
    budgetPct: budgetUsd > 0 ? Math.min(100, Math.round((spendUsd / budgetUsd) * 100)) : null,
    tokensIn,
    tokensOut,
    lastActivity,
    estCompletionMs: estimateCompletion(views, remaining, maxParallel)
  };
}

/** Mean wall-clock duration of completed tasks × remaining / parallelism. Null until 1 done. */
function estimateCompletion(views: TaskView[], remaining: number, maxParallel: number): number | null {
  const durations: number[] = [];
  for (const v of views) {
    if (v.status !== "done" || !v.lastUpdate) continue;
    const start = new Date(v.createdAt).getTime();
    const end = new Date(v.lastUpdate).getTime();
    if (end > start) durations.push(end - start);
  }
  if (!durations.length || remaining <= 0) return remaining <= 0 ? 0 : null;
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  return Math.round((avg * remaining) / maxParallel);
}

export function buildGraph(boardDir: string): Graph {
  const { views } = boardSummary(boardDir);
  const doneIds = new Set(views.filter((v) => v.status === "done").map((v) => v.id));
  const crit = new Set(criticalPath(views));

  const nodes: GraphNode[] = views.map((v) => {
    const blockedBy = (v.dependsOn ?? []).filter((d) => !doneIds.has(d));
    return {
      id: v.id,
      title: v.title,
      status: v.status,
      assignee: v.claimedBy ?? v.assignee,
      priority: v.priority,
      ready: blockedBy.length === 0 && v.status === "open",
      blockedBy,
      onCriticalPath: crit.has(v.id)
    };
  });

  const edges: Graph["edges"] = [];
  for (const v of views) {
    for (const dep of v.dependsOn ?? []) {
      edges.push({ from: dep, to: v.id, satisfied: doneIds.has(dep) });
    }
  }

  return { nodes, edges, criticalPath: [...crit] };
}

export function buildAgentCards(boardDir: string, project: ProjectConfig): AgentCard[] {
  const { views } = boardSummary(boardDir);
  const events = readEvents(boardDir);
  const costs = readCosts(boardDir);

  const spendByRole = new Map<string, number>();
  for (const c of costs) spendByRole.set(c.role, (spendByRole.get(c.role) ?? 0) + (Number(c.usd) || 0));

  return project.roles.map((role) => {
    const mine = views.filter((v) => (v.claimedBy ?? v.assignee) === role.name);
    const active = mine.find((v) => ACTIVE_STATUSES.has(v.status));
    const review = mine.find((v) => v.status === "needs-review");
    const blocked = mine.find((v) => ATTENTION_STATUSES.has(v.status));
    const current = active ?? review ?? blocked;
    const lastEvent = [...events].reverse().find((e) => e.role === role.name);
    const done = mine.filter((v) => DONE_STATUSES.has(v.status)).length;

    let state: AgentCard["state"] = "idle";
    if (active) state = "working";
    else if (review) state = "review-pending";
    else if (blocked) state = "blocked";

    return {
      role: role.name,
      title: role.title,
      sme: role.sme,
      provider: role.provider,
      state,
      currentTaskId: current?.id,
      currentTaskTitle: current?.title,
      lastActivity: lastEvent?.ts,
      lastSummary: current?.lastSummary ?? lastEvent?.summary,
      attempts: current?.attempts ?? 0,
      spendUsd: round(spendByRole.get(role.name) ?? 0),
      done
    };
  });
}

export function buildTimeline(boardDir: string, limit = 60): TimelineEntry[] {
  const events: TimelineEntry[] = readEvents(boardDir).map((e: BoardEvent) => ({
    ts: e.ts,
    kind: "event",
    role: e.role,
    taskId: e.taskId,
    status: e.status,
    text: e.summary ?? `${e.role} → ${e.taskId}: ${e.status}`
  }));
  const messages: TimelineEntry[] = readMessages(boardDir).map((m: BoardMessage) => ({
    ts: m.ts,
    kind: "message",
    role: m.from,
    to: m.to,
    taskId: m.taskId,
    text: m.body
  }));
  return [...events, ...messages]
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, limit);
}

/** Tasks needing a human's eyes: blocked, rejected, escalated, plus budget warnings. */
export function buildAttention(boardDir: string, project: ProjectConfig): {
  tasks: TaskView[];
  warnings: string[];
} {
  const { views } = boardSummary(boardDir);
  const tasks = views.filter((v) => ATTENTION_STATUSES.has(v.status));
  const warnings: string[] = [];
  const overview = buildOverview(boardDir, project);
  if (overview.budgetPct !== null && overview.budgetPct >= 80) {
    warnings.push(`Budget ${overview.budgetPct}% spent ($${overview.spendUsd} of $${overview.budgetUsd}).`);
  }
  if (overview.escalated > 0) warnings.push(`${overview.escalated} task(s) escalated to a human after exhausting repairs.`);
  return { tasks, warnings };
}

/**
 * The critical path: the longest chain of dependencies among not-yet-done tasks. These
 * are the tasks that actually gate completion — the operator should care about these
 * before anything else.
 */
export function criticalPath(views: TaskView[]): string[] {
  const byId = new Map(views.map((v) => [v.id, v]));
  const memo = new Map<string, string[]>();

  const chain = (id: string, seen: Set<string>): string[] => {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return []; // cycle guard
    seen.add(id);
    const task = byId.get(id);
    if (!task) return [];
    let best: string[] = [];
    for (const dep of task.dependsOn) {
      const c = chain(dep, new Set(seen));
      if (c.length > best.length) best = c;
    }
    const result = [...best, id];
    memo.set(id, result);
    return result;
  };

  let longest: string[] = [];
  for (const v of views) {
    if (v.status === "done") continue;
    const c = chain(v.id, new Set());
    if (c.length > longest.length) longest = c;
  }
  return longest;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
