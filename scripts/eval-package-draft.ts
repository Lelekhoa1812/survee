#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { INTERVIEW_PACKAGE_VERSION, INTERVIEW_PACKAGES } from "../src/lib/interview-packages";
import { checkHtml } from "../src/lib/diagnostics/static";

const DIMENSIONS = [
  "intent_coverage",
  "construct_and_question_design",
  "respondent_and_context_fit",
  "response_options_and_recall",
  "flow_and_burden",
  "privacy_and_risk",
  "analysis_and_interpretation",
  "review_record_and_evidence",
];
const ROLES = new Set(["domain", "methodologist", "accessibility", "respondent-proxy", "other"]);
const INTENT_STATUS = new Set(["covered", "partial", "missing", "unsupported"]);
const EVIDENCE_STATUS = new Set(["not_tested", "passed", "issues_found", "not_applicable"]);
const NONEMPTY = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function unique(values: unknown, label: string): asserts values is string[] {
  assert(Array.isArray(values) && values.every(NONEMPTY), `${label} must be an array of non-empty strings.`);
  assert(new Set(values).size === values.length, `${label} must not contain duplicates.`);
}

export function validateBenchmark(benchmark: any) {
  assert(benchmark?.benchmarkVersion === "kqa-package-draft/2", "Unsupported package-draft benchmark version.");
  assert(benchmark.track === "package-draft-review", "Benchmark track must be package-draft-review.");
  assert(benchmark.packageLibraryVersion === INTERVIEW_PACKAGE_VERSION, "Benchmark package-library version does not match the current catalog.");
  unique(benchmark.dimensions, "dimensions");
  assert(JSON.stringify(benchmark.dimensions) === JSON.stringify(DIMENSIONS), "Benchmark dimensions must match the versioned rubric.");
  const packageIds = new Set(INTERVIEW_PACKAGES.map((item) => item.id));
  assert(Array.isArray(benchmark.cases) && benchmark.cases.length >= packageIds.size, "Benchmark must cover every current interview package.");
  const caseIds = new Set<string>();
  for (const item of benchmark.cases) {
    assert(NONEMPTY(item.id) && !caseIds.has(item.id), `Missing or duplicate case id: ${item.id}`);
    caseIds.add(item.id);
    assert(packageIds.has(item.packageId), `${item.id}: unknown packageId ${item.packageId}.`);
    assert(NONEMPTY(item.brief), `${item.id}: brief is required.`);
    unique(item.requiredIntents?.map((intent: any) => intent.id), `${item.id}: required intent ids`);
    assert(item.requiredIntents.length > 0 && item.requiredIntents.every((intent: any) => NONEMPTY(intent.intent)), `${item.id}: each required intent needs an observable description.`);
    unique(item.hardGates?.map((gate: any) => gate.id), `${item.id}: hard gate ids`);
    assert(item.hardGates.length > 0 && item.hardGates.every((gate: any) => NONEMPTY(gate.description)), `${item.id}: each hard gate needs a description.`);
    assert(Array.isArray(item.prohibitedAsks) && Array.isArray(item.prohibitedClaims), `${item.id}: prohibited asks and claims must be arrays.`);
    assert(NONEMPTY(item.sourceNotes), `${item.id}: sourceNotes must explain how cited guidance informs the case.`);
    assert(Array.isArray(item.methodologySources) && item.methodologySources.length > 0 && item.methodologySources.every((source: any) => NONEMPTY(source.name) && typeof source.url === "string" && /^https:\/\//.test(source.url)), `${item.id}: methodologySources need named HTTPS citations.`);
  }
  assert([...packageIds].every((packageId) => benchmark.cases.some((item: any) => item.packageId === packageId)), "Benchmark must cover every current interview package.");
  assert(benchmark.ratingScale && ["0", "1", "2", "3"].every((score) => NONEMPTY(benchmark.ratingScale[score])), "Benchmark needs anchored 0–3 rating descriptions.");
  return benchmark;
}

function validateRunDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function validateResults(benchmark: any, results: any) {
  assert(results?.benchmarkVersion === benchmark.benchmarkVersion, "Result benchmarkVersion does not match the corpus.");
  assert(NONEMPTY(results.model) && NONEMPTY(results.skillVersion) && NONEMPTY(results.promptVersion), "Record model, skillVersion and promptVersion.");
  assert(results.packageLibraryVersion === benchmark.packageLibraryVersion, "Result packageLibraryVersion does not match the corpus.");
  assert(validateRunDate(results.runDate), "Record runDate as a valid YYYY-MM-DD date.");
  const expected = new Map<string, any>(benchmark.cases.map((item: any) => [item.id, item]));
  assert(Array.isArray(results.outputs), "Results need an outputs array with one HTML and review-record path per case.");
  const outputs = new Map<string, any>();
  for (const output of results.outputs) {
    assert(expected.has(output.caseId), `Unknown output case id: ${output.caseId}`);
    assert(!outputs.has(output.caseId), `Duplicate output case id: ${output.caseId}`);
    assert(NONEMPTY(output.htmlPath) && NONEMPTY(output.reviewPath), `${output.caseId}: htmlPath and reviewPath are required.`);
    outputs.set(output.caseId, output);
  }
  const missingOutputs = [...expected.keys()].filter((id) => !outputs.has(id));
  assert(missingOutputs.length === 0, `Results omit output artifacts for: ${missingOutputs.join(", ")}`);

  assert(Array.isArray(results.reviewers) && results.reviewers.length >= 2, "Use at least two independent reviewers per case.");
  const reviewers = new Map<string, any>();
  for (const reviewer of results.reviewers) {
    assert(NONEMPTY(reviewer.id) && !reviewers.has(reviewer.id), `Missing or duplicate reviewer id: ${reviewer.id}`);
    assert(ROLES.has(reviewer.role), `${reviewer.id}: unsupported reviewer role.`);
    reviewers.set(reviewer.id, reviewer);
  }
  const roles = new Set([...reviewers.values()].map((reviewer) => reviewer.role));
  assert(roles.has("domain") && roles.has("methodologist"), "Include at least one domain reviewer and one survey-methods reviewer.");

  assert(Array.isArray(results.ratings), "Results need a ratings array.");
  const ratingMap = new Map<string, any>();
  const caseById = new Map<string, any>(benchmark.cases.map((item: any) => [item.id, item]));
  for (const rating of results.ratings) {
    assert(expected.has(rating.caseId), `Unknown rating case id: ${rating.caseId}`);
    assert(reviewers.has(rating.reviewerId), `${rating.caseId}: unknown reviewer ${rating.reviewerId}.`);
    const key = `${rating.caseId}\u0000${rating.reviewerId}`;
    assert(!ratingMap.has(key), `${rating.caseId}: duplicate rating for ${rating.reviewerId}.`);
    assert(rating.dimensions && typeof rating.dimensions === "object", `${rating.caseId}: dimension ratings are required.`);
    assert(JSON.stringify(Object.keys(rating.dimensions).sort()) === JSON.stringify([...DIMENSIONS].sort()), `${rating.caseId}: rate every benchmark dimension exactly once.`);
    for (const dimension of DIMENSIONS) {
      const value = rating.dimensions[dimension];
      assert(Number.isInteger(value?.score) && value.score >= 0 && value.score <= 3, `${rating.caseId}/${dimension}: score must be an integer from 0 to 3.`);
      assert(NONEMPTY(value.evidence), `${rating.caseId}/${dimension}: cite artifact evidence for the rating.`);
    }
    const testCase = caseById.get(rating.caseId)!;
    const requiredIntentIds = new Set(testCase.requiredIntents.map((intent: any) => intent.id));
    assert(Array.isArray(rating.intentCoverage), `${rating.caseId}: intentCoverage is required.`);
    const intentIds = new Set<string>();
    for (const intent of rating.intentCoverage) {
      assert(requiredIntentIds.has(intent.intentId), `${rating.caseId}: unknown intent id ${intent.intentId}.`);
      assert(!intentIds.has(intent.intentId), `${rating.caseId}: duplicate intent rating ${intent.intentId}.`);
      assert(INTENT_STATUS.has(intent.status), `${rating.caseId}/${intent.intentId}: invalid intent status.`);
      assert(NONEMPTY(intent.evidence), `${rating.caseId}/${intent.intentId}: cite artifact evidence.`);
      intentIds.add(intent.intentId);
    }
    assert(intentIds.size === requiredIntentIds.size, `${rating.caseId}: rate every required intent exactly once.`);
    const gates = new Set(testCase.hardGates.map((gate: any) => gate.id));
    assert(Array.isArray(rating.hardGateFindings), `${rating.caseId}: hardGateFindings must be an array (use [] when none).`);
    const gateIds = new Set<string>();
    for (const finding of rating.hardGateFindings) {
      assert(gates.has(finding.gateId), `${rating.caseId}: unknown hard gate ${finding.gateId}.`);
      assert(!gateIds.has(finding.gateId), `${rating.caseId}: duplicate hard gate finding ${finding.gateId}.`);
      assert(NONEMPTY(finding.evidence), `${rating.caseId}/${finding.gateId}: cite evidence for a gate finding.`);
      gateIds.add(finding.gateId);
    }
    ratingMap.set(key, rating);
  }
  for (const caseId of expected.keys()) for (const reviewerId of reviewers.keys()) {
    assert(ratingMap.has(`${caseId}\u0000${reviewerId}`), `Missing independent rating for ${caseId} by ${reviewerId}.`);
  }
  assert(ratingMap.size === expected.size * reviewers.size, "Ratings contain unexpected or missing case/reviewer pairs.");

  assert(Array.isArray(results.evidenceStatus), "Results need separate functional, accessibility and respondent-pretest evidence statuses.");
  const evidenceByCase = new Map<string, any>();
  for (const record of results.evidenceStatus) {
    assert(expected.has(record.caseId) && !evidenceByCase.has(record.caseId), `Unknown or duplicate evidence status case: ${record.caseId}`);
    for (const lane of ["functional", "accessibility", "respondentPretest"]) {
      const evidence = record[lane];
      assert(evidence && EVIDENCE_STATUS.has(evidence.status), `${record.caseId}: ${lane} needs a valid status.`);
      if (["passed", "issues_found"].includes(evidence.status)) assert(NONEMPTY(evidence.evidence), `${record.caseId}/${lane}: record the method and evidence reference.`);
      if (evidence.status === "not_applicable") assert(NONEMPTY(evidence.evidence), `${record.caseId}/${lane}: explain why this evidence lane is not applicable.`);
    }
    evidenceByCase.set(record.caseId, record);
  }
  assert(evidenceByCase.size === expected.size, "Evidence status must cover every benchmark case exactly once.");
  assert(results.adjudications === undefined || Array.isArray(results.adjudications), "Adjudications must be an array when supplied.");
  const adjudications = results.adjudications ?? [];
  const adjudicationKeys = new Set<string>();
  const flaggedGateKeys = new Set<string>();
  for (const rating of ratingMap.values()) for (const finding of rating.hardGateFindings) flaggedGateKeys.add(`${rating.caseId}\u0000${finding.gateId}`);
  for (const record of adjudications) {
    assert(expected.has(record.caseId), `Adjudication has unknown case ${record.caseId}.`);
    const testCase = expected.get(record.caseId);
    assert(testCase.hardGates.some((gate: any) => gate.id === record.gateId), `${record.caseId}: unknown adjudicated gate ${record.gateId}.`);
    const key = `${record.caseId}\u0000${record.gateId}`;
    assert(flaggedGateKeys.has(key), `${record.caseId}/${record.gateId}: adjudication has no reviewer flag to resolve.`);
    assert(!adjudicationKeys.has(key), `${record.caseId}: duplicate adjudication for ${record.gateId}.`);
    assert(["confirmed", "cleared", "unresolved"].includes(record.outcome), `${record.caseId}/${record.gateId}: invalid adjudication outcome.`);
    assert(NONEMPTY(record.adjudicatorId) && NONEMPTY(record.evidence), `${record.caseId}/${record.gateId}: record adjudicator and rationale/evidence.`);
    adjudicationKeys.add(key);
  }
  return { expected, outputs, reviewers, ratingMap, evidenceByCase, adjudications };
}

function weightedKappa(pairs: Array<[number, number]>) {
  if (!pairs.length) return null;
  const size = 4;
  const observed = Array.from({ length: size }, () => Array(size).fill(0));
  const first = Array(size).fill(0); const second = Array(size).fill(0);
  for (const [a, b] of pairs) { observed[a][b] += 1; first[a] += 1; second[b] += 1; }
  const total = pairs.length;
  let observedAgreement = 0; let expectedAgreement = 0;
  for (let a = 0; a < size; a += 1) for (let b = 0; b < size; b += 1) {
    const weight = 1 - ((a - b) ** 2 / ((size - 1) ** 2));
    observedAgreement += weight * observed[a][b] / total;
    expectedAgreement += weight * first[a] * second[b] / (total ** 2);
  }
  return Math.abs(1 - expectedAgreement) < 1e-12 ? null : (observedAgreement - expectedAgreement) / (1 - expectedAgreement);
}

export function scoreResults(benchmark: any, results: any, artifactChecks: any[] = []) {
  validateBenchmark(benchmark);
  const validated = validateResults(benchmark, results);
  const dimensionResults: Record<string, any> = {};
  for (const dimension of DIMENSIONS) {
    const scores: number[] = [];
    const perCase: Record<string, number[]> = {};
    for (const item of benchmark.cases) {
      const caseScores: number[] = [];
      for (const reviewer of validated.reviewers.values()) caseScores.push(validated.ratingMap.get(`${item.id}\u0000${reviewer.id}`).dimensions[dimension].score);
      perCase[item.id] = caseScores;
      scores.push(...caseScores);
    }
    const pairwise: Array<[number, number]> = [];
    let exactMatches = 0; let comparisons = 0; let absoluteDifference = 0;
    const reviewerIds = [...validated.reviewers.keys()];
    for (const item of benchmark.cases) for (let i = 0; i < reviewerIds.length; i += 1) for (let j = i + 1; j < reviewerIds.length; j += 1) {
      const a = validated.ratingMap.get(`${item.id}\u0000${reviewerIds[i]}`).dimensions[dimension].score;
      const b = validated.ratingMap.get(`${item.id}\u0000${reviewerIds[j]}`).dimensions[dimension].score;
      pairwise.push([a, b]); comparisons += 1; absoluteDifference += Math.abs(a - b); if (a === b) exactMatches += 1;
    }
    dimensionResults[dimension] = {
      meanScore: scores.reduce((sum, score) => sum + score, 0) / scores.length,
      n: scores.length,
      distribution: Object.fromEntries([0, 1, 2, 3].map((score) => [score, scores.filter((value) => value === score).length])),
      pairwiseReviewerAgreement: comparisons ? exactMatches / comparisons : null,
      meanAbsoluteReviewerDifference: comparisons ? absoluteDifference / comparisons : null,
      quadraticWeightedKappa: weightedKappa(pairwise),
      perCaseReviewerScores: perCase,
    };
  }
  const intentCounts: Record<string, any> = {};
  const hardGateFlags: any[] = [];
  for (const item of benchmark.cases) {
    for (const intent of item.requiredIntents) intentCounts[intent.id] ??= { covered: 0, partial: 0, missing: 0, unsupported: 0, n: 0 };
    for (const reviewer of validated.reviewers.values()) {
      const rating = validated.ratingMap.get(`${item.id}\u0000${reviewer.id}`);
      for (const intent of rating.intentCoverage) { intentCounts[intent.intentId][intent.status] += 1; intentCounts[intent.intentId].n += 1; }
      for (const gate of rating.hardGateFindings) hardGateFlags.push({ caseId: item.id, reviewerId: reviewer.id, ...gate });
    }
  }
  const adjudicationMap = new Map<string, any>(validated.adjudications.map((record: any) => [`${record.caseId}\u0000${record.gateId}`, record]));
  const unresolvedHardGateFlags = hardGateFlags.filter((finding) => adjudicationMap.get(`${finding.caseId}\u0000${finding.gateId}`)?.outcome !== "cleared");
  return {
    benchmarkVersion: benchmark.benchmarkVersion,
    track: benchmark.track,
    developmentOnly: true,
    run: { model: results.model, skillVersion: results.skillVersion, promptVersion: results.promptVersion, packageLibraryVersion: results.packageLibraryVersion, runDate: results.runDate },
    cases: benchmark.cases.map((item: any) => ({ caseId: item.id, packageId: item.packageId, htmlPath: validated.outputs.get(item.id).htmlPath, reviewPath: validated.outputs.get(item.id).reviewPath, evidenceStatus: validated.evidenceByCase.get(item.id) })),
    dimensions: dimensionResults,
    requiredIntentStatusCounts: intentCounts,
    hardGateReview: { reviewerFlags: hardGateFlags, adjudications: validated.adjudications, unresolvedFlags: unresolvedHardGateFlags, unresolvedFlagCount: unresolvedHardGateFlags.length, flaggedCaseCount: new Set(hardGateFlags.map((finding) => finding.caseId)).size, interpretation: "A gate flag is a non-compensatory review trigger. A documented cleared outcome resolves that flag; confirmed or unresolved flags remain release blockers. High dimension scores cannot offset a gate." },
    staticFormatChecks: artifactChecks,
    limitations: [
      "This is a public synthetic development corpus, not a hidden holdout or validation of a model, prompt, package, instrument, or respondent outcome.",
      "Dimension means and reviewer agreement are descriptive; they are not universal pass thresholds. Inspect the raw ratings, evidence, disagreements, and gate flags.",
      "KQA static checks, functional-path tests, accessibility review, and respondent pretesting are separate evidence lanes and are not combined into content scores.",
    ],
  };
}

export async function auditArtifacts(benchmark: any, results: any, cwd = process.cwd()) {
  validateBenchmark(benchmark);
  const validated = validateResults(benchmark, results);
  const checks = [];
  for (const item of benchmark.cases) {
    const output = validated.outputs.get(item.id);
    const htmlPath = path.resolve(cwd, output.htmlPath);
    const reviewPath = path.resolve(cwd, output.reviewPath);
    const [html, review] = await Promise.all([readFile(htmlPath, "utf8"), readFile(reviewPath, "utf8")]);
    const report = checkHtml(html, { fileName: path.basename(htmlPath) });
    checks.push({
      caseId: item.id,
      htmlPath: output.htmlPath,
      reviewPath: output.reviewPath,
      htmlSha256: createHash("sha256").update(html).digest("hex"),
      reviewSha256: createHash("sha256").update(review).digest("hex"),
      staticFormat: {
        hasErrors: report.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
        errors: report.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
        warnings: report.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
        notes: report.diagnostics.filter((diagnostic) => diagnostic.severity === "info").length,
        diagnostics: report.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })),
      },
    });
  }
  return checks;
}

async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--results");
  assert(index >= 0 && args[index + 1] && !args[index + 1].startsWith("--"), "Usage: npm run eval:package-draft -- --results path/to/results.json [--benchmark path]");
  const benchmarkIndex = args.indexOf("--benchmark");
  const benchmarkPath = benchmarkIndex >= 0 ? args[benchmarkIndex + 1] : "docs/evals/package-draft-cases.json";
  assert(NONEMPTY(benchmarkPath), "--benchmark needs a path.");
  const [benchmark, results] = await Promise.all([benchmarkPath, args[index + 1]].map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  validateBenchmark(benchmark);
  const staticChecks = await auditArtifacts(benchmark, results);
  process.stdout.write(`${JSON.stringify(scoreResults(benchmark, results, staticChecks), null, 2)}\n`);
}

if (process.argv[1]?.endsWith("eval-package-draft.ts")) {
  main().catch((error) => { process.stderr.write(`Package-draft evaluation failed: ${error.message}\n`); process.exitCode = 1; });
}
