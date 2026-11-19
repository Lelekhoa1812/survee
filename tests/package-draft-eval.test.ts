import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditArtifacts, scoreResults, strictReleaseGateFailures, validateBenchmark, validateResults } from "../scripts/eval-package-draft";
import { INTERVIEW_PACKAGES } from "../src/lib/interview-packages";

const benchmark = JSON.parse(await readFile(new URL("../docs/evals/package-draft-cases.json", import.meta.url), "utf8"));
const dimensions = benchmark.dimensions;
const resultsFor = () => ({
  benchmarkVersion: benchmark.benchmarkVersion,
  resultsSchemaVersion: "kqa-package-draft-results/3",
  model: "test/model@1",
  skillVersion: "test-skill@1",
  promptVersion: "test-prompt@1",
  packageLibraryVersion: benchmark.packageLibraryVersion,
  runDate: "2026-11-19",
  runProvenance: {
    provider: "test-provider",
    modelSnapshot: "test/model@1+2026-11-19",
    generationSettings: { temperature: 0, maxOutputTokens: 4096, seed: "unavailable" },
    promptSha256: "a".repeat(64),
    skillSha256: "b".repeat(64),
    reviewerBlinding: { modelProvider: true, prompt: true, skill: true, otherReviewerRatings: true, exceptions: [] },
  },
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
    functional: { status: "not_tested", unrunReason: "No functional run was conducted for this fixture." },
    accessibility: { status: "not_tested", unrunReason: "No accessibility review was conducted for this fixture." },
    respondentPretest: { status: "not_tested", unrunReason: "No respondent pretest was conducted for this fixture." },
  })),
});

