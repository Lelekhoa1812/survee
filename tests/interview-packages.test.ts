import { describe, expect, it } from "vitest";
import { getInterviewPackage, INTERVIEW_PACKAGES, INTERVIEW_PACKAGE_VERSION } from "../src/lib/interview-packages";

describe("addressable interview package modules", () => {
  it("returns the exact detailed module for every stable catalog ID", async () => {
    expect(INTERVIEW_PACKAGE_VERSION).toBe("kqa-interview-packages/9");
    for (const item of INTERVIEW_PACKAGES) {
      const result = await getInterviewPackage(item.id);
      expect(result?.packageId, item.id).toBe(item.id);
      expect(result?.packageVersion, item.id).toBe(INTERVIEW_PACKAGE_VERSION);
      const heading = `${"#".repeat(item.level)} ${item.title}`;
      expect(result?.packages?.split("\n") ?? [], item.id).toContain(heading);
      expect(result?.packages, item.id).toContain("**Use for:**");
      expect(result?.packages, item.id).toContain("report-back owner");
      expect(result?.packages, item.id).toContain("KQA does not monitor outcomes");
    }
  });

  it("keeps caregiver support-service feedback bounded in the health-service profile", async () => {
    const result = await getInterviewPackage("health-service-experience");
    expect(result?.packages).toContain("Carer support-service discovery (bounded module)");
    expect(result?.packages).toContain("not a comprehensive caregiver assessment");
    expect(result?.packageCatalog.find((item) => item.id === "health-service-experience")).toMatchObject({
      notFor: expect.stringContaining("care planning"),
      riskFlags: expect.arrayContaining(["third-party care-recipient data"]),
    });
    expect(result?.selectionGuidance).toContain("formal caregiver needs assessment");
  });

  it("offers implementation feedback without treating it as a readiness or outcome measure", async () => {
    const result = await getInterviewPackage("workplace-process");
    expect(result?.packages).toContain("### Bounded organizational-change module");
    expect(result?.packages).toContain("readiness, engagement, sentiment, adoption, or manager score");
    expect(result?.packages).toContain("how workers will hear what changed");
    expect(result?.packages).toContain("KQA does not collect or escalate them");
  });
});
