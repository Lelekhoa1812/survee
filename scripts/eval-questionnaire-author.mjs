#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUIRED_FINDING_FIELDS = ["questionId", "category", "evidence", "rationale", "recommendation", "severity"];
const SEVERITY_WEIGHT = { low: 1, moderate: 2, high: 4, critical: 8 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateBenchmark(benchmark) {
  assert(benchmark && typeof benchmark.benchmarkVersion === "string", "Benchmark needs a benchmarkVersion.");
  assert(Array.isArray(benchmark.categories) && benchmark.categories.length > 0, "Benchmark needs categories.");
  assert(new Set(benchmark.categories).size === benchmark.categories.length, "Benchmark categories must be unique.");
  assert(Array.isArray(benchmark.cases) && benchmark.cases.length > 0, "Benchmark needs cases.");
  const caseIds = new Set();
  for (const item of benchmark.cases) {
    assert(typeof item.id === "string" && !caseIds.has(item.id), `Missing or duplicate case id: ${item.id}`);
    caseIds.add(item.id);
    assert(Array.isArray(item.questions), `${item.id}: questions must be an array.`);
    assert(Array.isArray(item.gold), `${item.id}: gold must be an array.`);
    assert(typeof item.cleanControl === "boolean", `${item.id}: cleanControl must be true or false.`);
    assert(!item.cleanControl || item.gold.length === 0, `${item.id}: clean controls must not contain gold findings.`);
    const qids = new Set(item.questions.map((q) => q.id));
    assert(qids.size === item.questions.length, `${item.id}: question ids must be unique.`);
    const goldKeys = new Set();
    for (const gold of item.gold) {
      assert(benchmark.categories.includes(gold.category), `${item.id}: unknown gold category ${gold.category}.`);
      assert(gold.questionId === null || qids.has(gold.questionId), `${item.id}: gold references unknown question ${gold.questionId}.`);
      assert(SEVERITY_WEIGHT[gold.severity], `${item.id}: invalid gold severity.`);
      assert(typeof gold.rationale === "string" && gold.rationale.trim(), `${item.id}: gold rationale is required.`);
      assert(!goldKeys.has(key(gold)), `${item.id}: duplicate gold location/category ${key(gold)}.`);
      goldKeys.add(key(gold));
    }
  }
  return benchmark;
}

function key(finding) {
  return JSON.stringify([finding.questionId ?? null, finding.category]);
}

function metrics(tp, fp, fn) {
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return { tp, fp, fn, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 };
}

export function scoreResults(benchmark, results) {
  validateBenchmark(benchmark);
  assert(results && results.benchmarkVersion === benchmark.benchmarkVersion, "Result benchmarkVersion does not match corpus.");
  assert(typeof results.model === "string" && results.model.trim(), "Record the model/provider version.");
  assert(typeof results.skillVersion === "string" && results.skillVersion.trim(), "Record the skill or prompt version/hash.");
  assert(Array.isArray(results.cases), "Results need a cases array.");
  const expectedByCase = new Map(benchmark.cases.map((item) => [item.id, item]));
  const outputByCase = new Map();
  for (const run of results.cases) {
    assert(expectedByCase.has(run.caseId), `Unknown result case id: ${run.caseId}`);
    assert(!outputByCase.has(run.caseId), `Duplicate result case id: ${run.caseId}`);
    assert(Array.isArray(run.findings), `${run.caseId}: findings must be an array; use [] for no findings.`);
    outputByCase.set(run.caseId, run.findings);
  }
  const missingCases = [...expectedByCase.keys()].filter((id) => !outputByCase.has(id));
  assert(missingCases.length === 0, `Results omit benchmark cases: ${missingCases.join(", ")}`);

  let tp = 0; let fp = 0; let fn = 0; let weightedMisses = 0; let totalGoldWeight = 0; let cleanFp = 0;
  let cleanQuestions = 0; let cleanFalseQuestions = 0; let cleanCases = 0; let cleanFalseCases = 0;
  const categoryCounts = new Map(benchmark.categories.map((category) => [category, { tp: 0, fp: 0, fn: 0 }]));
  for (const item of benchmark.cases) {
    const gold = item.gold;
    const goldByKey = new Map(gold.map((finding) => [key(finding), finding]));
    const findings = outputByCase.get(item.id);
    const seen = new Set();
    let falseInClean = false;
    if (item.cleanControl) {
      cleanCases += 1;
      cleanQuestions += item.questions.length;
    }
    for (const finding of findings) {
      assert(finding && typeof finding === "object", `${item.id}: finding must be an object.`);
      assert(benchmark.categories.includes(finding.category), `${item.id}: unknown finding category ${finding.category}.`);
      const valid = REQUIRED_FINDING_FIELDS.every((field) => field in finding && (typeof finding[field] === "string" || (field === "questionId" && finding[field] === null)) && (field === "questionId" || finding[field].trim()));
      const severityValid = Boolean(SEVERITY_WEIGHT[finding.severity]);
      const id = key(finding);
      if (valid && severityValid && goldByKey.has(id) && !seen.has(id)) {
        tp += 1;
        categoryCounts.get(finding.category).tp += 1;
        seen.add(id);
      } else {
        fp += 1;
        categoryCounts.get(finding.category).fp += 1;
        if (item.cleanControl) { falseInClean = true; cleanFp += 1; }
      }
    }
    for (const [id, expected] of goldByKey) {
      const weight = SEVERITY_WEIGHT[expected.severity];
      totalGoldWeight += weight;
      if (!seen.has(id)) {
        fn += 1;
        weightedMisses += weight;
        categoryCounts.get(expected.category).fn += 1;
      }
    }
    if (item.cleanControl && falseInClean) cleanFalseCases += 1;
    if (item.cleanControl) cleanFalseQuestions += new Set(findings.filter((finding) => {
      const valid = REQUIRED_FINDING_FIELDS.every((field) => field in finding && (field === "questionId" ? typeof finding[field] === "string" || finding[field] === null : typeof finding[field] === "string" && finding[field].trim()));
      return valid && Boolean(SEVERITY_WEIGHT[finding.severity]) && typeof finding.questionId === "string";
    }).map((finding) => finding.questionId)).size;
  }
  const categoryMetrics = Object.fromEntries([...categoryCounts].map(([category, counts]) => [category, metrics(counts.tp, counts.fp, counts.fn)]));
  const active = Object.values(categoryMetrics).filter((value) => value.tp + value.fp + value.fn > 0);
  return {
    benchmarkVersion: benchmark.benchmarkVersion,
    track: benchmark.track,
    run: { model: results.model, skillVersion: results.skillVersion, promptVersion: results.promptVersion ?? null, runDate: results.runDate ?? null },
    overall: metrics(tp, fp, fn),
    macroF1: active.length ? active.reduce((sum, value) => sum + value.f1, 0) / active.length : 0,
    cleanControls: {
      cases: cleanCases,
      falsePositiveCaseRate: cleanCases ? cleanFalseCases / cleanCases : 0,
      questions: cleanQuestions,
      falseAlarmsPer100Questions: cleanQuestions ? cleanFp / cleanQuestions * 100 : 0,
      casesWithFalseAlarms: cleanFalseCases,
      questionsWithActionableFalsePositiveRate: cleanQuestions ? cleanFalseQuestions / cleanQuestions : 0,
    },
    severityWeightedMissRate: totalGoldWeight ? weightedMisses / totalGoldWeight : 0,
    categories: categoryMetrics,
    limitations: ["Scores reflect this public development corpus only; they are not evidence of validity, respondent comprehension, usability, or production performance.", "A hit requires a matching location/category and non-empty evidence, rationale, recommendation, and severity; evaluate revision quality separately."],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const resultsPath = getArg("--results");
  assert(resultsPath && !resultsPath.startsWith("--"), "Usage: node scripts/eval-questionnaire-author.mjs --results <result.json> [--benchmark <cases.json>]");
  const benchmarkPath = getArg("--benchmark") ?? "eval/questionnaire-authoring/cases.json";
  const [benchmark, results] = await Promise.all([benchmarkPath, resultsPath].map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  process.stdout.write(`${JSON.stringify(scoreResults(benchmark, results), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`Evaluation failed: ${error.message}\n`); process.exitCode = 1; });
}
