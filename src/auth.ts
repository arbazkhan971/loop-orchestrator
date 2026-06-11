import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { LoadedConfig } from "./config/load.js";
import { ProjectConfig, ProviderConfig } from "./config/schema.js";

export type ProviderAuthStatus = {
  providerName: string;
  type: ProviderConfig["type"];
  command?: string;
  commandPath?: string;
  cliAvailable: boolean;
  version?: string;
  apiKeyEnv?: string;
  apiKeySet: boolean;
  recommendedMode: "subscription" | "api-key" | "env";
  configured: boolean;
  notes: string[];
};

const providerDefaults: Record<string, { commands: string[]; envs: string[] }> = {
  claude: {
    commands: ["claude"],
    envs: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]
  },
  codex: {
    commands: ["codex"],
    envs: ["OPENAI_API_KEY"]
  },
  gemini: {
    commands: ["gemini", "agy"],
    envs: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT"]
  },
  custom: {
    commands: [],
    envs: []
  }
};

export function getAuthStatus(project: ProjectConfig): ProviderAuthStatus[] {
  return Object.entries(project.providers).map(([providerName, provider]) => {
    const defaults = providerDefaults[provider.type];
    const command = provider.command ?? defaults.commands[0];
    const commandPath = command ? which(command) : undefined;
    const version = commandPath ? readVersion(commandPath) : undefined;
    const configuredEnv = provider.auth.env;
    const apiKeyEnv = configuredEnv ?? defaults.envs.find((env) => Boolean(process.env[env]));
    const apiKeySet = Boolean(apiKeyEnv && process.env[apiKeyEnv]);
    const recommendedMode = apiKeySet ? "api-key" : commandPath ? "subscription" : "env";
    const notes: string[] = [];

    if (apiKeySet) {
      notes.push(`Using ${apiKeyEnv} from environment.`);
    } else if (commandPath) {
      notes.push(`Using local ${provider.type} CLI authentication state.`);
    } else if (provider.type !== "custom") {
      notes.push(`Install ${defaults.commands.join(" or ")} or set one of: ${defaults.envs.join(", ")}.`);
    }

    return {
      providerName,
      type: provider.type,
      command,
      commandPath,
      cliAvailable: Boolean(commandPath),
      version,
      apiKeyEnv,
      apiKeySet,
      recommendedMode,
      configured: provider.auth.configured || provider.auth.mode !== "auto" || Boolean(provider.command || apiKeyEnv || commandPath),
      notes
    };
  });
}

export function configureLocalAuth(loaded: LoadedConfig, projectName: string): ProviderAuthStatus[] {
  const source = readFileSync(loaded.path, "utf8");
  const document = YAML.parseDocument(source);
  const root = document.toJSON() as Record<string, unknown>;
  const projects = root.projects as Array<Record<string, unknown>>;
  const project = projects.find((item) => item.name === projectName);
  if (!project) throw new Error(`Project not found in raw config: ${projectName}`);

  const typedProject = loaded.config.projects.find((item) => item.name === projectName);
  if (!typedProject) throw new Error(`Project not found: ${projectName}`);

  const statuses = getAuthStatus(typedProject);
  const rawProviders = project.providers as Record<string, Record<string, unknown>>;

  for (const status of statuses) {
    const provider = rawProviders[status.providerName];
    if (!provider) continue;
    if (status.commandPath && !provider.command) provider.command = status.command;
    provider.auth = {
      mode: status.recommendedMode,
      env: status.apiKeyEnv,
      configured: status.configured,
      notes: status.notes.join(" ")
    };
  }

  writeFileSync(loaded.path, YAML.stringify(root));
  return statuses;
}

export function hasConfig(path: string): boolean {
  return existsSync(resolve(path));
}

function which(command: string): string | undefined {
  const result = spawnSync("bash", ["-lc", `command -v ${shellQuote(command)}`], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

function readVersion(commandPath: string): string | undefined {
  const result = spawnSync(commandPath, ["--version"], { encoding: "utf8", timeout: 5000 });
  if (result.status !== 0) return undefined;
  return (result.stdout || result.stderr).trim().split("\n")[0];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
