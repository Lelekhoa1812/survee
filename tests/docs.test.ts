import { describe, expect, it } from "vitest";
import { buildBundle, DOCS, readAsset, readDoc } from "../src/lib/docs";
import { getInterviewPackage, INTERVIEW_PACKAGES, INTERVIEW_PACKAGE_VERSION } from "../src/lib/interview-packages";

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
    expect(rows).toHaveLength(18);
    expect(rows.filter(([, , type]) => type === "Full package")).toHaveLength(8);
    expect(rows.filter(([, , type]) => type === "Sector module")).toHaveLength(10);
    expect(packages).toContain("### Program evaluation");
    expect(packages).toContain("### Community consultation");
    expect(packages).toContain("Neither is an employee climate or recurring workforce pulse instrument");
    expect(packages).toContain("field-tested patient-experience measure");
    expect(packages).toContain("## Industrial operations");
    expect(packages).toContain("Do not imply that KQA is anonymous");
    expect(packages).toContain("do not report a conventional margin of error or claim representativeness");
    expect(packages).toContain("jurisdiction-specific assessment and legal review");
    expect(packages).toContain("not an emergency or statutory reporting channel");
  });

  it("defines distinct, risk-based release evidence and launch blockers", async () => {
    const packages = await readDoc("INTERVIEW_PACKAGES.md");
    expect(packages).toContain("## Risk-based release gate");
    expect(packages).toContain("Consequential individual use");
    expect(packages).toContain("Do not combine areas into an average score");
    expect(packages).toContain("Unresolved issues in a required review block fielding");
    expect(packages).toContain("expert or method review does not replace pretesting");
  });

  it("defines a sampling plan and a transparent, appropriately bounded report", async () => {
    const packages = await readDoc("INTERVIEW_PACKAGES.md");
    expect(packages).toContain("## Sampling and reporting plan");
    expect(packages).toContain("target population and unit");
    expect(packages).toContain("who could be missed");
    expect(packages).toContain("whether the purpose is qualitative learning or population estimation");
    expect(packages).toContain("Do not invent sample or response counts");
    expect(packages).toContain("do not report a conventional margin of error or claim representativeness");
    expect(packages).toContain("AAPOR's Transparency Initiative");
    expect(packages).toContain("ABS [sample design guide]");
    expect(packages).toContain("## Respondent notice, privacy, and ethics");
    expect(packages).toContain("material unresolved purpose, access, use, retention, or contact fact blocks fielding");
    expect(packages).toContain("responsible ethics/HRPP/IRB office");
    expect(packages).toContain("## Field monitoring and respondent burden");
    expect(packages).toContain("KQA does not collect item display telemetry");
    expect(packages).toContain("Synthetic responses can test code paths");
    expect(packages).toContain("preceding instructions/questions");
    expect(packages).toContain("AAPOR Responsible AI Integration in Survey Research report (2026)");
  });

  it("keeps the stable package catalog synchronized with the documentation and returns focused profiles", async () => {
    const packages = await readDoc("INTERVIEW_PACKAGES.md");
    expect(packages).toContain("kqa-interview-packages/7");
    expect(INTERVIEW_PACKAGE_VERSION).toBe("kqa-interview-packages/7");
    for (const item of INTERVIEW_PACKAGES) expect(packages).toContain(`\`${item.id}\``);
    const packageIds = new Set(INTERVIEW_PACKAGES.map((item) => item.id));
    for (const item of INTERVIEW_PACKAGES) {
      expect(item.decisionFocus.length).toBeGreaterThan(0);
      expect(item.respondents.length).toBeGreaterThan(0);
      expect(item.useWhen.length).toBeGreaterThan(0);
      expect(item.notFor.length).toBeGreaterThan(0);
      for (const relatedId of item.relatedPackages) expect(packageIds.has(relatedId)).toBe(true);
    }
    const profile = await getInterviewPackage("candidate-experience");
    expect(profile?.packageId).toBe("candidate-experience");
    expect(profile?.packageVersion).toBe(INTERVIEW_PACKAGE_VERSION);
    expect(profile?.packages).toContain("### Candidate experience");
    expect(profile?.packages).toContain("## Risk-based release gate");
    expect(profile?.packages).not.toContain("### Safety and quality learning\n\n**Use for:**");
    expect(profile?.packageCatalog.find((item) => item.id === "candidate-experience")?.notFor).toContain("ranking");
    expect(profile?.selectionGuidance).toContain("If purpose, audience, modality, or risk boundary is unclear");
    expect(profile?.packageCatalog.find((item) => item.id === "employee-onboarding")?.relatedPackages).toContain("workplace-process");
    const catalogOnly = await getInterviewPackage(undefined, { catalogOnly: true });
    expect(catalogOnly?.catalogOnly).toBe(true);
    expect(catalogOnly?.packageCatalog).toHaveLength(18);
    expect(catalogOnly).not.toHaveProperty("packages");
  });

  it("documents respondent navigation and custom-question focus targets once", async () => {
    const format = await readDoc("FORMAT.md");
    expect(format).toContain('data-kqa-question-id="QUESTION_ID"');
    expect(format).toContain("focus its first visible enabled control");
    expect(format).toContain("clears the value and keeps any optional note");
    expect(format).toContain("clear-answer");
    expect(format).toContain("announces how many questions are shown or hidden");
    expect(format).toContain('With the default `presentation: "all"`, the respondent shell adds **Questions** navigation');
    expect(format).toContain('With `presentation: "guided"`, KQA shows one currently eligible section at a time');
  });

  it("keeps authoring and README quality claims bounded to verified evidence", async () => {
    const playbook = await readDoc("AGENT_PLAYBOOK.md");
    expect(playbook).not.toContain("nine problems in ten");
    expect(playbook).toContain("not a measured guarantee of questionnaire quality");
  });

  it("publishes the portable questionnaire author skill and includes it in the bundle", async () => {
    expect(DOCS.some((doc) => doc.slug === "questionnaire-author-skill" && doc.file === "kqa-questionnaire-author/SKILL.md")).toBe(true);
    expect(DOCS.some((doc) => doc.slug === "question-blueprint" && doc.file === "QUESTION_BLUEPRINT.md")).toBe(true);
    const bundle = await buildBundle("https://kqa.example");
    expect(bundle).toContain("name: kqa-questionnaire-author");
    expect(bundle).toContain("## Workflow");
    expect(bundle).toContain("`create_interview` tool immediately creates an open interview");
    expect(bundle).not.toContain("legacy `create_interview`");
    expect(bundle).toContain("risk-based release gate");
    expect(bundle).toContain("question-content rubric and cognitive pretest protocol");
    expect(bundle).toContain("sample plan");
    expect(bundle).toContain("pre-submit **Check your answers** review");
    expect(bundle).toContain("does not simulate respondent input");
    expect(bundle).toContain("<!-- QUESTION_BLUEPRINT.md -->");
  });

  it("ships version-matched references for the standalone questionnaire author skill", async () => {
    const skill = await readDoc("kqa-questionnaire-author/SKILL.md");
    expect(skill).toContain("references/FORMAT.md");
    expect(skill).toContain("install each item at its supplied relative path");
    expect(skill).toContain("references/QUESTIONNAIRE_AUTHORING_BENCHMARK.md");
    expect(skill).toContain("references/PACKAGE_DRAFT_BENCHMARK.md");
    expect(skill).toContain("references/AUTHORING_TRUST_BOUNDARY_EVAL.md");
    expect(skill).toContain("references/QUESTION_BLUEPRINT.md");
    const references = [
      ["FORMAT.md", "FORMAT.md"],
      ["AGENT_PLAYBOOK.md", "AGENT_PLAYBOOK.md"],
      ["DESIGN_SYSTEM.md", "DESIGN_SYSTEM.md"],
      ["INTERVIEW_PACKAGES.md", "INTERVIEW_PACKAGES.md"],
      ["QUESTION_BLUEPRINT.md", "QUESTION_BLUEPRINT.md"],
      ["MCP.md", "MCP.md"],
      ["QUESTIONNAIRE_AUTHORING_BENCHMARK.md", "evals/QUESTIONNAIRE_AUTHORING_BENCHMARK.md"],
      ["PACKAGE_DRAFT_BENCHMARK.md", "evals/PACKAGE_DRAFT_BENCHMARK.md"],
      ["AUTHORING_TRUST_BOUNDARY_EVAL.md", "evals/AUTHORING_TRUST_BOUNDARY_EVAL.md"],
      ["starter.kqa.html", "template/starter.kqa.html"],
      ["routed-follow-up.kqa.html", "examples/routed-follow-up.kqa.html"],
      ["service-improvement.kqa.html", "examples/service-improvement.kqa.html"],
      ["service-improvement.review.md", "examples/service-improvement.review.md"],
      ["personal-planning.kqa.html", "examples/personal-planning.kqa.html"],
      ["personal-planning.review.md", "examples/personal-planning.review.md"],
    ];
    for (const [copy, source] of references) expect(await readDoc(`kqa-questionnaire-author/references/${copy}`)).toBe(await readDoc(source));
  });

  it("publishes the questionnaire evaluation benchmark and its labeled development corpus", async () => {
    expect(DOCS.some((doc) => doc.slug === "questionnaire-authoring-benchmark" && doc.file === "evals/QUESTIONNAIRE_AUTHORING_BENCHMARK.md")).toBe(true);
    expect(DOCS.some((doc) => doc.slug === "package-draft-benchmark" && doc.file === "evals/PACKAGE_DRAFT_BENCHMARK.md")).toBe(true);
    expect(DOCS.some((doc) => doc.slug === "authoring-trust-boundary-eval" && doc.file === "evals/AUTHORING_TRUST_BOUNDARY_EVAL.md")).toBe(true);
    const bundle = await buildBundle("https://kqa.example");
    expect(bundle).toContain("QUESTIONNAIRE_AUTHORING_BENCHMARK.md");
    expect(bundle).toContain("PACKAGE_DRAFT_BENCHMARK.md");
    expect(bundle).toContain("AUTHORING_TRUST_BOUNDARY_EVAL.md");
    expect(bundle).toContain("scores are not validation or respondent evidence");
    const corpus = await readAsset("evals/questionnaire-authoring-cases.json");
    expect(corpus?.type).toBe("application/json; charset=utf-8");
    expect(JSON.parse(corpus!.body).benchmarkVersion).toBe("kqa-questionnaire-review/1");
    const draftCases = await readAsset("evals/package-draft-cases.json");
    const resultSchema = await readAsset("evals/package-draft-results.schema.json");
    expect(JSON.parse(draftCases!.body).benchmarkVersion).toBe("kqa-package-draft/2");
    expect(JSON.parse(resultSchema!.body).title).toContain("package-draft");
    expect(JSON.parse(resultSchema!.body).properties.benchmarkVersion.const).toBe(JSON.parse(draftCases!.body).benchmarkVersion);
    const trustCases = await readAsset("evals/authoring-trust-boundary-cases.json");
    expect(trustCases?.type).toBe("application/json; charset=utf-8");
    const trustBenchmark = JSON.parse(trustCases!.body);
    expect(trustBenchmark.benchmarkVersion).toBe("kqa-authoring-trust-boundary/1");
    expect(new Set(trustBenchmark.cases.map((item: { id: string }) => item.id)).size).toBe(6);
    expect(trustBenchmark.cases.find((item: { id: string }) => item.id === "explicit-approval-positive-control").requiredTools).toContain("create_interview");
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

  it("publishes package-based worked examples with non-validation limits", async () => {
    for (const [htmlPath, reviewPath, packageId] of [
      ["examples/service-improvement.kqa.html", "examples/service-improvement.review.md", "service-improvement"],
      ["examples/personal-planning.kqa.html", "examples/personal-planning.review.md", "personal-planning"],
    ]) {
      const html = await readAsset(htmlPath);
      const review = await readAsset(reviewPath);
      expect(html?.type).toBe("text/html; charset=utf-8");
      expect(html?.body).toContain('id="kqa-manifest"');
      expect(review?.type).toBe("text/markdown; charset=utf-8");
      expect(review?.body).toContain(packageId);
      expect(review?.body?.toLowerCase()).toContain("not validated");
    }
  });
});