describe("package draft development benchmark", () => {
  it("loads the versioned corpus against the current catalog and preserves public-development limits", () => {
    expect(validateBenchmark(benchmark).cases).toHaveLength(INTERVIEW_PACKAGES.length + 9);
    expect(benchmark.benchmarkVersion).toBe("kqa-package-draft/12");
    expect(benchmark.packageLibraryVersion).toBe("kqa-interview-packages/11");
    expect(benchmark.dimensions).toContain("sampling_and_inference");
    expect(Object.keys(benchmark.dimensionRubrics.sampling_and_inference)).toEqual(["0", "1", "2", "3"]);
    const report = scoreResults(benchmark, resultsFor());
    expect(report.developmentOnly).toBe(true);
    expect(report.hardGateReview.flaggedCaseCount).toBe(0);
    expect(report.dimensions.intent_coverage.meanScore).toBe(2);
    expect(report.dimensions.intent_coverage.pairwiseReviewerAgreement).toBe(1);
    expect(report.dimensions.sampling_and_inference.meanScore).toBe(2);
    expect(report.limitations.join(" ")).toContain("not a hidden holdout");
  });


  it("covers each current package with a source-noted brief and explicit boundaries", () => {
    expect(new Set(benchmark.cases.map((item: any) => item.packageId))).toEqual(new Set(INTERVIEW_PACKAGES.map((item) => item.id)));
    expect(benchmark.cases).toHaveLength(INTERVIEW_PACKAGES.length + 9);
    for (const id of ["industrial-multishift-contractor-process-feedback", "multilingual-public-consultation-language-equivalence", "localized-consultation-journey-tested-control", "employee-experience-power-imbalance-small-cell-privacy", "personal-planning-sensitive-disclosure-minimization", "industrial-maintenance-improvement-rating-not-ranking", "industrial-resource-efficiency-frontline-discovery", "personal-interest-learning-choice", "personal-shared-decision-preparation"]) {
      expect(benchmark.cases.some((item: any) => item.id === id)).toBe(true);
    }
    for (const item of benchmark.cases) {
      expect(item.sourceNotes).toBeTruthy();
      expect(item.methodologySources.length).toBeGreaterThan(0);
      expect(item.methodologySources.every((source: any) => source.url.startsWith("https://"))).toBe(true);
      expect(item.requiredIntents.length).toBeGreaterThanOrEqual(5);
      expect(item.hardGates.length).toBeGreaterThanOrEqual(1);
    }
    const resourceEfficiency = benchmark.cases.find((item: any) => item.id === "industrial-resource-efficiency-frontline-discovery");
    expect(resourceEfficiency.requiredIntents.map((intent: any) => intent.id)).toContain("resource-ideas-vs-measurement");
    expect(resourceEfficiency.hardGates.map((gate: any) => gate.id)).toContain("worker-observation-as-verified-savings");
    expect(resourceEfficiency.sourceNotes).toContain("demonstrate savings");
    const personalLearning = benchmark.cases.find((item: any) => item.id === "personal-interest-learning-choice");
    expect(personalLearning.requiredIntents.map((intent: any) => intent.id)).toContain("defer-or-decline");
    expect(personalLearning.hardGates.map((gate: any) => gate.id)).toContain("institutional-purpose-drift");
    expect(personalLearning.sourceNotes).toContain("personal-interest learning");
    const languageMismatch = benchmark.cases.find((item: any) => item.id === "multilingual-public-consultation-language-equivalence");
    expect(languageMismatch.requiredIntents.map((intent: any) => intent.id)).toContain("whole-respondent-experience-language-fit");
    expect(languageMismatch.hardGates.map((gate: any) => gate.id)).toContain("unreviewed-shell-translation-used-for-fielding");
    const localizedControl = benchmark.cases.find((item: any) => item.id === "localized-consultation-journey-tested-control");
    expect(localizedControl.requiredIntents.map((intent: any) => intent.id)).toContain("localized-flow-evidence");
    expect(localizedControl.contextFacts.join(" ")).toContain("Vietnamese");
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

  it("requires machine-checkable run provenance and explains blinding exceptions", () => {
    const missing = resultsFor();
    delete (missing as any).runProvenance;
    expect(() => validateResults(benchmark, missing)).toThrow("provider and immutable modelSnapshot");
    const badHash = resultsFor();
    badHash.runProvenance.promptSha256 = "A".repeat(64);
    expect(() => validateResults(benchmark, badHash)).toThrow("promptSha256 as a lowercase SHA-256");
    const noSettings: any = resultsFor();
    noSettings.runProvenance.generationSettings = {};
    expect(() => validateResults(benchmark, noSettings)).toThrow("effective generationSettings");
    const unexplained = resultsFor();
    unexplained.runProvenance.reviewerBlinding.prompt = false;
    expect(() => validateResults(benchmark, unexplained)).toThrow("Explain every reviewerBlinding exception");
    const explained: any = resultsFor();
    explained.runProvenance.reviewerBlinding.prompt = false;
    explained.runProvenance.reviewerBlinding.exceptions = ["Prompt label was visible to reviewers."];
    expect(validateResults(benchmark, explained)).toBeDefined();
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
    results.ratings[0].dimensions.sampling_and_inference.score = 3;
    results.ratings[0].hardGateFindings = [{ gateId: benchmark.cases[0].hardGates[0].id, evidence: "Eligibility is silently excluded in question 1." }];
    const report = scoreResults(benchmark, results);
    expect(report.dimensions.sampling_and_inference.meanScore).toBeGreaterThan(2);
    expect(report.hardGateReview.flaggedCaseCount).toBe(1);
    expect(report.hardGateReview.unresolvedFlagCount).toBe(1);
    expect(report.hardGateReview.interpretation).toContain("High dimension scores cannot offset a gate");
    const adjudicatedResults: any = results;
    adjudicatedResults.adjudications = [{ caseId: benchmark.cases[0].id, gateId: benchmark.cases[0].hardGates[0].id, outcome: "cleared", adjudicatorId: "panel-1", evidence: "Reviewed the source and confirmed the case was not excluded." }];
    const cleared = scoreResults(benchmark, adjudicatedResults);
    expect(cleared.hardGateReview.unresolvedFlagCount).toBe(0);
    expect(cleared.hardGateReview.reviewerFlags).toHaveLength(1);
  });

  it("reports descriptive per-package case, intent, evidence and gate coverage without a readiness score", () => {
    const results: any = resultsFor();
    const item = benchmark.cases.find((candidate: any) => candidate.packageId === "community-consultation");
    const rating = results.ratings.find((candidate: any) => candidate.caseId === item.id && candidate.reviewerId === "domain-1");
    rating.intentCoverage[0].status = "missing";
    rating.hardGateFindings = [{ gateId: item.hardGates[0].id, evidence: "The consultation purpose is absent from the draft." }];
    results.evidenceStatus.find((record: any) => record.caseId === item.id).functional = {
      status: "passed", method: "Manual browser task run", scope: "Required-answer, save, correction, and submit flow",
      evidenceRef: "run-2026-11-19/case-community-consultation/functional.md#submit-flow",
      limitations: ["One desktop browser and one scripted path; no mobile or network-interruption coverage."],
    };
    const report = scoreResults(benchmark, results);
    const coverage = report.packageCoverage.byPackage["community-consultation"];
    expect(coverage.caseCount).toBe(benchmark.cases.filter((candidate: any) => candidate.packageId === "community-consultation").length);
    expect(coverage.reviewerRatingCount).toBe(coverage.caseCount * coverage.reviewerCount);
    expect(coverage.requiredIntentStatusCounts.missing).toBe(1);
    expect(coverage.casesWithMissingIntents).toContain(item.id);
    expect(coverage.evidenceStatusCounts.functional.passed).toBe(1);
    expect(coverage.hardGateReview.reviewerFlagCount).toBe(1);
    expect(coverage.hardGateReview.unresolvedCaseIds).toContain(item.id);
    expect(coverage).not.toHaveProperty("readinessScore");
    expect(report.packageCoverage.interpretation).toContain("not package readiness");
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
    expect(report.resultsSchemaVersion).toBe("kqa-package-draft-results/3");
    expect(report.run.runProvenance).toEqual(results.runProvenance);
    expect(report.cases[0]).toMatchObject({ htmlSha256: checks[0].htmlSha256, reviewSha256: checks[0].reviewSha256 });
    expect(report.cases[0].htmlSha256).toMatch(/^[a-f0-9]{64}$/);

    const directory = await mkdtemp(path.join(os.tmpdir(), "kqa-package-draft-eval-"));
    try {
      for (const output of results.outputs) {
        const sourceHtml = path.resolve(output.htmlPath);
        const sourceReview = path.resolve(output.reviewPath);
        const targetHtml = path.join(directory, output.htmlPath);
        const targetReview = path.join(directory, output.reviewPath);
        await Promise.all([mkdir(path.dirname(targetHtml), { recursive: true }), mkdir(path.dirname(targetReview), { recursive: true })]);
        await Promise.all([copyFile(sourceHtml, targetHtml), copyFile(sourceReview, targetReview)]);
      }
      const before = await auditArtifacts(benchmark, results, directory);
      const firstOutput = path.join(directory, results.outputs[0].htmlPath);
      await writeFile(firstOutput, `${await readFile(firstOutput, "utf8")}\n`);
      const after = await auditArtifacts(benchmark, results, directory);
      expect(after[0].htmlSha256).not.toBe(before[0].htmlSha256);
      expect(after[0].reviewSha256).toBe(before[0].reviewSha256);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects incomplete artifacts and evidence lane statuses", () => {
    const noOutput = resultsFor();
    noOutput.outputs.pop();
    expect(() => validateResults(benchmark, noOutput)).toThrow("omit output artifacts");
    const noEvidence = resultsFor();
    noEvidence.evidenceStatus[0].respondentPretest.status = "passed";
    expect(() => validateResults(benchmark, noEvidence)).toThrow("record the method used");
    noEvidence.evidenceStatus[0].respondentPretest = { status: "passed", method: "Cognitive interview", scope: "Two intended-language participants", evidenceRef: "run-1/pretest.md", limitations: [] };
    expect(() => validateResults(benchmark, noEvidence)).toThrow("record at least one limitation");
    noEvidence.evidenceStatus[0].respondentPretest = { status: "not_applicable" };
    expect(() => validateResults(benchmark, noEvidence)).toThrow("explain why this evidence lane is not applicable");
    noEvidence.evidenceStatus[0].respondentPretest = { status: "not_tested" };
    expect(() => validateResults(benchmark, noEvidence)).toThrow("explain why this lane was not tested");
  });

  it("strict mode blocks unresolved hard gates and static format errors, but accepts cleared findings", () => {
    const clean = scoreResults(benchmark, resultsFor(), []);
    expect(strictReleaseGateFailures(clean)).toEqual([]);

    const flagged: any = resultsFor();
    const item = benchmark.cases[0];
    const gateId = item.hardGates[0].id;
    flagged.ratings[0].hardGateFindings = [{ gateId, evidence: "The draft makes an unsupported claim." }];
    const blockedByFinding = scoreResults(benchmark, flagged, []);
    expect(strictReleaseGateFailures(blockedByFinding)).toContain("1 unresolved hard-gate finding(s)");

    flagged.adjudications = [{ caseId: item.id, gateId, outcome: "cleared", adjudicatorId: "panel-1", evidence: "Independent review confirmed the draft does not make the claim." }];
    expect(strictReleaseGateFailures(scoreResults(benchmark, flagged, []))).toEqual([]);

    const blockedByFormat = scoreResults(benchmark, resultsFor(), [{ caseId: item.id, staticFormat: { hasErrors: true } }]);
    expect(strictReleaseGateFailures(blockedByFormat)).toEqual([`static format errors in ${item.id}`]);
  });
});
