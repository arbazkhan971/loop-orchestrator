import { ProviderConfig } from "./config/schema.js";

export type ProviderCommand = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

export function buildProviderCommand(provider: ProviderConfig, promptFile: string): ProviderCommand {
  if (provider.type === "custom") {
    if (!provider.command) throw new Error("Custom provider requires a command.");
    return { command: provider.command, args: provider.args, env: provider.env };
  }

  if (provider.type === "claude") {
    const args = [...provider.args];
    if (provider.model) args.push("--model", provider.model);
    if (provider.promptMode === "argument") args.push("-p", `Read ${promptFile} and execute the task.`);
    return { command: provider.command ?? "claude", args, env: provider.env };
  }

  if (provider.type === "codex") {
    const args = [...provider.args];
    if (provider.model) args.push("--model", provider.model);
    if (provider.effort) args.push("--effort", provider.effort);
    if (provider.promptMode === "argument") args.push(`Read ${promptFile} and execute the task.`);
    return { command: provider.command ?? "codex", args, env: provider.env };
  }

  const args = [...provider.args];
  if (provider.model) args.push("--model", provider.model);
  return { command: provider.command ?? "gemini", args, env: provider.env };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function commandToShell(command: ProviderCommand): string {
  const env = Object.entries(command.env).map(([key, value]) => `${key}=${shellQuote(value)}`);
  const args = command.args.map(shellQuote);
  return [...env, command.command, ...args].join(" ");
}
