// Screenshots of the harder states for visual review. Usage: node scripts/shots-states.mjs <baseUrl> <outDir> <interviewId> <respondentToken> [dark]
import { readFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { assertSafeMutatingTestTarget } from "./lib/mutating-test-target.mjs";

const [base = "http://localhost:3100", out = ".", id, token, scheme = "light"] = process.argv.slice(2);
assertSafeMutatingTestTarget(base, "state screenshot generation");
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const starter = readFileSync(path.join(import.meta.dirname, "..", "docs", "template", "starter.kqa.html"), "utf8");
const broken = starter
  .replace('name="priority" data-kqa="priority" value="accuracy"', 'name="priority" value="accuracy"')
  .replace('data-kqa="company" maxlength="120"', 'data-kqa="compnay" maxlength="120"')
  .replace('data-kqa="channels" value="phone"', 'data-kqa="channels" value="phne"')
  .replace("</body>", "<script>localStorage.setItem('a','b');</script></body>");
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
const dir = mkdtempSync(path.join(tmpdir(), "kqa-shots-"));
writeFileSync(path.join(dir, "broken.html"), broken);
writeFileSync(path.join(dir, "starter.html"), starter);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox"] });
try {
  for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 }]]) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    const shot = async (name, full = true) => { await sleep(500); await page.screenshot({ path: `${out}/${scheme}-${label}-${name}.png`, fullPage: full }); };
    await page.goto(`${base}/admin/login`, { waitUntil: "networkidle2" });
    if (await page.$("#email")) {
      await page.type("#email", process.env.ADMIN_EMAIL || "admin@axion.local");
      await page.type("#password", process.env.ADMIN_PASSWORD || "12345678");
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click("button.primary")]);
    }
    // checker with errors
    await page.goto(`${base}/admin/check`, { waitUntil: "networkidle2" });
    await (await page.$("input[type=file]")).uploadFile(path.join(dir, "broken.html"));
    await page.waitForSelector(".diag", { timeout: 20000 });
    await shot("check-errors");
    // new interview, valid file
    await page.goto(`${base}/admin/new`, { waitUntil: "networkidle2" });
    await page.type("#name", "Investor scouting scope");
    await (await page.$("input[type=file]")).uploadFile(path.join(dir, "starter.html"));
    await page.waitForFunction(() => /All checks passed/.test(document.body.innerText), { timeout: 20000 });
    await shot("new-ready");
    if (id) {
      await page.goto(`${base}/admin/interviews/${id}?tab=people`, { waitUntil: "networkidle2" });
      await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Add people/.test(b.textContent))?.click());
      await page.waitForSelector(".modal");
      await shot("add-people", false);
    }
    if (token) {
      const r = await browser.newPage();
      await r.setViewport(viewport);
      await r.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
      await r.goto(`${base}/${token}`, { waitUntil: "networkidle2" });
      await sleep(900);
      await r.screenshot({ path: `${out}/${scheme}-${label}-respondent.png` });
      await r.close();
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("done");
