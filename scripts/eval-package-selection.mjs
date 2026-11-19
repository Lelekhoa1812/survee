#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ACTIONS = new Set(["recommend", "clarify", "out_of_scope"]);
const NONEMPTY = (v) => typeof v === "string" && v.trim().length > 0;
const ISO_DATE = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;
function assert(ok, message) { if (!ok) throw new Error(message); }
function uniqueStrings(values, label) {
  assert(Array.isArray(values) && values.every(NONEMPTY), `${label} must be an array of non-empty strings.`);
  assert(new Set(values).size === values.length, `${label} must not contain duplicates.`);
}

export function validateBenchmark(benchmark) {
  assert(benchmark && benchmark.benchmarkVersion === "kqa-package-selection/3", "Unsupported benchmarkVersion.");
  assert(benchmark.track === "package-selection", "track must be package-selection.");
  uniqueStrings(benchmark.packageIds, "packageIds");
  assert(Array.isArray(benchmark.allowedActions) && benchmark.allowedActions.length === ACTIONS.size && benchmark.allowedActions.every((x) => ACTIONS.has(x)), "allowedActions must declare all supported actions.");
  uniqueStrings(benchmark.allowedGates, "allowedGates");
  assert(Array.isArray(benchmark.cases) && benchmark.cases.length > 0, "cases must be a non-empty array.");
  const ids = new Set();
  for (const c of benchmark.cases) {
    assert(NONEMPTY(c.id) && !ids.has(c.id), `Missing or duplicate case id: ${c.id}`); ids.add(c.id);
    assert(NONEMPTY(c.brief), `${c.id}: brief is required.`);
    const g = c.gold;
    assert(g && ACTIONS.has(g.action), `${c.id}: invalid gold action.`);
    uniqueStrings(g.acceptablePackageIds, `${c.id}: acceptablePackageIds`);
    uniqueStrings(g.clarificationSlots, `${c.id}: clarificationSlots`);
    uniqueStrings(g.requiredGates, `${c.id}: requiredGates`);
    assert([...g.acceptablePackageIds, ...(g.candidatePackageIds ?? [])].every((id) => benchmark.packageIds.includes(id)), `${c.id}: unknown package ID.`);
    assert(g.requiredGates.every((gate) => benchmark.allowedGates.includes(gate)), `${c.id}: unknown required gate.`);
    if (g.action === "recommend") {
      assert(NONEMPTY(g.packageId) && g.acceptablePackageIds.includes(g.packageId), `${c.id}: recommendation needs an accepted packageId.`);
      assert(g.clarificationSlots.length === 0, `${c.id}: recommendation cannot require clarification slots.`);
    } else {
      assert(g.packageId === null && g.acceptablePackageIds.length === 0, `${c.id}: non-recommendation cannot specify a packageId.`);
    }
    if (g.action === "clarify") {
      uniqueStrings(g.candidatePackageIds, `${c.id}: candidatePackageIds`);
      assert(g.candidatePackageIds.length >= 2 && g.clarificationSlots.length > 0, `${c.id}: clarify needs at least two candidates and a clarification slot.`);
    } else assert(g.candidatePackageIds === undefined || g.candidatePackageIds.length === 0, `${c.id}: only clarify may specify candidates.`);
    if (g.action === "out_of_scope") assert(g.requiredGates.length > 0, `${c.id}: out_of_scope must name the boundary gate(s).`);
  }
  return benchmark;
}

