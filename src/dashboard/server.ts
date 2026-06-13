import { createServer, type Server, type ServerResponse } from "node:http";
import { LoadedConfig, getProject } from "../config/load.js";
import type { ProjectConfig } from "../config/schema.js";
import { capturePane as captureTmuxPane, listSessions as listTmuxSessions } from "../tmux.js";
import { renderDashboard } from "./render.js";

export type DashboardServerOptions = {
  project: ProjectConfig;
  namespace: string;
  port: number;
  listSessions?: (namespace: string) => string[];
  capturePane?: (session: string, lines?: number) => string;
};

export function startDashboard(loaded: LoadedConfig, options: { project?: string; port?: number }) {
  const project = getProject(loaded, options.project);
  const namespace = loaded.config.defaults.namespace;
  const port = options.port ?? loaded.config.defaults.dashboardPort;
  const server = createDashboardServer({
    project,
    namespace,
    port,
    listSessions: listTmuxSessions,
    capturePane: captureTmuxPane
  });

  server.listen(port, () => {
    console.log(`Loop dashboard: http://localhost:${port}`);
  });
}

export function createDashboardServer(options: DashboardServerOptions): Server {
  const listSessions = options.listSessions ?? listTmuxSessions;
  const capturePane = options.capturePane ?? captureTmuxPane;

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
