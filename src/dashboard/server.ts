import { createServer, ServerResponse } from "node:http";
import { LoadedConfig, getProject } from "../config/load.js";
import { capturePane, listSessions } from "../tmux.js";
import { renderDashboard } from "./render.js";

export function startDashboard(loaded: LoadedConfig, options: { project?: string; port?: number }) {
  const project = getProject(loaded, options.project);
  const namespace = loaded.config.defaults.namespace;
  const port = options.port ?? loaded.config.defaults.dashboardPort;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/api/status") {
      return json(res, {
        project: project.name,
        sessions: listSessions(namespace).filter((session) => session.includes(`-${project.name}-`))
      });
    }

    if (url.pathname === "/api/config") {
      return json(res, project);
    }

    if (url.pathname === "/api/logs") {
      const session = url.searchParams.get("session");
      if (!session) return json(res, { error: "Missing session" }, 400);
      return json(res, { session, logs: capturePane(session, 220) });
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderDashboard(project.name));
  });

  server.listen(port, () => {
    console.log(`Loop dashboard: http://localhost:${port}`);
  });
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
