import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkHtml } from "../src/lib/diagnostics/static";

const html = (template = `<template data-kqa-repeat-template="assets"><fieldset><legend>Asset</legend>
  <label>Asset name <input type="text" data-kqa-repeat-field="name"></label>
  <label>Condition <select data-kqa-repeat-field="condition"><option value="">Choose</option><option value="good">Good</option><option value="poor">Poor</option></select></label>
</fieldset></template>`) => `<!doctype html><html lang="en-AU"><head><title>Repeat test</title>
<script type="application/json" id="kqa-manifest">{"format":"kqa/1","title":"Repeat test","questions":[{"id":"assets","type":"repeat","label":"List assets","maxRows":5,"fields":[{"id":"name","type":"text","label":"Asset name"},{"id":"condition","type":"select","label":"Condition","options":[{"value":"good","label":"Good"},{"value":"poor","label":"Poor"}]}]}]}</script></head>
<body><main><h1>Repeat test</h1><section data-kqa-question-id="assets"><h2>List assets</h2>${template}</section></main></body></html>`;

const codes = (source: string) => checkHtml(source).diagnostics.map((item) => item.code);

describe("repeat question HTML contract", () => {
  it("ships a complete technical example that passes the checker", () => {
    const example = readFileSync(new URL("../docs/examples/repeated-assets.kqa.html", import.meta.url), "utf8");
    expect(checkHtml(example, { fileName: "repeated-assets.kqa.html" }).ok).toBe(true);
  });

  it("accepts one semantic fieldset template with the declared native fields", () => {
    const report = checkHtml(html());
    expect(report.ok).toBe(true);
    expect(report.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("requires exactly one template for each repeat question", () => {
    expect(codes(html().replace("</section>", "<template data-kqa-repeat-template=\"assets\"></template></section>"))).toContain("KQA300");
    expect(codes(html().replace('data-kqa-repeat-template="assets"', 'data-kqa-repeat-template="other"'))).toContain("KQA300");
  });

  it("rejects missing or mismatched declared fields and option coverage", () => {
    expect(codes(html().replace('data-kqa-repeat-field="name"', 'data-kqa-repeat-field="missing"'))).toContain("KQA300");
    expect(codes(html().replace('<option value="poor">Poor</option>', ""))).toContain("KQA304");
    expect(codes(html().replace('data-kqa-repeat-field="condition"', 'data-kqa-repeat-field="condition" data-kqa="assets"'))).toContain("KQA309");
  });

  it("requires a semantic fieldset and accessible labels", () => {
    expect(codes(html().replace("<fieldset>", "<div>").replace("</fieldset>", "</div>"))).toContain("KQA318");
    expect(codes(html().replace("<label>Asset name <input type=\"text\" data-kqa-repeat-field=\"name\"></label>", '<input type="text" data-kqa-repeat-field="name">'))).toContain("KQA308");
  });
});
