import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDesignGuidance } from "../src/lib/design/guidance";

describe("design guidance package", () => {
  it("returns an actionable brief-to-review plan with explicit standards and heuristics", () => {
    const guidance = getDesignGuidance();
    expect(guidance.policyVersion).toBe("kqa-design/11");
    expect(guidance.designPlan.inputs).toContain("brand/theme references");
    expect(guidance.designPlan.steps.join(" ")).toContain("Build, then critique");
    expect(guidance.designPlan.output.fields).toContain("reviewEvidence");
    expect(guidance.designPlan.guardrails.join(" ")).toContain("WCAG 2.2 AA");
    expect(guidance.designPlan.guardrails.join(" ")).toContain("subjective taste heuristics");
    expect(guidance.designPlan.steps.join(" ")).toContain("could fit almost any unrelated product");
    expect(guidance.designPlan.output.fields).toContain("representativeSamplesAndStates");
    expect(guidance.designPlan.accessibilityEvaluationMethodology.steps.join(" ")).toContain("representative sample");
    expect(guidance.designPlan.accessibilityEvaluationMethodology.status).toContain("not a normative WCAG success criterion");
    expect(guidance.designPlan.taskBasedUsabilityMethodology.steps.join(" ")).toContain("realistic, neutral tasks");
    expect(guidance.designPlan.taskBasedUsabilityMethodology.steps.join(" ")).toContain("label usability as untested");
    expect(guidance.designPlan.output.fields).toContain("observedUsabilityFindings");
    expect(guidance.designPlan.output.fields).toContain("usabilityLimitationsOrUntestedReason");
    expect(guidance.designPlan.steps.join(" ")).toContain("representative users");
    expect(guidance.reviewChecklist.join(" ")).toContain("realistic end-to-end tasks");
    expect(guidance.sources.find((source) => source.name === "WCAG Evaluation Methodology (WCAG-EM) 2.0")?.url).toBe("https://www.w3.org/TR/wcag-em-2/");
    expect(guidance.sources.find((source) => source.name === "U.S. Web Design System: Design principles")?.url).toBe("https://designsystem.digital.gov/design-principles/");
    expect(guidance.sources.find((source) => source.name === "GOV.UK Service Manual: Plan user research")?.url).toBe("https://www.gov.uk/service-manual/user-research/plan-user-research-for-your-service");
    expect(guidance.reviewChecklist.join(" ")).toContain("npm run a11y:audit");
    expect(guidance.reviewChecklist.join(" ")).toContain("disposable local account");
    expect(guidance.reviewChecklist.join(" ")).toContain("commit-scoped JSON summary");
    expect(guidance.sources.find((source) => source.name === "axe-core")?.role).toContain("not a complete accessibility verdict");
    expect(guidance.principles.find((principle) => principle.id === "brief-specific-visuals")?.guidance).toContain("options rather than defaults");
    const externalDesignSource = guidance.sources.find((source) => source.name === "Anthropic frontend-design skill");
    expect(externalDesignSource).toMatchObject({
      revision: "41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f",
      reviewedAt: "2026-11-16",
      contentSha256: "d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3",
    });
    expect(externalDesignSource?.url).not.toContain("/main/");
  });

  it("scopes the visual profile to the host, questionnaire, and analytics surfaces", () => {
    const host = getDesignGuidance("host");
    expect(host.visualProfile).toHaveProperty("host");
    expect(host.visualProfile).not.toHaveProperty("questionnaire");
    expect(host.designPlan.surfaceInstructions).toHaveProperty("host");
    expect(host.designPlan.surfaceInstructions).not.toHaveProperty("questionnaire");

    const questionnaire = getDesignGuidance("questionnaire");
    expect(questionnaire.visualProfile).toHaveProperty("questionnaire");
    expect(questionnaire.visualProfile).not.toHaveProperty("host");
    expect(questionnaire.designPlan.surfaceInstructions).not.toHaveProperty("host");
    expect(questionnaire.designPlan.surfaceInstructions.questionnaire).toContain("sandboxed iframe");

    const analytics = getDesignGuidance("analytics");
    expect(analytics.visualProfile).toHaveProperty("host");
    expect(analytics.visualProfile).toHaveProperty("analytics");
    expect(analytics.designPlan.surfaceInstructions).toHaveProperty("analytics");
    expect(analytics.designPlan.surfaceInstructions).not.toHaveProperty("questionnaire");
    expect((analytics.visualProfile as { analytics: string }).analytics).toContain("Do not suppress small groups by default");
  });

  it("only advertises host tokens and core theme values that exist in the current stylesheet", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const guidance = getDesignGuidance("host");
    const hostProfile = (guidance.visualProfile as {
      host: {
        tokens: Record<string, readonly string[]>;
        themeModes: readonly string[];
        existingConventions: readonly string[];
        direction: string;
        coreThemeValues: Record<string, Record<string, string>>;
      };
    }).host;
    const tokenNames = Object.values(hostProfile.tokens).flatMap((tokens) => [...tokens]);
    expect(tokenNames.length).toBeGreaterThan(20);
    for (const token of tokenNames) expect(css).toContain(`${token}:`);
    for (const theme of Object.values(hostProfile.coreThemeValues)) {
      for (const [token, value] of Object.entries(theme)) expect(css).toContain(`${token}: ${value}`);
    }
    expect(hostProfile.direction).toContain("restrained teal");
    expect(hostProfile.themeModes).toContain("prefers-color-scheme: dark");
    expect(hostProfile.existingConventions.join(" ")).toContain("No shared spacing scale");
  });

  it("provides the respondent design kit's own scoped tokens, not host-only values", () => {
    const starter = readFileSync(new URL("../docs/template/starter.kqa.html", import.meta.url), "utf8");
    const guidance = getDesignGuidance("questionnaire");
    const profile = (guidance.visualProfile as {
      questionnaire: { tokens: readonly string[]; coreThemeValues: Record<string, Record<string, string>>; layoutConventions: readonly string[]; constraints: readonly string[] };
    }).questionnaire;
    expect(profile.tokens.length).toBeGreaterThan(15);
    for (const token of profile.tokens) expect(starter).toContain(`${token}:`);
    for (const theme of Object.values(profile.coreThemeValues)) {
      for (const [token, value] of Object.entries(theme)) expect(starter).toContain(`${token}: ${value}`);
    }
    expect(profile.layoutConventions.join(" ")).toContain("44 px scale targets");
    expect(profile.constraints.join(" ")).toContain("iframe");
  });
});
