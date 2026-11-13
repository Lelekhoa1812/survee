// Saves that arrive at the same moment must all be kept. Usage: node scripts/concurrency-check.mjs <baseUrl> <token>
// The token must belong to a person on the starter template who has not submitted.
const [base = "http://localhost:3100", token] = process.argv.slice(2);
if (!token) { console.error("Usage: node scripts/concurrency-check.mjs <baseUrl> <token>"); process.exit(2); }
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
const put = (answers) => fetch(`${base}/api/p/${token}/answers`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) });
const get = async () => (await (await fetch(`${base}/api/p/${token}`)).json()).answers;

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
  await put(Object.fromEntries(Object.keys(Object.assign({}, ...patches)).map((k) => [k, { value: null }])));
  const results = await Promise.all(patches.map(put));
  const saved = await get();
  const keys = patches.map((p) => Object.keys(p)[0]);
  const missing = keys.filter((k) => saved[k]?.value === undefined);
  check(`round ${round}: ${patches.length} simultaneous saves all kept`, results.every((r) => r.ok) && missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : "");
}
process.exit(failed ? 1 : 0);
