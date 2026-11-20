import { describe, expect, it } from "vitest";
import { getInterviewPackage, INTERACTION_PATTERN_IDS, INTERVIEW_PACKAGES, INTERVIEW_PACKAGE_VERSION } from "../src/lib/interview-packages";

describe("addressable interview package modules", () => {
  it("returns the exact detailed module for every stable catalog ID", async () => {
    expect(INTERVIEW_PACKAGE_VERSION).toBe("kqa-interview-packages/13");
    for (const item of INTERVIEW_PACKAGES) {
      const result = await getInterviewPackage(item.id);
      expect(result?.packageId, item.id).toBe(item.id);
      expect(result?.packageVersion, item.id).toBe(INTERVIEW_PACKAGE_VERSION);
      const heading = `${"#".repeat(item.level)} ${item.title}`;
      expect(result?.packages?.split("\n") ?? [], item.id).toContain(heading);
      expect(result?.packages, item.id).toContain("**Use for:**");
      expect(result?.packages, item.id).toContain("report-back owner");
      expect(result?.packages, item.id).toContain("survee does not monitor outcomes");
    }
  });

  it("provides contextual interaction options and tradeoffs without prescribed recipes or fit scores", async () => {
    expect(new Set(INTERACTION_PATTERN_IDS)).toEqual(new Set(["all", "guided", "guided-question", "routing", "question-order-variation", "ranking", "independent-ratings", "option-randomization", "repeat", "required-answer"]));
    for (const item of INTERVIEW_PACKAGES) {
      expect(item.interactionGuidance.consider.length + item.interactionGuidance.avoid.length, item.id).toBeGreaterThan(0);
      expect(item.interactionGuidance.decisionChecks.length, item.id).toBeGreaterThan(0);
      expect(item).not.toHaveProperty("default");
      expect(item).not.toHaveProperty("score");
      expect(item).not.toHaveProperty("fitScore");
      for (const candidate of item.interactionGuidance.consider) {
        expect(INTERACTION_PATTERN_IDS, item.id).toContain(candidate.pattern);
        expect(candidate.when.length, item.id).toBeGreaterThan(10);
        expect(candidate.benefit.length, item.id).toBeGreaterThan(10);
        expect(candidate.tradeoff.length, item.id).toBeGreaterThan(10);
      }
      for (const caution of item.interactionGuidance.avoid) {
        expect(INTERACTION_PATTERN_IDS, item.id).toContain(caution.pattern);
        expect(caution.when.length, item.id).toBeGreaterThan(10);
        expect(caution.reason.length, item.id).toBeGreaterThan(10);
      }
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
    expect(result?.packages).toContain("survee does not collect or escalate them");
  });

  it("routes frontline resource observations to qualified investigation without claiming measured savings", async () => {
    const result = await getInterviewPackage("industrial-operations");
    expect(result?.packages).toContain("Frontline resource-efficiency discovery module");
    expect(result?.packages).toContain("never as measured performance");
    expect(result?.packages).toContain("qualified operations and energy/resource specialists");
    expect(result?.packages).toContain("Do not infer savings, emissions reductions");
    expect(result?.packageCatalog.find((item) => item.id === "industrial-operations")).toMatchObject({
      decisionFocus: expect.stringContaining("resource-efficiency opportunities"),
      notFor: expect.stringContaining("verified savings estimates"),
    });
  });

  it("bounds shared-decision preparation to the respondent's own questions and preferences", async () => {
    const result = await getInterviewPackage("personal-planning");
    expect(result?.packages).toContain("Optional shared-decision preparation module");
    expect(result?.packages).toContain("does not compare or recommend clinical options");
    expect(result?.packages).toContain("Do not ask them to speak for a partner or household");
    expect(result?.packageCatalog.find((item) => item.id === "personal-planning")).toMatchObject({
      notFor: expect.stringContaining("recommending a clinical choice"),
      riskFlags: expect.arrayContaining(["clinical-advice boundary"]),
    });
    expect(result?.selectionGuidance).toContain("clinical treatment assessment, scoring, or recommendations are outside scope");
  });

  it("returns the same contextual interaction metadata in compact and focused MCP package profiles", async () => {
    const catalog = await getInterviewPackage(undefined, { catalogOnly: true });
    const focused = await getInterviewPackage("industrial-operations");
    const catalogItem = catalog?.packageCatalog.find((item) => item.id === "industrial-operations");
    const focusedItem = focused?.packageCatalog.find((item) => item.id === "industrial-operations");
    expect(catalogItem?.interactionGuidance).toEqual(focusedItem?.interactionGuidance);
    expect(catalogItem?.interactionGuidance.avoid.map((item) => item.pattern)).toContain("repeat");
    expect(catalog?.selectionGuidance).toContain("complete strict order of every option");
    expect(catalog?.selectionGuidance).toContain("fixed values explicitly declared");
  });
});
