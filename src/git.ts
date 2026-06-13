import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Git checkpoint / rollback / diff helpers for the verification gate.
 *
 * The autonomy loop snapshots HEAD before an agent works, captures the diff for the
 * critic, reverts the working tree if the change regresses the test suite, and hashes the
 * project's test files to detect reward-hacking (an agent weakening its own grader to
 * pass). All commands degrade to no-ops when the working dir is not a git repo.
 */

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
}

export function isGitRepo(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).out === "true";
}

export function headSha(cwd: string): string | undefined {
  const r = git(cwd, ["rev-parse", "HEAD"]);
  return r.ok ? r.out : undefined;
}

/** Diff of the working tree (staged + unstaged) since a base sha, capped for prompt size. */
export function workingDiff(cwd: string, baseSha: string | undefined, maxChars = 16_000): string {
  const args = baseSha ? ["diff", baseSha, "--"] : ["diff", "HEAD", "--"];
  const r = git(cwd, args);
  // Include untracked files' presence so the reviewer knows new files exist.
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"]).out;
  let diff = r.out;
  if (untracked) diff += `\n\n# New untracked files:\n${untracked}`;
  return diff.length > maxChars ? `${diff.slice(0, maxChars)}\n…(diff truncated)…` : diff;
}

/** Revert all working-tree changes back to the snapshot (used on regression). */
export function revertWorkingTree(cwd: string): boolean {
  const clean = git(cwd, ["checkout", "--", "."]).ok;
  // Also drop untracked files the agent created during a failed attempt.
  git(cwd, ["clean", "-fd"]);
  return clean;
}

/** Has the working tree changed since the snapshot? (Did the agent actually do anything?) */
export function hasChanges(cwd: string): boolean {
  const tracked = git(cwd, ["status", "--porcelain"]).out;
  return tracked.length > 0;
}

/**
 * Hash the project's test/CI files so we can detect if an agent modified its own grader.
 * Returns a single digest over the named files' contents (missing files contribute "").
 */
export function hashFiles(cwd: string, files: string[]): string {
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    const full = resolve(cwd, file);
    hash.update(file);
    hash.update("\0");
    hash.update(existsSync(full) ? readFileSync(full) : Buffer.from(""));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Best-effort discovery of the files that constitute the "grader" — test files and CI
 * config. We forbid agents from changing these during implementation tasks so a passing
 * verification actually means something.
 */
export function discoverTestFiles(cwd: string): string[] {
  const tracked = git(cwd, ["ls-files"]).out;
  if (!tracked) return [];
  const patterns = [
    /(^|\/)tests?\//i,
    /(^|\/)__tests__\//,
    /\.(test|spec)\.[jt]sx?$/,
    /_test\.go$/,
    /(^|\/)test_.*\.py$/,
    /\.(yml|yaml)$/i // CI workflows
  ];
  return tracked
    .split("\n")
    .map((l) => l.trim())
    .filter((f) => f && patterns.some((p) => p.test(f)))
    .filter((f) => !f.includes("node_modules"))
    .slice(0, 400);
}
