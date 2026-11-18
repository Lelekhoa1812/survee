import { describe, expect, it } from "vitest";
import { buildBundle, DOCS, readAsset } from "../src/lib/docs";

describe("agent documentation bundle", () => {
  it("publishes the design system and includes it in the full questionnaire bundle", async () => {
    expect(DOCS.some((doc) => doc.slug === "design-system" && doc.file === "DESIGN_SYSTEM.md")).toBe(true);
    const bundle = await buildBundle("https://kqa.example");
    expect(bundle).toContain("KQA design system and agent guidance");
    expect(bundle).toContain("WCAG 2.2 Quick Reference");
    expect(bundle).toContain("Separate observed facts from interpretation");
  });

  it("includes the interview packages in the published agent bundle", async () => {
    expect(DOCS.some((doc) => doc.slug === "interview-packages" && doc.file === "INTERVIEW_PACKAGES.md")).toBe(true);
    const bundle = await buildBundle("https://kqa.example");
    expect(bundle).toContain("<!-- INTERVIEW_PACKAGES.md -->");
    expect(bundle).toContain("### Safety and quality learning");
    expect(bundle).toContain("### Personal reflection and wellbeing");
  });

  it("publishes the native routing runtime contract to agents", async () => {
    const bundle = await buildBundle("https://kqa.example");
    expect(bundle).toContain("KQA.isEligible(id)");
    expect(bundle).toContain('"eligibility"');
    expect(bundle).toContain("currently eligible questions only");
  });

  it("serves the conditional follow-up example as an HTML asset", async () => {
    const asset = await readAsset("examples/conditional-follow-up.kqa.html");
    expect(asset?.type).toBe("text/html; charset=utf-8");
    expect(asset?.body).toContain('data-kqa="support-details"');
  });

  it("serves the native routed follow-up example as an HTML asset", async () => {
    const asset = await readAsset("examples/routed-follow-up.kqa.html");
    expect(asset?.type).toBe("text/html; charset=utf-8");
    expect(asset?.body).toContain('"when": { "all":');
    expect(asset?.body).toContain('"required": true');
  });
});
