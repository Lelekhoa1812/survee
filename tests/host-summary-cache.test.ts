import { describe, expect, it, vi } from "vitest";
import { getCachedHostSummary, type HostSummaryCacheKey } from "../src/lib/analytics/host-summary-cache";

const key: HostSummaryCacheKey = { tenantId: "tenant-1", interviewId: "interview-1", surveyVersion: 2, respondentRevision: 4 };

describe("host analysis summary cache", () => {
  it("coalesces concurrent scans and reuses the bounded aggregate for the same revision", async () => {
    const compute = vi.fn(async () => ({ total: 42 }));
    const [first, second] = await Promise.all([
      getCachedHostSummary(key, compute),
      getCachedHostSummary(key, compute),
    ]);

    expect(first).toEqual({ total: 42 });
    expect(second).toBe(first);
    await expect(getCachedHostSummary(key, compute)).resolves.toBe(first);
    expect(compute).toHaveBeenCalledOnce();
  });

  it("does not reuse summaries across tenants, survey versions, or respondent revisions", async () => {
    const compute = vi.fn(async () => ({ total: 1 }));
    const isolatedKey = { ...key, interviewId: "scope-isolation" };
    await getCachedHostSummary(isolatedKey, compute);
    await getCachedHostSummary({ ...isolatedKey, tenantId: "tenant-2" }, compute);
    await getCachedHostSummary({ ...isolatedKey, surveyVersion: 3 }, compute);
    await getCachedHostSummary({ ...isolatedKey, respondentRevision: 5 }, compute);
    expect(compute).toHaveBeenCalledTimes(4);
  });

  it("does not retain oversized or failed summaries", async () => {
    const large = vi.fn(async () => ({ text: "x".repeat(140 * 1024) }));
    await getCachedHostSummary({ ...key, interviewId: "oversized" }, large);
    await getCachedHostSummary({ ...key, interviewId: "oversized" }, large);
    expect(large).toHaveBeenCalledTimes(2);

    const failure = vi.fn(async () => { throw new Error("scan failed"); });
    await expect(getCachedHostSummary({ ...key, interviewId: "failed" }, failure)).rejects.toThrow("scan failed");
    await expect(getCachedHostSummary({ ...key, interviewId: "failed" }, failure)).rejects.toThrow("scan failed");
    expect(failure).toHaveBeenCalledTimes(2);
  });

  it("expires entries and evicts the oldest keys at its entry cap", async () => {
    vi.useFakeTimers();
    try {
      const compute = vi.fn(async () => ({ total: 1 }));
      const keys = Array.from({ length: 9 }, (_, index) => ({ ...key, interviewId: `bounded-${index}` }));
      for (const item of keys) await getCachedHostSummary(item, compute);
      expect(compute).toHaveBeenCalledTimes(9);
      await getCachedHostSummary(keys[0], compute);
      expect(compute).toHaveBeenCalledTimes(10);

      vi.advanceTimersByTime(30_001);
      await getCachedHostSummary(keys[8], compute);
      expect(compute).toHaveBeenCalledTimes(11);
    } finally {
      vi.useRealTimers();
    }
  });
});
