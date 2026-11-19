#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const PATTERNS = new Set(["fixed_questions", "multi", "optional_longtext", "repeat_group", "clarify", "out_of_scope"]);
const FORMAT_STATUSES = new Set(["supported", "unsupported", "not_applicable"]);
const FALLBACKS = new Set(["fixed_questions", "multi", "optional_longtext"]);
const NONEMPTY = (value) => typeof value === "string" && value.trim().length > 0;
const ISO_DATE = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
function assert(ok, message) { if (!ok) throw new Error(message); }
function uniqueStrings(values, label) {
  assert(Array.isArray(values) && values.every(NONEMPTY), `${label} must be an array of non-empty strings.`);
  assert(new Set(values).size === values.length, `${label} must not contain duplicates.`);
}

export function validateBenchmark(benchmark) {
  assert(benchmark && benchmark.benchmarkVersion === "kqa-repeatable-record-selection/2", "Unsupported benchmarkVersion.");
  assert(benchmark.track === "repeatable-record-selection", "track must be repeatable-record-selection.");
  for (const [name, values, allowed] of [
    ["allowedPatterns", benchmark.allowedPatterns, PATTERNS],
    ["allowedFormatStatuses", benchmark.allowedFormatStatuses, FORMAT_STATUSES],
    ["allowedFallbackPatterns", benchmark.allowedFallbackPatterns, FALLBACKS],
    ["allowedGates", benchmark.allowedGates, null],
  ]) {
    uniqueStrings(values, name);
    if (allowed) assert(values.length === allowed.size && values.every((value) => allowed.has(value)), `${name} must declare the supported values.`);
  }
  assert(Array.isArray(benchmark.cases) && benchmark.cases.length > 0, "cases must be a non-empty array.");
  const seen = new Set();
  for (const item of benchmark.cases) {
    assert(item && NONEMPTY(item.id) && !seen.has(item.id), `Missing or duplicate case id: ${item?.id}`); seen.add(item.id);
    assert(NONEMPTY(item.brief), `${item.id}: brief is required.`);
    const gold = item.gold;
    assert(gold && PATTERNS.has(gold.pattern), `${item.id}: invalid gold pattern.`);
    assert(FORMAT_STATUSES.has(gold.formatStatus), `${item.id}: invalid gold formatStatus.`);
    assert(gold.fallbackPattern === null || FALLBACKS.has(gold.fallbackPattern), `${item.id}: invalid fallbackPattern.`);
    uniqueStrings(gold.clarificationSlots, `${item.id}: clarificationSlots`);
    uniqueStrings(gold.requiredGates, `${item.id}: requiredGates`);
    assert(gold.requiredGates.every((gate) => benchmark.allowedGates.includes(gate)), `${item.id}: unknown required gate.`);
    if (gold.pattern === "repeat_group") {
      assert(gold.formatStatus === "supported", `${item.id}: the current format supports native repeat groups.`);
      assert(gold.fallbackPattern === null, `${item.id}: a supported repeat group should not require a fallback.`);
    }
    if (gold.pattern === "out_of_scope") assert(gold.formatStatus === "not_applicable" && gold.requiredGates.length > 0, `${item.id}: out_of_scope needs not_applicable status and a boundary gate.`);
    if (gold.pattern === "clarify") assert(gold.clarificationSlots.length > 0, `${item.id}: clarify needs clarificationSlots.`);
    else assert(gold.clarificationSlots.length === 0, `${item.id}: only clarify may need clarificationSlots.`);
  }
  return benchmark;
}

