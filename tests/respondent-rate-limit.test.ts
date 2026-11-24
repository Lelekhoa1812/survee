import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ consumeRateLimit: vi.fn(async () => true) }));
vi.mock("@/lib/repo", () => ({ consumeRateLimit: state.consumeRateLimit }));
vi.mock("@/lib/http", () => ({
  fail: (status: number, error: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ ok: false, error, ...extra }), { status }),
}));

import { respondentRateLimit } from "../src/lib/respondent-rate-limit";

const token = "sensitive-respondent-token";

beforeEach(() => {
  state.consumeRateLimit.mockReset().mockResolvedValue(true);
});

describe("respondent API rate limits", () => {
  it("uses separate bounded token and platform IP buckets for each action", async () => {
    const req = new Request("https://kqa.example/api/p/token", { headers: { "x-vercel-forwarded-for": "192.0.2.4, 10.0.0.2" } });

    expect(await respondentRateLimit(req, token, "load")).toBeNull();
    expect(state.consumeRateLimit.mock.calls).toEqual([
      ["respondent-load-ip:192.0.2.4", 1800, 15],
      [`respondent-load-token:${token}`, 180, 15],
    ]);
  });

  it("limits repeated questionnaire frame loads too", async () => {
    const req = new Request("https://kqa.example/api/frame/token", { headers: { "x-vercel-forwarded-for": "192.0.2.4" } });

    expect(await respondentRateLimit(req, token, "frame")).toBeNull();
    expect(state.consumeRateLimit.mock.calls).toEqual([
      ["respondent-frame-ip:192.0.2.4", 1800, 15],
      [`respondent-frame-token:${token}`, 180, 15],
    ]);
  });

  it("does not trust caller supplied forwarding headers when the platform IP header is absent", async () => {
    const req = new Request("https://kqa.example/api/p/token", { headers: { "x-forwarded-for": "203.0.113.5" } });

    expect(await respondentRateLimit(req, token, "save")).toBeNull();
    expect(state.consumeRateLimit.mock.calls).toEqual([[`respondent-save-token:${token}`, 600, 15]]);
  });

  it("returns 429 when any applicable bucket is exhausted", async () => {
    state.consumeRateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const req = new Request("https://kqa.example/api/p/token", { headers: { "x-vercel-forwarded-for": "192.0.2.4" } });

    const response = await respondentRateLimit(req, token, "submit");

    expect(response?.status).toBe(429);
    await expect(response?.json()).resolves.toMatchObject({ code: "rate_limited" });
  });

  it("does not allocate a new token bucket after the source IP budget is exhausted", async () => {
    state.consumeRateLimit.mockResolvedValueOnce(false);
    const req = new Request("https://kqa.example/api/p/token", { headers: { "x-vercel-forwarded-for": "192.0.2.4" } });

    const response = await respondentRateLimit(req, "random-nonexistent-token", "load");

    expect(response?.status).toBe(429);
    expect(state.consumeRateLimit.mock.calls).toEqual([["respondent-load-ip:192.0.2.4", 1800, 15]]);
  });

  it("fails closed with 503 when the shared limiter is unavailable", async () => {
    state.consumeRateLimit.mockRejectedValue(new Error("database unavailable"));

    const response = await respondentRateLimit(new Request("https://kqa.example/api/p/token"), token, "load");

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({ code: "rate_limit_unavailable" });
  });
});
