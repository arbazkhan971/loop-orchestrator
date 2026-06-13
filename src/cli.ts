#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { configureLocalAuth, getAuthStatus } from "./auth.js";
import { defaultRunId, output, safeLoadConfig, writeIfMissing } from "./cli/support.js";
import { getProject } from "./config/load.js";
import { startDashboard } from "./dashboard/server.js";
import { packageVersion } from "./metadata.js";
import { starterBrief, starterConfig } from "./starter.js";
import { capturePane, listSessions, startProjectSessions, stopRun } from "./tmux.js";

const program = new Command();

program
  .name("loop")
  .description("tmux-based AI agent team orchestrator")
  .version(packageVersion)
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
    const loaded = safeLoadConfig(opts.config, opts.json);
    if (!loaded) return;
    output({ ok: true, config: loaded.path, projects: loaded.config.projects.map((project) => project.name) }, opts.json);
  });

const auth = program.command("auth").description("inspect and configure local provider authentication");

auth
  .command("status")
  .description("show local Claude, Codex, Gemini, and custom provider readiness")
  .option("-p, --project <name>", "project name")
  .action((options) => {
    const opts = program.opts();
    const loaded = safeLoadConfig(opts.config, opts.json);
    if (!loaded) return;
    const project = getProject(loaded, options.project);
    output({ project: project.name, providers: getAuthStatus(project) }, opts.json);
  });

auth
  .command("configure")
  .description("write detected local provider auth settings into loop.config.yaml")
  .option("-p, --project <name>", "project name")
  .option("--write", "write detected settings")
  .action((options) => {
    const opts = program.opts();
    const loaded = safeLoadConfig(opts.config, opts.json);
    if (!loaded) return;
    const project = getProject(loaded, options.project);
    if (!options.write) {
      output({
        project: project.name,
        dryRun: true,
        message: "Run `loop auth configure --write` to update loop.config.yaml.",
        providers: getAuthStatus(project)
      }, opts.json);
      return;
    }
    output({ project: project.name, updated: loaded.path, providers: configureLocalAuth(loaded, project.name) }, opts.json);
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
    const loaded = safeLoadConfig(opts.config, opts.json);
    if (!loaded) return;
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
    const loaded = safeLoadConfig(opts.config, opts.json);
    if (!loaded) return;
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
    const loaded = safeLoadConfig(opts.config, opts.json);
    if (!loaded) return;
    output({ killed: stopRun(loaded.config.defaults.namespace, run) }, opts.json);
  });

program
  .command("dashboard")
  .description("start the local dashboard")
  .option("-p, --project <name>", "project name")
  .option("--port <port>", "dashboard port")
  .action((options) => {
    const opts = program.opts();
    const loaded = safeLoadConfig(opts.config, opts.json);
    if (!loaded) return;
    startDashboard(loaded, { project: options.project, port: options.port ? Number(options.port) : undefined });
  });

program.parse();
