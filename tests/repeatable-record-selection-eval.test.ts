import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
// @ts-expect-error The checked JavaScript CLI intentionally has no TypeScript build dependency.
import { scoreResults, validateBenchmark } from "../scripts/eval-repeatable-record-selection.mjs";

const benchmark = JSON.parse(await readFile(new URL("../docs/evals/repeatable-record-selection-cases.json", import.meta.url), "utf8"));
const resultsFor = (mutate: (item: any) => any = (item) => item.gold) => ({
  benchmarkVersion: benchmark.benchmarkVersion,
  model: "test/model",
  runDate: "2026-11-19",
  skillVersion: "test-skill",
  cases: benchmark.cases.map((item: any) => {
    const { requiredGates, ...decision } = mutate(item);
    return { caseId: item.id, decision: { ...decision, clarificationSlots: [...decision.clarificationSlots], gates: [...(decision.gates ?? requiredGates)] } };
  }),
});

describe("repeatable record selection benchmark", () => {
  it("validates the corpus and scores a perfect reference result", () => {
    expect(validateBenchmark(benchmark).cases).toHaveLength(12);
    const report = scoreResults(benchmark, resultsFor());
    expect(report.patternAccuracy).toBe(1);
    expect(report.formatSupportAccuracy).toBe(1);
    expect(report.hardGateFailures).toBe(0);
    expect(report.gateF1).toBe(1);
  });

  it("requires truthful support status for repeat groups", () => {
    const results = resultsFor((item) => ({
      ...item.gold,
      ...(item.gold.pattern === "repeat_group" ? { formatStatus: "unsupported", fallbackPattern: "optional_longtext" } : {}),
    }));
    expect(() => scoreResults(benchmark, results)).toThrow("repeat_group is supported in the current KQA format");
  });

  it("scores boundary and capability-gate failures as hard failures", () => {
    const results = resultsFor((item) => {
      if (item.id === "hazard-and-isolation-report") return { ...item.gold, pattern: "repeat_group", formatStatus: "supported", fallbackPattern: null };
      if (item.id === "routine-handoff-episodes") return { ...item.gold, gates: item.gold.requiredGates.filter((gate: string) => gate !== "respondent_pretest") };
      return item.gold;
    });
    const report = scoreResults(benchmark, results);
    expect(report.hardGateFailureCases).toContain("hazard-and-isolation-report");
    expect(report.hardGateFailureCases).toContain("routine-handoff-episodes");
  });

  it("rejects incomplete, duplicate, and unknown result cases", () => {
    const incomplete = resultsFor();
    incomplete.cases.pop();
    expect(() => scoreResults(benchmark, incomplete)).toThrow("omit benchmark cases");
    const unknown = resultsFor();
    unknown.cases[0].decision.gates.push("unknown_gate");
    expect(() => scoreResults(benchmark, unknown)).toThrow("unknown gate");
    const duplicate = resultsFor();
    duplicate.cases[1].caseId = duplicate.cases[0].caseId;
    expect(() => scoreResults(benchmark, duplicate)).toThrow("Duplicate result case id");
  });
});
