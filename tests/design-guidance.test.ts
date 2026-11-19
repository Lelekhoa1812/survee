import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDesignGuidance } from "../src/lib/design/guidance";

describe("design guidance package", () => {
  it("returns an actionable brief-to-review plan with explicit standards and heuristics", () => {
    const guidance = getDesignGuidance();
    expect(guidance.policyVersion).toBe("kqa-design/25");
    expect(guidance.principles.some((principle) => principle.id === "host-freshness")).toBe(true);
    expect(guidance.designPlan.inputs).toContain("brand/theme references");
    expect(guidance.designPlan.steps.join(" ")).toContain("Build, then critique");
    expect(guidance.designPlan.output.fields).toContain("reviewEvidence");
    expect(guidance.designPlan.output.fields).toContain("questionBlueprint");
    expect(guidance.designPlan.output.questionBlueprint.reference).toBe("docs/QUESTION_BLUEPRINT.md");
    expect(guidance.designPlan.output.questionBlueprint.fields).toContain("dataUserNeedOrDecision");
    expect(guidance.principles.some((principle) => principle.id === "language-adaptation")).toBe(true);
    expect(guidance.designPlan.output.reviewEvidenceMatrix.required).toBe(true);
    expect(guidance.designPlan.output.reviewEvidenceMatrix.columns.map((column) => column.name)).toEqual([
      "surfaceRoute", "stateTheme", "viewportInputMethod", "criterion", "methodTool", "observedResult", "evidenceReference", "limitationUntestedReason",
    ]);
    expect(guidance.designPlan.output.reviewEvidenceMatrix.starterSamples.join(" ")).toContain("Reflow at 320 CSS px");
    expect(guidance.designPlan.output.reviewEvidenceMatrix.starterSamples.join(" ")).toContain("360 and 390 CSS px");
    expect(guidance.designPlan.accessibilityEvaluationMethodology.steps.join(" ")).toContain("360, and 390 CSS px");
    expect(guidance.designPlan.output.reviewEvidenceMatrix.instructions.join(" ")).toContain("Do not omit untested samples");
    expect(guidance.designPlan.output.reviewEvidenceMatrix.instructions.join(" ")).toContain("respondent names, answers, private links");
    expect(guidance.reviewChecklist.join(" ")).toContain("one QA evidence row per selected sample");
    expect(guidance.designPlan.guardrails.join(" ")).toContain("WCAG 2.2 AA");
    expect(guidance.designPlan.guardrails.join(" ")).toContain("subjective taste heuristics");
    expect(guidance.designPlan.steps.join(" ")).toContain("could fit almost any unrelated product");
    expect(guidance.designPlan.output.fields).toContain("representativeSamplesAndStates");
    expect(guidance.designPlan.output.fields).toContain("designProfileProposalAndReview");
    expect(guidance.designPlan.steps.join(" ")).toContain("call extract_design_profile");
    expect(guidance.designPlan.steps.join(" ")).toContain("Never fetch an arbitrary stylesheet URL");
    expect(guidance.designPlan.accessibilityEvaluationMethodology.steps.join(" ")).toContain("representative sample");
    expect(guidance.designPlan.accessibilityEvaluationMethodology.steps.join(" ")).toContain("one QA evidence row");
    expect(guidance.designPlan.accessibilityEvaluationMethodology.status).toContain("not a normative WCAG success criterion");
    expect(guidance.designPlan.taskBasedUsabilityMethodology.steps.join(" ")).toContain("realistic, neutral tasks");
    expect(guidance.designPlan.taskBasedUsabilityMethodology.steps.join(" ")).toContain("label usability as untested");
    expect(guidance.designPlan.taskBasedUsabilityMethodology.steps.join(" ")).toContain("one moderated session includes cognitive probes and usability tasks");
    expect(guidance.designPlan.questionContentRubric.map((item) => item.dimension)).toContain("Answer form and options");
    expect(guidance.designPlan.questionContentReviewMethodology.probeDimensions.map((item) => item.name)).toEqual([
      "Comprehension", "Recall and retrieval", "Judgment", "Response selection",
    ]);
    expect(guidance.designPlan.questionContentReviewMethodology.steps.join(" ")).toContain("A moderated session may combine cognitive probes");
    expect(guidance.designPlan.questionContentReviewMethodology.recordFields).toContain("participantFitAndGaps");
    expect(guidance.designPlan.output.questionContentReview.instructions.join(" ")).toContain("even when one session supports multiple methods");
    expect(guidance.designPlan.output.fields).toContain("questionContentReview");
    expect(guidance.designPlan.output.fields).toContain("observedUsabilityFindings");
    expect(guidance.designPlan.output.fields).toContain("usabilityLimitationsOrUntestedReason");
    expect(guidance.designPlan.steps.join(" ")).toContain("representative users");
    expect(guidance.reviewChecklist.join(" ")).toContain("realistic end-to-end tasks");
    expect(guidance.sources.find((source) => source.name === "WCAG Evaluation Methodology (WCAG-EM) 2.0")?.url).toBe("https://www.w3.org/TR/wcag-em-2/");
    expect(guidance.sources.find((source) => source.name === "U.S. Web Design System: Design principles")?.url).toBe("https://designsystem.digital.gov/design-principles/");
    expect(guidance.sources.find((source) => source.name === "GOV.UK Service Manual: Plan user research")?.url).toBe("https://www.gov.uk/service-manual/user-research/plan-user-research-for-your-service");
    expect(guidance.sources.find((source) => source.name === "CDC/NCHS: Cognitive Interviewing")?.url).toBe("https://www.cdc.gov/nchs/ccqder/question-evaluation/cognitive-interviewing.html");
    expect(guidance.sources.find((source) => source.name === "U.S. Census Bureau: Statistical Quality Standard A2")?.url).toBe("https://www.census.gov/about/policies/quality/standards/standarda2.html");
    expect(guidance.sources.find((source) => source.name === "U.S. Census Bureau: Question Template for Non-Methodologists")?.url).toBe("https://www.census.gov/library/working-papers/2025/adrm/rsm2025-07.html");
    expect(guidance.sources.find((source) => source.name === "Pew Research Center: Questionnaire Design and Translation")?.role).toContain("meaning-equivalent");
    expect(guidance.sources.find((source) => source.name === "AAPOR: Code of Professional Ethics and Practices")?.role).toContain("June 2026");
    expect(guidance.sources.find((source) => source.name === "W3C WAI: Multi-page Forms")?.url).toBe("https://www.w3.org/WAI/tutorials/forms/multi-page/");
    expect(guidance.sources.find((source) => source.name === "ONS Design System: Hub and Spoke")?.url).toBe("https://service-manual.ons.gov.uk/design-system/patterns/hub-and-spoke");
    expect(guidance.reviewChecklist.join(" ")).toContain("npm run a11y:audit");
    expect(guidance.reviewChecklist.join(" ")).toContain("disposable local account");
    expect(guidance.reviewChecklist.join(" ")).toContain("commit-scoped JSON summary");
    expect(guidance.reviewChecklist.join(" ")).toContain("concise polite status announces the count without stealing focus");
    expect(guidance.principles.find((principle) => principle.id === "respondent-control")?.guidance).toContain("clear an answer from pre-submit review");
    expect(guidance.principles.find((principle) => principle.id === "bounded-text-feedback")?.guidance).toContain("never announce every keystroke");
    expect(guidance.principles.find((principle) => principle.id === "bounded-text-feedback")?.guidance).toContain("light-only colors");
    expect(guidance.sources.find((source) => source.name === "WCAG 2.2 SC 4.1.3: Status Messages")?.url).toBe("https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html");
    expect(guidance.sources.find((source) => source.name === "GOV.UK Design System: Character count")?.url).toBe("https://design-system.service.gov.uk/components/character-count/");
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

  it("gives questionnaire authors conditional-reveal and retention review guidance", () => {
    const guidance = getDesignGuidance("questionnaire");
    const checklist = guidance.reviewChecklist.join(" ");
    expect(checklist).toContain("section-aware question navigation");
    expect(checklist).toContain("cognitive pretest protocol");
    expect(checklist).toContain("representative screen reader/browser combinations");
    expect(checklist).toContain("does not establish accessibility");
    expect(checklist).toContain("how a respondent can remove them");
    const constraints = guidance.productConstraints.join(" ");
    expect(constraints).toContain("requiredness applies only while a question is eligible");
    expect(constraints).toContain("For custom/script-driven reveals outside `when`, KQA cannot calculate eligibility");
    expect(constraints).toContain("keep hidden questions optional");
    expect(guidance.sources.find((source) => source.name === "GOV.UK Design System: Radios")?.url).toBe("https://design-system.service.gov.uk/components/radios/");
    expect(getDesignGuidance("host").reviewChecklist.join(" ")).not.toContain("Keep conditional reveals simple");
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

  it("keeps muted and danger text contrast above WCAG AA in both host themes", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const root = css.match(/:root\s*\{([^}]+)\}/)?.[1];
    const dark = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]+)\}/)?.[1];
    expect(root).toBeTruthy();
    expect(dark).toBeTruthy();

    const token = (block: string, name: string) => {
      const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
      if (!match) throw new Error(`Could not find ${name} in theme block.`);
      return match[1];
    };
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
        .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (foreground: string, background: string) => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const blend = (foreground: string, background: string, alpha: number) => {
      const channels = [1, 3, 5].map((index) => Math.round(
        parseInt(foreground.slice(index, index + 2), 16) * alpha
        + parseInt(background.slice(index, index + 2), 16) * (1 - alpha),
      ));
      return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    };

    for (const theme of [root!, dark!]) {
      const muted = token(theme, "--muted");
      expect(contrast(muted, token(theme, "--bg"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(muted, token(theme, "--surface"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(theme, "--danger-ink"), token(theme, "--danger"))).toBeGreaterThanOrEqual(4.5);
    }
    const lightBg = token(root!, "--bg");
    const landingGradientCenter = blend(token(root!, "--accent-soft"), lightBg, 0.72);
    expect(contrast(token(root!, "--muted"), landingGradientCenter)).toBeGreaterThanOrEqual(4.7);
    expect(css).toMatch(/\.btn\.danger\.solid\s*\{[^}]*color:\s*var\(--danger-ink\)/);
    expect(css).toMatch(/\.toast\.err\s*\{[^}]*color:\s*var\(--danger-ink\)/);
    expect(css).toMatch(/\.verdict\.fail \.dot\s*\{[^}]*color:\s*var\(--danger-ink\)/);
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
