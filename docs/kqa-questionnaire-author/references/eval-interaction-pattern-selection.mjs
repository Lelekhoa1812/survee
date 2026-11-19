#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ACTIONS = new Set(["recommend", "clarify", "out_of_scope"]);
const PRESENTATIONS = new Set(["all", "guided", "guided-question"]);
const NONEMPTY = (value) => typeof value === "string" && value.trim().length > 0;
const ISO_DATE = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
function assert(ok, message) { if (!ok) throw new Error(message); }
function exactKeys(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  assert(extra.length === 0, `${label} contains unsupported fields: ${extra.join(", ")}.`);
}
function uniqueStrings(values, label, allowed) {
  assert(Array.isArray(values) && values.every(NONEMPTY), `${label} must be an array of non-empty strings.`);
  assert(new Set(values).size === values.length, `${label} must not contain duplicates.`);
  if (allowed) assert(values.every((value) => allowed.has(value)), `${label} contains an unknown value.`);
}
function validateDecision(decision, id, benchmark) {
  exactKeys(decision, ["action", "presentation", "patterns", "clarificationSlots", "gates", "rationale"], `${id}: decision`);
  assert(decision && ACTIONS.has(decision.action), `${id}: invalid action.`);
  uniqueStrings(decision.patterns, `${id}: patterns`, new Set(benchmark.allowedPatterns));
  assert(decision.presentation === null || PRESENTATIONS.has(decision.presentation), `${id}: invalid presentation.`);
  uniqueStrings(decision.clarificationSlots, `${id}: clarificationSlots`, new Set(benchmark.allowedClarificationSlots));
  uniqueStrings(decision.gates, `${id}: gates`, new Set(benchmark.allowedGates));
  assert(NONEMPTY(decision.rationale), `${id}: rationale is required.`);
  if (decision.action === "recommend") assert(decision.clarificationSlots.length === 0, `${id}: recommend cannot include clarification slots.`);
  if (decision.action === "clarify") assert(decision.patterns.length === 0 && decision.presentation === null && decision.clarificationSlots.length > 0, `${id}: clarify needs clarification slots and no selected patterns or presentation.`);
  if (decision.action === "out_of_scope") assert(decision.patterns.length === 0 && decision.presentation === null && decision.clarificationSlots.length === 0, `${id}: out_of_scope cannot select patterns, presentation, or clarification slots.`);
}
export function validateBenchmark(benchmark) {
  exactKeys(benchmark, ["benchmarkVersion", "track", "status", "description", "allowedActions", "allowedPresentations", "allowedPatterns", "allowedClarificationSlots", "allowedGates", "cases"], "benchmark");
  assert(benchmark && benchmark.benchmarkVersion === "kqa-interaction-pattern-selection/1", "Unsupported benchmarkVersion.");
  assert(benchmark.track === "interaction-pattern-selection", "track must be interaction-pattern-selection.");
  uniqueStrings(benchmark.allowedActions, "allowedActions", ACTIONS);
  assert(benchmark.allowedActions.length === ACTIONS.size, "allowedActions must declare every supported action.");
  for (const name of ["allowedPatterns", "allowedPresentations", "allowedClarificationSlots", "allowedGates"]) uniqueStrings(benchmark[name], name);
  assert(benchmark.allowedPresentations.length === PRESENTATIONS.size && benchmark.allowedPresentations.every((item) => PRESENTATIONS.has(item)), "allowedPresentations must match KQA presentation modes.");
  assert(Array.isArray(benchmark.cases) && benchmark.cases.length > 0, "cases must be a non-empty array.");
  const seen = new Set();
  for (const item of benchmark.cases) {
    exactKeys(item, ["id", "brief", "gold"], `case ${item?.id}`);
    assert(item && NONEMPTY(item.id) && !seen.has(item.id), `Missing or duplicate case id: ${item?.id}`); seen.add(item.id);
    assert(NONEMPTY(item.brief), `${item.id}: brief is required.`);
    const gold = item.gold;
    exactKeys(gold, ["action", "presentation", "patterns", "clarificationSlots", "requiredGates", "prohibitedPatterns"], `${item.id}: gold`);
    validateDecision({ action: gold.action, presentation: gold.presentation, patterns: gold.patterns, clarificationSlots: gold.clarificationSlots, gates: gold.requiredGates, rationale: "gold fixture" }, item.id, benchmark);
    assert(gold.presentation === null || benchmark.allowedPresentations.includes(gold.presentation), `${item.id}: presentation is not declared.`);
    uniqueStrings(gold.requiredGates, `${item.id}: requiredGates`, new Set(benchmark.allowedGates));
    uniqueStrings(gold.prohibitedPatterns, `${item.id}: prohibitedPatterns`, new Set(benchmark.allowedPatterns));
    if (gold.action === "clarify") assert(gold.clarificationSlots.length > 0, `${item.id}: clarify needs clarification slots.`);
    if (gold.action === "out_of_scope") assert(gold.requiredGates.length > 0, `${item.id}: out_of_scope needs a boundary gate.`);
  }
  return benchmark;
}
function metrics(tp, fp, fn) {
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision === null || recall === null ? null : precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
  return { precision, recall, f1, averaging: "micro across cases" };
}
export function scoreResults(benchmark, results) {
  validateBenchmark(benchmark);
  exactKeys(results, ["benchmarkVersion", "model", "runDate", "skillVersion", "cases"], "results");
  assert(results && results.benchmarkVersion === benchmark.benchmarkVersion, "Result benchmarkVersion does not match corpus.");
  assert(NONEMPTY(results.model) && NONEMPTY(results.skillVersion) && ISO_DATE(results.runDate), "Record model, skillVersion, and runDate as YYYY-MM-DD.");
  assert(Array.isArray(results.cases), "Results need a cases array.");
  const expected = new Map(benchmark.cases.map((item) => [item.id, item]));
  const actual = new Map();
  for (const row of results.cases) {
    exactKeys(row, ["caseId", "decision"], "result row");
    assert(row && typeof row === "object", "Each result row must be an object.");
    assert(expected.has(row.caseId), `Unknown result case id: ${row.caseId}`);
    assert(!actual.has(row.caseId), `Duplicate result case id: ${row.caseId}`);
    validateDecision(row.decision, row.caseId, benchmark);
    actual.set(row.caseId, row.decision);
  }
  const missing = [...expected.keys()].filter((id) => !actual.has(id));
  assert(missing.length === 0, `Results omit benchmark cases: ${missing.join(", ")}`);

  let actionCorrect = 0; let exactPatternSets = 0; let patternDecisionCases = 0; let exactInteractionDecisions = 0; let presentationCorrect = 0;
  let presentationCases = 0; let presentationCorrectWhenSpecified = 0;
  let patternTp = 0; let patternFp = 0; let patternFn = 0;
  let clarifyTp = 0; let clarifyFp = 0; let clarifyFn = 0;
  let gateTp = 0; let gateFp = 0; let gateFn = 0;
  let hardGateFailures = 0; const hardGateFailureCases = [];
  for (const [id, item] of expected) {
    const gold = item.gold; const decision = actual.get(id);
    const expectedPatterns = new Set(gold.patterns); const predictedPatterns = new Set(decision.patterns);
    if (decision.action === gold.action) actionCorrect += 1;
    const patternSetCorrect = expectedPatterns.size === predictedPatterns.size && [...expectedPatterns].every((pattern) => predictedPatterns.has(pattern));
    if (gold.action === "recommend") {
      patternDecisionCases += 1;
      if (patternSetCorrect) exactPatternSets += 1;
    }
    if (decision.presentation === gold.presentation) presentationCorrect += 1;
    if (gold.presentation !== null) {
      presentationCases += 1;
      if (decision.presentation === gold.presentation) presentationCorrectWhenSpecified += 1;
    }
    if (decision.action === gold.action && decision.presentation === gold.presentation && patternSetCorrect) exactInteractionDecisions += 1;
    patternTp += [...predictedPatterns].filter((pattern) => expectedPatterns.has(pattern)).length;
    patternFp += [...predictedPatterns].filter((pattern) => !expectedPatterns.has(pattern)).length;
    patternFn += [...expectedPatterns].filter((pattern) => !predictedPatterns.has(pattern)).length;
    const expectedSlots = new Set(gold.clarificationSlots);
    const predictedSlots = decision.action === "clarify" ? new Set(decision.clarificationSlots) : new Set();
    clarifyTp += [...predictedSlots].filter((slot) => expectedSlots.has(slot)).length;
    clarifyFp += [...predictedSlots].filter((slot) => !expectedSlots.has(slot)).length;
    clarifyFn += [...expectedSlots].filter((slot) => !predictedSlots.has(slot)).length;
    const expectedGates = new Set(gold.requiredGates); const predictedGates = new Set(decision.gates);
    gateTp += [...predictedGates].filter((gate) => expectedGates.has(gate)).length;
    gateFp += [...predictedGates].filter((gate) => !expectedGates.has(gate)).length;
    gateFn += [...expectedGates].filter((gate) => !predictedGates.has(gate)).length;
    const violatedPattern = gold.prohibitedPatterns.some((pattern) => predictedPatterns.has(pattern));
    const missedGate = gold.requiredGates.some((gate) => !predictedGates.has(gate));
    const wrongBoundaryAction = (gold.action === "out_of_scope" && decision.action !== "out_of_scope") || (gold.action === "clarify" && decision.action === "recommend");
    if (violatedPattern || missedGate || wrongBoundaryAction) { hardGateFailures += 1; hardGateFailureCases.push(id); }
  }
  return {
    developmentOnly: true,
    cases: expected.size,
    actionAccuracy: actionCorrect / expected.size,
    exactPatternSetAccuracyAmongRecommendations: patternDecisionCases ? exactPatternSets / patternDecisionCases : null,
    patternDecisionCases,
    presentationAccuracy: presentationCorrect / expected.size,
    presentationAccuracyWhenSpecified: presentationCases ? presentationCorrectWhenSpecified / presentationCases : null,
    exactInteractionDecisionAccuracy: exactInteractionDecisions / expected.size,
    patternSetMicro: metrics(patternTp, patternFp, patternFn),
    clarificationSlotMicro: metrics(clarifyTp, clarifyFp, clarifyFn),
    safeguardGateMicro: metrics(gateTp, gateFp, gateFn),
    hardGateFailures,
    hardGateFailureCases,
    interpretation: "Descriptive development metrics only; no universal pass score or validated-performance claim. Review each hard-gate failure. Pattern, clarification, and safeguard metrics are separate and non-compensatory."
  };
}
async function main() {
  const args = process.argv.slice(2); const resultIndex = args.indexOf("--results");
  assert(resultIndex >= 0 && args[resultIndex + 1], "Usage: npm run eval:interaction-pattern-selection -- --results path/to/results.json");
  const root = new URL("./interaction-pattern-selection-cases.json", import.meta.url);
  const benchmark = validateBenchmark(JSON.parse(await readFile(root, "utf8")));
  const results = JSON.parse(await readFile(args[resultIndex + 1], "utf8"));
  console.log(JSON.stringify(scoreResults(benchmark, results), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
