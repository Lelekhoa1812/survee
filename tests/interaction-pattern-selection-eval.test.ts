import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
// @ts-expect-error The checked JavaScript CLI intentionally has no TypeScript build dependency.
import { scoreResults, validateBenchmark } from "../docs/evals/eval-interaction-pattern-selection.mjs";

const benchmark = JSON.parse(await readFile(new URL("../docs/evals/interaction-pattern-selection-cases.json", import.meta.url), "utf8"));
const resultsFor = (mutate: (item: any) => any = (item) => item.gold) => ({
  benchmarkVersion: benchmark.benchmarkVersion,
  model: "test/model",
  runDate: "2026-11-19",
  skillVersion: "test-skill",
  cases: benchmark.cases.map((item: any) => {
    const gold = mutate(item);
    return {
      caseId: item.id,
      decision: {
        action: gold.action,
        presentation: gold.presentation,
        patterns: [...gold.patterns],
        clarificationSlots: [...gold.clarificationSlots],
        gates: [...(gold.gates ?? gold.requiredGates)],
        rationale: "Evidence and construct align with this interaction choice.",
      },
    };
  }),
});

describe("interaction pattern selection benchmark", () => {
  it("validates the corpus and scores a perfect reference result", () => {
    expect(validateBenchmark(benchmark).cases).toHaveLength(21);
    const report = scoreResults(benchmark, resultsFor());
    expect(report.actionAccuracy).toBe(1);
    expect(report.exactPatternSetAccuracyAmongRecommendations).toBe(1);
    expect(report.presentationAccuracy).toBe(1);
    expect(report.presentationAccuracyWhenSpecified).toBe(1);
    expect(report.patternSetMicro.f1).toBe(1);
    expect(report.clarificationSlotMicro.f1).toBe(1);
    expect(report.safeguardGateMicro.f1).toBe(1);
    expect(report.hardGateFailures).toBe(0);
  });

  it("treats prohibited patterns, missed safeguards, and boundary actions as non-compensatory failures", () => {
    const results = resultsFor((item) => {
      if (item.id === "ordered-frequency-categories") return { ...item.gold, patterns: ["option-randomization"] };
      if (item.id === "unordered-option-position-concern") return { ...item.gold, requiredGates: item.gold.requiredGates.filter((gate: string) => gate !== "respondent_pretest") };
      if (item.id === "adaptive-moderator-probing") return { ...item.gold, action: "recommend", presentation: "all", patterns: ["ranking"] };
      return item.gold;
    });
    const report = scoreResults(benchmark, results);
    expect(report.hardGateFailureCases).toEqual(expect.arrayContaining(["ordered-frequency-categories", "unordered-option-position-concern", "adaptive-moderator-probing"]));
  });

  it("scores clarification facts only for clarification decisions and reports pattern-set misses", () => {
    const results = resultsFor((item) => {
      if (item.id === "guided-mode-without-evidence") return { ...item.gold, clarificationSlots: ["respondent_context"] };
      if (item.id === "short-service-feedback") return { ...item.gold, patterns: ["option-randomization"] };
      if (item.id === "unclear-requiredness") return { ...item.gold, action: "recommend", presentation: "all", patterns: ["optional-answer"], clarificationSlots: [] };
      return item.gold;
    });
    const report = scoreResults(benchmark, results);
    expect(report.clarificationSlotMicro.recall).toBeLessThan(1);
    expect(report.exactPatternSetAccuracyAmongRecommendations).toBeLessThan(1);
    expect(report.exactInteractionDecisionAccuracy).toBeLessThan(1);
  });

  it("rejects incomplete, duplicate, unknown, or malformed result rows", () => {
    const incomplete = resultsFor();
    incomplete.cases.pop();
    expect(() => scoreResults(benchmark, incomplete)).toThrow("omit benchmark cases");
    const unknown = resultsFor();
    unknown.cases[0].decision.gates.push("unknown-gate");
    expect(() => scoreResults(benchmark, unknown)).toThrow("unknown value");
    const duplicate = resultsFor();
    duplicate.cases[1].caseId = duplicate.cases[0].caseId;
    expect(() => scoreResults(benchmark, duplicate)).toThrow("Duplicate result case id");
    const malformed = resultsFor();
    malformed.cases[0].decision.rationale = " ";
    expect(() => scoreResults(benchmark, malformed)).toThrow("rationale is required");
    const extraField = resultsFor();
    (extraField.cases[0].decision as any).extra = true;
    expect(() => scoreResults(benchmark, extraField)).toThrow("unsupported fields");
    const invalidDate = resultsFor();
    (invalidDate as any).runDate = "9999-99-99";
    expect(() => scoreResults(benchmark, invalidDate)).toThrow("Record model, skillVersion, and runDate");
  });
});
