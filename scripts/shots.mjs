// Screenshots of the host area for visual review. Usage: node scripts/shots.mjs <baseUrl> <outDir> <interviewId> [dark]
import puppeteer from "puppeteer-core";

const [base = "http://localhost:3100", out = ".", id, scheme = "light"] = process.argv.slice(2);
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const email = process.env.ADMIN_EMAIL || "admin@axion.local";
const password = process.env.ADMIN_PASSWORD || "12345678";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox"] });
const errors = [];
try {
  for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 }]]) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    page.on("pageerror", (e) => errors.push(`${label}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${label}: ${m.text()}`); });
    const shot = async (name, full = true) => { await sleep(350); await page.screenshot({ path: `${out}/${scheme}-${label}-${name}.png`, fullPage: full }); };

    await page.goto(`${base}/admin/login`, { waitUntil: "networkidle2" });
    await shot("login", false);
    if (await page.$("#email")) {
      await page.type("#email", email);
      await page.type("#password", password);
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click("button.primary")]);
    }
    await shot("dashboard");
    await page.goto(`${base}/admin/new`, { waitUntil: "networkidle2" });
    await shot("new");
    await page.goto(`${base}/admin/check`, { waitUntil: "networkidle2" });
    await shot("check", false);
    if (id) {
      for (const tab of ["overview", "people", "answers", "survey", "export"]) {
        await page.goto(`${base}/admin/interviews/${id}?tab=${tab}`, { waitUntil: "networkidle2" });
        await sleep(600);
        await shot(tab);
      }
    }
    await page.goto(`${base}/admin/docs`, { waitUntil: "networkidle2" });
    await shot("docs", false);
    await page.close();
  }
} finally {
  await browser.close();
}
if (errors.length) console.log("Console/page errors:\n" + [...new Set(errors)].join("\n"));
console.log("done");
