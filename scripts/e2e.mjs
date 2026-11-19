// End-to-end check in a real Chrome: open a respondent link, answer, reload, confirm answers come back, submit.
// Usage: node scripts/e2e.mjs <baseUrl> <token> [outDir]
import puppeteer from "puppeteer-core";
import { assertSafeMutatingTestTarget } from "./lib/mutating-test-target.mjs";

const [base = "http://localhost:3100", token, out = "."] = process.argv.slice(2);
if (!token) { console.error("Usage: node scripts/e2e.mjs <baseUrl> <token> [outDir]"); process.exit(2); }
assertSafeMutatingTestTarget(base, "respondent E2E");
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
let failed = 0;
const check = (name, ok, extra = "") => { log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };

const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox"], defaultViewport: { width: 1280, height: 860 } });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${base}/${token}`, { waitUntil: "networkidle2" });
  await page.waitForSelector("iframe");
  const frameEl = await page.$("iframe");
  const frame = await frameEl.contentFrame();
  await frame.waitForFunction(() => window.KQA && window.KQA.ready, { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector(".rs-loading"), { timeout: 10000 });
  check("questionnaire loads in the sandboxed frame", true);
  await page.screenshot({ path: `${out}/respondent-empty.png` });

  // answer through the real controls
  await frame.evaluate(() => {
    const click = (sel) => document.querySelector(sel)?.click();
    click('[data-kqa="priority"][value="accuracy"]');
    click('[data-kqa="channels"][value="email"]');
    click('[data-kqa="channels"][value="phone"]');
  });
  await frame.focus('[data-kqa="company"]');
  await page.keyboard.type("Acme Pty Ltd");
  await frame.focus('[data-kqa="goal"]');
  await page.keyboard.type("Ship it");

  // Exercise the real browser keyboard path for ranking, including focus after moving an item.
  const rankMoveDown = 'ol[data-kqa="tradeoffs"] li:first-child button[data-kqa-rank-move="down"]';
  await frame.waitForSelector(rankMoveDown);
  await frame.focus(rankMoveDown);
  await page.keyboard.press("Enter");
  const ranked = await frame.evaluate(() => ({
    order: [...document.querySelectorAll('ol[data-kqa="tradeoffs"] li')].map((item) => item.getAttribute("data-value")),
    focused: document.activeElement?.getAttribute("data-kqa-rank-move"),
    focusedItem: document.activeElement?.closest("li")?.getAttribute("data-value"),
  }));
  check("rank can be reordered with the keyboard and retains useful focus", JSON.stringify(ranked.order) === JSON.stringify(["speed", "quality", "cost"]) && ranked.focused === "up" && ranked.focusedItem === "quality", JSON.stringify(ranked));

  await page.waitForFunction(() => /Saved/.test(document.querySelector(".save-state")?.textContent ?? ""), { timeout: 8000 });
  check("autosave reports Saved", true);
  const counted = await page.$eval(".rs-progress small", (e) => e.textContent);
  check("progress counter updates", /^[1-9]\d* of/.test(counted ?? ""), counted);
  await page.waitForFunction(async (t) => {
    const response = await fetch(`/api/p/${t}`);
    if (!response.ok) return false;
    const payload = await response.json();
    return JSON.stringify(payload.answers.tradeoffs?.value) === JSON.stringify(["speed", "quality", "cost"]);
  }, { timeout: 8000 }, token);
  const savedRank = await page.evaluate(async (t) => (await (await fetch(`/api/p/${t}`)).json()).answers.tradeoffs?.value, token);
  check("rank order is persisted", JSON.stringify(savedRank) === JSON.stringify(["speed", "quality", "cost"]), JSON.stringify(savedRank));
  await page.screenshot({ path: `${out}/respondent-answered.png` });

  // reload: answers must come back
  await page.reload({ waitUntil: "networkidle2" });
  const f2 = await (await page.waitForSelector("iframe")).contentFrame();
  await f2.waitForFunction(() => window.KQA && window.KQA.ready, { timeout: 10000 });
  await sleep(500);
  const restored = await f2.evaluate(() => ({ p: KQA.get("priority"), c: KQA.get("channels"), co: KQA.get("company"), g: KQA.get("goal"), dom: document.querySelector('[data-kqa="company"]')?.value, radio: document.querySelector('[data-kqa="priority"][value="accuracy"]')?.checked }));
  check("answers restored after reload", restored.p === "accuracy" && restored.co === "Acme Pty Ltd" && restored.dom === "Acme Pty Ltd" && restored.radio === true && JSON.stringify(restored.c) === JSON.stringify(["email", "phone"]), JSON.stringify(restored));
  await page.screenshot({ path: `${out}/respondent-restored.png` });

  // submit
  await page.click(".rs-bar .btn.accent");
  await page.waitForSelector(".modal");
  await page.screenshot({ path: `${out}/respondent-confirm.png` });
  const title = await page.$eval(".modal h2", (e) => e.textContent);
  log("INFO  confirm dialog:", title);
  check("required answers reach the submit confirmation", /Submit your answers/.test(title), title);
  if (/Submit your answers/.test(title)) {
    await page.click(".modal .btn.accent");
    await page.waitForSelector(".rs-banner.ok", { timeout: 8000 });
    check("submit locks the questionnaire", true);
    const locked = await f2.evaluate(() => KQA.locked);
    check("frame is locked after submit", locked === true);
    await page.screenshot({ path: `${out}/respondent-submitted.png` });
    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForSelector(".rs-banner.ok");
    check("locked state survives reload", true);
  }
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
