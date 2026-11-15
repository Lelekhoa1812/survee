import { describe, expect, it } from "vitest";
import { assertSafeMutatingTestTarget, isLocalTestTarget } from "../scripts/lib/mutating-test-target.mjs";

describe("mutating browser-test target guard", () => {
  it("allows loopback development targets without remote flags", () => {
    expect(isLocalTestTarget("http://localhost:3100")).toBe(true);
    expect(assertSafeMutatingTestTarget("http://127.0.0.1:3100", "test").origin).toBe("http://127.0.0.1:3100");
    expect(assertSafeMutatingTestTarget("http://[::1]:3100", "test").origin).toBe("http://[::1]:3100");
  });

  it("requires a remote opt-in bound to the exact HTTPS origin", () => {
    expect(() => assertSafeMutatingTestTarget("https://staging.example.com", "test", {})).toThrow(/refusing remote target/);
    expect(() => assertSafeMutatingTestTarget("https://staging.example.com", "test", {
      KQA_E2E_ALLOW_REMOTE_MUTATIONS: "1",
      KQA_E2E_CONFIRM_ORIGIN: "https://other.example.com",
    })).toThrow(/exact origin/);
    expect(assertSafeMutatingTestTarget("https://staging.example.com", "test", {
      KQA_E2E_ALLOW_REMOTE_MUTATIONS: "1",
      KQA_E2E_CONFIRM_ORIGIN: "https://staging.example.com",
    }).origin).toBe("https://staging.example.com");
  });

  it("requires a second explicit switch for the primary production host", () => {
    const env = {
      KQA_E2E_ALLOW_REMOTE_MUTATIONS: "1",
      KQA_E2E_CONFIRM_ORIGIN: "https://kqa-bay.vercel.app",
    };
    expect(() => assertSafeMutatingTestTarget("https://kqa-bay.vercel.app", "test", env)).toThrow(/primary production host/);
    expect(() => assertSafeMutatingTestTarget("https://kqa-bay.vercel.app.", "test", {
      ...env,
      KQA_E2E_CONFIRM_ORIGIN: "https://kqa-bay.vercel.app.",
    })).toThrow(/primary production host/);
    expect(assertSafeMutatingTestTarget("https://kqa-bay.vercel.app", "test", {
      ...env,
      KQA_E2E_ALLOW_PRODUCTION_MUTATIONS: "1",
    }).hostname).toBe("kqa-bay.vercel.app");
  });

  it("rejects non-HTTPS remote targets and embedded credentials", () => {
    expect(() => assertSafeMutatingTestTarget("http://staging.example.com", "test", {})).toThrow(/must use HTTPS/);
    expect(() => assertSafeMutatingTestTarget("https://user:pass@staging.example.com", "test", {})).toThrow(/must not contain credentials/);
  });
});