export function scoreResults(benchmark, results) {
  validateBenchmark(benchmark);
  assert(results && results.benchmarkVersion === benchmark.benchmarkVersion, "Result benchmarkVersion does not match corpus.");
  assert(NONEMPTY(results.model) && ISO_DATE(results.runDate), "Record model and runDate as YYYY-MM-DD.");
  assert(NONEMPTY(results.promptVersion) && NONEMPTY(results.packageLibraryVersion), "Record promptVersion and packageLibraryVersion.");
  assert(Array.isArray(results.cases), "Results need a cases array.");
  const expected = new Map(benchmark.cases.map((c) => [c.id, c])); const actual = new Map();
  for (const row of results.cases) {
    assert(row && typeof row === "object", "Each result row must be an object.");
    assert(expected.has(row.caseId), `Unknown result case id: ${row.caseId}`);
    assert(!actual.has(row.caseId), `Duplicate result case id: ${row.caseId}`);
    assert(row && row.decision && ACTIONS.has(row.decision.action), `${row.caseId}: invalid decision action.`);
    const d = row.decision;
    assert(d.packageId === null || NONEMPTY(d.packageId), `${row.caseId}: packageId must be null or non-empty.`);
    uniqueStrings(d.candidatePackageIds, `${row.caseId}: candidatePackageIds`);
    uniqueStrings(d.clarificationSlots, `${row.caseId}: clarificationSlots`);
    uniqueStrings(d.gates, `${row.caseId}: gates`);
    assert([...(d.packageId ? [d.packageId] : []), ...d.candidatePackageIds].every((id) => benchmark.packageIds.includes(id)), `${row.caseId}: unknown package ID.`);
    assert(d.gates.every((gate) => benchmark.allowedGates.includes(gate)), `${row.caseId}: unknown gate.`);
    if (d.action === "recommend") {
      assert(NONEMPTY(d.packageId), `${row.caseId}: recommend needs packageId.`);
      assert(d.candidatePackageIds.length === 0 && d.clarificationSlots.length === 0, `${row.caseId}: recommend cannot include clarification candidates or slots.`);
    } else {
      assert(d.packageId === null, `${row.caseId}: non-recommend action packageId must be null.`);
      if (d.action === "clarify") assert(d.candidatePackageIds.length >= 2 && d.clarificationSlots.length > 0, `${row.caseId}: clarify needs at least two candidates and a clarification slot.`);
      else assert(d.candidatePackageIds.length === 0 && d.clarificationSlots.length === 0, `${row.caseId}: out_of_scope cannot include clarification candidates or slots.`);
    }
    actual.set(row.caseId, d);
  }
  const missing = [...expected.keys()].filter((id) => !actual.has(id));
  assert(missing.length === 0, `Results omit benchmark cases: ${missing.join(", ")}`);

  let actionCorrect = 0; let packageCorrect = 0; let candidateTp = 0; let candidateFp = 0; let candidateFn = 0;
  let slotTp = 0; let slotFp = 0; let slotFn = 0; let hardGateFailures = 0;
  const gateFailureCases = [];
  for (const [id, c] of expected) {
    const g = c.gold; const d = actual.get(id);
    const actionHit = d.action === g.action;
    if (actionHit) actionCorrect += 1;
    if (d.action === "recommend" && g.acceptablePackageIds.includes(d.packageId)) packageCorrect += 1;
    let failed = false;
    if (g.action === "out_of_scope" && d.action !== "out_of_scope") failed = true;
    if (g.action === "recommend" && d.action === "recommend" && !g.acceptablePackageIds.includes(d.packageId)) failed = true;
    if (g.requiredGates.some((gate) => !d.gates.includes(gate))) failed = true;
    if (g.action === "clarify") {
      const predictedCandidates = d.action === "clarify" ? d.candidatePackageIds : [];
      const predictedSlots = d.action === "clarify" ? d.clarificationSlots : [];
      const candidateSet = new Set(g.candidatePackageIds);
      const slotSet = new Set(g.clarificationSlots);
      candidateTp += predictedCandidates.filter((item) => candidateSet.has(item)).length;
      candidateFp += predictedCandidates.filter((item) => !candidateSet.has(item)).length;
      candidateFn += g.candidatePackageIds.filter((item) => !predictedCandidates.includes(item)).length;
      slotTp += predictedSlots.filter((item) => slotSet.has(item)).length;
      slotFp += predictedSlots.filter((item) => !slotSet.has(item)).length;
      slotFn += g.clarificationSlots.filter((item) => !predictedSlots.includes(item)).length;
    }
    if (failed) { hardGateFailures += 1; gateFailureCases.push(id); }
  }
  const precision = (tp, fp) => tp + fp ? tp / (tp + fp) : 0;
  const recall = (tp, fn) => tp + fn ? tp / (tp + fn) : null;
  const f1 = (p, r) => p === null || r === null ? null : p + r === 0 ? 0 : 2 * p * r / (p + r);
  const candidatePrecision = precision(candidateTp, candidateFp);
  const candidateRecall = recall(candidateTp, candidateFn);
  const slotPrecision = precision(slotTp, slotFp);
  const slotRecall = recall(slotTp, slotFn);
  return {
    developmentOnly: true,
    cases: expected.size,
    actionAccuracy: actionCorrect / expected.size,
    packageAccuracyAmongRecommendations: packageCorrect / Math.max(1, [...expected.keys()].filter((id) => actual.get(id).action === "recommend").length),
    clarificationCandidatePrecision: candidatePrecision,
    clarificationCandidateRecall: candidateRecall,
    clarificationCandidateF1: f1(candidatePrecision, candidateRecall),
    clarificationCandidateAveraging: "micro across clarify cases",
    clarificationSlotPrecision: slotPrecision,
    clarificationSlotRecall: slotRecall,
    clarificationSlotF1: f1(slotPrecision, slotRecall),
    clarificationSlotAveraging: "micro across clarify cases",
    hardGateFailures,
    hardGateFailureCases: gateFailureCases,
    interpretation: "Descriptive development metrics only; no universal pass score or validated-performance claim. Hard-gate failures must be reviewed individually and cannot be offset by other scores."
  };
}

async function main() {
  const args = process.argv.slice(2); const resultIndex = args.indexOf("--results");
  assert(resultIndex >= 0 && args[resultIndex + 1], "Usage: npm run eval:package-selection -- --results path/to/results.json");
  const root = new URL("../docs/evals/package-selection-cases.json", import.meta.url);
  const benchmark = validateBenchmark(JSON.parse(await readFile(root, "utf8")));
  const results = JSON.parse(await readFile(args[resultIndex + 1], "utf8"));
  console.log(JSON.stringify(scoreResults(benchmark, results), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
