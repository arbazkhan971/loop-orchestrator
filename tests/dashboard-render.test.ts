import { describe, expect, it } from "vitest";
import { renderDashboard } from "../src/dashboard/render.js";

describe("dashboard rendering", () => {
  it("escapes project names embedded in HTML", () => {
    const html = renderDashboard(`demo <ops> "team"`);

    expect(html).toContain("demo &lt;ops&gt; &quot;team&quot;");
    expect(html).not.toContain(`demo <ops> "team"`);
  });
});
