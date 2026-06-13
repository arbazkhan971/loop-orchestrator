// `loop doctor` — preflight environment checks so failures surface before a run
// with an actionable fix, not as a cryptic mid-start error.
//
// The decision logic (evaluateDoctor) is pure and unit-tested. gatherDoctor
// does the environment probing.

import { spawnSync } from "node:child_process";
import { LoadedConfig, getProject } from "./config/load.js";
import { validateProject } from "./config/validate.js";
import { ProviderConfig } from "./config/schema.js";

export type DoctorCheck = { name: string; ok: boolean; detail: string; fix?: string };

export type ProviderProbe = {
  name: string;
  command: string;
  present: boolean;
  authMode: string;
  authConfigured: boolean;
};

export type DoctorInputs = {
  tmux: { present: boolean; version?: string };
  hasConfig: boolean;
  providers: ProviderProbe[];
  configErrors: string[];
};

export function evaluateDoctor(inputs: DoctorInputs): { ok: boolean; checks: DoctorCheck[] } {
  const checks: DoctorCheck[] = [];

  checks.push(
    inputs.tmux.present
      ? { name: "tmux", ok: true, detail: inputs.tmux.version ?? "installed" }
      : { name: "tmux", ok: false, detail: "not found", fix: "Install tmux (brew install tmux / apt-get install -y tmux)." }
  );

  if (!inputs.hasConfig) {
    checks.push({ name: "config", ok: false, detail: "no loop.config.yaml found", fix: "Run `loop init`." });
  } else if (inputs.configErrors.length) {
    for (const error of inputs.configErrors) {
      checks.push({ name: "config", ok: false, detail: error, fix: "Fix loop.config.yaml." });
    }
  } else {
    checks.push({ name: "config", ok: true, detail: "references valid" });
  }

  for (const provider of inputs.providers) {
    checks.push(
      provider.present
        ? {
            name: `provider:${provider.name}`,
            ok: true,
            detail: `${provider.command} on PATH (auth ${provider.authMode}${provider.authConfigured ? ", configured" : ""})`
          }
        : {
            name: `provider:${provider.name}`,
            ok: false,
            detail: `${provider.command} not on PATH`,
            fix: `Install and log in to ${provider.command}, then re-run \`loop auth configure --write\`.`
          }
    );
  }

  return { ok: checks.every((check) => check.ok), checks };
}

function defaultCommand(provider: ProviderConfig): string {
  if (provider.command) return provider.command;
  return provider.type === "custom" ? "" : provider.type;
}

function commandExists(command: string): boolean {
  if (!command) return false;
  if (spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0) return true;
  return spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

export function gatherDoctor(loaded: LoadedConfig | undefined, projectName?: string): DoctorInputs {
  const tmuxResult = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  const tmux = { present: tmuxResult.status === 0, version: tmuxResult.status === 0 ? tmuxResult.stdout.trim() : undefined };

  if (!loaded) {
    return { tmux, hasConfig: false, providers: [], configErrors: [] };
  }

  const project = getProject(loaded, projectName);
  const providers: ProviderProbe[] = Object.entries(project.providers).map(([name, provider]) => {
    const command = defaultCommand(provider);
    return {
      name,
      command: command || "(custom: command required)",
      present: commandExists(command),
      authMode: provider.auth.mode,
      authConfigured: provider.auth.configured
    };
  });

  return { tmux, hasConfig: true, providers, configErrors: validateProject(project) };
}
