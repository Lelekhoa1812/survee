import { describe, expect, it, vi } from "vitest";

// A bare-string answer entry used to throw inside saveAnswers (`"value" in entry`), which surfaced as an HTTP 500.
// The guard runs before any database access, so the database mock fails the test if it is ever reached.
vi.mock("../src/lib/db", () => ({
  withMongoTransaction: async () => { throw new Error("database must not be reached for malformed entries"); },
  col: new Proxy({}, { get: () => async () => { throw new Error("database must not be reached for malformed entries"); } }),
}));

import { saveAnswers } from "../src/lib/repo";

const token = "a".repeat(24);

describe("saveAnswers entry shape", () => {
  it.each([
    ["a bare string", { "focus-area": "learning" }],
    ["a number", { "focus-area": 3 }],
    ["an array", { "focus-area": ["learning"] }],
    ["a boolean alongside a valid entry", { "focus-area": true, other: { value: "x" } }],
  ])("rejects %s with a 400 instead of throwing", async (_label, patch) => {
    const result = await saveAnswers(token, 1, patch as never);
    expect(result).toEqual({ ok: false, status: 400, error: "Send each answer as an object with a value or note.", code: "invalid_args" });
  });

  it("still accepts null as a clear marker for the shape check", async () => {
    // null passes the shape guard; it then reaches the database, which the mock refuses. Confirm it got past the guard.
    await expect(saveAnswers(token, 1, { "focus-area": null } as never)).rejects.toThrow("database must not be reached");
  });
});
