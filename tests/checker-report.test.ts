import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkHtml } from "../src/lib/diagnostics/static";
import { toAgentMarkdown } from "../src/lib/diagnostics/report";

const starter = readFileSync(new URL("../docs/template/starter.kqa.html", import.meta.url), "utf8");

describe("agent checker reports", () => {
  it("does not tell an agent a passing file was rejected", () => {
    const report = toAgentMarkdown(checkHtml(starter, { fileName: "starter.kqa.html" }));
    expect(report).toContain("passed the static checker");
    expect(report).not.toContain("found blocking errors");
  });

  it("clearly identifies blocking errors when a file fails", () => {
    const invalid = starter.replace('id="kqa-manifest"', 'id="missing-manifest"');
    const report = toAgentMarkdown(checkHtml(invalid));
    expect(report).toContain("found blocking errors");
    expect(report).toContain("KQA200");
  });
});
