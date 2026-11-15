// Regression check for the live check (the browser probe) in a real Chrome.
// Needs the dev server running. Usage: node scripts/probe-e2e.mjs [baseUrl]
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const base = process.argv[2] || "http://localhost:3100";
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(base).hostname);
const email = process.env.ADMIN_EMAIL || (local ? "admin@axiob.local" : "");
const password = process.env.ADMIN_PASSWORD || (local ? "12345678" : "");
const starter = readFileSync(path.join(import.meta.dirname, "..", "docs", "template", "starter.kqa.html"), "utf8");
const dir = mkdtempSync(path.join(tmpdir(), "kqa-probe-"));

const cases = [
  { name: "starter passes", html: starter, expect: { pass: true, codes: [] } },
  { name: "custom control that never repaints", html: starter.replace('KQA.on("ready", paint);\n    KQA.on("change", paint);\n    KQA.on("lock", paint);', ""), expect: { codes: ["KQA608"] } },
  { name: "script error on load", html: starter.replace("<script>\n  // A custom control", "<script>\n  undefinedFunction();\n  // A custom control"), expect: { codes: ["KQA600"], pass: false } },
  {
    name: "control that swallows its own events",
    html: starter.replace('data-kqa="company" maxlength="120"', 'data-kqa="company" onchange="event.stopImmediatePropagation()" oninput="event.stopImmediatePropagation()" maxlength="120"'),
    expect: { codes: [] }, // the bridge listens in the capture phase on document, before the control's own handler
  },
  { name: "page that hides all content", html: starter.replace("<body>", '<body><style>body{display:none}</style>'), expect: { codes: ["KQA606"], pass: false } },
];

let failed = 0;
const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox"], defaultViewport: { width: 1100, height: 900 } });
try {
  const page = await browser.newPage();
  await page.goto(`${base}/admin/login`, { waitUntil: "networkidle2" });
  if (await page.$("#email")) {
    if (!email || !password) throw new Error("Supply explicit ADMIN_EMAIL and ADMIN_PASSWORD before probing a remote host.");
    await page.type("#email", email);
    await page.type("#password", password);
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click("button.primary")]);
  }
  for (const [i, c] of cases.entries()) {
    const file = path.join(dir, `case-${i}.html`);
    writeFileSync(file, c.html);
    await page.goto(`${base}/admin/check`, { waitUntil: "networkidle2" });
    await (await page.$("input[type=file]")).uploadFile(file);
    await page.waitForFunction(() => { const h = document.querySelector(".verdict h3"); return h && !/Running the live check|Checking the file/.test(h.textContent); }, { timeout: 20000 });
    const verdict = await page.$eval(".verdict h3", (e) => e.textContent);
    const codes = await page.$$eval(".diag .code-chip", (els) => els.map((e) => e.textContent));
    const passed = /passed|Ready to use/.test(verdict);
    const missing = (c.expect.codes ?? []).filter((x) => !codes.includes(x));
    const unexpected = c.expect.codes && c.expect.codes.length === 0 ? codes : [];
    const passOk = c.expect.pass === undefined || c.expect.pass === passed;
    const ok = missing.length === 0 && unexpected.length === 0 && passOk;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}  verdict="${verdict}" codes=[${codes.join(", ")}]${missing.length ? " missing=" + missing : ""}${unexpected.length ? " unexpected=" + unexpected : ""}`);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
