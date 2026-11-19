import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { auditArtifacts, scoreResults, validateBenchmark, validateResults } from "../scripts/eval-package-draft";
import { INTERVIEW_PACKAGES } from "../src/lib/interview-packages";

const benchmark = JSON.parse(await readFile(new URL("../docs/evals/package-draft-cases.json", import.meta.url), "utf8"));
const dimensions = benchmark.dimensions;
const resultsFor = () => ({
  benchmarkVersion: benchmark.benchmarkVersion,
  model: "test/model@1",
  skillVersion: "test-skill@1",
  promptVersion: "test-prompt@1",
  packageLibraryVersion: benchmark.packageLibraryVersion,
  runDate: "2026-11-19",
  // Shared known-good artifacts exercise only hashing/checker plumbing; this is not a semantic benchmark run.
  outputs: benchmark.cases.map((item: any) => ({
    caseId: item.id,
    htmlPath: item.id.includes("personal") ? "docs/examples/personal-planning.kqa.html" : "docs/examples/service-improvement.kqa.html",
    reviewPath: item.id.includes("personal") ? "docs/examples/personal-planning.review.md" : "docs/examples/service-improvement.review.md",
  })),
  reviewers: [{ id: "domain-1", role: "domain" }, { id: "methods-1", role: "methodologist" }],
  ratings: benchmark.cases.flatMap((item: any) => ["domain-1", "methods-1"].map((reviewerId) => ({
    caseId: item.id,
    reviewerId,
    dimensions: Object.fromEntries(dimensions.map((dimension: string) => [dimension, { score: 2, evidence: `Observed in ${item.id} artifact.` }])),
    intentCoverage: item.requiredIntents.map((intent: any) => ({ intentId: intent.id, status: "covered", evidence: `Observed ${intent.id} in artifact.` })),
    hardGateFindings: [],
  }))),
  evidenceStatus: benchmark.cases.map((item: any) => ({
    caseId: item.id,
    functional: { status: "not_tested" },
    accessibility: { status: "not_tested" },
    respondentPretest: { status: "not_tested" },
  })),
});

