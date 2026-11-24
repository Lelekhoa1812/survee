import { describe, expect, it, vi } from "vitest";
import { clearClientOperationId, clientOperationId } from "../src/lib/client-idempotency";
import { isValidOperationId, operationArgumentDigest, requestOperationId } from "../src/lib/operation-id";

describe("operation id helpers", () => {
  it("validates bounded keys and reads the standard header", () => {
    expect(isValidOperationId("0b6ed27f-fae7-4b65-bfef-568171b5b8b6")).toBe(true);
    expect(isValidOperationId("bad key")).toBe(false);
    expect(isValidOperationId("x".repeat(129))).toBe(false);
    expect(requestOperationId(new Request("https://local", { headers: { "Idempotency-Key": "retry-1" } }))).toBe("retry-1");
    expect(requestOperationId(new Request("https://local"))).toBeNull();
  });

  it("digests object arguments independently of property order", () => {
    expect(operationArgumentDigest({ a: 1, b: { x: true, y: [2, 3] } })).toBe(operationArgumentDigest({ b: { y: [2, 3], x: true }, a: 1 }));
    expect(operationArgumentDigest({ a: 1 })).not.toBe(operationArgumentDigest({ a: 2 }));
  });

  it("reuses a key for the same payload, rotates for changed payloads, and clears after success", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    try {
      const body = { name: "Sensitive interview name", html: "private questionnaire" };
      const first = await clientOperationId("create-interview", body);
      const retry = await clientOperationId("create-interview", body);
      expect(retry).toEqual(first);
      const changed = await clientOperationId("create-interview", { ...body, name: "Changed" });
      expect(changed.operationId).not.toBe(first.operationId);
      expect([...values.values()].join(" ")).not.toContain("Sensitive interview name");
      expect([...values.values()].join(" ")).not.toContain("private questionnaire");
      clearClientOperationId("create-interview", first.fingerprint);
      expect((await clientOperationId("create-interview", body)).operationId).not.toBe(first.operationId);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
