import { describe, expect, it } from "vitest";
import { evaluateDoctor } from "../src/doctor.js";

describe("doctor evaluation", () => {
  it("is ok when tmux, config, and providers all pass", () => {
    const report = evaluateDoctor({
      tmux: { present: true, version: "tmux 3.4" },
      hasConfig: true,
      configErrors: [],
      providers: [{ name: "dev", command: "claude", present: true, authMode: "subscription", authConfigured: true }]
    });
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "tmux")?.detail).toBe("tmux 3.4");
  });

  it("fails and offers a fix when tmux is missing", () => {
    const report = evaluateDoctor({ tmux: { present: false }, hasConfig: false, configErrors: [], providers: [] });
    expect(report.ok).toBe(false);
    const tmux = report.checks.find((c) => c.name === "tmux");
    expect(tmux?.ok).toBe(false);
    expect(tmux?.fix).toContain("Install tmux");
  });

  it("reports missing config when none is loaded", () => {
    const report = evaluateDoctor({ tmux: { present: true }, hasConfig: false, configErrors: [], providers: [] });
    expect(report.checks.find((c) => c.name === "config")?.fix).toBe("Run `loop init`.");
  });

  it("surfaces a not-on-PATH provider with a remediation", () => {
    const report = evaluateDoctor({
      tmux: { present: true },
      hasConfig: true,
      configErrors: [],
      providers: [{ name: "be", command: "codex", present: false, authMode: "auto", authConfigured: false }]
    });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "provider:be")?.fix).toContain("Install and log in to codex");
  });
});
