// Run axe-core against representative public and, optionally, authenticated product flows.
// Usage: npm run a11y:audit -- [baseUrl] [route ...] [--authenticated] [--report path]
// Authenticated mode requires KQA_A11Y_EMAIL and KQA_A11Y_PASSWORD. Optional fixture routes use
// KQA_A11Y_INTERVIEW_ID and KQA_A11Y_RESPONDENT_TOKEN; provision disposable data, never real respondents.
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import axe from "axe-core";
import { createAuditReport, normalizeAxeResult } from "./a11y-audit-report.mjs";

function parseArgs(args) {
  const positional = [];
  let authenticated = false;
  let reportPath = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--authenticated") authenticated = true;
    else if (args[index] === "--report") {
      reportPath = args[index + 1];
      if (!reportPath) throw new Error("--report requires a file path.");
      index += 1;
    } else if (args[index].startsWith("--")) throw new Error(`Unknown option: ${args[index]}`);
    else positional.push(args[index]);
  }
  return { positional, authenticated, reportPath };
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function safeRouteName(path) {
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error("Audit routes must remain on the configured base origin.");
  const pathname = url.pathname
    .replace(/\/[a-f\d]{24}(?=\/|$)/gi, "/:id")
    .replace(/\/[A-Za-z\d_-]{20,120}(?=\/|$)/g, "/:token");
  return url.search ? `${pathname}?[query]` : pathname;
}

function currentCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function sourceTreeDirty() {
  try {
    return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
  } catch {
    return true;
  }
}

async function waitForFrame(page, predicate, timeout = 12_000) {
  const expires = Date.now() + timeout;
  while (Date.now() < expires) {
    const frame = page.frames().find(predicate);
    if (frame) return frame;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return null;
}

async function auditDocument(document, wcagTags) {
  await document.addScriptTag({ content: axe.source });
  const [checks, rawAxe] = await Promise.all([
    document.evaluate(() => ({
      titlePresent: !!document.title.trim(),
      mainHeadingPresent: [...document.querySelectorAll("h1")].some((heading) => heading.textContent?.trim()),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    })),
    document.evaluate(async (tags) => window.axe.run(document, {
      runOnly: { type: "tag", values: tags },
    }), wcagTags),
  ]);
  return { checks, axe: normalizeAxeResult(rawAxe) };
}

async function checkReducedMotion(document) {
  return document.evaluate(() => ({
    enabled: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    runningAnimations: document.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
  }));
}

function pushCheckFailures(failures, documentName, viewportName, checks, options = {}) {
  const label = `${documentName} @ ${viewportName}`;
  if (!checks.titlePresent) failures.push(`${label}: missing document title`);
  if (options.requireMainHeading !== false && !checks.mainHeadingPresent) failures.push(`${label}: missing non-empty h1`);
  if (checks.horizontalOverflow) failures.push(`${label}: horizontal overflow`);
}

function pushReducedMotionFailure(failures, documentName, viewportName, reducedMotion) {
  if (!reducedMotion.enabled || reducedMotion.runningAnimations > 0) {
    failures.push(`${documentName} @ ${viewportName}: reduced-motion preference not respected`);
  }
}

function emptyDocumentResult() {
  return { checks: { titlePresent: false, mainHeadingPresent: false, horizontalOverflow: false }, axe: { violations: [], incomplete: [], passedRules: 0 } };
}

async function login(page, baseUrl, email, password) {
  await page.goto(new URL("/admin/login?next=%2Fadmin", baseUrl), { waitUntil: "networkidle2" });
  await page.waitForSelector("#email", { timeout: 10_000 });
  await page.type("#email", email);
  await page.type("#password", password);
  await page.click("button.primary");
  await page.waitForFunction(() => location.pathname.startsWith("/admin") && location.pathname !== "/admin/login", { timeout: 15_000 });
}

const args = parseArgs(process.argv.slice(2));
const [baseInput = process.env.KQA_A11Y_URL || "http://localhost:3000", ...requestedRoutes] = args.positional;
const base = new URL(baseInput);
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
  throw new Error("The base URL must be HTTP(S) and must not contain embedded credentials.");
}
if (args.authenticated) {
  if (!process.env.KQA_A11Y_EMAIL || !process.env.KQA_A11Y_PASSWORD) {
    throw new Error("Authenticated mode requires KQA_A11Y_EMAIL and KQA_A11Y_PASSWORD.");
  }
  if (!isLocalHost(base.hostname) && process.env.KQA_A11Y_ALLOW_REMOTE !== "1") {
    throw new Error("Authenticated mode is local-only by default. Set KQA_A11Y_ALLOW_REMOTE=1 only for an explicitly approved non-production test environment.");
  }
  if (!isLocalHost(base.hostname) && base.protocol !== "https:") {
    throw new Error("Remote authenticated audits require HTTPS.");
  }
}

