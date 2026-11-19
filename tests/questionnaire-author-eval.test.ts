import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
// @ts-expect-error The checked JavaScript CLI intentionally has no TypeScript build dependency.
import { scoreResults, validateBenchmark } from "../scripts/eval-questionnaire-author.mjs";

const benchmark = JSON.parse(await readFile(new URL("../docs/evals/questionnaire-authoring-cases.json", import.meta.url), "utf8"));

describe("questionnaire authoring review benchmark", () => {
  it("has unique cases, known categories, valid question locations, and clean controls", () => {
    expect(validateBenchmark(benchmark).cases.length).toBeGreaterThanOrEqual(15);
    expect(benchmark.cases.some((item: { cleanControl: boolean }) => item.cleanControl)).toBe(true);
    expect(benchmark.cases.some((item: { gold: unknown[] }) => item.gold.length > 0)).toBe(true);
  });

  it("scores supported findings and reports false alarms on clean controls", () => {
    const tiny = {
      benchmarkVersion: "test/1",
      track: "content-review",
      categories: ["wording_bias"],
      cases: [
        { id: "flawed", cleanControl: false, questions: [{ id: "q1" }], gold: [{ questionId: "q1", category: "wording_bias", severity: "high", rationale: "Loaded wording." }] },
        { id: "clean", cleanControl: true, questions: [{ id: "q2" }], gold: [] },
      ],
    };
    const result = scoreResults(tiny, {
      benchmarkVersion: "test/1", model: "test/model", skillVersion: "sha256:abc",
      cases: [
        { caseId: "flawed", findings: [{ questionId: "q1", category: "wording_bias", severity: "high", evidence: "excellent", rationale: "It assumes a positive answer.", recommendation: "Use neutral wording." }] },
        { caseId: "clean", findings: [{ questionId: "q2", category: "wording_bias", severity: "low", evidence: "priority", rationale: "Possible issue.", recommendation: "Rewrite." }] },
      ],
    });
    expect(result.overall).toMatchObject({ tp: 1, fp: 1, fn: 0, precision: 0.5, recall: 1 });
    expect(result.cleanControls.falsePositiveCaseRate).toBe(1);
    expect(result.cleanControls.falseAlarmsPer100Questions).toBe(100);
    expect(result.severityWeightedMissRate).toBe(0);
  });

  it("rejects incomplete runs rather than hiding missing benchmark cases", () => {
    const tiny = { benchmarkVersion: "test/1", categories: ["wording_bias"], cases: [{ id: "one", cleanControl: false, questions: [], gold: [] }] };
    expect(() => scoreResults(tiny, { benchmarkVersion: "test/1", model: "m", skillVersion: "s", cases: [] })).toThrow("omit benchmark cases");
  });

  it("rejects duplicate gold annotations and mislabeled clean controls", () => {
    const invalid = {
      benchmarkVersion: "test/1", categories: ["wording_bias"], cases: [
        { id: "clean", cleanControl: true, questions: [{ id: "q" }], gold: [{ questionId: "q", category: "wording_bias", severity: "low", rationale: "x" }] },
      ],
    };
    expect(() => validateBenchmark(invalid)).toThrow("clean controls must not contain gold findings");
    const duplicate = {
      benchmarkVersion: "test/1", categories: ["wording_bias"], cases: [
        { id: "flawed", cleanControl: false, questions: [{ id: "q" }], gold: [
          { questionId: "q", category: "wording_bias", severity: "low", rationale: "x" },
          { questionId: "q", category: "wording_bias", severity: "high", rationale: "y" },
        ] },
      ],
    };
    expect(() => validateBenchmark(duplicate)).toThrow("duplicate gold location/category");
  });
});
