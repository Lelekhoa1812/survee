// Real-Chrome regression check: a lone "-" in a native number input must not clear a saved answer.
// Usage: node scripts/check-number-bad-input-chrome.mjs   (CHROME_PATH overrides the browser binary)
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dir = mkdtempSync(join(tmpdir(), "survee-number-"));
const page0 = join(dir, "page.html");
// Build a standalone page around the bridge source, using the same tsx toolchain as the repo.
const bundle = execFileSync(process.execPath, ["--import", "tsx", "-e", `
  import("./src/lib/format/bridge.ts").then((m) => process.stdout.write(m.BRIDGE_SOURCE));`], { encoding: "utf8" });
writeFileSync(page0, `<!doctype html><html><body>
<section><input type="number" data-kqa="amount" id="amount"></section>
<section><template data-kqa-repeat-template="assets"><fieldset><legend>Asset</legend><input type="number" data-kqa-repeat-field="amount"></fieldset></template><div data-kqa-record-list="assets"></div></section>
<script>${bundle}</script></body></html>`);

const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
const results = [];
const check = (name, ok, extra = "") => results.push([ok, name, extra]);
const settle = () => new Promise((r) => setTimeout(r, 150));
await page.evaluateOnNewDocument(() => { window.__ops = []; window.addEventListener("message", (e) => { if (e.data && e.data.kqa) window.__ops.push(e.data); }); });
await page.goto(pathToFileURL(page0).href);
await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { data: { kqa: 1, type: "init",
  questions: [{ id: "amount", type: "number", label: "Amount" }, { id: "assets", type: "repeat", label: "Assets", maxRows: 2, fields: [{ id: "amount", type: "number", label: "Amount" }] }],
  answers: { amount: { value: 5 } },
  recordGroups: { assets: [{ id: "row1", values: { amount: 2 }, revision: 1, fieldRevisions: { amount: 1 } }] } }, source: window })));
await settle();

const scalar = () => page.evaluate(() => { const el = document.querySelector("#amount"); return { bad: el.validity.badInput, kqa: window.KQA.get("amount"), invalid: el.getAttribute("aria-invalid"), last: window.__ops.filter((m) => m.type === "number-draft").at(-1) || null }; });
await page.evaluate(() => { const e = document.querySelector("#amount"); e.focus(); e.select(); });
await page.keyboard.type("-");
await settle();
let s = await scalar();
check("scalar lone '-' is browser-invalid", s.bad === true, JSON.stringify(s));
check("scalar saved value kept while draft is invalid", s.kqa === 5, JSON.stringify(s));
check("scalar field flagged aria-invalid and draft reported", s.invalid === "true" && s.last && s.last.valid === false, JSON.stringify(s));
await page.keyboard.press("Backspace");
await settle();
s = await scalar();
check("scalar correction releases the draft", s.invalid === null && s.last && s.last.valid === true, JSON.stringify(s));

const rowField = () => page.evaluate(() => { const el = document.querySelector('[data-kqa-repeat-field="amount"]'); return { bad: el.validity.badInput, ops: window.__ops.filter((m) => m.type === "record-operation").length, drafts: window.__ops.filter((m) => m.type === "record-drafts").at(-1) || null }; });
await page.evaluate(() => { const e = document.querySelector('[data-kqa-repeat-field="amount"]'); e.focus(); e.select(); });
await page.keyboard.type("-");
await settle();
const r = await rowField();
check("repeat lone '-' is browser-invalid", r.bad === true, JSON.stringify(r));
check("repeat '-' sends no record operation (not a clear)", r.ops === 0, `ops=${r.ops}`);
check("repeat invalid draft reported to shell", !!r.drafts && r.drafts.drafts.length === 1, JSON.stringify(r.drafts));

await browser.close();
let failed = 0;
for (const [ok, name, extra] of results) { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && extra ? "  " + extra : ""}`); }
process.exit(failed ? 1 : 0);