describe("package draft development benchmark", () => {
  it("loads the versioned corpus against the current catalog and preserves public-development limits", () => {
    expect(validateBenchmark(benchmark).cases).toHaveLength(INTERVIEW_PACKAGES.length + 4);
    const report = scoreResults(benchmark, resultsFor());
    expect(report.developmentOnly).toBe(true);
    expect(report.hardGateReview.flaggedCaseCount).toBe(0);
    expect(report.dimensions.intent_coverage.meanScore).toBe(2);
    expect(report.dimensions.intent_coverage.pairwiseReviewerAgreement).toBe(1);
    expect(report.limitations.join(" ")).toContain("not a hidden holdout");
  });


  it("covers each current package with a source-noted brief and explicit boundaries", () => {
    expect(new Set(benchmark.cases.map((item: any) => item.packageId))).toEqual(new Set(INTERVIEW_PACKAGES.map((item) => item.id)));
    expect(benchmark.cases).toHaveLength(INTERVIEW_PACKAGES.length + 4);
    for (const id of ["industrial-multishift-contractor-process-feedback", "multilingual-public-consultation-language-equivalence", "employee-experience-power-imbalance-small-cell-privacy", "personal-planning-sensitive-disclosure-minimization"]) {
      expect(benchmark.cases.some((item: any) => item.id === id)).toBe(true);
    }
    for (const item of benchmark.cases) {
      expect(item.sourceNotes).toBeTruthy();
      expect(item.methodologySources.length).toBeGreaterThan(0);
      expect(item.methodologySources.every((source: any) => source.url.startsWith("https://"))).toBe(true);
      expect(item.requiredIntents.length).toBeGreaterThanOrEqual(5);
      expect(item.hardGates.length).toBeGreaterThanOrEqual(1);
    }
    const missingPackage = structuredClone(benchmark);
    missingPackage.cases = missingPackage.cases.filter((item: any) => item.packageId !== "event-feedback");
    expect(() => validateBenchmark(missingPackage)).toThrow("cover every current interview package");
  });

  it("requires two reviewer roles and a complete case by reviewer rating matrix", () => {
    const invalid = resultsFor();
    invalid.reviewers = [{ id: "only-one", role: "domain" }, { id: "only-one-too", role: "other" }];
    expect(() => validateResults(benchmark, invalid)).toThrow("domain reviewer and one survey-methods reviewer");
    const incomplete = resultsFor();
    incomplete.ratings.pop();
    expect(() => validateResults(benchmark, incomplete)).toThrow("Missing independent rating");
  });

  it("requires every intent to be rated and rejects unanchored or duplicate gate findings", () => {
    const missingIntent = resultsFor();
    missingIntent.ratings[0].intentCoverage.pop();
    expect(() => validateResults(benchmark, missingIntent)).toThrow("rate every required intent exactly once");
    const finding = resultsFor();
    const gateId = benchmark.cases[0].hardGates[0].id;
    finding.ratings[0].hardGateFindings = [{ gateId, evidence: "Questionnaire passage 2." }, { gateId, evidence: "Questionnaire passage 3." }];
    expect(() => validateResults(benchmark, finding)).toThrow("duplicate hard gate finding");
  });

  it("reports gate flags independently of dimension scores", () => {
    const results = resultsFor();
    results.ratings[0].dimensions.privacy_and_risk.score = 3;
    results.ratings[0].hardGateFindings = [{ gateId: benchmark.cases[0].hardGates[0].id, evidence: "Eligibility is silently excluded in question 1." }];
    const report = scoreResults(benchmark, results);
    expect(report.dimensions.privacy_and_risk.meanScore).toBeGreaterThan(2);
    expect(report.hardGateReview.flaggedCaseCount).toBe(1);
    expect(report.hardGateReview.unresolvedFlagCount).toBe(1);
    expect(report.hardGateReview.interpretation).toContain("High dimension scores cannot offset a gate");
    const adjudicatedResults: any = results;
    adjudicatedResults.adjudications = [{ caseId: benchmark.cases[0].id, gateId: benchmark.cases[0].hardGates[0].id, outcome: "cleared", adjudicatorId: "panel-1", evidence: "Reviewed the source and confirmed the case was not excluded." }];
    const cleared = scoreResults(benchmark, adjudicatedResults);
    expect(cleared.hardGateReview.unresolvedFlagCount).toBe(0);
    expect(cleared.hardGateReview.reviewerFlags).toHaveLength(1);
  });

  it("keeps KQA static format checks separate and hashes each submitted artifact", async () => {
    const results = resultsFor();
    const checks = await auditArtifacts(benchmark, results);
    expect(checks).toHaveLength(benchmark.cases.length);
    expect(checks[0].htmlSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(checks[0].reviewSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(checks[0].staticFormat).toHaveProperty("hasErrors");
    const report = scoreResults(benchmark, results, checks);
    expect(report.staticFormatChecks).toEqual(checks);
    expect(report.dimensions).not.toHaveProperty("staticFormat");
  });

  it("rejects incomplete artifacts and evidence lane statuses", () => {
    const noOutput = resultsFor();
    noOutput.outputs.pop();
    expect(() => validateResults(benchmark, noOutput)).toThrow("omit output artifacts");
    const noEvidence = resultsFor();
    noEvidence.evidenceStatus[0].respondentPretest.status = "passed";
    expect(() => validateResults(benchmark, noEvidence)).toThrow("record the method and evidence reference");
    noEvidence.evidenceStatus[0].respondentPretest.status = "not_applicable";
    expect(() => validateResults(benchmark, noEvidence)).toThrow("explain why this evidence lane is not applicable");
  });
});
