// Saves that arrive at the same moment must all be kept. Usage: node scripts/concurrency-check.mjs <baseUrl> <token>
// The token must belong to a person on the starter template who has not submitted.
import { assertSafeMutatingTestTarget } from "./lib/mutating-test-target.mjs";

const [base = "http://localhost:3100", token] = process.argv.slice(2);
if (!token) { console.error("Usage: node scripts/concurrency-check.mjs <baseUrl> <token>"); process.exit(2); }
assertSafeMutatingTestTarget(base, "answer concurrency check");
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
const getState = async () => {
  const response = await fetch(`${base}/api/p/${token}`);
  const data = await response.json();
  if (!response.ok || !Number.isSafeInteger(data.version) || data.version < 1) throw new Error(`Could not read a current respondent version (${response.status}).`);
  return data;
};
const put = (version, answers) => fetch(`${base}/api/p/${token}/answers`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version, answers }) });

const initial = await getState();
const version = initial.version;
const patches = [
  { priority: { value: "cost" } },
  { channels: { value: ["email", "events"] } },
  { company: { value: "Concurrent Pty Ltd" } },
  { goal: { value: "Keep every answer" } },
  { "team-size": { value: 12 } },
  { confidence: { value: 4 } },
  { "start-date": { value: "2026-12-01" } },
  { region: { value: "anz" } },
];
for (let round = 1; round <= 3; round++) {
  const reset = await put(version, Object.fromEntries(Object.keys(Object.assign({}, ...patches)).map((k) => [k, { value: null }])));
  if (!reset.ok) throw new Error(`Could not reset test answers for round ${round} (${reset.status}).`);
  const results = await Promise.all(patches.map((patch) => put(version, patch)));
  const saved = (await getState()).answers;
  const keys = patches.map((p) => Object.keys(p)[0]);
  const missing = keys.filter((k) => saved[k]?.value === undefined);
  check(`round ${round}: ${patches.length} simultaneous saves all kept`, results.every((r) => r.ok) && missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : "");
}
process.exit(failed ? 1 : 0);
