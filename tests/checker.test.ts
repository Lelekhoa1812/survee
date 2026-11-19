import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkHtml } from "../src/lib/diagnostics/static";
import type { Report } from "../src/lib/diagnostics/types";

const STARTER = readFileSync(join(__dirname, "../docs/template/starter.kqa.html"), "utf8");

function swap(html: string, from: string | RegExp, to: string): string {
  const out = html.replace(from, to);
  if (out === html) throw new Error(`fixture did not change: ${String(from)}`);
  return out;
}
const codes = (r: Report) => r.diagnostics.map((d) => d.code);
const find = (r: Report, code: string) => r.diagnostics.find((d) => d.code === code);
const GUIDED = `<!doctype html><html lang="en"><head><title>Test</title><script type="application/json" id="kqa-manifest">{"format":"kqa/1","title":"Test","presentation":"guided","sections":[{"id":"start","title":"Getting started"}],"questions":[{"id":"name","type":"text","section":"start","label":"Your name"}]}</script></head><body><main><div data-kqa-question-list="start"><section data-kqa-question-id="name"><label>Your name<input type="text" data-kqa="name"></label></section></div></main></body></html>`;
const RANK = `<!doctype html><html lang="en"><head><title>Test</title><script type="application/json" id="kqa-manifest">{"format":"kqa/1","title":"Test","questions":[{"id":"priority","type":"rank","label":"Order these","options":[{"value":"cost","label":"Cost"},{"value":"speed","label":"Speed"},{"value":"quality","label":"Quality"}]}]}</script></head><body><fieldset><legend>Order these</legend><ol data-kqa="priority"><li data-value="cost">Cost</li><li data-value="speed">Speed</li><li data-value="quality">Quality</li></ol></fieldset></body></html>`;

