import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";

/**
 * Shared blackboard for the autonomous SME team.
 *
 * Coordination happens through three append-only JSONL logs under `.loop/board/`:
 *  - tasks.jsonl   the work items the orchestrator/PM decomposes a goal into
 *  - events.jsonl  status updates SMEs emit (claimed/done/blocked/needs-review)
 *  - messages.jsonl free-form hand-off notes between roles
 *
 * Append-only JSONL is the safest cross-process format we can get with tmux as the
 * only IPC: every writer only ever appends a single line, and `appendFileSync` opens
 * with O_APPEND so concurrent single-line writes below PIPE_BUF do not interleave on
 * local filesystems. We never rewrite history; the *current* state of a task is the
 * reduction of its event stream. Claims are resolved by "first claim event wins",
 * which is decided when we fold the log — no lock needed for correctness, only a tiny
 * advisory lock for the rare orchestrator-side compaction.
 */

export type TaskStatus =
  | "open"
  | "claimed"
  | "in-progress"
  | "needs-review"
  | "blocked"
  | "done"
  | "rejected";

export type BoardTask = {
  id: string;
  title: string;
  /** SME role key this task is assigned to (e.g. "backend", "qa"). */
  assignee: string;
  /** Role that created the task (orchestrator/pm or another SME handing off). */
  createdBy: string;
  description: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
  priority: number;
  createdAt: string;
};

export type BoardEvent = {
  ts: string;
  role: string;
  taskId: string;
  status: TaskStatus;
  summary?: string;
};

export type BoardMessage = {
  ts: string;
  from: string;
  to: string;
  taskId?: string;
  body: string;
};

export type TaskView = BoardTask & {
  status: TaskStatus;
  claimedBy?: string;
  lastSummary?: string;
  lastUpdate?: string;
};

export type BoardPaths = {
  dir: string;
  tasks: string;
  events: string;
  messages: string;
};

export function boardPaths(boardDir: string): BoardPaths {
  return {
    dir: boardDir,
    tasks: resolve(boardDir, "tasks.jsonl"),
    events: resolve(boardDir, "events.jsonl"),
    messages: resolve(boardDir, "messages.jsonl")
  };
}

export function initBoard(boardDir: string): BoardPaths {
  mkdirSync(boardDir, { recursive: true });
  const paths = boardPaths(boardDir);
  for (const file of [paths.tasks, paths.events, paths.messages]) {
    if (!existsSync(file)) writeFileSync(file, "");
  }
  return paths;
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // A torn/partial line (extremely rare with single-line appends) is skipped
      // rather than crashing the whole board read.
    }
  }
  return out;
}

function appendJsonl(file: string, value: unknown): void {
  appendFileSync(file, `${JSON.stringify(value)}\n`);
}

export function addTask(boardDir: string, task: BoardTask): void {
  appendJsonl(boardPaths(boardDir).tasks, task);
}

export function addEvent(boardDir: string, event: BoardEvent): void {
  appendJsonl(boardPaths(boardDir).events, event);
}

export function addMessage(boardDir: string, message: BoardMessage): void {
  appendJsonl(boardPaths(boardDir).messages, message);
}

export function readTasks(boardDir: string): BoardTask[] {
  return readJsonl<BoardTask>(boardPaths(boardDir).tasks);
}

export function readEvents(boardDir: string): BoardEvent[] {
  return readJsonl<BoardEvent>(boardPaths(boardDir).events);
}

export function readMessages(boardDir: string): BoardMessage[] {
  return readJsonl<BoardMessage>(boardPaths(boardDir).messages);
}

/**
 * Fold the append-only logs into the current view of every task.
 *
 * Status precedence rules:
 *  - The *first* "claimed" event wins the claim (later claims are ignored).
 *  - After a claim, the latest event from the claiming role advances the status.
 *  - "done"/"rejected"/"blocked" from anyone are honored (PM can reject; QA can block).
 */
export function foldBoard(boardDir: string): TaskView[] {
  const tasks = readTasks(boardDir);
  const events = readEvents(boardDir);
  const views = new Map<string, TaskView>();

  for (const task of tasks) {
    views.set(task.id, { ...task, status: "open" });
  }

  for (const event of events) {
    const view = views.get(event.taskId);
    if (!view) continue;

    if (event.status === "claimed") {
      if (!view.claimedBy) {
        view.claimedBy = event.role;
        view.status = "claimed";
      }
    } else {
      view.status = event.status;
    }
    view.lastSummary = event.summary ?? view.lastSummary;
    view.lastUpdate = event.ts;
  }

  return [...views.values()].sort((a, b) => b.priority - a.priority);
}

/** Open tasks assigned to a role that nobody has claimed yet. */
export function openTasksFor(boardDir: string, role: string): TaskView[] {
  return foldBoard(boardDir).filter(
    (task) => task.assignee === role && task.status === "open"
  );
}

export function isComplete(boardDir: string): boolean {
  const views = foldBoard(boardDir);
  if (!views.length) return false;
  return views.every((task) => task.status === "done" || task.status === "rejected");
}

export function boardSummary(boardDir: string): {
  total: number;
  byStatus: Record<string, number>;
  views: TaskView[];
} {
  const views = foldBoard(boardDir);
  const byStatus: Record<string, number> = {};
  for (const view of views) {
    byStatus[view.status] = (byStatus[view.status] ?? 0) + 1;
  }
  return { total: views.length, byStatus, views };
}

/**
 * Compact the event log so it does not grow unbounded across long runs. Folds to the
 * current state and rewrites a minimal event stream. Guarded by an advisory lock so the
 * orchestrator never compacts while it might race its own future appends. SMEs never
 * call this — only the orchestrator between iterations.
 */
export function compactBoard(boardDir: string): void {
  const paths = boardPaths(boardDir);
  const lock = resolve(boardDir, ".compact.lock");
  if (existsSync(lock)) return;
  writeFileSync(lock, String(process.pid));
  try {
    const views = foldBoard(boardDir);
    const lines = views
      .filter((view) => view.lastUpdate)
      .map((view) =>
        JSON.stringify({
          ts: view.lastUpdate ?? view.createdAt,
          role: view.claimedBy ?? view.assignee,
          taskId: view.id,
          status: view.status,
          summary: view.lastSummary
        } satisfies BoardEvent)
      );
    const tmp = `${paths.events}.tmp`;
    writeFileSync(tmp, lines.length ? `${lines.join("\n")}\n` : "");
    renameSync(tmp, paths.events);
  } finally {
    try {
      renameSync(lock, `${lock}.done`);
    } catch {
      // best-effort lock release
    }
  }
}
