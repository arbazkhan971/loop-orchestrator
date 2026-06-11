import { describe, expect, it } from "vitest";
import { sessionName } from "../src/tmux.js";

describe("tmux helpers", () => {
  it("builds stable sanitized session names", () => {
    expect(sessionName("loop", "demo product", "issue/123", "fe 1")).toBe("loop-demo-product-issue-123-fe-1");
  });
});
