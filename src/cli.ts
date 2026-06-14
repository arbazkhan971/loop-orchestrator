#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { configureLocalAuth, getAuthStatus } from "./auth.js";
import { loadConfig, getProject } from "./config/load.js";
import { startDashboard } from "./dashboard/server.js";
import { validateConfig, validateWorkflow } from "./config/validate.js";
import { evaluateDoctor, gatherDoctor } from "./doctor.js";
import { attachError, attachSession, capturePane, listSessions, startProjectSessions, stopRun } from "./tmux.js";
import { WorkflowState } from "./workflow/engine.js";
import { listRuns, readManifest } from "./workflow/manifest.js";
import { createTmuxRunner, manifestPath, realClock, runWorkflow, writeWorkflowManifest } from "./workflow/run.js";

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
    const loaded = safeLoadConfig(opts.config, opts.json);
    if (!loaded) return;
    const errors = validateConfig(loaded.config);
    if (errors.length) {
      output({ ok: false, config: loaded.path, errors }, opts.json);
      process.exitCode = 1;
      return;
    }
    output({ ok: true, config: loaded.path, projects: loaded.config.projects.map((project) => project.name) }, opts.json);
  });

program
  .command("doctor")
  .description("check tmux, provider CLIs, auth, and config before a run")
  .option("-p, --project <name>", "project name")
  .action((options) => {
    const opts = program.opts();
    let loaded: ReturnType<typeof loadConfig> | undefined;
    try {
      loaded = loadConfig(opts.config);
    } catch {
      loaded = undefined;
    }
    const report = evaluateDoctor(gatherDoctor(loaded, options.project));
    output(report, opts.json);
    if (!report.ok) process.exitCode = 1;
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
  .command("run")
  .description("run a dynamic workflow: launch stages as their dependencies complete")
  .option("-p, --project <name>", "project name")
  .option("-w, --workflow <name>", "workflow name")
  .option("-r, --run <id>", "run id", defaultRunId())
  .option("--execute", "launch configured agent commands instead of prompt-only shells")
  .option("--once", "run a single tick (launch ready stages) and exit")
  .option("--resume", "resume an interrupted run from its saved manifest")
  .action(async (options) => {
    const opts = program.opts();
    const loaded = safeLoadConfig(opts.config, opts.json);
    if (!loaded) return;
    const project = getProject(loaded, options.project);

    const workflow = resolveWorkflow(project, options.workflow);
    if (!workflow) {
      const names = project.workflows.map((item) => item.name).join(", ") || "(none defined)";
      output({ ok: false, error: `Workflow not found: ${options.workflow ?? "(missing)"}. Available: ${names}` }, opts.json);
      process.exitCode = 1;
      return;
    }

    const problems = validateWorkflow(project, workflow);
    if (problems.length) {
      output({ ok: false, workflow: workflow.name, errors: problems }, opts.json);
      process.exitCode = 1;
      return;
    }

    let initialState: WorkflowState | undefined;
    if (options.resume) {
      const manifest = readManifest(loaded, options.run);
      if (!manifest) {
        output({ ok: false, error: `No manifest to resume for run "${options.run}".` }, opts.json);
        process.exitCode = 1;
        return;
      }
      initialState = { workflow: manifest.workflow, iteration: manifest.iteration, done: false, stages: manifest.stages };
    }

    // Persist whatever state exists if the process is interrupted mid-run.
    process.on("SIGINT", () => {
      console.error(`Interrupted. Latest manifest: ${manifestPath(loaded, options.run)}`);
      process.exit(130);
    });

    const runner = createTmuxRunner(loaded, project, options.run, Boolean(options.execute));
    const finalState = await runWorkflow(
      workflow,
      { ...runner, onTick: (state) => writeWorkflowManifest(loaded, project, options.run, state) },
      realClock,
      { maxTicks: options.once ? 1 : undefined, initialState }
    );

    output(
      {
        run: options.run,
        project: project.name,
        workflow: workflow.name,
        outcome: finalState.outcome ?? "in-progress",
        done: finalState.done,
        iteration: finalState.iteration,
        manifest: manifestPath(loaded, options.run),
        stages: finalState.stages
      },
      opts.json
    );
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
  .command("attach")
  .argument("<session>", "tmux session name")
  .description("attach to a running loop session")
  .action((session) => {
    const opts = program.opts();
    const loaded = safeLoadConfig(opts.config, opts.json);
    const namespace = loaded?.config.defaults.namespace ?? "loop";
    const error = attachError(session, listSessions(namespace));
    if (error) {
      output({ ok: false, error }, opts.json);
      process.exitCode = 1;
      return;
    }
    attachSession(session);
  });

program
  .command("runs")
  .description("list past and in-flight workflow runs")
  .action(() => {
    const opts = program.opts();
    const loaded = safeLoadConfig(opts.config, opts.json);
    if (!loaded) return;
    output({ runs: listRuns(loaded) }, opts.json);
  });

program
  .command("show")
  .argument("<run>", "run id")
  .description("show the workflow manifest for a run")
  .action((run) => {
    const opts = program.opts();
    const loaded = safeLoadConfig(opts.config, opts.json);
    if (!loaded) return;
    const manifest = readManifest(loaded, run);
    if (!manifest) {
      output({ ok: false, error: `No workflow manifest for run "${run}".` }, opts.json);
      process.exitCode = 1;
      return;
    }
    output(manifest, opts.json);
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

function safeLoadConfig(configPath: string | undefined, asJson: boolean): ReturnType<typeof loadConfig> | undefined {
  try {
    return loadConfig(configPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("No loop.config.yaml")) {
      const help = {
        ok: false,
        error: "No loop.config.yaml found.",
        nextSteps: [
          "Run `loop init` in this repo.",
          "Run `loop auth status` again.",
          "Run `loop auth configure --write` to store detected local provider metadata."
        ]
      };
      if (asJson) {
        console.log(JSON.stringify(help, null, 2));
      } else {
        console.error("No loop.config.yaml found.");
        console.error("");
        console.error("Run:");
        console.error("  loop init");
        console.error("  loop auth status");
        console.error("  loop auth configure --write");
      }
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }
}

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

function resolveWorkflow(project: ReturnType<typeof getProject>, name?: string) {
  if (!name) return project.workflows.length === 1 ? project.workflows[0] : undefined;
  return project.workflows.find((workflow) => workflow.name === name);
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
        auth:
          mode: auto
        dangerouslySkipPermissions: true
        args: []
        promptMode: interactive
      frontend:
        type: claude
        model: claude-sonnet-4-6
        auth:
          mode: auto
        dangerouslySkipPermissions: true
        args: []
        promptMode: interactive
      backend:
        type: codex
        model: gpt-5.4
        effort: medium
        auth:
          mode: auto
        yolo: true
        args: []
        promptMode: interactive
      scout:
        type: gemini
        model: gemini-3.5-flash
        auth:
          mode: auto
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
    workflows:
      - name: delivery
        cadenceSeconds: 30
        maxIterations: 50
        stages:
          - name: plan
            role: cto
            completeWhen:
              - "pane-matches:PLAN COMPLETE"
          - name: implement-backend
            role: be1
            dependsOn: [plan]
            completeWhen:
              - pr-opened
              - tests-pass
            failWhen:
              - tests-fail
          - name: implement-frontend
            role: fe1
            dependsOn: [plan]
            completeWhen:
              - pr-opened
          - name: qa
            role: qa1
            dependsOn: [implement-backend, implement-frontend]
            completeWhen:
              - review-approved
              - "pane-matches:MERGE READY"
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