export function scoreResults(benchmark, results) {
  validateBenchmark(benchmark);
  assert(results && results.benchmarkVersion === benchmark.benchmarkVersion, "Result benchmarkVersion does not match corpus.");
  assert(NONEMPTY(results.model) && NONEMPTY(results.skillVersion) && ISO_DATE(results.runDate), "Record model, skillVersion, and runDate as YYYY-MM-DD.");
  assert(Array.isArray(results.cases), "Results need a cases array.");
  const expected = new Map(benchmark.cases.map((item) => [item.id, item]));
  const actual = new Map();
  for (const row of results.cases) {
    assert(row && typeof row === "object", "Each result row must be an object.");
    assert(expected.has(row.caseId), `Unknown result case id: ${row.caseId}`);
    assert(!actual.has(row.caseId), `Duplicate result case id: ${row.caseId}`);
    const decision = row.decision;
    assert(decision && PATTERNS.has(decision.pattern), `${row.caseId}: invalid pattern.`);
    assert(FORMAT_STATUSES.has(decision.formatStatus), `${row.caseId}: invalid formatStatus.`);
    assert(decision.fallbackPattern === null || FALLBACKS.has(decision.fallbackPattern), `${row.caseId}: invalid fallbackPattern.`);
    uniqueStrings(decision.clarificationSlots, `${row.caseId}: clarificationSlots`);
    uniqueStrings(decision.gates, `${row.caseId}: gates`);
    assert(decision.gates.every((gate) => benchmark.allowedGates.includes(gate)), `${row.caseId}: unknown gate.`);
    assert(decision.gates.every((gate) => benchmark.allowedGates.includes(gate)), `${row.caseId}: unknown gate.`);
    if (decision.pattern === "repeat_group") {
      assert(decision.formatStatus === "supported", `${row.caseId}: repeat_group is supported in the current KQA format.`);
      assert(decision.fallbackPattern === null, `${row.caseId}: supported repeat_group must not be assigned a fallbackPattern.`);
    }
    if (decision.pattern === "out_of_scope") assert(decision.formatStatus === "not_applicable" && decision.clarificationSlots.length === 0, `${row.caseId}: out_of_scope cannot include clarification slots.`);
    if (decision.pattern === "clarify") assert(decision.clarificationSlots.length > 0, `${row.caseId}: clarify needs clarificationSlots.`);
    else assert(decision.clarificationSlots.length === 0, `${row.caseId}: only clarify may include clarificationSlots.`);
    actual.set(row.caseId, decision);
  }
  const missing = [...expected.keys()].filter((id) => !actual.has(id));
  assert(missing.length === 0, `Results omit benchmark cases: ${missing.join(", ")}`);

  let patternCorrect = 0; let formatStatusCorrect = 0; let clarificationTp = 0; let clarificationFp = 0; let clarificationFn = 0;
  let gateTp = 0; let gateFp = 0; let gateFn = 0; let hardGateFailures = 0;
  const hardGateFailureCases = [];
  for (const [id, item] of expected) {
    const gold = item.gold; const decision = actual.get(id);
    const patternHit = decision.pattern === gold.pattern;
    const supportHit = decision.formatStatus === gold.formatStatus;
    if (patternHit) patternCorrect += 1;
    if (supportHit) formatStatusCorrect += 1;
    let failed = !patternHit || !supportHit || gold.requiredGates.some((gate) => !decision.gates.includes(gate));
    if (gold.pattern === "out_of_scope" && decision.pattern !== "out_of_scope") failed = true;
    const predictedSlots = decision.pattern === "clarify" ? decision.clarificationSlots : [];
    const expectedSlots = new Set(gold.clarificationSlots);
    clarificationTp += predictedSlots.filter((slot) => expectedSlots.has(slot)).length;
    clarificationFp += predictedSlots.filter((slot) => !expectedSlots.has(slot)).length;
    clarificationFn += gold.clarificationSlots.filter((slot) => !predictedSlots.includes(slot)).length;
    const predictedGates = new Set(decision.gates);
    const expectedGates = new Set(gold.requiredGates);
    gateTp += [...predictedGates].filter((gate) => expectedGates.has(gate)).length;
    gateFp += [...predictedGates].filter((gate) => !expectedGates.has(gate)).length;
    gateFn += [...expectedGates].filter((gate) => !predictedGates.has(gate)).length;
    if (failed) { hardGateFailures += 1; hardGateFailureCases.push(id); }
  }
  const precision = (tp, fp) => tp + fp ? tp / (tp + fp) : 0;
  const recall = (tp, fn) => tp + fn ? tp / (tp + fn) : null;
  const f1 = (p, r) => r === null ? null : p + r === 0 ? 0 : 2 * p * r / (p + r);
  const slotPrecision = precision(clarificationTp, clarificationFp); const slotRecall = recall(clarificationTp, clarificationFn);
  const gatePrecision = precision(gateTp, gateFp); const gateRecall = recall(gateTp, gateFn);
  return {
    developmentOnly: true,
    cases: expected.size,
    patternAccuracy: patternCorrect / expected.size,
    formatSupportAccuracy: formatStatusCorrect / expected.size,
    clarificationSlotPrecision: slotPrecision,
    clarificationSlotRecall: slotRecall,
    clarificationSlotF1: f1(slotPrecision, slotRecall),
    gatePrecision,
    gateRecall,
    gateF1: f1(gatePrecision, gateRecall),
    hardGateFailures,
    hardGateFailureCases,
    interpretation: "Descriptive public-development metrics only. Human review must assess rationale and wording; no metric establishes respondent usability, domain validity, or field readiness. Hard-gate failures must be reviewed individually and cannot be offset by other scores."
  };
}

async function main() {
  const args = process.argv.slice(2); const resultIndex = args.indexOf("--results");
  assert(resultIndex >= 0 && args[resultIndex + 1], "Usage: npm run eval:repeatable-record-selection -- --results path/to/results.json");
  const corpusPath = new URL("../docs/evals/repeatable-record-selection-cases.json", import.meta.url);
  const benchmark = validateBenchmark(JSON.parse(await readFile(corpusPath, "utf8")));
  const results = JSON.parse(await readFile(args[resultIndex + 1], "utf8"));
  console.log(JSON.stringify(scoreResults(benchmark, results), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
