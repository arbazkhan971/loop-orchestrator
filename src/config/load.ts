import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import { RootConfig, RootConfigSchema } from "./schema.js";

export type LoadedConfig = {
  config: RootConfig;
  path: string;
  rootDir: string;
};

export function findConfig(startDir = process.cwd()): string {
  const candidates = ["loop.config.yaml", "loop.config.yml", "loop.config.json"];
  let current = resolve(startDir);

  while (true) {
    for (const candidate of candidates) {
      const path = resolve(current, candidate);
      if (existsSync(path)) return path;
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error("No loop.config.yaml found. Run `loop init` first.");
}

export function loadConfig(configPath?: string): LoadedConfig {
  const path = resolve(configPath ?? findConfig());
  const source = readFileSync(path, "utf8");
  const raw = path.endsWith(".json") ? JSON.parse(source) : YAML.parse(source);
  const parsed = RootConfigSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid loop config:\n${details}`);
  }

  return {
    config: parsed.data,
    path,
    rootDir: dirname(path)
  };
}

export function getProject(loaded: LoadedConfig, name?: string) {
  if (!name && loaded.config.projects.length === 1) return loaded.config.projects[0];
  const project = loaded.config.projects.find((item) => item.name === name);
  if (!project) {
    const names = loaded.config.projects.map((item) => item.name).join(", ");
    throw new Error(`Project not found: ${name ?? "(missing)"}. Available projects: ${names}`);
  }
  return project;
}
