import { describe, expect, it } from "vitest";
import { buildProviderCommand, commandToShell } from "../src/providers.js";

describe("provider commands", () => {
  it("builds codex command with model and effort", () => {
    const command = buildProviderCommand(
      {
        type: "codex",
        args: ["--yolo"],
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
