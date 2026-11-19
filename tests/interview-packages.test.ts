import { describe, expect, it } from "vitest";
import { getInterviewPackage, INTERVIEW_PACKAGES, INTERVIEW_PACKAGE_VERSION } from "../src/lib/interview-packages";

describe("addressable interview package modules", () => {
  it("returns the exact detailed module for every stable catalog ID", async () => {
    expect(INTERVIEW_PACKAGE_VERSION).toBe("kqa-interview-packages/7");
    for (const item of INTERVIEW_PACKAGES) {
      const result = await getInterviewPackage(item.id);
      expect(result?.packageId, item.id).toBe(item.id);
      expect(result?.packageVersion, item.id).toBe(INTERVIEW_PACKAGE_VERSION);
      const heading = `${"#".repeat(item.level)} ${item.title}`;
      expect(result?.packages?.split("\n") ?? [], item.id).toContain(heading);
      expect(result?.packages, item.id).toContain("**Use for:**");
    }
  });
});
