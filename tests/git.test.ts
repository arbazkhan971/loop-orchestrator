import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverTestFiles, hashFiles, headSha, isGitRepo } from "../src/git.js";

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "loop-git-"));
  execSync("git init -q && git config user.email t@t.t && git config user.name t", { cwd: dir });
  return dir;
}

describe("git helpers", () => {
  it("detects a git repo and returns HEAD after a commit", () => {
    const dir = gitRepo();
    expect(isGitRepo(dir)).toBe(true);
    writeFileSync(join(dir, "a.txt"), "hi");
    execSync("git add -A && git commit -qm init", { cwd: dir });
    expect(headSha(dir)).toMatch(/^[0-9a-f]{7,}$/);
  });

  it("returns false for a non-git dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "loop-nogit-"));
    expect(isGitRepo(dir)).toBe(false);
  });

  it("discovers test files and hashing is stable until a test file changes (tamper guard)", () => {
    const dir = gitRepo();
    writeFileSync(join(dir, "index.js"), "export const x = 1;");
    writeFileSync(join(dir, "index.test.js"), "test('x', () => {});");
    execSync("git add -A && git commit -qm init", { cwd: dir });

    const testFiles = discoverTestFiles(dir);
    expect(testFiles).toContain("index.test.js");
    expect(testFiles).not.toContain("index.js");

    const before = hashFiles(dir, testFiles);
    // editing a NON-test file does not change the grader hash
    writeFileSync(join(dir, "index.js"), "export const x = 2;");
    expect(hashFiles(dir, testFiles)).toBe(before);
    // editing the test file DOES change the hash → tamper detected
    writeFileSync(join(dir, "index.test.js"), "test('x', () => { expect(true).toBe(true); });");
    expect(hashFiles(dir, testFiles)).not.toBe(before);
  });
});