describe("starter template", () => {
  it("passes with no errors", () => {
    const r = checkHtml(STARTER, { fileName: "starter.kqa.html" });
    expect(r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} ${d.message}`)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.manifest?.questions).toHaveLength(10);
    expect(r.stats.boundQuestions).toBe(9);
    expect(r.stats.customQuestions).toBe(1);
  });
  it("has no warnings either, so it is a safe model to copy", () => {
    const r = checkHtml(STARTER);
    expect(r.diagnostics.filter((d) => d.severity !== "info").map((d) => `${d.code} L${d.location?.line} ${d.message}`)).toEqual([]);
  });
});

describe("exclusive checkbox options", () => {
  it("accepts declared exclusive values and rejects undeclared ones", () => {
    const html = `<!doctype html><html lang="en"><head><title>Test</title><script type="application/json" id="kqa-manifest">{"format":"kqa/1","title":"Test","questions":[{"id":"choices","type":"multi","label":"Choose","exclusiveOptions":["none"],"options":[{"value":"none","label":"None"},{"value":"one","label":"One"}]}]}</script></head><body><fieldset><legend>Choose</legend><label><input type="checkbox" data-kqa="choices" value="none">None</label><label><input type="checkbox" data-kqa="choices" value="one">One</label></fieldset></body></html>`;
    expect(codes(checkHtml(html))).not.toContain("KQA221");
    expect(codes(checkHtml(html.replace('"exclusiveOptions":["none"]', '"exclusiveOptions":["missing"]')))).toContain("KQA221");
  });
});

describe("file level", () => {
  it("rejects an empty file", () => expect(codes(checkHtml("  \n"))).toContain("KQA100"));
  it("reports a missing manifest", () => {
    const r = checkHtml(swap(STARTER, /<script type="application\/json" id="kqa-manifest">/, '<script type="application/json" id="not-it">'));
    expect(find(r, "KQA200")?.message).toMatch(/without id="kqa-manifest"/);
    expect(r.ok).toBe(false);
  });
  it("reports a truncated file", () => {
    const r = checkHtml(STARTER.slice(0, STARTER.indexOf("<script>\n  // A custom control") + 40));
    expect(codes(r)).toContain("KQA112");
  });
  it("flags duplicate ids with the first location", () => {
    const r = checkHtml(swap(STARTER, 'id="f-goal"', 'id="f-company"'));
    expect(find(r, "KQA111")?.message).toMatch(/f-company.*used 2 times/);
  });
  it("warns when the doctype is missing", () => expect(codes(checkHtml(swap(STARTER, "<!doctype html>", "")))).toContain("KQA103"));
});

describe("questionnaire language metadata", () => {
  it("explains the English KQA shell for non-English questionnaires without treating it as an error", () => {
    const report = checkHtml(STARTER.replace('<html lang="en-AU">', '<html lang="vi-VN">'));
    const diagnostic = find(report, "KQA505");
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.message).toContain("KQA's shell and built-in respondent controls remain in English");
    expect(report.ok).toBe(true);
  });

  it("does not warn for English tags and treats an empty lang attribute as missing", () => {
    expect(codes(checkHtml(STARTER.replace('<html lang="en-AU">', '<html lang="en-US">')))).not.toContain("KQA505");
    expect(codes(checkHtml(STARTER.replace('<html lang="en-AU">', '<html lang="">')))).toContain("KQA501");
  });
});

describe("manifest syntax", () => {
  it("points at a trailing comma with line and column", () => {
    const r = checkHtml(swap(STARTER, '"label": "What is your company called?"\n    },', '"label": "What is your company called?",\n    },'));
    const d = find(r, "KQA202");
    expect(d?.message).toMatch(/Trailing comma/);
    expect(d?.location?.line).toBeGreaterThan(5);
    expect(d?.context).toContain(">");
  });
  it("explains single quotes", () => {
    const r = checkHtml(swap(STARTER, '"id": "priority"', "'id': 'priority'"));
    expect(find(r, "KQA202")?.message).toMatch(/Single quotes/);
  });
  it("explains a missing comma", () => {
    const r = checkHtml(swap(STARTER, '"id": "company", "type": "text"', '"id": "company" "type": "text"'));
    expect(find(r, "KQA202")?.message).toMatch(/comma is probably missing/);
  });
  it("rejects comments in JSON", () => {
    const r = checkHtml(swap(STARTER, '"format": "kqa/1",', '"format": "kqa/1", // version'));
    expect(find(r, "KQA202")?.message).toMatch(/Comments are not allowed/);
  });
  it("requires type=application/json", () => {
    const r = checkHtml(swap(STARTER, /<script type="application\/json" id="kqa-manifest">/, '<script id="kqa-manifest">'));
    expect(codes(r)).toContain("KQA203");
  });
});

describe("manifest rules", () => {
  it("accepts full-order rank markup and rejects missing or duplicate option bindings", () => {
    expect(checkHtml(RANK).ok).toBe(true);
    expect(codes(checkHtml(RANK.replace('<li data-value="quality">Quality</li>', "")))).toContain("KQA304");
    expect(codes(checkHtml(RANK.replace('data-value="quality"', 'data-value="speed"')))).toContain("KQA304");
    expect(codes(checkHtml(RANK.replace(',"options":[{"value":"cost","label":"Cost"},{"value":"speed","label":"Speed"},{"value":"quality","label":"Quality"}]', "")))).toContain("KQA209");
  });
  it("suggests ordered-list binding when a rank control is missing", () => {
    const d = find(checkHtml(RANK.replace('<ol data-kqa="priority"><li data-value="cost">Cost</li><li data-value="speed">Speed</li><li data-value="quality">Quality</li></ol>', "")), "KQA300");
    expect(d?.fix).toContain('<ol data-kqa="priority">');
  });
  it("accepts guided presentation only with section and question block markers", () => {
    expect(codes(checkHtml(GUIDED))).not.toContain("KQA220");
    expect(codes(checkHtml(GUIDED))).not.toContain("KQA321");
    expect(codes(checkHtml(GUIDED.replace('"presentation":"guided",', '')))).not.toContain("KQA220");
    expect(codes(checkHtml(GUIDED.replace(',"sections":[{"id":"start","title":"Getting started"}],', ',')))).toContain("KQA220");
    expect(codes(checkHtml(GUIDED.replace(' data-kqa-question-id="name"', '')))).toContain("KQA321");
    expect(codes(checkHtml(GUIDED.replace('data-kqa-question-list="start"', 'data-kqa-question-list="unknown"')))).toContain("KQA321");
  });
  it("accepts answered-state routing for free text and rejects an unnecessary value", () => {
    const html = `<!doctype html><html><head><script type="application/json" id="kqa-manifest">{"format":"kqa/1","title":"Answer routing","questions":[{"id":"details","type":"text","label":"Details"},{"id":"follow-up","type":"text","label":"More detail","when":{"all":[{"question":"details","operator":"answered"}]}}]}</script></head><body><label>Details<input type="text" data-kqa="details"></label><label>More detail<input type="text" data-kqa="follow-up"></label></body></html>`;
    expect(codes(checkHtml(html))).not.toContain("KQA218");
    expect(codes(checkHtml(html.replace('"operator":"answered"', '"operator":"answered","value":"yes"')))).toContain("KQA218");
    expect(codes(checkHtml(html.replace('"operator":"answered"', '"operator":"greaterThan"')))).toContain("KQA218");
  });
  it("rejects a wrong format version", () => expect(codes(checkHtml(swap(STARTER, '"format": "kqa/1"', '"format": "kqa/2"')))).toContain("KQA204"));
  it("suggests a type for a common mistake", () => {
    const d = find(checkHtml(swap(STARTER, '"id": "priority", "type": "single"', '"id": "priority", "type": "radio"')), "KQA208");
    expect(d?.message).toMatch(/Did you mean "single"/);
    expect(d?.fix).toMatch(/Change "type" to "single"/);
  });
  it("suggests a slug for an invalid id", () => {
    const d = find(checkHtml(swap(STARTER, '"id": "team-size"', '"id": "Team Size"')), "KQA206");
    expect(d?.message).toMatch(/team-size/);
  });
  it("rejects duplicate question ids", () => expect(codes(checkHtml(swap(STARTER, '"id": "channels"', '"id": "priority"')))).toContain("KQA207"));
  it("requires options on choice questions", () => {
    const r = checkHtml(swap(STARTER, /"id": "channels", "type": "multi", "section": "choices",\n\s+"label": "Which channels do you use today\?",\n\s+"help": "Choose up to 3 channels that apply.",\n\s+"maxSelections": 3,\n\s+"options": \[[^\]]*\]/, '"id": "channels", "type": "multi", "section": "choices", "label": "Which channels do you use today?"'));
    expect(codes(r)).toContain("KQA209");
  });
  it("rejects duplicate option values", () => expect(codes(checkHtml(swap(STARTER, '"value": "speed"', '"value": "accuracy"')))).toContain("KQA210"));
  it("accepts a valid multi-select cap and rejects invalid caps", () => {
    const valid = STARTER;
    expect(codes(checkHtml(valid))).not.toContain("KQA219");
    for (const cap of [0, 1.5, 5]) {
      const invalid = valid.replace('"maxSelections": 3', `"maxSelections": ${cap}`);
      expect(codes(checkHtml(invalid))).toContain("KQA219");
    }
    const wrongType = swap(valid, '"id": "channels", "type": "multi"', '"id": "channels", "type": "single"');
    expect(codes(checkHtml(wrongType))).toContain("KQA219");
  });
  it("rejects an unknown section", () => expect(codes(checkHtml(swap(STARTER, '"section": "writing", "required": true', '"section": "nope", "required": true')))).toContain("KQA211"));
  it("rejects a bad scale", () => expect(codes(checkHtml(swap(STARTER, '"id": "confidence", "type": "scale", "section": "writing", "min": 1, "max": 5', '"id": "confidence", "type": "scale", "section": "writing", "min": 5, "max": 1')))).toContain("KQA212"));
  it("rejects scale bounds outside the safe integer range", () => expect(codes(checkHtml(swap(STARTER, '"id": "confidence", "type": "scale", "section": "writing", "min": 1, "max": 5', '"id": "confidence", "type": "scale", "section": "writing", "min": 10000000000000000, "max": 10000000000000002')))).toContain("KQA212"));
  it("warns about a misspelt field", () => {
    const d = find(checkHtml(swap(STARTER, '"required": true,\n      "label": "Which area', '"require": true,\n      "label": "Which area')), "KQA216");
    expect(d?.message).toMatch(/Did you mean "required"/);
  });
  it("flags options on a text question", () => expect(codes(checkHtml(swap(STARTER, '"id": "company", "type": "text",', '"id": "company", "type": "text", "options": [{"value":"a","label":"A"},{"value":"b","label":"B"}],')))).toContain("KQA209"));
  it("accepts bounded conditions that refer to earlier declared choice values", () => {
    const html = swap(STARTER, '"id": "company", "type": "text",', '"id": "company", "type": "text", "when": {"all":[{"question":"priority","operator":"equals","value":"accuracy"}]},');
    expect(codes(checkHtml(html))).not.toContain("KQA218");
  });
  it("rejects routing references to later questions", () => {
    const html = swap(STARTER, '"id": "priority", "type": "single",', '"id": "priority", "type": "single", "when": {"any":[{"question":"channels","operator":"equals","value":"email"}]},');
    expect(codes(checkHtml(html))).toContain("KQA218");
  });
  it("rejects conditions whose operator does not match the source type or option value", () => {
    const html = swap(STARTER, '"id": "company", "type": "text",', '"id": "company", "type": "text", "when": {"all":[{"question":"channels","operator":"equals","value":"missing"}]},');
    expect(codes(checkHtml(html)).filter((code) => code === "KQA218").length).toBeGreaterThanOrEqual(2);
  });
  it("rejects empty condition groups", () => {
    const html = swap(STARTER, '"id": "company", "type": "text",', '"id": "company", "type": "text", "when": {"all":[]},');
    expect(codes(checkHtml(html))).toContain("KQA218");
  });
});

describe("bindings", () => {
  it("catches a typo in data-kqa on both sides", () => {
    const r = checkHtml(swap(STARTER, 'data-kqa="company"', 'data-kqa="compny"'));
    expect(find(r, "KQA301")?.message).toMatch(/Did you mean "company"/);
    expect(find(r, "KQA300")?.message).toMatch(/probably a typo/);
  });
  it("catches an option value that differs from the manifest", () => {
    const d = find(checkHtml(swap(STARTER, 'data-kqa="priority" value="speed"', 'data-kqa="priority" value="fast"')), "KQA303");
    expect(d?.message).toMatch(/not an option of "priority"/);
    expect(d?.location?.snippet).toContain('value="fast"');
  });
  it("catches an option nobody can pick", () => {
    const r = checkHtml(swap(STARTER, /<label class="kq-opt"><input type="radio" name="priority" data-kqa="priority" value="cost">.*<\/label>\n/, ""));
    expect(find(r, "KQA304")?.message).toMatch(/option "cost"/);
  });
  it("catches the wrong element for the type", () => {
    const d = find(checkHtml(swap(STARTER, 'type="radio" name="priority" data-kqa="priority" value="cost"', 'type="checkbox" name="priority" data-kqa="priority" value="cost"')), "KQA302");
    expect(d?.message).toMatch(/needs radio buttons/);
  });
  it("catches radios of two questions sharing a name", () => expect(codes(checkHtml(swap(STARTER, 'name="confidence" data-kqa="confidence" value="1"', 'name="priority" data-kqa="confidence" value="1"')))).toContain("KQA319"));
  it("catches a missing value attribute", () => expect(codes(checkHtml(swap(STARTER, 'data-kqa="priority" value="speed"', 'data-kqa="priority"')))).toContain("KQA312"));
  it("catches a note field with no question note", () => {
    const r = checkHtml(swap(STARTER, '"note": true', '"note": false'));
    expect(codes(r)).toContain("KQA305");
  });
  it("catches a note the page forgot", () => expect(codes(checkHtml(swap(STARTER, 'data-kqa-note="priority"', 'data-kqa-other="priority"')))).toContain("KQA306"));
  it("catches pre-selected controls", () => expect(codes(checkHtml(swap(STARTER, 'name="priority" data-kqa="priority" value="accuracy"', 'name="priority" data-kqa="priority" value="accuracy" checked')))).toContain("KQA320"));
  it("catches a custom question nothing sets", () => {
    const html = swap(STARTER, 'KQA.set("stars", value)', "void value");
    expect(codes(checkHtml(html))).toContain("KQA317");
  });
  it("warns about unlabelled controls", () => expect(codes(checkHtml(swap(STARTER, '<label for="f-company">What is your company called?</label>', "What is your company called?")))).toContain("KQA308"));
  it("checks control limits against the manifest", () => expect(codes(checkHtml(swap(STARTER, 'min="1" max="5000"', 'min="0" max="9"')))).toContain("KQA314"));
  it("catches an unknown status element", () => expect(codes(checkHtml(swap(STARTER, 'data-kqa-status="goal"', 'data-kqa-status="goall"')))).toContain("KQA311"));
});

describe("sandbox", () => {
  const withScript = (body: string) => swap(STARTER, "</body>", `<script>${body}</script></body>`);
  it("blocks an external script", () => expect(codes(checkHtml(swap(STARTER, "</head>", '<script src="https://evil.example/x.js"></script></head>')))).toContain("KQA400"));
  it("allows an allowlisted CDN script", () => expect(codes(checkHtml(swap(STARTER, "</head>", '<script src="https://cdnjs.cloudflare.com/ajax/libs/x/1.0.0/x.min.js"></script></head>')))).not.toContain("KQA400"));
  it("blocks a relative script and stylesheet", () => {
    const r = checkHtml(swap(STARTER, "</head>", '<script src="app.js"></script><link rel="stylesheet" href="style.css"></head>'));
    expect(codes(r)).toEqual(expect.arrayContaining(["KQA400", "KQA401"]));
  });
  it("blocks a disallowed stylesheet host and @import", () => {
    const r = checkHtml(swap(STARTER, "</head>", '<link rel="stylesheet" href="https://cdn.example/s.css"><style>@import url("https://cdn.example/t.css");</style></head>'));
    expect(r.diagnostics.filter((d) => d.code === "KQA401")).toHaveLength(2);
  });
  it("flags network calls, storage, dialogs, navigation, eval", () => {
    const r = checkHtml(withScript("fetch('/x'); localStorage.setItem('a','b'); confirm('sure?'); window.print(); location.href='/'; eval('1');"));
    expect(codes(r)).toEqual(expect.arrayContaining(["KQA402", "KQA403", "KQA404", "KQA412", "KQA409", "KQA414"]));
  });
  it("ignores keywords inside comments and strings", () => {
    const r = checkHtml(withScript("// fetch('/x')\nvar s = 'localStorage and confirm(1)'; /* eval('x') */"));
    expect(codes(r)).not.toEqual(expect.arrayContaining(["KQA402"]));
    expect(codes(r)).not.toContain("KQA403");
    expect(codes(r)).not.toContain("KQA404");
    expect(codes(r)).not.toContain("KQA414");
  });
  it("blocks forms that submit, meta refresh, base, iframes, file inputs", () => {
    const html = swap(STARTER, "</main>", '<form action="/go" method="post"></form><iframe src="x"></iframe><input type="file"></main>').replace("</head>", '<meta http-equiv="refresh" content="5"><base href="/"></head>');
    expect(codes(checkHtml(html))).toEqual(expect.arrayContaining(["KQA405", "KQA408", "KQA415", "KQA406", "KQA407"]));
  });
  it("flags http images and download links", () => {
    const r = checkHtml(swap(STARTER, "</main>", '<img src="http://x.example/a.png" alt=""><a href="/x" download>x</a></main>'));
    expect(codes(r)).toEqual(expect.arrayContaining(["KQA411", "KQA413"]));
  });
});

describe("report shape", () => {
  it("sorts errors first and gives line context", () => {
    const r = checkHtml(swap(STARTER, 'data-kqa="priority" value="speed"', 'data-kqa="priority" value="fast"'));
    expect(r.diagnostics[0].severity).toBe("error");
    const d = find(r, "KQA303")!;
    expect(d.location!.line).toBeGreaterThan(1);
    expect(d.context).toMatch(/> +\d+ \|/);
    expect(d.fix.length).toBeGreaterThan(10);
  });
});
