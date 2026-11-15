// Screenshots of host and account surfaces for visual review. Usage: node scripts/shots.mjs <baseUrl> <outDir> <interviewId> [light|dark] [all|analysis|accounts]
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const [base = "http://localhost:3100", out = ".", id, scheme = "light", shotSet = "all"] = process.argv.slice(2);
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const local = ["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname);
const email = process.env.ADMIN_EMAIL || (local ? "admin@axiob.local" : "");
const password = process.env.ADMIN_PASSWORD || (local ? "12345678" : "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!(scheme === "light" || scheme === "dark")) throw new Error("scheme must be light or dark");
if (!(shotSet === "all" || shotSet === "analysis" || shotSet === "accounts")) throw new Error("shotSet must be all, analysis, or accounts");
await mkdir(out, { recursive: true });

const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox"] });
const errors = [];
try {
  for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 }], ["narrow", { width: 320, height: 760, isMobile: true, deviceScaleFactor: 2 }]]) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    page.on("pageerror", (e) => errors.push(`${label}: uncaught page error: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${label}: console error: ${m.text()}`); });
    const auditLayout = async (name) => {
      const layout = await page.evaluate(() => ({
        width: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        hasPage: !!document.querySelector("main.page"),
        navWidth: document.querySelector(".topbar .nav")?.clientWidth ?? 0,
        navScrollWidth: document.querySelector(".topbar .nav")?.scrollWidth ?? 0,
      }));
      if (!layout.hasPage && ["dashboard", "new", "check", "overview", "people", "answers", "analysis", "survey", "export", "docs", "settings"].includes(name)) errors.push(`${label}: ${name} did not render the host page`);
      if (layout.documentWidth > layout.width + 1 || layout.bodyWidth > layout.width + 1) {
        errors.push(`${label}: ${name} has horizontal overflow (${layout.width}px viewport, ${Math.max(layout.documentWidth, layout.bodyWidth)}px content)`);
      }
      if (layout.navScrollWidth > layout.navWidth + 1) errors.push(`${label}: ${name} hides main navigation items (${layout.navWidth}px available, ${layout.navScrollWidth}px needed)`);
    };
    const shot = async (name, full = true) => {
      await sleep(350);
      await auditLayout(name);
      await page.screenshot({ path: `${out}/${scheme}-${label}-${name}.png`, fullPage: full });
    };

    await page.goto(`${base}/admin/login`, { waitUntil: "networkidle2" });
    await shot("login", false);
    if (shotSet === "all" || shotSet === "accounts") {
      await page.goto(`${base}/signup`, { waitUntil: "networkidle2" });
      await shot("signup", false);
      await page.goto(`${base}/verify`, { waitUntil: "networkidle2" });
      await shot("verify", false);
      await page.goto(`${base}/forgot-password`, { waitUntil: "networkidle2" });
      await shot("forgot-password", false);
      await page.goto(`${base}/reset-password`, { waitUntil: "networkidle2" });
      await shot("reset-password", false);
    }
    await page.goto(`${base}/admin/login`, { waitUntil: "networkidle2" });
    if (email && password && await page.$("#email")) {
      await page.type("#email", email);
      await page.type("#password", password);
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click("button.primary")]);
    }
    const signedIn = new URL(page.url()).pathname.startsWith("/admin") && !(await page.$("#email"));
    if (!signedIn) {
      if (!email || !password) console.log(`${label}: login-only screenshot; no credentials supplied for protected pages`);
      else errors.push(`${label}: login did not reach the protected host area`);
      await page.close();
      continue;
    }
    if (shotSet === "analysis" && !id) throw new Error("analysis screenshots require an interviewId");
    if (shotSet === "all") {
      await shot("dashboard");
      await page.goto(`${base}/admin/new`, { waitUntil: "networkidle2" });
      await shot("new");
      await page.goto(`${base}/admin/check`, { waitUntil: "networkidle2" });
      await shot("check", false);
    }
    if (id && shotSet !== "accounts") {
      const tabs = shotSet === "analysis" ? ["analysis"] : ["overview", "people", "answers", "analysis", "survey", "export"];
      for (const tab of tabs) {
        await page.goto(`${base}/admin/interviews/${id}?tab=${tab}`, { waitUntil: "networkidle2" });
        await sleep(600);
        if (new URL(page.url()).pathname.endsWith("/login")) errors.push(`${label}: ${tab} redirected to sign in`);
        await shot(tab);
      }
    }
    if (shotSet === "all") {
      await page.goto(`${base}/admin/docs`, { waitUntil: "networkidle2" });
      await shot("docs", false);
      await page.goto(`${base}/admin/settings`, { waitUntil: "networkidle2" });
      await shot("settings");
    }
    if (shotSet === "accounts") {
      await page.goto(`${base}/admin/settings`, { waitUntil: "networkidle2" });
      await shot("settings");
      const hasReviewButton = await page.evaluate(() => [...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Review assignment"));
      if (hasReviewButton) {
        await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Review assignment")?.click());
        await sleep(250);
        if (!(await page.$('[role="dialog"]'))) errors.push(`${label}: migration confirmation did not open as a dialog`);
        await shot("migration-confirm", false);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error("Console/page errors:\n" + [...new Set(errors)].join("\n"));
  process.exitCode = 1;
}
console.log("done");
