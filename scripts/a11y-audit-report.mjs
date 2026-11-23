export const A11Y_AUDIT_REPORT_VERSION = "kqa-a11y/1";

function normalizeFindings(findings = []) {
  return findings.map(({ id, impact, help, helpUrl, nodes = [] }) => ({
    id,
    impact: impact ?? null,
    help,
    helpUrl,
    targets: [...new Set(nodes.flatMap((node) => node.target ?? []))].slice(0, 100),
  }));
}

/** Keep selectors and rule metadata; never serialize rendered HTML or answer text from axe nodes. */
export function normalizeAxeResult(result) {
  return {
    violations: normalizeFindings(result.violations),
    incomplete: normalizeFindings(result.incomplete),
    passedRules: result.passes?.length ?? 0,
  };
}

export function summarizeAuditSamples(samples) {
  const documents = samples.flatMap((sample) => [sample.page, ...(sample.embeddedDocuments ?? [])]);
  const axeViolations = documents.reduce((count, document) => count + document.axe.violations.length, 0);
  const axeNeedsReview = documents.reduce((count, document) => count + document.axe.incomplete.length, 0);
  const checkFailures = samples.reduce((count, sample) => count + sample.checks.failures.length, 0);
  const httpFailures = samples.filter((sample) => sample.httpStatus < 200 || sample.httpStatus >= 400).length;
  return {
    samples: samples.length,
    documents: documents.length,
    axeViolations,
    axeNeedsReview,
    checkFailures,
    httpFailures,
    passed: axeViolations === 0 && checkFailures === 0 && httpFailures === 0,
  };
}

export function createAuditReport({ generatedAt, targetOrigin, commit, sourceTreeDirty = false, authenticated, axeVersion, wcagTags, viewports, browser, coverage, samples, runFailures = [] }) {
  const summary = summarizeAuditSamples(samples);
  summary.coverageComplete = (coverage?.gaps?.length ?? 0) === 0;
  summary.runFailures = runFailures.length;
  summary.passed = summary.passed && runFailures.length === 0;
  return {
    schemaVersion: A11Y_AUDIT_REPORT_VERSION,
    generatedAt,
    sourceCommit: commit,
    sourceTreeDirty,
    target: { origin: targetOrigin, authenticated },
    method: {
      axeVersion,
      wcagTags: [...wcagTags],
      viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
      checks: ["HTTP response", "document title, route-appropriate h1, and horizontal overflow for each document including iframes", "reduced motion at desktop width for each document including iframes"],
      limitations: [
        "Automated accessibility checks do not establish WCAG conformance.",
        "Keyboard, assistive technology, content, visual contrast, and complete task review remain manual work.",
      ],
    },
    browser,
    coverage,
    summary,
    runFailures,
    samples,
  };
}
