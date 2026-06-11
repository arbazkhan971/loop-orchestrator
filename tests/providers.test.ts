import { describe, expect, it } from "vitest";
import { buildProviderCommand, commandToShell } from "../src/providers.js";

describe("provider commands", () => {
  it("builds codex command with model and effort", () => {
    const command = buildProviderCommand(
      {
        type: "codex",
        args: [],
        yolo: true,
        dangerouslySkipPermissions: false,
        model: "gpt-5.4",
        effort: "medium",
        promptMode: "interactive",
        env: {}
      },
      "/tmp/prompt.md"
    );

    expect(command.command).toBe("codex");
    expect(command.args).toEqual(["--yolo", "--model", "gpt-5.4", "--effort", "medium"]);
  });

  it("builds claude command with dangerous skip permissions", () => {
    const command = buildProviderCommand(
      {
        type: "claude",
        args: [],
        dangerouslySkipPermissions: true,
        yolo: false,
        model: "claude-sonnet-4-6",
        promptMode: "interactive",
        env: {}
      },
      "/tmp/prompt.md"
    );

    expect(command.args).toEqual(["--dangerously-skip-permissions", "--model", "claude-sonnet-4-6"]);
  });

  it("does not duplicate unsafe flags already passed through args", () => {
    const command = buildProviderCommand(
      {
        type: "claude",
        args: ["--dangerously-skip-permissions"],
        dangerouslySkipPermissions: true,
        yolo: false,
        promptMode: "interactive",
        env: {}
      },
      "/tmp/prompt.md"
    );

    expect(command.args.filter((arg) => arg === "--dangerously-skip-permissions")).toHaveLength(1);
  });

  it("quotes shell arguments safely", () => {
    const shell = commandToShell({
      command: "custom-agent",
      args: ["--task", "fix user's bug"],
      env: { TOKEN: "abc'123" }
    });

    expect(shell).toContain("TOKEN='abc'\\''123'");
    expect(shell).toContain("'fix user'\\''s bug'");
  });
});
