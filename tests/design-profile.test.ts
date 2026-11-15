import { describe, expect, it } from "vitest";
import postcss from "postcss";
import { extractDesignProfile } from "../src/lib/design/profile";

function profile(source: string, format: "css" | "json" = "css") {
  const result = extractDesignProfile({ source, format, surface: "questionnaire" });
  if (!result.ok) throw new Error(result.error);
  return result.profile as {
    profileVersion: string;
    policyVersion: string;
    sourceSha256: string;
    extractedTokens: { name: string; value: string; scope: string; sourceContext: string; line: number | null }[];
    proposedMappings: { role: string; sourceToken: string; targetToken: string; scope: string; confidence: string; valueCheck: string }[];
    ambiguousMappings: { role: string; scope: string; sourceTokens: string[] }[];
    unmappedTokens: { token: string; value: string }[];
    contrastChecks: { scope: string; ratio?: number; status: string; wcagAaNormalText?: boolean; pairing?: string; caveat?: string }[];
    integrationProposal: { status: string; cssOverlay: string | null; overlayNotes: string[] };
    themeCoverage: { hasDarkTokens: boolean; scopes: string[] };
    diagnostics: string[];
    limits: string[];
  };
}

describe("user-supplied design profile extraction", () => {
  it("extracts default and dark CSS tokens with source provenance and safe overlay proposals", () => {
    const result = profile(`:root {\n  --bg: #ffffff;\n  --ink: #111111;\n  --brand: #155eef;\n}\n@media (prefers-color-scheme: dark) { :root { --bg: #000000; --ink: #ffffff; } }`);

    expect(result).toMatchObject({ profileVersion: "kqa-design-profile/1", policyVersion: "kqa-design/12", themeCoverage: { hasDarkTokens: true } });
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.extractedTokens.find((token) => token.name === "--bg" && token.scope === "default")).toMatchObject({ value: "#ffffff", line: 2, sourceContext: ":root" });
    expect(result.proposedMappings).toContainEqual(expect.objectContaining({ role: "color.canvas", targetToken: "--bg", scope: "default", confidence: "high" }));
    expect(result.proposedMappings).toContainEqual(expect.objectContaining({ role: "text.primary", targetToken: "--ink", scope: "dark" }));
    expect(result.contrastChecks).toContainEqual(expect.objectContaining({ scope: "default", status: "evaluated", ratio: 18.88, wcagAaNormalText: true }));
    expect(result.contrastChecks).toContainEqual(expect.objectContaining({ scope: "dark", status: "evaluated", ratio: 21, wcagAaNormalText: true }));
    expect(result.integrationProposal.status).toBe("proposal_only");
    expect(result.integrationProposal.cssOverlay).toContain("@media (prefers-color-scheme: dark)");
    expect(result.integrationProposal.cssOverlay).toContain("--brand: #155eef");
    expect(result.limits.join(" ")).toContain("they do not inspect rendered UI");
  });

  it("flags a recognized low-contrast pair without presenting it as a rendered audit", () => {
    const result = profile(":root { --background: #fff; --text: #aaaaaa; }");
    expect(result.contrastChecks).toContainEqual(expect.objectContaining({
      status: "evaluated",
      ratio: 2.32,
      wcagAaNormalText: false,
      pairing: "candidate-inferred-from-token-names",
    }));
    expect(result.contrastChecks[0]?.caveat).toContain("not a rendered contrast evaluation");
  });

  it("preserves custom selector scopes but omits them from the generic overlay", () => {
    const result = profile(":root { --bg: #fff; --ink: #000; } [data-theme=dark] { --bg: #222; --ink: #eee; }");
    expect(result.extractedTokens.some((token) => token.scope === "custom:[data-theme=dark]")).toBe(true);
    expect(result.themeCoverage.hasDarkTokens).toBe(false);
    expect(result.integrationProposal.overlayNotes.join(" ")).toContain("Custom selector scopes");
    expect(result.integrationProposal.cssOverlay).not.toContain("#222");
    expect(result.integrationProposal.cssOverlay).not.toContain("#eee");
  });

  it("does not broaden combined or negated media queries into generic themes", () => {
    const result = profile(`@media (prefers-color-scheme: dark) and (min-width: 900px) { :root { --background: #000; } }
      @media not (prefers-color-scheme: light) { :root { --text: #fff; } }`);
    expect(result.extractedTokens.map((token) => token.scope)).toEqual([
      "custom:@media (prefers-color-scheme: dark) and (min-width: 900px)",
      "custom:@media not (prefers-color-scheme: light)",
    ]);
    expect(result.themeCoverage.hasDarkTokens).toBe(false);
    expect(result.integrationProposal.cssOverlay).toBeNull();
    expect(result.integrationProposal.overlayNotes.join(" ")).toContain("Custom selector scopes");
  });

  it("keeps attacker-controlled JSON paths out of the generated CSS structure", () => {
    const hostileName = "foo*/brand-}body{color:red;/*";
    const result = profile(JSON.stringify({ [hostileName]: "#155eef" }), "json");
    const overlay = result.integrationProposal.cssOverlay;
    expect(overlay).not.toBeNull();
    expect(overlay).not.toContain(hostileName);
    const parsed = postcss.parse(overlay!);
    expect(parsed.nodes?.filter((node) => node.type === "rule").map((node) => (node as import("postcss").Rule).selector)).toEqual([":root"]);
    expect(overlay).toContain("--brand: #155eef;");
  });

  it("flattens nested token JSON, preserves light/dark scope, and marks collisions ambiguous", () => {
    const result = profile(JSON.stringify({
      light: { colors: { background: "#fff", canvas: "#fefefe", text: "#000" } },
      dark: { colors: { background: "#000", text: "#fff" } },
    }), "json");
    expect(result.extractedTokens.map((token) => token.scope)).toContain("light");
    expect(result.ambiguousMappings).toContainEqual(expect.objectContaining({ scope: "light", role: "color.canvas", sourceTokens: ["colors.background", "colors.canvas"] }));
    expect(result.proposedMappings).toContainEqual(expect.objectContaining({ role: "text.primary", scope: "dark", sourceToken: "colors.text" }));
    expect(result.integrationProposal.cssOverlay).toContain("@media (prefers-color-scheme: light)");
  });

  it("does not evaluate alpha colors, gradients, or unsupported color syntax", () => {
    const result = profile(":root { --bg: linear-gradient(#fff, #000); --ink: rgb(0 0 0 / 50%); }");
    expect(result.contrastChecks).toContainEqual(expect.objectContaining({ status: "not_evaluated" }));
    expect(result.proposedMappings.every((mapping) => mapping.confidence === "review")).toBe(true);
    expect(result.integrationProposal.cssOverlay).toBeNull();
  });

  it("evaluates comma and space rgb syntax but rejects mixed separators", () => {
    const result = profile(":root { --background: rgb(255, 255, 255); --text: rgb(0 0 0); }");
    expect(result.contrastChecks).toContainEqual(expect.objectContaining({ status: "evaluated", ratio: 21 }));

    const malformed = profile(":root { --background: rgb(255 255, 255); --text: #000; }");
    expect(malformed.proposedMappings).toContainEqual(expect.objectContaining({ role: "color.canvas", valueCheck: "manual_review" }));
    expect(malformed.contrastChecks).toContainEqual(expect.objectContaining({ status: "not_evaluated" }));
    expect(malformed.integrationProposal.cssOverlay).toContain("--ink: #000;");
    expect(malformed.integrationProposal.cssOverlay).not.toContain("rgb(255 255, 255)");
  });

  it("returns bounded, generic errors for invalid and oversized input", () => {
    expect(extractDesignProfile({ source: "{broken", format: "json", surface: "host" })).toMatchObject({ ok: false, code: "invalid_json" });
    expect(extractDesignProfile({ source: ":root { --ink: red;", format: "css", surface: "host" })).toMatchObject({ ok: false, code: "invalid_css" });
    expect(extractDesignProfile({ source: "x".repeat(32 * 1024 + 1), format: "css", surface: "host" })).toMatchObject({ ok: false, code: "too_large" });
    expect(extractDesignProfile({ source: "🟣".repeat(9000), format: "css", surface: "host" })).toMatchObject({ ok: false, code: "too_large" });
  });
});
