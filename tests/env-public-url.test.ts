import { afterEach, describe, expect, it, vi } from "vitest";
import { publicBaseUrl } from "../src/lib/env";

afterEach(() => vi.unstubAllEnvs());

describe("public email link origin", () => {
  it("allows localhost HTTP in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KQA_PUBLIC_URL", "http://localhost:3000/path");
    expect(publicBaseUrl()).toEqual({ ok: true, origin: "http://localhost:3000" });
  });

  it("requires HTTPS in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KQA_PUBLIC_URL", "http://kqa.example");
    expect(publicBaseUrl()).toEqual({ ok: false, error: "KQA_PUBLIC_URL must use https:// in production." });
  });

  it("accepts HTTPS in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KQA_PUBLIC_URL", "https://kqa.example");
    expect(publicBaseUrl()).toEqual({ ok: true, origin: "https://kqa.example" });
  });
});
