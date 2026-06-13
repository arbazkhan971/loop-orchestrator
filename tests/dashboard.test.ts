import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(repoRoot, "src/cli.ts");
const tsxPath = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");

describe("dashboard CLI", () => {
  it("serves dashboard HTML and project APIs", async () => {
    const root = mkdtempSync(join(tmpdir(), "loop-dashboard-"));
    const configPath = join(root, "loop.config.yaml");
    writeFileSync(
      configPath,
      `version: 1
defaults:
  namespace: loop-dashboard-test
  dashboardPort: 4318
  promptDir: .loop/prompts
  runDir: .loop/runs
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
    const port = await getFreePort();
    const child = spawn(process.execPath, [tsxPath, cliPath, "--config", configPath, "dashboard", "--port", String(port)], {
      cwd: root
    });

    try {
      await waitForDashboard(port, child);

      const status = await getJson(`http://127.0.0.1:${port}/api/status`);
      expect(status).toEqual({ project: "demo", sessions: [] });

      const config = await getJson(`http://127.0.0.1:${port}/api/config`);
      expect(config).toMatchObject({ name: "demo", safetyMode: "workspace-write" });

      const html = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
      expect(html).toContain("<title>Loop Orchestrator</title>");
      expect(html).toContain("demo");
    } finally {
      await stopProcess(child);
    }
  });
});

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function waitForDashboard(port: number, child: ChildProcessWithoutNullStreams) {
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Dashboard exited early with code ${child.exitCode}: ${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (response.ok) return;
    } catch {
      // Keep polling until the server is listening.
    }
    await delay(100);
  }
  throw new Error(`Dashboard did not start on port ${port}: ${stderr}`);
}

async function getJson(url: string) {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return response.json();
}

async function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(1000).then(() => {
      child.kill("SIGKILL");
    })
  ]);
}
