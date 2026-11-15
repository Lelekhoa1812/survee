// Run axe-core against representative public pages at desktop and WCAG reflow widths.
// Usage: npm run a11y:audit -- [baseUrl] [route ...]
import puppeteer from "puppeteer-core";
import axe from "axe-core";

const [baseInput = process.env.KQA_A11Y_URL || "http://localhost:3000", ...requestedRoutes] = process.argv.slice(2);
const base = new URL(baseInput);
const routes = requestedRoutes.length
  ? requestedRoutes
  : ["/", "/admin/login", "/signup", "/forgot-password", "/reset-password"];
const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "reflow", width: 320, height: 880 },
];
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let failed = false;

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: viewports[0],
});

try {
  console.log(`axe-core ${axe.version}; ${base.origin}; routes ${routes.join(", ")}`);
  console.log(`Rules: ${wcagTags.join(", ")}; viewport widths ${viewports.map(({ width }) => width).join(" and ")} CSS px`);

  for (const route of routes) {
    const url = new URL(route, base);
    for (const viewport of viewports) {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(30_000);
      await page.setViewport({ width: viewport.width, height: viewport.height });
      await page.goto(url, { waitUntil: "networkidle2" });
      await page.addScriptTag({ content: axe.source });

      const pageChecks = await page.evaluate(() => ({
        title: document.title.trim(),
        hasMainHeading: [...document.querySelectorAll("h1")].some((heading) => heading.textContent?.trim()),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      }));
      const result = await page.evaluate(async (tags) => window.axe.run(document, {
        runOnly: { type: "tag", values: tags },
      }), wcagTags);

      const label = `${route} @ ${viewport.width}px`;
      if (!pageChecks.title) {
        failed = true;
        console.error(`FAIL ${label}: document title is empty`);
      }
      if (!pageChecks.hasMainHeading) {
        failed = true;
        console.error(`FAIL ${label}: no non-empty h1 found`);
      }
      if (pageChecks.horizontalOverflow) {
        failed = true;
        console.error(`FAIL ${label}: document is wider than the viewport`);
      }
      if (result.violations.length) failed = true;
      console.log(`${result.violations.length ? "FAIL" : "PASS"} ${label}: ${result.violations.length} axe violations, ${result.incomplete.length} needs-review results`);
      for (const violation of result.violations) {
        const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
        console.error(`  ${violation.impact ?? "unknown"} ${violation.id}: ${violation.help} [${targets}]`);
        console.error(`    ${violation.helpUrl}`);
      }
      for (const item of result.incomplete) {
        console.warn(`  NEEDS REVIEW ${item.id}: ${item.help}`);
        for (const node of item.nodes) {
          console.warn(`    ${node.target.join(" ")}`);
          const checks = [...(node.any ?? []), ...(node.all ?? []), ...(node.none ?? [])];
          for (const check of checks) {
            if (check.message) console.warn(`      ${check.id}: ${check.message}`);
          }
        }
        console.warn(`    ${item.helpUrl}`);
      }

      if (viewport.name === "desktop") {
        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        const reducedMotion = await page.evaluate(() => {
          const enabled = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          const activeAnimations = [...document.querySelectorAll("body *")].filter((element) => {
            const style = getComputedStyle(element);
            return style.animationName !== "none";
          }).length;
          return { enabled, activeAnimations };
        });
        if (!reducedMotion.enabled || reducedMotion.activeAnimations > 0) {
          failed = true;
          console.error(`FAIL ${route} @ reduced motion: ${JSON.stringify(reducedMotion)}`);
        } else {
          console.log(`PASS ${route} @ reduced motion: non-essential CSS animations disabled`);
        }
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}

if (failed) process.exitCode = 1;
else console.log("Automated checks passed. Manual keyboard, assistive-technology, content, and conformance review are still required.");
