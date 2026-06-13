import { existsSync, writeFileSync } from "node:fs";
import { loadConfig, type LoadedConfig } from "../config/load.js";

export function safeLoadConfig(configPath: string | undefined, asJson: boolean): LoadedConfig | undefined {
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

export function output(data: unknown, asJson: boolean) {
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(formatHuman(data));
}

export function writeIfMissing(path: string, content: string, force: boolean) {
  if (existsSync(path) && !force) {
    console.log(`Skipped ${path}; already exists.`);
    return;
  }
  writeFileSync(path, content);
}

export function defaultRunId(): string {
  const date = new Date();
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `run-${stamp}`;
}

function formatHuman(data: unknown): string {
  if (typeof data !== "object" || data === null) return String(data);
  return JSON.stringify(data, null, 2);
}
