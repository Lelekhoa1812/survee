import { describe, expect, it } from "vitest";
import config from "../next.config";

describe("global anti-framing header matcher", () => {
  it("leaves the authenticated questionnaire review frame to its route policy", async () => {
    const rules = await config.headers?.();
    const restrictiveRule = rules?.find((rule) => rule.headers.some((header) => header.key === "X-Frame-Options"));
    expect(restrictiveRule?.source).toBeDefined();
    const matches = new RegExp(`^${restrictiveRule!.source}`);

    expect(matches.test(`/api/admin/previews/${"r".repeat(32)}/frame`)).toBe(false);
    expect(matches.test("/api/admin/interviews")).toBe(true);
  });
});
