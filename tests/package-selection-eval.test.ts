import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
// @ts-expect-error The checked JavaScript CLI intentionally has no TypeScript build dependency.
import { scoreResults, validateBenchmark } from "../scripts/eval-package-selection.mjs";
import { INTERVIEW_PACKAGES } from "../src/lib/interview-packages";

const benchmark = JSON.parse(await readFile(new URL("../docs/evals/package-selection-cases.json", import.meta.url), "utf8"));
const decision = (action: string, packageId: string | null, overrides: Record<string, unknown> = {}) => ({
  action, packageId, candidatePackageIds: [], clarificationSlots: [], gates: [], ...overrides,
});
const resultsFor = (fn: (c: any) => any) => ({
  benchmarkVersion: benchmark.benchmarkVersion, model: "test/model", runDate: "2026-11-19",
  promptVersion: "test-prompt", packageLibraryVersion: "kqa-interview-packages/12",
  cases: benchmark.cases.map((c: any) => ({ caseId: c.id, decision: fn(c) })),
});

describe("package selection development benchmark", () => {
  it("validates the audit scenarios with distinct fit, clarification, and boundary decisions", () => {
    expect(validateBenchmark(benchmark).cases).toHaveLength(28);
    expect(new Set(benchmark.packageIds)).toEqual(new Set(INTERVIEW_PACKAGES.map((p) => p.id)));
    expect(benchmark.cases.filter((c: any) => c.gold.action === "clarify")).toHaveLength(3);
    expect(benchmark.cases.filter((c: any) => c.gold.action === "out_of_scope")).toHaveLength(10);
    expect(benchmark.cases.map((c: any) => c.id)).toEqual(expect.arrayContaining([
      "post-change-process-learning", "formal-moc-approval", "caregiver-service-feedback",
      "caregiver-validated-measure", "anonymous-workforce-climate", "financial-wellbeing-scored-measure",
      "digital-only-population-representativeness", "live-adaptive-longitudinal-interview", "frontline-resource-efficiency-discovery", "personal-shared-decision-preparation", "clinical-treatment-recommendation",
    ]));
    const requiredGates = Object.fromEntries(benchmark.cases.map((c: any) => [c.id, c.gold.requiredGates]));
    expect(requiredGates["formal-moc-approval"]).toContain("moc-boundary");
    expect(requiredGates["caregiver-validated-measure"]).toEqual(expect.arrayContaining(["validated-instrument-boundary", "scoring-boundary"]));
    expect(requiredGates["anonymous-workforce-climate"]).toContain("anonymity-limit");
    expect(requiredGates["financial-wellbeing-scored-measure"]).toEqual(expect.arrayContaining(["financial-data-minimization", "validated-instrument-boundary", "scoring-boundary"]));
    expect(requiredGates["digital-only-population-representativeness"]).toEqual(expect.arrayContaining(["mode-mismatch", "coverage-limit"]));
    expect(requiredGates["live-adaptive-longitudinal-interview"]).toEqual(expect.arrayContaining(["mode-mismatch", "interaction-capability-boundary"]));
    expect(requiredGates["frontline-resource-efficiency-discovery"]).toEqual(expect.arrayContaining(["resource-measurement-boundary", "safety-reporting-route"]));
    expect(requiredGates["personal-shared-decision-preparation"]).toContain("health-data-minimization");
    expect(requiredGates["clinical-treatment-recommendation"]).toEqual(expect.arrayContaining(["clinical-advice-boundary", "scoring-boundary"]));
  });

  it("scores an all-gold synthetic run and keeps the development-only caveat", () => {
    const report = scoreResults(benchmark, resultsFor((c: any) => ({
      action: c.gold.action, packageId: c.gold.packageId,
      candidatePackageIds: c.gold.candidatePackageIds ?? [],
      clarificationSlots: c.gold.clarificationSlots,
      gates: c.gold.requiredGates,
    })));
    expect(report.actionAccuracy).toBe(1);
    expect(report.packageAccuracyAmongRecommendations).toBe(1);
    expect(report.clarificationCandidateF1).toBe(1);
    expect(report.clarificationSlotF1).toBe(1);
    expect(report.clarificationCandidateAveraging).toContain("micro");
    expect(report.clarificationSlotAveraging).toContain("micro");
    expect(report.hardGateFailures).toBe(0);
    expect(report.developmentOnly).toBe(true);
    expect(report.interpretation).toContain("no universal pass score");
  });

  it("treats a recommendation for a prohibited case as a non-compensatory hard-gate failure", () => {
    const report = scoreResults(benchmark, resultsFor((c: any) => c.id === "applicant-ranking"
      ? decision("recommend", "candidate-experience", { gates: ["employment-consequential-use"] })
      : decision(c.gold.action, c.gold.packageId, {
        candidatePackageIds: c.gold.candidatePackageIds ?? [], clarificationSlots: c.gold.clarificationSlots,
        gates: c.gold.requiredGates,
      })));
    expect(report.hardGateFailures).toBe(1);
    expect(report.hardGateFailureCases).toContain("applicant-ranking");
  });

  it("treats clarification of an explicitly out-of-scope use as a hard-gate failure", () => {
    const report = scoreResults(benchmark, resultsFor((c: any) => c.id === "active-hazard-reporting"
      ? decision("clarify", null, { candidatePackageIds: ["safety-quality-learning", "event-feedback"], clarificationSlots: ["decision_focus"] })
      : decision(c.gold.action, c.gold.packageId, {
        candidatePackageIds: c.gold.candidatePackageIds ?? [], clarificationSlots: c.gold.clarificationSlots,
        gates: c.gold.requiredGates,
      })));
    expect(report.hardGateFailures).toBe(1);
    expect(report.hardGateFailureCases).toContain("active-hazard-reporting");
  });

  it("rejects incomplete result coverage and unknown package-selection gates", () => {
    const incomplete = resultsFor((c: any) => decision(c.gold.action, c.gold.packageId, {
      candidatePackageIds: c.gold.candidatePackageIds ?? [], clarificationSlots: c.gold.clarificationSlots, gates: c.gold.requiredGates,
    }));
    incomplete.cases.pop();
    expect(() => scoreResults(benchmark, incomplete)).toThrow("omit benchmark cases");
    const unknown = resultsFor((c: any) => decision(c.gold.action, c.gold.packageId, { gates: ["invented-gate"] }));
    expect(() => scoreResults(benchmark, unknown)).toThrow("unknown gate");
  });

  it("requires explicit non-compensatory gates for out-of-scope gold cases", () => {
    const invalid = structuredClone(benchmark);
    invalid.cases.find((c: any) => c.id === "applicant-ranking").gold.requiredGates = [];
    expect(() => validateBenchmark(invalid)).toThrow("out_of_scope must name the boundary gate");
  });

  it("scores clarify candidates and slots, penalizing missing and extra selections", () => {
    const report = scoreResults(benchmark, resultsFor((c: any) => c.id === "account-progress-or-friction"
      ? decision("clarify", null, {
        candidatePackageIds: ["customer-success", "product-discovery"],
        clarificationSlots: ["decision_focus", "respondent_group"],
      })
      : decision(c.gold.action, c.gold.packageId, {
        candidatePackageIds: c.gold.candidatePackageIds ?? [], clarificationSlots: c.gold.clarificationSlots,
        gates: c.gold.requiredGates,
      })));
    expect(report.clarificationCandidatePrecision).toBeLessThan(1);
    expect(report.clarificationCandidateRecall).toBeLessThan(1);
    expect(report.clarificationSlotPrecision).toBeLessThan(1);
    expect(report.clarificationSlotRecall).toBe(1);
  });

  it("does not give clarification candidate or slot credit when the action is not clarify", () => {
    const report = scoreResults(benchmark, resultsFor((c: any) => c.id === "account-progress-or-friction"
      ? decision("recommend", "customer-success")
      : decision(c.gold.action, c.gold.packageId, {
        candidatePackageIds: c.gold.candidatePackageIds ?? [], clarificationSlots: c.gold.clarificationSlots,
        gates: c.gold.requiredGates,
      })));
    expect(report.clarificationCandidateRecall).toBeLessThan(1);
    expect(report.clarificationSlotRecall).toBeLessThan(1);
  });

  it("rejects recommendation results that carry clarification-only fields", () => {
    const invalid = resultsFor((c: any) => decision(c.gold.action, c.gold.packageId, {
      candidatePackageIds: c.gold.candidatePackageIds ?? [], clarificationSlots: c.gold.clarificationSlots,
      gates: c.gold.requiredGates,
    }));
    invalid.cases.find((row: any) => row.caseId === "saas-unmet-need").decision.clarificationSlots = ["decision_focus"];
    expect(() => scoreResults(benchmark, invalid)).toThrow("recommend cannot include clarification");
  });

  it("requires result dates to be real ISO calendar dates", () => {
    const invalid = resultsFor((c: any) => decision(c.gold.action, c.gold.packageId, {
      candidatePackageIds: c.gold.candidatePackageIds ?? [], clarificationSlots: c.gold.clarificationSlots,
      gates: c.gold.requiredGates,
    }));
    invalid.runDate = "2026-02-30";
    expect(() => scoreResults(benchmark, invalid)).toThrow("YYYY-MM-DD");
  });

  it("rejects malformed rows with a controlled validation message", () => {
    const invalid = resultsFor((c: any) => decision(c.gold.action, c.gold.packageId, {
      candidatePackageIds: c.gold.candidatePackageIds ?? [], clarificationSlots: c.gold.clarificationSlots,
      gates: c.gold.requiredGates,
    }));
    invalid.cases[0] = null;
    expect(() => scoreResults(benchmark, invalid)).toThrow("Each result row must be an object");
  });
});