const interviewId = process.env.KQA_A11Y_INTERVIEW_ID || "";
const respondentToken = process.env.KQA_A11Y_RESPONDENT_TOKEN || "";
if (interviewId && !/^[a-f\d]{24}$/i.test(interviewId)) throw new Error("KQA_A11Y_INTERVIEW_ID must be a 24-character MongoDB ObjectId.");
if (respondentToken && !/^[A-Za-z\d_-]{20,120}$/.test(respondentToken)) throw new Error("KQA_A11Y_RESPONDENT_TOKEN has an invalid shape.");

const routes = (requestedRoutes.length ? requestedRoutes : [
  "/",
  "/admin/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify",
  "/verify-email",
  "/join",
])
  .map((path) => ({ name: safeRouteName(path), path, kind: "page" }));
const coverage = { authenticatedHost: false, interviewTabs: false, respondentQuestionnaire: false, gaps: [] };
if (args.authenticated) {
  routes.push(
    { name: "Host dashboard", path: "/admin", kind: "page" },
    { name: "New interview", path: "/admin/new", kind: "page" },
    { name: "Questionnaire checker", path: "/admin/check", kind: "page" },
    { name: "Format guide", path: "/admin/docs", kind: "page" },
    { name: "Settings", path: "/admin/settings", kind: "page" },
  );
  if (interviewId) {
    coverage.interviewTabs = true;
    for (const tab of ["overview", "people", "answers", "analysis", "survey", "export"]) {
      routes.push({ name: `Interview ${tab}`, path: `/admin/interviews/${interviewId}?tab=${tab}`, kind: "page" });
    }
  } else coverage.gaps.push("Set KQA_A11Y_INTERVIEW_ID to audit interview tabs from a disposable fixture.");
  if (respondentToken) {
    coverage.respondentQuestionnaire = true;
    routes.push({ name: "Respondent questionnaire", path: `/${respondentToken}`, kind: "respondent" });
  } else coverage.gaps.push("Set KQA_A11Y_RESPONDENT_TOKEN to audit the questionnaire and its embedded document.");
} else {
  coverage.gaps.push("Authenticated host, interview, and respondent surfaces were not included.");
}

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "reflow", width: 320, height: 880 },
  { name: "mobile", width: 360, height: 880 },
  { name: "mobile-large", width: 390, height: 880 },
];
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const reportSamples = [];
const failures = [];
const runFailures = [];
let authenticatedContextReady = false;
let authenticatedLoginAttempted = false;

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: viewports[0],
});
const browserVersion = await browser.version();

