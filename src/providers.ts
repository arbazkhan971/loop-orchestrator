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
    if (provider.dangerouslySkipPermissions && !args.includes("--dangerously-skip-permissions")) {
      args.push("--dangerously-skip-permissions");
    }
    if (provider.model) args.push("--model", provider.model);
    if (provider.promptMode === "argument") args.push("-p", `Read ${promptFile} and execute the task.`);
    return { command: provider.command ?? "claude", args, env: provider.env };
  }

  if (provider.type === "codex") {
    const args = [...provider.args];
    if (provider.yolo && !args.includes("--yolo")) {
      args.push("--yolo");
    }
    if (provider.model) args.push("--model", provider.model);
    if (provider.effort) args.push("--effort", provider.effort);
    if (provider.promptMode === "argument") args.push(`Read ${promptFile} and execute the task.`);
    return { command: provider.command ?? "codex", args, env: provider.env };
  }

  const args = [...provider.args];
  if (provider.model) args.push("--model", provider.model);
  return { command: provider.command ?? "gemini", args, env: provider.env };
}

/**
 * Build a HEADLESS, non-interactive invocation of a provider for a single task.
 *
 * This is the core of the autonomy engine: instead of scraping a TUI to guess when an
 * agent is "done", we spawn a fresh headless child per task and detect completion from
 * its exit code + structured output. tmux is only the human viewport.
 *
 * The role/system prompt is passed by file path (claude --append-system-prompt-file,
 * or AGENTS.md/GEMINI.md conventions); the task text is the inline payload.
 */
export function buildHeadlessCommand(
  provider: ProviderConfig,
  task: string,
  rolePromptFile: string
): ProviderCommand {
  if (provider.type === "claude") {
    const args = ["-p", task, "--append-system-prompt", `@${rolePromptFile}`];
    if (provider.model) args.push("--model", provider.model);
    if (provider.dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
    args.push("--output-format", "json", ...provider.args);
    return { command: provider.command ?? "claude", args, env: provider.env };
  }

  if (provider.type === "codex") {
    // Codex reads role/intel from AGENTS.md in cwd; pass the task to `codex exec`.
    const args = ["exec"];
    if (provider.model) args.push("--model", provider.model);
    if (provider.effort) args.push("--effort", provider.effort);
    if (provider.yolo) args.push("--full-auto");
    args.push("--json", ...provider.args, task);
    return { command: provider.command ?? "codex", args, env: provider.env };
  }

  if (provider.type === "gemini") {
    const args = ["-p", task];
    if (provider.model) args.push("--model", provider.model);
    if (provider.yolo) args.push("--approval-mode", "yolo");
    args.push("--output-format", "json", ...provider.args);
    return { command: provider.command ?? "gemini", args, env: provider.env };
  }

  // custom
  if (!provider.command) throw new Error("Custom provider requires a command.");
  return { command: provider.command, args: [...provider.args, task], env: provider.env };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function commandToShell(command: ProviderCommand): string {
  const env = Object.entries(command.env).map(([key, value]) => `${key}=${shellQuote(value)}`);
  const args = command.args.map(shellQuote);
  return [...env, command.command, ...args].join(" ");
}
