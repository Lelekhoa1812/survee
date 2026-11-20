// Persistence under bad conditions, in real Chrome: offline edits are kept and saved on reconnect, a server refusal is
// shown and rolled back, and a second window cannot overwrite a submitted answer.
// Usage: node scripts/offline-e2e.mjs <baseUrl> <token>      (use a token that has not been submitted)
import puppeteer from "puppeteer-core";
import { assertSafeMutatingTestTarget } from "./lib/mutating-test-target.mjs";

const [base = "http://localhost:3100", token] = process.argv.slice(2);
if (!token) { console.error("Usage: node scripts/offline-e2e.mjs <baseUrl> <token>"); process.exit(2); }
assertSafeMutatingTestTarget(base, "offline respondent E2E");
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
const state = (page) => page.$eval(".save-state", (e) => e.textContent.trim());
const waitState = (page, re, ms = 15000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector(".save-state")?.textContent ?? ""), { timeout: ms, polling: 200 }, re.source);

async function open(browser) {
  const page = await browser.newPage();
  await page.goto(`${base}/${token}`, { waitUntil: "networkidle2" });
  const frame = await (await page.waitForSelector("iframe")).contentFrame();
  await frame.waitForFunction(() => window.KQA && window.KQA.ready, { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector(".rs-loading"));
  return { page, frame };
}
const typeInto = (frame, sel, v) => frame.evaluate((s, val) => { const el = document.querySelector(s); el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, sel, v);

const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox"], defaultViewport: { width: 1200, height: 800 } });
try {
  const { page, frame } = await open(browser);

  // 1. offline: edits are held, the state says so, and they are saved when the connection returns
  await page.setOfflineMode(true);
  await typeInto(frame, '[data-kqa="company"]', "Offline Pty Ltd");
  await waitState(page, /Offline/);
  check("offline edit shows 'Offline, will save'", true, await state(page));
  await sleep(1500);
  await page.setOfflineMode(false);
  await waitState(page, /Saved/, 30000);
  check("saved automatically after reconnecting", true);
  const server = await page.evaluate(async (t) => (await (await fetch(`/api/p/${t}`)).json()).answers.company?.value, token);
  check("server holds the offline edit", server === "Offline Pty Ltd", String(server));

  // 2. server refusal: an out-of-range number is rejected, shown, and the page reverts to what is stored
  await typeInto(frame, '[data-kqa="team-size"]', "999999");
  await page.waitForSelector(".toast.err", { timeout: 8000 });
  const toast = await page.$eval(".toast.err", (e) => e.textContent);
  check("refused value names the question and the limit", /How many people are in your team/.test(toast) && /5,?000/.test(toast), toast);
  // The page puts a refused value back after it has re-read the saved answers, which takes a network round trip.
  let reverted = null;
  for (let i = 0; i < 24; i++) {
    reverted = await frame.evaluate(() => document.querySelector('[data-kqa="team-size"]').value);
    if (reverted === "") break;
    await sleep(250);
  }
  check("page reverts to the saved value", reverted === "", `value="${reverted}"`);

  // 3. rapid typing: the final value wins and nothing is lost
  for (const v of ["A", "Ac", "Acm", "Acme", "Acme 2"]) await typeInto(frame, '[data-kqa="company"]', v);
  await waitState(page, /Saved/);
  await sleep(300);
  const rapid = await page.evaluate(async (t) => (await (await fetch(`/api/p/${t}`)).json()).answers.company?.value, token);
  check("rapid edits settle on the last value", rapid === "Acme 2", String(rapid));

  // 4. two windows: after one submits, the other cannot change answers
  const two = await open(browser);
  await page.bringToFront();
  await frame.evaluate(() => document.querySelector('[data-kqa="priority"][value="speed"]').click());
  await frame.evaluate(() => document.querySelector('[data-kqa="channels"][value="email"]').click());
  await waitState(page, /Saved/);
  await page.click(".rs-bar .btn.accent");
  await page.waitForSelector(".modal");
  await page.click(".modal .btn.accent");
  await page.waitForSelector(".rs-banner.ok", { timeout: 8000 });
  check("first window submitted", true);
  await two.page.bringToFront();
  await typeInto(two.frame, '[data-kqa="company"]', "Sneaky overwrite");
  await two.page.waitForSelector(".toast.err", { timeout: 8000 });
  const toast2 = await two.page.$eval(".toast.err", (e) => e.textContent);
  check("second window is refused", /locked|submitted/i.test(toast2), toast2);
  const after = await page.evaluate(async (t) => (await (await fetch(`/api/p/${t}`)).json()).answers.company?.value, token);
  check("submitted answer was not overwritten", after === "Acme 2", String(after));
  check("second window is locked", (await two.frame.evaluate(() => KQA.locked)) === true);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
