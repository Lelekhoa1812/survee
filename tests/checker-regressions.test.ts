import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkHtml, maskJs } from "../src/lib/diagnostics/static";
import { frameContentSecurityPolicy } from "../src/lib/format/bridge";
import type { Report } from "../src/lib/diagnostics/types";

// Cases found by adversarial QA of the checker. Each one pins a behaviour so it cannot quietly regress.
const STARTER = readFileSync(join(__dirname, "../docs/template/starter.kqa.html"), "utf8");
const codes = (r: Report) => r.diagnostics.map((d) => d.code);
const find = (r: Report, code: string) => r.diagnostics.find((d) => d.code === code);
function swap(html: string, from: string | RegExp, to: string): string {
  const out = html.replace(from, to);
  if (out === html) throw new Error(`fixture did not change: ${String(from)}`);
  return out;
}
/** Insert extra script text at the end of the custom-control script. */
const withScript = (js: string) => swap(STARTER, "  // A custom control", `  ${js}\n  // A custom control`);

describe("false errors that trapped agents in a loop", () => {
  it("a form with an onsubmit handler is fine", () => {
    const r = checkHtml(swap(STARTER, "<main", '<form onsubmit="return false"><main').replace("</main>", "</main></form>"));
    expect(codes(r)).not.toContain("KQA405");
    expect(codes(r)).not.toContain("KQA416");
  });
  it("a form with no action and no handler is a warning, not an error", () => {
    const r = checkHtml(swap(STARTER, "<main", "<form><main").replace("</main>", "</main></form>"));
    expect(find(r, "KQA416")?.severity).toBe("warning");
    expect(codes(r)).not.toContain("KQA405");
    expect(r.ok).toBe(true);
  });
  it("a form that posts somewhere is still an error", () => {
    const r = checkHtml(swap(STARTER, "<main", '<form action="https://example.com/x" method="post"><main').replace("</main>", "</main></form>"));
    expect(find(r, "KQA405")?.severity).toBe("error");
  });
  it("a misspelt type does not also claim the options are wrong", () => {
    const r = checkHtml(swap(STARTER, '"id": "priority", "type": "single"', '"id": "priority", "type": "radio"'));
    expect(codes(r)).toContain("KQA208");
    expect(find(r, "KQA208")?.message).toMatch(/Did you mean "single"/);
    expect(codes(r)).not.toContain("KQA209");
  });
});

describe("script scanning", () => {
  it("does not mistake a regular expression for a call", () => {
    const r = checkHtml(withScript("var re = /fetch|alert\\(|'quote/g; void re;"));
    expect(codes(r).filter((c) => ["KQA402", "KQA404"].includes(c))).toEqual([]);
  });
  it("does not flag a user function that happens to be called confirm", () => {
    const r = checkHtml(withScript("function confirm(id) { return id; } void confirm;"));
    expect(codes(r)).not.toContain("KQA404");
  });
  it("does not flag a local variable called download", () => {
    expect(codes(checkHtml(withScript("let download = 0; void download;")))).not.toContain("KQA413");
  });
  it.each([
    ["window.fetch('/x')", "KQA402"],
    ["window.alert('x')", "KQA404"],
    ["window.eval('1')", "KQA414"],
    ["Function('return 1')()", "KQA414"],
    ["self.location.href = 'https://example.com'", "KQA409"],
    ["location.reload()", "KQA409"],
    ["var s = `${fetch('/x')}`;", "KQA402"],
    ["window.localStorage.setItem('a', 'b')", "KQA403"],
  ])("sees %s", (js, code) => {
    expect(codes(checkHtml(withScript(js)))).toContain(code);
  });
  it("still sees code after a regex containing a quote", () => {
    expect(codes(checkHtml(withScript("var r = /it's/; fetch('/x');")))).toContain("KQA402");
  });
  it("scans scripts whose type carries parameters", () => {
    const r = checkHtml(swap(STARTER, "</body>", '<script type="text/javascript; charset=utf-8" src="https://evil.example/x.js"></script></body>'));
    expect(find(r, "KQA400")?.severity).toBe("error");
  });
  it("keeps masking sane", () => {
    expect(maskJs("a = /x'y/; b = 'fetch'; // fetch\nfetch(1)")).toMatch(/fetch\(1\)$/);
    expect(maskJs("a = 4 / 2; b = 6 / 3; fetch(1)")).toContain("fetch(1)");
  });
  it("stays fast on a script with tens of thousands of matches", () => {
    const body = Array.from({ length: 40000 }, (_, i) => `fetch(${i});`).join("\n");
    const t = Date.now();
    checkHtml(withScript(body));
    expect(Date.now() - t).toBeLessThan(2500);
  });
});

