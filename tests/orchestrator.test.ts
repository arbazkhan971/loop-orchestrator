import { describe, expect, it } from "vitest";
import { agentReportedSuccess, extractJsonArray } from "../src/orchestrator.js";

describe("extractJsonArray", () => {
  it("pulls a JSON array out of noisy CLI wrapper output", () => {
    // Many CLIs emit a wrapper line, then the result text embeds a literal array.
    const noisy = '{"event":"start"}\nresult: [{"a":1},{"a":2}] -- done\n{"event":"end"}';
    const extracted = extractJsonArray(noisy);
    expect(extracted).toBeDefined();
    const parsed = JSON.parse(extracted!);
    expect(parsed).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("unwraps a claude --output-format json envelope with an ESCAPED inner array", () => {
    // This is the real shape of `claude -p ... --output-format json`: the model's text
    // (containing our array) is escaped inside the "result" string. A naive slice fails;
    // we must unwrap the envelope first.
    const inner = '[{"title":"Build API","assignee":"be","priority":5}]';
    const envelope = JSON.stringify({ result: `Here is the plan:\n${inner}`, is_error: false });
    const extracted = extractJsonArray(envelope);
    expect(extracted).toBeDefined();
    const parsed = JSON.parse(extracted!);
    expect(parsed).toEqual([{ title: "Build API", assignee: "be", priority: 5 }]);
  });

  it("handles a bare top-level JSON array", () => {
    const extracted = extractJsonArray('[{"title":"x"}]');
    expect(JSON.parse(extracted!)).toEqual([{ title: "x" }]);
  });

  it("ignores brackets inside strings when balancing", () => {
    const raw = 'noise [{"title":"has ] bracket","assignee":"qa"}] end';
    const parsed = JSON.parse(extractJsonArray(raw)!);
    expect(parsed).toEqual([{ title: "has ] bracket", assignee: "qa" }]);
  });

  it("extracts a clean array from plain output", () => {
    const raw = 'prefix text\n[{"title":"x","priority":1}]\ntrailing';
    const extracted = extractJsonArray(raw);
    expect(extracted).toBeDefined();
    const parsed = JSON.parse(extracted!);
    expect(parsed).toEqual([{ title: "x", priority: 1 }]);
  });

  it("returns undefined when no array is present", () => {
    expect(extractJsonArray('{"result":"no arrays here"}')).toBeUndefined();
    expect(extractJsonArray("just some prose")).toBeUndefined();
    expect(extractJsonArray("")).toBeUndefined();
  });
});

describe("agentReportedSuccess", () => {
  it("treats exit-0 output with is_error:true as failure", () => {
    // The real failure mode we hit: claude exits 0 but reports an unavailable model.
    const out = '{"type":"result","is_error":true,"result":"model unavailable"}';
    expect(agentReportedSuccess(out)).toBe(false);
  });

  it("treats is_error:false as success", () => {
    expect(agentReportedSuccess('{"is_error":false,"result":"done"}')).toBe(true);
  });

  it("treats a terminal error event as failure", () => {
    expect(agentReportedSuccess('{"type":"error","message":"boom"}')).toBe(false);
  });

  it("accepts substantive output when no structured signal is present", () => {
    expect(agentReportedSuccess("created the file successfully")).toBe(true);
    expect(agentReportedSuccess("   ")).toBe(false);
  });
});
