#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { loadConfig, getProject } from "./config/load.js";
import { startDashboard } from "./dashboard/server.js";
import { capturePane, listSessions, startProjectSessions, stopRun } from "./tmux.js";

const program = new Command();

program
  .name("loop")
  .description("tmux-based AI agent team orchestrator")
  .version("0.1.0")
  .option("-c, --config <path>", "path to loop.config.yaml")
  .option("--json", "print machine-readable JSON");

program
  .command("init")
  .description("create a starter loop.config.yaml and brief.md")
  .option("-f, --force", "overwrite existing files")
  .action((options) => {
    const root = process.cwd();
    writeIfMissing(resolve(root, "loop.config.yaml"), starterConfig(), Boolean(options.force));
    writeIfMissing(resolve(root, "brief.md"), starterBrief(), Boolean(options.force));
    mkdirSync(resolve(root, ".loop"), { recursive: true });
    console.log("Created loop.config.yaml, brief.md, and .loop/");
  });

program
  .command("validate")
  .description("validate the loop config")
  .action(() => {
    const opts = program.opts();
    const loaded = loadConfig(opts.config);
    output({ ok: true, config: loaded.path, projects: loaded.config.projects.map((project) => project.name) }, opts.json);
  });

program
  .command("start")
  .description("start tmux sessions for a project team")
  .option("-p, --project <name>", "project name")
  .option("-r, --run <id>", "run id", defaultRunId())
  .option("--role <name...>", "only start specific roles")
  .option("--execute", "launch configured agent commands instead of prompt-only shells")
  .action((options) => {
    const opts = program.opts();
    const loaded = loadConfig(opts.config);
    const project = getProject(loaded, options.project);
    const sessions = startProjectSessions(loaded, project, options.run, {
      execute: Boolean(options.execute),
      roles: options.role
    });
    output({ run: options.run, project: project.name, sessions }, opts.json);
  });

program
  .command("status")
  .description("list loop tmux sessions")
  .action(() => {
    const opts = program.opts();
    const loaded = loadConfig(opts.config);
    output({ sessions: listSessions(loaded.config.defaults.namespace) }, opts.json);
  });

program
  .command("logs")
  .argument("<session>", "tmux session name")
  .option("-n, --lines <count>", "number of lines", "160")
  .description("print captured logs for a session")
  .action((session, options) => {
    console.log(capturePane(session, Number(options.lines)));
  });

program
  .command("stop")
  .argument("<run>", "run id")
  .description("stop all tmux sessions for a run")
  .action((run) => {
    const opts = program.opts();
    const loaded = loadConfig(opts.config);
    output({ killed: stopRun(loaded.config.defaults.namespace, run) }, opts.json);
  });

program
  .command("dashboard")
  .description("start the local dashboard")
  .option("-p, --project <name>", "project name")
  .option("--port <port>", "dashboard port")
  .action((options) => {
    const opts = program.opts();
    const loaded = loadConfig(opts.config);
    startDashboard(loaded, { project: options.project, port: options.port ? Number(options.port) : undefined });
  });

program.parse();

function output(data: unknown, asJson: boolean) {
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(formatHuman(data));
}

function formatHuman(data: unknown): string {
  if (typeof data !== "object" || data === null) return String(data);
  return JSON.stringify(data, null, 2);
}

function writeIfMissing(path: string, content: string, force: boolean) {
  if (existsSync(path) && !force) {
    console.log(`Skipped ${path}; already exists.`);
    return;
  }
  writeFileSync(path, content);
}

function defaultRunId(): string {
  const date = new Date();
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `run-${stamp}`;
}

function starterConfig(): string {
  return `version: 1
defaults:
  namespace: loop
  dashboardPort: 4318
  promptDir: .loop/prompts
  runDir: .loop/runs

projects:
  - name: demo-product
    brief: brief.md
    workingDir: .
    safetyMode: workspace-write
    providers:
      planner:
        type: claude
        model: claude-opus-4-8
        dangerouslySkipPermissions: true
        args: []
        promptMode: interactive
      frontend:
        type: claude
        model: claude-sonnet-4-6
        dangerouslySkipPermissions: true
        args: []
        promptMode: interactive
      backend:
        type: codex
        model: gpt-5.4
        effort: medium
        yolo: true
        args: []
        promptMode: interactive
      scout:
        type: gemini
        model: gemini-3.5-flash
        args: []
        promptMode: interactive
    repositories:
      - name: frontend-app
        path: ~/work/frontend-app
        role: frontend
        defaultBranch: main
        protectedBranches: [main, production]
      - name: backend-api
        path: ~/work/backend-api
        role: backend
        defaultBranch: main
        protectedBranches: [main, production]
    roles:
      - name: cto
        title: Technical lead and architecture reviewer
        provider: planner
        repositories: [frontend-app, backend-api]
        responsibilities:
          - Convert incoming issues into implementation plans and acceptance criteria.
          - Review architecture, risk, rollout, and backward compatibility.
        guardrails:
          - Prefer small PRs with clear test evidence.
      - name: fe1
        title: Frontend engineer
        provider: frontend
        repositories: [frontend-app]
        responsibilities:
          - Implement accessible responsive UI changes.
          - Run browser smoke tests and capture screenshots.
      - name: be1
        title: Backend engineer
        provider: backend
        repositories: [backend-api]
        responsibilities:
          - Implement APIs, migrations, and tests.
          - Avoid destructive database operations.
      - name: qa1
        title: QA and release reviewer
        provider: backend
        repositories: [frontend-app, backend-api]
        responsibilities:
          - Verify acceptance criteria.
          - Produce final merge readiness notes.
    loops:
      - name: delivery-loop
        cadenceMinutes: 30
        maxIterations: 8
        stopWhen:
          - tests pass
          - pull request opened
          - release reviewer approves
`;
}

function starterBrief(): string {
  return `# Demo Product Brief

Build and maintain a full-stack web product using small, reviewable pull requests.

## Operating principles

- Keep every task scoped to the requested issue.
- Do not mention private customer or repository names in public artifacts.
- Prefer backward-compatible API and UI changes.
- Run tests and include evidence before asking for review.
`;
}
