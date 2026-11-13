// Black-box checks for the properties the security review found and we fixed. Needs the dev or production server.
// Usage: node scripts/security-check.mjs <baseUrl> [adminEmail] [adminPassword] [--throttle]
const [base = "http://localhost:3100", email = "admin@axion.local", password = "12345678"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const origin = new URL(base).origin;
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("kqa_admin="));
const post = (path, body, cookie, extra = {}) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: JSON.stringify(body) });

// 1. logout really ends the session, even for a copied cookie
const login = await post("/api/admin/login", { email, password });
const cookie = cookieOf(login);
check("can sign in", login.status === 200 && !!cookie, String(login.status));
const before = await fetch(base + "/api/admin/interviews", { headers: { Cookie: cookie } });
check("session works before logout", before.status === 200);
await post("/api/admin/logout", {}, cookie);
const after = await fetch(base + "/api/admin/interviews", { headers: { Cookie: cookie } });
check("a copied cookie is rejected after logout", after.status === 401, String(after.status));

// 2. rotating X-Forwarded-For no longer defeats the throttle. Slow (about 200 requests) and it locks sign-in for 15
// minutes afterwards, so it only runs with --throttle.
const withThrottle = process.argv.includes("--throttle");
let blockedAt = 0;
for (let i = 1; withThrottle && i <= 230; i++) {
  const r = await post("/api/admin/login", { email, password: "wrong-" + i }, undefined, { "X-Forwarded-For": `10.0.${i}.${i}` });
  if (r.status === 429) { blockedAt = i; break; }
}
if (withThrottle) check("failed logins are throttled even when X-Forwarded-For is rotated", blockedAt > 0 && blockedAt <= 215, `blocked at attempt ${blockedAt || "never"}`);

// 3. unauthenticated and cross-origin requests are refused
check("admin API needs a session", (await fetch(base + "/api/admin/interviews")).status === 401);
const evil = await fetch(base + "/api/admin/logout", { method: "POST", headers: { Origin: "https://evil.example" } });
check("cross-origin mutation is refused", evil.status === 403 || evil.status === 401, String(evil.status));

// 4. oversized bodies are refused without buffering them
const big = await fetch(base + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: "x".repeat(20000) });
check("oversized login body is refused", big.status === 413, String(big.status));
process.exit(failed ? 1 : 0);
