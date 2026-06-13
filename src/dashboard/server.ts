import { existsSync, readdirSync, statSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { boardSummary } from "../board.js";
import { LoadedConfig, getProject } from "../config/load.js";
import type { ProjectConfig } from "../config/schema.js";
import { capturePane as captureTmuxPane, listSessions as listTmuxSessions } from "../tmux.js";
import { renderDashboard } from "./render.js";

export type BoardSummaryResult = ReturnType<typeof boardSummary>;

const EMPTY_BOARD: BoardSummaryResult = { total: 0, byStatus: {}, views: [] };

export type DashboardServerOptions = {
  project: ProjectConfig;
  namespace: string;
  port: number;
  /** Directory that holds run subdirectories (each containing a `board/`). */
  runsDir?: string;
  listSessions?: (namespace: string) => string[];
  capturePane?: (session: string, lines?: number) => string;
  /** Injectable board reader (defaults to reading the latest run's board on disk). */
  readBoard?: (run?: string) => BoardSummaryResult;
};

export function startDashboard(loaded: LoadedConfig, options: { project?: string; port?: number }) {
  const project = getProject(loaded, options.project);
  const namespace = loaded.config.defaults.namespace;
  const port = options.port ?? loaded.config.defaults.dashboardPort;
  const runsDir = resolve(loaded.rootDir, loaded.config.defaults.runDir);
  const server = createDashboardServer({
    project,
    namespace,
    port,
    runsDir,
    listSessions: listTmuxSessions,
    capturePane: captureTmuxPane
  });

  server.listen(port, () => {
    console.log(`Loop dashboard: http://localhost:${port}`);
  });
}

/**
 * Resolve the board directory for a given (or the most recent) run under `runsDir`.
 * A run directory is considered valid when it contains a `board/` subdirectory.
 * Returns undefined when no run/board exists.
 */
function resolveBoardDir(runsDir: string | undefined, run?: string | null): string | undefined {
  if (!runsDir || !existsSync(runsDir)) return undefined;

  if (run) {
    const dir = resolve(runsDir, run, "board");
    return existsSync(dir) ? dir : undefined;
  }

  let latest: { dir: string; mtime: number } | undefined;
  for (const entry of readdirSync(runsDir)) {
    const boardDir = resolve(runsDir, entry, "board");
    if (!existsSync(boardDir)) continue;
    try {
      const mtime = statSync(boardDir).mtimeMs;
      if (!latest || mtime > latest.mtime) latest = { dir: boardDir, mtime };
    } catch {
      // Skip unreadable entries.
    }
  }
  return latest?.dir;
}

function defaultReadBoard(runsDir: string | undefined, run?: string | null): BoardSummaryResult {
  const boardDir = resolveBoardDir(runsDir, run);
  if (!boardDir) return EMPTY_BOARD;
  try {
    return boardSummary(boardDir);
  } catch {
    return EMPTY_BOARD;
  }
}

export function createDashboardServer(options: DashboardServerOptions): Server {
  const listSessions = options.listSessions ?? listTmuxSessions;
  const capturePane = options.capturePane ?? captureTmuxPane;
  const readBoard =
    options.readBoard ?? ((run?: string) => defaultReadBoard(options.runsDir, run));

  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${options.port}`);

    if (url.pathname === "/api/status") {
      return json(res, {
        project: options.project.name,
        sessions: listSessions(options.namespace).filter((session) => session.includes(`-${options.project.name}-`))
      });
    }

    if (url.pathname === "/api/config") {
      return json(res, options.project);
    }

    if (url.pathname === "/api/board") {
      const run = url.searchParams.get("run") ?? undefined;
      return json(res, readBoard(run));
    }

    if (url.pathname === "/api/logs") {
      const session = url.searchParams.get("session");
      if (!session) return json(res, { error: "Missing session" }, 400);
      return json(res, { session, logs: capturePane(session, 220) });
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderDashboard(options.project.name));
  });
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