try {
  console.log(`axe-core ${axe.version}; ${base.origin}; routes ${routes.map(({ name }) => name).join(", ")}`);
  console.log(`Rules: ${wcagTags.join(", ")}; viewport widths ${viewports.map(({ width }) => width).join(" and ")} CSS px`);
  let targetIdentityVerified = false;
  const preflightPage = await browser.newPage();
  try {
    const response = await preflightPage.goto(new URL("/", base), { waitUntil: "networkidle2" });
    const title = await preflightPage.title();
    targetIdentityVerified = (response?.status() ?? 0) >= 200
      && (response?.status() ?? 0) < 400
      && /\bsurvee\b/i.test(title);
    if (!targetIdentityVerified) {
      const message = `Target identity preflight failed: expected Survee homepage, received HTTP ${response?.status() ?? 0} with title ${JSON.stringify(title)}.`;
      failures.push(message);
      runFailures.push(message);
      console.error(`FAIL ${message}`);
    } else {
      console.log(`PASS Survee target identity preflight (${JSON.stringify(title)})`);
    }
  } catch {
    const message = "Target identity preflight failed: the configured homepage could not be loaded.";
    failures.push(message);
    runFailures.push(message);
    console.error(`FAIL ${message}`);
  } finally {
    await preflightPage.close();
  }

  if (targetIdentityVerified) for (const route of routes) {
    const requiresSession = route.path.startsWith("/admin") && route.path !== "/admin/login";
    if (requiresSession && args.authenticated && !authenticatedLoginAttempted) {
      authenticatedLoginAttempted = true;
      const authPage = await browser.newPage();
      try {
        await login(authPage, base, process.env.KQA_A11Y_EMAIL, process.env.KQA_A11Y_PASSWORD);
        authenticatedContextReady = true;
        coverage.authenticatedHost = true;
        console.log("PASS authenticated audit sign-in");
      } catch {
        const message = "Authenticated sign-in failed; protected route coverage is unavailable.";
        failures.push(message);
        runFailures.push(message);
        coverage.gaps.push("Authenticated sign-in failed; protected host routes were not scanned.");
        console.error("FAIL authenticated audit sign-in; credentials or disposable local fixture may be unavailable.");
      } finally {
        await authPage.close();
      }
    }
    if (requiresSession && (!args.authenticated || !authenticatedContextReady)) continue;
    const url = new URL(route.path, base);
    if (url.origin !== base.origin) throw new Error("Audit routes must remain on the configured base origin.");
    for (const viewport of viewports) {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(30_000);
      await page.setViewport({ width: viewport.width, height: viewport.height });
      const sample = {
        route: route.name,
        viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
        httpStatus: 0,
        page: null,
        embeddedDocuments: [],
        checks: { failures: [] },
      };

      try {
        const response = await page.goto(url, { waitUntil: "networkidle2" });
        sample.httpStatus = response?.status() ?? 0;
        if (sample.httpStatus < 200 || sample.httpStatus >= 400) sample.checks.failures.push("HTTP response was not successful.");

        if (route.kind === "respondent") {
          await page.waitForSelector("iframe", { timeout: 12_000 });
          const frame = await waitForFrame(page, (candidate) => {
            try { return candidate !== page.mainFrame() && new URL(candidate.url()).origin === base.origin && new URL(candidate.url()).pathname.startsWith("/api/frame/"); }
            catch { return false; }
          });
          if (!frame) sample.checks.failures.push("Questionnaire iframe did not load for accessibility review.");
          else {
            try {
              await frame.waitForFunction(async () => {
                const ready = window.KQA?.ready;
                if (!ready || typeof ready.then !== "function") return false;
                try { await ready; return true; }
                catch { return false; }
              }, { timeout: 12_000 });
            }
            catch { sample.checks.failures.push("Questionnaire runtime did not become ready."); }
          }
        }

        sample.page = await auditDocument(page, wcagTags);
        // The respondent shell names its questionnaire iframe with `title`; the
        // separately scanned iframe document owns the questionnaire heading.
        pushCheckFailures(sample.checks.failures, route.name, viewport.name, sample.page.checks, { requireMainHeading: route.kind !== "respondent" });
        for (const violation of sample.page.axe.violations) {
          console.error(`  ${violation.impact ?? "unknown"} ${violation.id}: ${violation.help} [${violation.targets.join(", ")}]`);
        }
        for (const item of sample.page.axe.incomplete) {
          console.warn(`  NEEDS REVIEW ${item.id}: ${item.help} [${item.targets.join(", ")}]`);
        }

        if (route.kind === "respondent") {
          const frame = page.frames().find((candidate) => {
            try { return candidate !== page.mainFrame() && new URL(candidate.url()).origin === base.origin && new URL(candidate.url()).pathname.startsWith("/api/frame/"); }
            catch { return false; }
          });
          if (frame) {
            try {
              const embeddedDocument = { name: "Questionnaire frame", ...(await auditDocument(frame, wcagTags)) };
              sample.embeddedDocuments.push(embeddedDocument);
              pushCheckFailures(sample.checks.failures, embeddedDocument.name, viewport.name, embeddedDocument.checks);
            } catch {
              sample.checks.failures.push("Questionnaire iframe could not be scanned by axe-core.");
            }
          }
        }

        if (viewport.name === "desktop") {
          await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
          const reducedMotion = await checkReducedMotion(page);
          sample.checks.reducedMotion = reducedMotion;
          pushReducedMotionFailure(sample.checks.failures, route.name, viewport.name, reducedMotion);
          const frame = page.frames().find((candidate) => {
            try { return candidate !== page.mainFrame() && new URL(candidate.url()).origin === base.origin && new URL(candidate.url()).pathname.startsWith("/api/frame/"); }
            catch { return false; }
          });
          const embeddedDocument = sample.embeddedDocuments.find((document) => document.name === "Questionnaire frame");
          if (frame && embeddedDocument) {
            embeddedDocument.reducedMotion = await checkReducedMotion(frame);
            pushReducedMotionFailure(sample.checks.failures, embeddedDocument.name, viewport.name, embeddedDocument.reducedMotion);
          }
        }
      } catch {
        sample.checks.failures.push("Route navigation or audit execution failed.");
      }

      if (!sample.page) sample.page = emptyDocumentResult();

      if (sample.checks.failures.length) {
        failures.push(...sample.checks.failures);
        for (const failure of sample.checks.failures) console.error(`FAIL ${failure}`);
      }
      const violationCount = (sample.page?.axe.violations.length ?? 0) + sample.embeddedDocuments.reduce((sum, document) => sum + document.axe.violations.length, 0);
      const reviewCount = (sample.page?.axe.incomplete.length ?? 0) + sample.embeddedDocuments.reduce((sum, document) => sum + document.axe.incomplete.length, 0);
      if (violationCount) failures.push(`${route.name} @ ${viewport.width}px: ${violationCount} axe violations`);
      console.log(`${violationCount || sample.checks.failures.length ? "FAIL" : "PASS"} ${route.name} @ ${viewport.width}px: ${violationCount} axe violations, ${reviewCount} needs-review results`);

      reportSamples.push(sample);
      await page.close();
    }
  }
} finally {
  await browser.close();
}

const report = createAuditReport({
  generatedAt: new Date().toISOString(),
  targetOrigin: base.origin,
  commit: currentCommit(),
  sourceTreeDirty: sourceTreeDirty(),
  authenticated: args.authenticated,
  axeVersion: axe.version,
  wcagTags,
  viewports,
  browser: browserVersion,
  coverage,
  samples: reportSamples,
  runFailures,
});

if (args.reportPath) {
  const reportFile = resolve(args.reportPath);
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`Report written to ${reportFile}`);
}

if (failures.length || !report.summary.passed) process.exitCode = 1;
else if (!report.summary.coverageComplete) {
  console.log(`Automated checks passed with partial coverage: ${report.summary.samples} samples, ${report.summary.documents} documents, ${report.summary.axeNeedsReview} needs-review results. Gaps: ${coverage.gaps.join(" ")} Manual review is still required.`);
} else console.log(`Automated checks passed with complete configured coverage: ${report.summary.samples} samples, ${report.summary.documents} documents, ${report.summary.axeNeedsReview} needs-review results. Manual review is still required.`);
