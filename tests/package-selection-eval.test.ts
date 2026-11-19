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
  promptVersion: "test-prompt", packageLibraryVersion: "kqa-interview-packages/3",
  cases: benchmark.cases.map((c: any) => ({ caseId: c.id, decision: fn(c) })),
});

describe("package selection development benchmark", () => {
  it("validates the audit scenarios with distinct fit, clarification, and boundary decisions", () => {
    expect(validateBenchmark(benchmark).cases).toHaveLength(16);
    expect(new Set(benchmark.packageIds)).toEqual(new Set(INTERVIEW_PACKAGES.map((p) => p.id)));
    expect(benchmark.cases.filter((c: any) => c.gold.action === "clarify")).toHaveLength(3);
    expect(benchmark.cases.filter((c: any) => c.gold.action === "out_of_scope")).toHaveLength(3);
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
});
