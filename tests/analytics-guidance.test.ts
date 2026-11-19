import { describe, expect, it } from "vitest";
import { ANALYTICS_GUIDANCE_VERSION, getAnalyticsGuidance } from "../src/lib/analytics/guidance";
import { dispatchTool, listToolDefs } from "../src/lib/mcp/tools";

describe("versioned analytics guidance", () => {
  it("returns a deterministic, JSON-serializable package with primary sources", () => {
    const first = getAnalyticsGuidance();
    const second = getAnalyticsGuidance();
    expect(ANALYTICS_GUIDANCE_VERSION).toBe("kqa-analytics/17");
    const analysis = getAnalyticsGuidance();
    expect(analysis.principles.find((principle) => principle.id === "explore-answer-segments")?.guidance).toContain("crossTabWith");
    expect(analysis.productConstraints.join(" ")).toContain("400 cells");
    expect(analysis.productConstraints.join(" ")).toContain("No minimum group threshold applies");
    expect(first).toEqual(second);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(first.sources.length).toBeGreaterThanOrEqual(6);
    expect(first.sources.every((source) => source.url.startsWith("https://"))).toBe(true);
  });

  it("covers cohort definition, denominators, missingness, measure types, privacy, and claim limits", () => {
    const guidance = getAnalyticsGuidance();
    const text = guidance.principles.map(({ title, guidance }) => `${title} ${guidance}`).join(" ").toLowerCase();
    for (const phrase of [
      "business question",
      "submittedonly",
      "segmentby",
      "questionids",
      "one participant scan",
      "checkbox segments overlap",
      "zero-count",
      "comparestatuses",
      "participantcount",
      "cohortcount",
      "eligiblecount",
      "inactivecount",
      "noanswercount",
      "does not retain historical display telemetry",
      "shared asof",
      "missing",
      "unmapped",
      "median",
      "scalemedianrange",
      "never average category codes",
      "multi-select",
      "causal",
      "chart",
      "asof",
      "keyboard-operable",
      "histogram",
      "box plot",
      "type 7",
      "ddsketch",
      "relative-value error is not rank error",
      "binscollapsed",
      "privacy",
      "repeat-group rows",
      "never count rows as participants",
      "ambiguity",
    ]) {
      expect(text).toContain(phrase);
    }
    expect(guidance.productConstraints.join(" ")).toContain("current-version");
    expect(guidance.reviewChecklist.length).toBeGreaterThanOrEqual(6);
    expect(guidance.sources.map((source) => source.name)).toContain("W3C WAI, Complex Images");
    expect(guidance.sources.map((source) => source.name)).toContain("R stats, Sample Quantiles");
  });

  it("documents that analytics does not suppress small cohorts", () => {
    const constraints = getAnalyticsGuidance().productConstraints.join(" ").toLowerCase();
    expect(constraints).toContain("does not enforce a minimum cohort-size threshold");
    expect(constraints).toContain("singleton counts and percentages may be returned");
    expect(constraints).toContain("disclosurerisk metadata flags singleton segments");
    expect(constraints).toContain("questionsummary.disclosurerisk flags singleton");
    expect(constraints).toContain("disclosure rules");
    expect(constraints).toContain("reuse analysisrunid as runid");
    expect(constraints).toContain("initial participant scan is live");
  });

  it("states that repeat rows are excluded and are not independent observations", () => {
    const guidance = getAnalyticsGuidance();
    const principle = guidance.principles.find((item) => item.id === "keep-repeat-records-out-of-default-analysis");
    expect(principle?.guidance).toContain("exclude their field values");
    expect(principle?.guidance).toContain("never count rows as participants");
    expect(guidance.productConstraints.join(" ")).toContain("Repeat-group field values are excluded");
  });

  it("returns fresh package objects so callers cannot mutate shared guidance", () => {
    const first = getAnalyticsGuidance();
    (first.principles[0] as { guidance: string }).guidance = "caller mutation";
    expect(getAnalyticsGuidance().principles[0].guidance).not.toBe("caller mutation");
  });

  it("exposes the versioned package as a no-argument MCP tool", async () => {
    expect(listToolDefs().find(({ name }) => name === "get_analytics_guidance")?.inputSchema).toMatchObject({ type: "object", properties: {}, required: [], additionalProperties: false });
    const result = await dispatchTool("get_analytics_guidance", {});
    expect(result.isError).toBe(false);
    expect(result.structuredContent.policyVersion).toBe(ANALYTICS_GUIDANCE_VERSION);
    expect(result.structuredContent.sources).toEqual(getAnalyticsGuidance().sources);
  });
});
