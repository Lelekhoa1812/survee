import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  values: new Map<string, string>(),
  headers: vi.fn(async () => ({ get: (name: string) => mocks.values.get(name.toLowerCase()) ?? null })),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: vi.fn() }));

import { sameOrigin } from "../src/lib/http";

function setHeaders(values: Record<string, string>) {
  mocks.values = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]));
}

beforeEach(() => setHeaders({
  origin: "https://kqa.example",
  host: "kqa.example",
  "x-forwarded-proto": "https",
}));

describe("sameOrigin", () => {
  it("accepts a normalized matching origin, host, and forwarded protocol", async () => {
    setHeaders({ origin: "https://KQA.EXAMPLE", host: "kqa.example", "x-forwarded-proto": "https" });
    expect(await sameOrigin()).toBe(true);
  });

  it("rejects a protocol mismatch even when the hostname matches", async () => {
    setHeaders({ origin: "http://kqa.example", host: "kqa.example", "x-forwarded-proto": "https" });
    expect(await sameOrigin()).toBe(false);
  });

  it("rejects a hostname suffix lookalike and origins with credentials", async () => {
    setHeaders({ origin: "https://kqa.example.attacker.test", host: "kqa.example", "x-forwarded-proto": "https" });
    expect(await sameOrigin()).toBe(false);
    setHeaders({ origin: "https://user@kqa.example", host: "kqa.example", "x-forwarded-proto": "https" });
    expect(await sameOrigin()).toBe(false);
  });

  it("uses the first trusted forwarded host and protocol values", async () => {
    setHeaders({ origin: "https://kqa.example", host: "internal:3000", "x-forwarded-host": "kqa.example, proxy.internal", "x-forwarded-proto": "https, http" });
    expect(await sameOrigin()).toBe(true);
  });

  it("fails closed when the forwarded protocol is missing or unsupported", async () => {
    setHeaders({ origin: "https://kqa.example", host: "kqa.example" });
    expect(await sameOrigin()).toBe(false);
    setHeaders({ origin: "https://kqa.example", host: "kqa.example", "x-forwarded-proto": "ftp" });
    expect(await sameOrigin()).toBe(false);
  });
});
