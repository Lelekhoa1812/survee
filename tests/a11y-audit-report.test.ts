import { describe, expect, it } from "vitest";
import { createAuditReport, normalizeAxeResult, summarizeAuditSamples } from "../scripts/a11y-audit-report.mjs";

describe("accessibility audit reports", () => {
  it("keeps axe reports to rules and selectors instead of rendered response content", () => {
    const result = normalizeAxeResult({
      violations: [{
        id: "label",
        impact: "critical",
        help: "Form elements must have labels",
        helpUrl: "https://example.test/label",
        nodes: [{ target: ["#answer"], html: "<textarea>Private respondent answer</textarea>", failureSummary: "Private respondent answer" }],
      }],
      incomplete: [],
      passes: [{ id: "landmark" }],
    });

    expect(result).toEqual({
      violations: [{ id: "label", impact: "critical", help: "Form elements must have labels", helpUrl: "https://example.test/label", targets: ["#answer"] }],
      incomplete: [],
      passedRules: 1,
    });
    expect(JSON.stringify(result)).not.toContain("Private respondent answer");
  });

  it("summarizes iframe findings and explicit checks across samples", () => {
    const clean = { axe: { violations: [], incomplete: [], passedRules: 12 } };
    const samples = [
      { page: clean, embeddedDocuments: [clean], checks: { failures: [] }, httpStatus: 200 },
      { page: { ...clean, axe: { ...clean.axe, violations: [{ id: "contrast" }], incomplete: [{ id: "review" }] } }, checks: { failures: ["overflow"] }, httpStatus: 200 },
    ];

    expect(summarizeAuditSamples(samples)).toEqual({
      samples: 2,
      documents: 3,
      axeViolations: 1,
      axeNeedsReview: 1,
      checkFailures: 1,
      httpFailures: 0,
      passed: false,
    });
  });

  it("records scope and limitations without storing credentials or private route URLs", () => {
    const report = createAuditReport({
      generatedAt: "2026-11-16T00:00:00.000Z",
      targetOrigin: "http://localhost:3000",
      commit: "abc123",
      sourceTreeDirty: false,
      authenticated: true,
      axeVersion: "4.14.0",
      wcagTags: ["wcag22aa"],
      viewports: [{ name: "desktop", width: 1280, height: 900 }],
      browser: "Chrome/1",
      coverage: { host: true, respondent: true, gaps: [] },
      samples: [],
    });

    expect(report.schemaVersion).toBe("kqa-a11y/1");
    expect(report.summary.passed).toBe(true);
    expect(report.summary.coverageComplete).toBe(true);
    expect(report.sourceTreeDirty).toBe(false);
    expect(report.method.limitations.join(" ")).toContain("do not establish WCAG conformance");
    expect(JSON.stringify(report)).not.toContain("password");
  });

  it("keeps check status distinct from incomplete route coverage", () => {
    const report = createAuditReport({
      generatedAt: "2026-11-16T00:00:00.000Z",
      targetOrigin: "http://localhost:3000",
      authenticated: false,
      axeVersion: "4.14.0",
      wcagTags: ["wcag22aa"],
      viewports: [{ name: "desktop", width: 1280, height: 900 }],
      browser: "Chrome/1",
      coverage: { gaps: ["Authenticated routes were not included."] },
      samples: [{ page: { axe: { violations: [], incomplete: [], passedRules: 1 } }, checks: { failures: [] }, httpStatus: 200 }],
    });

    expect(report.summary.passed).toBe(true);
    expect(report.summary.coverageComplete).toBe(false);
  });
});
