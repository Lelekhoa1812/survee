import { describe, expect, it } from "vitest";
import { buildBundle, DOCS } from "../src/lib/docs";

describe("agent documentation bundle", () => {
  it("publishes the design system and includes it in the full questionnaire bundle", async () => {
    expect(DOCS.some((doc) => doc.slug === "design-system" && doc.file === "DESIGN_SYSTEM.md")).toBe(true);
    const bundle = await buildBundle("https://kqa.example");
    expect(bundle).toContain("KQA design system and agent guidance");
    expect(bundle).toContain("WCAG 2.2 Quick Reference");
    expect(bundle).toContain("Separate observed facts from interpretation");
  });
});