describe("markup rules", () => {
  it("looks inside <template>", () => {
    expect(codes(checkHtml(swap(STARTER, "</body>", '<template><iframe src="https://example.com"></iframe></template></body>')))).toContain("KQA408");
  });
  it("warns about a link to another page, not about an https link or an in-page link", () => {
    const rel = checkHtml(swap(STARTER, "<h1>Starter questionnaire</h1>", '<h1>Starter questionnaire</h1><p><a href="other.html">more</a></p>'));
    expect(codes(rel)).toContain("KQA409");
    const abs = checkHtml(swap(STARTER, "<h1>Starter questionnaire</h1>", '<h1>Starter questionnaire</h1><p><a href="https://example.com/x">more</a> <a href="#choices">up</a></p>'));
    expect(codes(abs)).not.toContain("KQA409");
  });
  it("compares maxlength with the manifest", () => {
    expect(codes(checkHtml(swap(STARTER, 'data-kqa="company" maxlength="120"', 'data-kqa="company" maxlength="50"')))).toContain("KQA314");
  });
  it("notices a number step that the control does not set", () => {
    const r = checkHtml(swap(STARTER, '"id": "team-size", "type": "number", "section": "writing", "min": 1, "max": 5000,', '"id": "team-size", "type": "number", "section": "writing", "min": 1, "max": 5000, "step": 5,'));
    expect(codes(r)).toContain("KQA314");
  });
  it("treats a value on a range input as a pre-set answer", () => {
    const html = swap(STARTER, "</main>", '<input type="range" min="1" max="5" value="3" data-kqa="x" aria-label="x"></main>');
    expect(codes(checkHtml(html))).toContain("KQA301"); // unknown id, but the value is judged on bound controls in the next test
    const bound = swap(
      swap(STARTER, '<label><input type="radio" name="confidence" data-kqa="confidence" value="1">1</label>', '<input type="range" min="1" max="5" value="3" data-kqa="confidence" aria-label="Confidence">'),
      /<label><input type="radio" name="confidence"[^\n]*\n/g,
      "",
    );
    expect(codes(checkHtml(bound))).toContain("KQA320");
  });
});

describe("pointing at the right place", () => {
  it("names each control that lost its data-kqa on its own line", () => {
    const html = swap(swap(STARTER, 'name="priority" data-kqa="priority" value="accuracy"', 'name="priority" value="accuracy"'), 'name="priority" data-kqa="priority" value="speed"', 'name="priority" value="speed"');
    const r = checkHtml(html);
    const missing = r.diagnostics.filter((d) => d.code === "KQA304");
    expect(missing).toHaveLength(2);
    const lines = html.split("\n");
    for (const d of missing) {
      expect(lines[(d.location?.line ?? 0) - 1]).toMatch(/value="(accuracy|speed)"/);
      expect(d.message).toMatch(/no data-kqa/);
    }
    expect(new Set(missing.map((d) => d.location?.line)).size).toBe(2);
  });
  it("does not call a valueless radio a missing option", () => {
    const r = checkHtml(swap(STARTER, 'data-kqa="priority" value="cost"', 'data-kqa="priority"'));
    expect(codes(r)).toContain("KQA312");
    expect(codes(r)).not.toContain("KQA304");
  });
  it("points a missing control at the question in the manifest", () => {
    const html = swap(STARTER, 'data-kqa="team-size" min="1"', 'data-kqa="team-sizee" min="1"');
    const r = checkHtml(html);
    const d = find(r, "KQA300");
    expect(d?.location?.line).toBeGreaterThan(0);
    const around = html.split("\n").slice((d?.location?.line ?? 1) - 1, (d?.location?.line ?? 1) + 2).join("\n");
    expect(around).toMatch(/"id": "team-size"/);
  });
  it("counts lines correctly in a CRLF file", () => {
    const crlf = STARTER.replace(/\n/g, "\r\n");
    const bad = swap(crlf, 'data-kqa="company" maxlength="120"', 'data-kqa="compnay" maxlength="120"');
    const d = find(checkHtml(bad), "KQA301");
    expect(bad.split("\r\n")[(d?.location?.line ?? 1) - 1]).toMatch(/compnay/);
  });
});

describe("images and frame policy", () => {
  it("warns that a remote image will not load", () => {
    const r = checkHtml(swap(STARTER, "<h1>Starter questionnaire</h1>", '<h1>Starter questionnaire</h1><img src="https://example.com/logo.png" alt="Logo">'));
    expect(codes(r)).toContain("KQA417");
  });
  it("accepts an image embedded as a data URI", () => {
    const r = checkHtml(swap(STARTER, "<h1>Starter questionnaire</h1>", '<h1>Starter questionnaire</h1><img src="data:image/png;base64,//8AAA==" alt="Dot">'));
    expect(codes(r)).not.toContain("KQA417");
  });
  it("accepts a stored KQA image asset URL", () => {
    const r = checkHtml(swap(STARTER, "<h1>Starter questionnaire</h1>", `<h1>Starter questionnaire</h1><img src="/api/assets/${"a".repeat(43)}" alt="Logo">`));
    expect(codes(r)).not.toContain("KQA418");
    expect(codes(r)).not.toContain("KQA417");
  });
  it("rejects a relative image file that is not stored in KQA", () => {
    const r = checkHtml(swap(STARTER, "<h1>Starter questionnaire</h1>", '<h1>Starter questionnaire</h1><img src="./logo.png" alt="Logo">'));
    expect(codes(r)).toContain("KQA418");
  });
  it("warns about a remote CSS background image", () => {
    const r = checkHtml(swap(STARTER, "</style>", ".hero { background: url(https://example.com/bg.jpg); }\n</style>"));
    expect(codes(r)).toContain("KQA417");
  });
  it("allows only the KQA asset path for stored image assets in the frame CSP", () => {
    const csp = frameContentSecurityPolicy("https://kqa.example/path");
    expect(csp).toContain("img-src https://kqa.example/api/assets/ data: blob:");
    expect(csp).not.toContain("img-src 'self'");
    expect(frameContentSecurityPolicy("javascript:alert(1)")).toContain("img-src data: blob:");
  });
});
