import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LoadedConfig } from "./config/load.js";
import { ProjectConfig, RoleConfig } from "./config/schema.js";
import { buildProviderCommand, commandToShell, shellQuote } from "./providers.js";
import { buildRolePrompt } from "./prompts.js";

export type SessionInfo = {
  role: string;
  session: string;
  provider: string;
  promptFile: string;
  status: "started" | "exists" | "skipped";
};

function runTmux(args: string[], input?: string): string {
  const result = spawnSync("tmux", args, {
    input,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `tmux ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function tmuxOk(args: string[]): boolean {
  return spawnSync("tmux", args, { stdio: "ignore" }).status === 0;
}

export function sessionName(namespace: string, project: string, runId: string, role: string): string {
  return `${namespace}-${project}-${runId}-${role}`.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 120);
}

export function listSessions(namespace = "loop"): string[] {
  const result = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${namespace}-`));
}

export function capturePane(session: string, lines = 160): string {
  return runTmux(["capture-pane", "-pt", session, "-S", `-${lines}`]);
}

export function stopRun(namespace: string, runId: string): string[] {
  const killed: string[] = [];
  for (const session of listSessions(namespace)) {
    if (session.includes(`-${runId}-`)) {
      runTmux(["kill-session", "-t", session]);
      killed.push(session);
    }
  }
  return killed;
}

export function startProjectSessions(
  loaded: LoadedConfig,
  project: ProjectConfig,
  runId: string,
  options: { execute: boolean; roles?: string[] }
): SessionInfo[] {
  const namespace = loaded.config.defaults.namespace;
  const runDir = resolve(loaded.rootDir, loaded.config.defaults.runDir, runId);
  const promptDir = resolve(runDir, "prompts");
  mkdirSync(promptDir, { recursive: true });

  const wantedRoles = new Set(options.roles ?? []);
  if (wantedRoles.size) {
    const knownRoles = new Set(project.roles.map((role) => role.name));
    const unknown = [...wantedRoles].filter((role) => !knownRoles.has(role));
    if (unknown.length) {
      throw new Error(`Unknown role(s): ${unknown.join(", ")}. Available roles: ${[...knownRoles].join(", ")}`);
    }
  }
  const roles = project.roles.filter((role) => role.autoStart && (!wantedRoles.size || wantedRoles.has(role.name)));
  const infos: SessionInfo[] = [];

  for (const role of roles) {
    infos.push(startRoleSession(loaded, project, role, runId, promptDir, options.execute));
  }

  return infos;
}

function startRoleSession(
  loaded: LoadedConfig,
  project: ProjectConfig,
  role: RoleConfig,
  runId: string,
  promptDir: string,
  execute: boolean
): SessionInfo {
  const provider = project.providers[role.provider];
  if (!provider) throw new Error(`Role ${role.name} references missing provider ${role.provider}`);

  const namespace = loaded.config.defaults.namespace;
  const session = sessionName(namespace, project.name, runId, role.name);
  const promptFile = resolve(promptDir, `${role.name}.md`);
  writeFileSync(promptFile, buildRolePrompt(loaded, project, role, runId));

  if (tmuxOk(["has-session", "-t", session])) {
    return { role: role.name, session, provider: role.provider, promptFile, status: "exists" };
  }

  const cwd = resolve(loaded.rootDir, project.workingDir);
  const command = execute
    ? buildExecutableShell(provider, promptFile)
    : `printf '%s\\n' ${shellQuote(`Prompt written to ${promptFile}`)} ${shellQuote(`Run: loop attach ${session}`)}; exec $SHELL -l`;

  runTmux(["new-session", "-d", "-s", session, "-c", cwd, command]);
  return { role: role.name, session, provider: role.provider, promptFile, status: "started" };
}

function buildExecutableShell(provider: ProjectConfig["providers"][string], promptFile: string): string {
  const providerCommand = buildProviderCommand(provider, promptFile);
  const command = commandToShell(providerCommand);

  if (provider.promptMode === "stdin") {
    return `bash -lc ${shellQuote(`cat ${shellQuote(promptFile)} | ${command}`)}`;
  }

  return `bash -lc ${shellQuote(`printf 'Prompt: %s\\n' ${shellQuote(promptFile)}; ${command}`)}`;
}
