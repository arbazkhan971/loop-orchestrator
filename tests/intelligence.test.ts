import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeProject, renderIntelligence } from "../src/intelligence.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "loop-test-"));
}

describe("intelligence", () => {
  it("detects a Node/TypeScript project's name, package manager, and commands", () => {
    const root = tmpProject();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "my-cool-pkg",
        scripts: { build: "tsc", test: "vitest run", lint: "eslint ." },
        devDependencies: { vitest: "^1.0.0", typescript: "^5.0.0" }
      })
    );

    const intel = analyzeProject(root);

    expect(intel.name).toBe("my-cool-pkg");
    expect(intel.packageManager).toBe("npm");
    expect(intel.commands.test).toBe("npm run test");
    expect(intel.commands.build).toBe("npm run build");
    expect(intel.commands.lint).toBe("npm run lint");
    // typescript dep without a typecheck script -> tsc --noEmit fallback
    expect(intel.commands.typecheck).toBe("tsc --noEmit");
    expect(intel.frameworks).toContain("Vitest");

    const rendered = renderIntelligence(intel);
    expect(rendered).toContain("my-cool-pkg");
    expect(rendered).toContain("npm run test");
    expect(rendered).toContain("npm run build");
    expect(rendered).toContain("tsc --noEmit");
  });

  it("detects a Go project via go.mod", () => {
    const root = tmpProject();
    writeFileSync(join(root, "go.mod"), "module example.com/app\n\ngo 1.22\n");
    writeFileSync(join(root, "main.go"), "package main\n\nfunc main() {}\n");

    const intel = analyzeProject(root);

    expect(intel.commands.test).toBe("go test ./...");
    expect(intel.commands.build).toBe("go build ./...");
    expect(intel.frameworks).toContain("Go modules");
    expect(intel.languages).toContain("Go");

    const rendered = renderIntelligence(intel);
    expect(rendered).toContain("go test ./...");
  });
});
