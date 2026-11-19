import { describe, expect, it } from "vitest";
import { buildBundle, DOCS, readAsset, readDoc } from "../src/lib/docs";

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

  it("keeps the package taxonomy and high-risk use safeguards explicit", async () => {
    const packages = await readDoc("INTERVIEW_PACKAGES.md");
    expect(packages).not.toBeNull();
    const selection = packages!.split("## Package selection")[1].split("## Additional sector modules")[0];
    const rows = Array.from(selection.matchAll(/^\| (.+?) \| (Full package|Sector module) \|/gm));
    expect(rows).toHaveLength(17);
    expect(rows.filter(([, , type]) => type === "Full package")).toHaveLength(7);
    expect(rows.filter(([, , type]) => type === "Sector module")).toHaveLength(10);
    expect(packages).toContain("### Program evaluation");
    expect(packages).toContain("### Community consultation");
    expect(packages).toContain("Do not claim representativeness or report margins of error unless the sampling design supports it.");
    expect(packages).toContain("jurisdiction-specific assessment and legal review");
    expect(packages).toContain("not an emergency or statutory reporting channel");
  });

  it("publishes the portable questionnaire author skill and includes it in the bundle", async () => {
    expect(DOCS.some((doc) => doc.slug === "questionnaire-author-skill" && doc.file === "kqa-questionnaire-author/SKILL.md")).toBe(true);
    const bundle = await buildBundle("https://kqa.example");
    expect(bundle).toContain("name: kqa-questionnaire-author");
    expect(bundle).toContain("## Workflow");
    expect(bundle).toContain("create_interview` operation immediately creates an open interview");
    expect(bundle).toContain("KQA's pre-submit **Check your answers** review");
    expect(bundle).toContain("does not simulate respondent input");
  });

  it("publishes the live MCP operating guide as a named doc and in the agent bundle", async () => {
    expect(DOCS.some((doc) => doc.slug === "mcp" && doc.file === "MCP.md")).toBe(true);
    const bundle = await buildBundle("https://kqa.example");
    expect(bundle).toContain("<!-- MCP.md -->");
    expect(bundle).toContain("KQA MCP server");
    expect(bundle).toContain("KQA does not persist reviewer identity");
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
