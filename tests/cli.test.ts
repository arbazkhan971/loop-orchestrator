import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(repoRoot, "src/cli.ts");
const tsxPath = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");

describe("CLI", () => {
  it("initializes starter files without overwriting existing files by default", () => {
    const root = mkdtempSync(join(tmpdir(), "loop-cli-init-"));

    const first = runLoop(["init"], root);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("Created loop.config.yaml, brief.md, and .loop/");
    expect(existsSync(join(root, "loop.config.yaml"))).toBe(true);
    expect(existsSync(join(root, "brief.md"))).toBe(true);
    expect(existsSync(join(root, ".loop"))).toBe(true);

    writeFileSync(join(root, "brief.md"), "custom brief");
    const second = runLoop(["init"], root);

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Skipped");
    expect(readFileSync(join(root, "brief.md"), "utf8")).toBe("custom brief");
  });

  it("validates a config as JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "loop-cli-validate-"));
    const configPath = join(root, "loop.config.yaml");
    writeFileSync(
      configPath,
      `version: 1
projects:
  - name: demo
    providers:
      dev:
        type: codex
    roles:
      - name: dev
        title: Developer
        provider: dev
`
    );

    const result = runLoop(["--config", configPath, "--json", "validate"], root);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      config: configPath,
      projects: ["demo"]
    });
  });
});

function runLoop(args: string[], cwd: string) {
  return spawnSync(process.execPath, [tsxPath, cliPath, ...args], {
    cwd,
    encoding: "utf8"
  });
}
