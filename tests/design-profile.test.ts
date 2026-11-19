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
    tokenFormat?: { name: string; status: string; supported: string[]; limitations: string[]; colorModule?: { name: string; source: string; alphaHandling: string } };
    extractedTokens: { name: string; value: string; scope: string; sourceContext: string; line: number | null; sourceType?: string }[];
    proposedMappings: { role: string; sourceToken: string; sourceType?: string; targetToken: string; scope: string; confidence: string; valueCheck: string }[];
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

    expect(result).toMatchObject({ profileVersion: "kqa-design-profile/2", policyVersion: "kqa-design/19", themeCoverage: { hasDarkTokens: true } });
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

  it("imports the bounded DTCG 2025.10 subset with inherited types and typed value normalization", () => {
    const result = profile(JSON.stringify({
      $schema: "https://www.designtokens.org/schemas/2025.10/format.json",
      colors: {
        $type: "color",
        canvas: { $value: { colorSpace: "srgb", components: [1, 1, 1], alpha: 1 } },
        ink: { $value: "#111111" },
      },
      spacing: { $type: "dimension", radius: { $value: { value: 8, unit: "px" } } },
      typeface: { $type: "fontFamily", body: { $value: ["Inter", "sans-serif"] } },
    }), "json");

    expect(result.profileVersion).toBe("kqa-design-profile/2");
    expect(result.tokenFormat).toMatchObject({
      name: "Design Tokens Format Module 2025.10 (bounded subset)",
      status: "W3C Design Tokens Community Group specification; not a W3C Standard.",
      colorModule: {
        name: "Design Tokens Color Module 2025.10",
        source: "https://www.designtokens.org/TR/2025.10/color/",
      },
    });
    expect(result.extractedTokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "colors.canvas", value: "#ffffff", sourceType: "color" }),
      expect.objectContaining({ name: "spacing.radius", value: "8px", sourceType: "dimension" }),
      expect.objectContaining({ name: "typeface.body", value: "Inter, sans-serif", sourceType: "fontFamily" }),
    ]));
    expect(result.proposedMappings).toContainEqual(expect.objectContaining({ role: "color.canvas", confidence: "high", sourceType: "color" }));
    expect(result.proposedMappings).toContainEqual(expect.objectContaining({ role: "shape.radius", confidence: "high", sourceType: "dimension" }));
    expect(result.proposedMappings).toContainEqual(expect.objectContaining({ role: "type.body", confidence: "high", sourceType: "fontFamily" }));
    expect(result.integrationProposal.status).toBe("proposal_only");
  });

  it("preserves DTCG alpha semantics when a translucent color has a hex fallback", () => {
    const translucent = profile(JSON.stringify({
      $schema: "https://www.designtokens.org/schemas/2025.10/format.json",
      colors: {
        $type: "color",
        canvas: { $value: { colorSpace: "srgb", components: [0, 0, 0], alpha: 0.5, hex: "#000000" } },
        text: { $value: "#ffffff" },
      },
    }), "json");

    expect(translucent.extractedTokens.find((token) => token.name === "colors.canvas")?.value).toContain('"alpha":0.5');
    expect(translucent.proposedMappings).toContainEqual(expect.objectContaining({
      role: "color.canvas", sourceToken: "colors.canvas", confidence: "review", valueCheck: "manual_review",
    }));
    expect(translucent.contrastChecks).toContainEqual(expect.objectContaining({ scope: "default", status: "not_evaluated" }));
    expect(translucent.integrationProposal.cssOverlay).not.toContain("--bg:");
    expect(translucent.tokenFormat?.limitations.join(" ")).toContain("Translucent colors need manual review");

    const opaque = profile(JSON.stringify({
      $schema: "https://www.designtokens.org/schemas/2025.10/format.json",
      colors: { $type: "color", canvas: { $value: { colorSpace: "srgb", components: [1, 1, 1], alpha: 1, hex: "#ffffff" } } },
    }), "json");
    expect(opaque.proposedMappings).toContainEqual(expect.objectContaining({
      role: "color.canvas", confidence: "high", valueCheck: "recognized", value: "#ffffff",
    }));
    expect(opaque.integrationProposal.cssOverlay).toContain("--bg: #ffffff;");
  });

  it("resolves explicit $root token paths and inline JSON Pointer references", () => {
    const result = profile(JSON.stringify({
      palette: {
        $type: "color",
        $root: { $value: "#ffffff" },
        brand: { $value: "#155eef" },
        accents: {
          $type: "color",
          $root: { $value: "#cc4400" },
        },
      },
      semantic: {
        $type: "color",
        canvas: { $value: "{palette.$root}" },
        brandCopy: { $value: "{palette.brand}" },
        nestedRoot: { $value: "{palette.accents.$root}" },
        surface: { $value: { $ref: "#/palette/$root/$value" } },
      },
    }), "json");

    expect(result.extractedTokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "semantic.canvas", value: "#ffffff" }),
      expect.objectContaining({ name: "semantic.brandCopy", value: "#155eef" }),
      expect.objectContaining({ name: "semantic.nestedRoot", value: "#cc4400" }),
      expect.objectContaining({ name: "semantic.surface", value: "#ffffff" }),
    ]));
    expect(result.diagnostics).toEqual([]);
  });

  it("does not resolve a group name as its $root token", () => {
    const result = profile(JSON.stringify({
      palette: { $type: "color", $root: { $value: "#ffffff" } },
      semantic: { $type: "color", canvas: { $value: "{palette}" } },
    }), "json");

    expect(result.extractedTokens).toContainEqual(expect.objectContaining({
      name: "semantic.canvas",
      value: "{palette}",
      requiresReview: true,
    }));
    expect(result.diagnostics.join(" ")).toContain("references unresolved token {palette}");
  });

  it("keeps unresolved and circular aliases visible for manual review", () => {
    const result = profile(JSON.stringify({
      colors: {
        $type: "color",
        canvas: { $value: "{colors.missing}" },
        pointer: { $value: { $ref: "#/colors/not-found/$value" } },
        other: { $value: "{colors.loop}" },
        loop: { $value: "{colors.other}" },
      },
    }), "json");

    expect(result.proposedMappings).toContainEqual(expect.objectContaining({ role: "color.canvas", confidence: "review", valueCheck: "manual_review" }));
    expect(result.diagnostics.join(" ")).toContain("references unresolved token {colors.missing}");
    expect(result.diagnostics.join(" ")).toContain("references unresolved JSON Pointer #/colors/not-found/$value");
    expect(result.diagnostics.join(" ")).toContain("Circular DTCG token reference");
  });

  it("keeps multi-theme aliases scoped and marks unresolved ambiguous references for review", () => {
    const result = profile(JSON.stringify({
      dark: {
        colors: { $type: "color", canvas: { $value: "#000000" } },
        semantic: { $type: "color", canvasCopy: { $value: "{colors.canvas}" } },
      },
      light: {
        colors: { $type: "color", canvas: { $value: "#ffffff" } },
        semantic: { $type: "color", canvasCopy: { $value: "{colors.canvas}" } },
      },
      semantic: { $type: "color", canvas: { $value: "{colors.canvas}" } },
    }), "json");

    expect(result.extractedTokens).toContainEqual(expect.objectContaining({ name: "semantic.canvas", scope: "default", value: "{colors.canvas}" }));
    expect(result.proposedMappings).toContainEqual(expect.objectContaining({ role: "color.canvas", scope: "default", valueCheck: "manual_review" }));
    expect(result.diagnostics.join(" ")).toContain("references ambiguous token path {colors.canvas}");
    expect(result.extractedTokens).toContainEqual(expect.objectContaining({ name: "semantic.canvasCopy", scope: "dark", value: "#000000" }));
    expect(result.extractedTokens).toContainEqual(expect.objectContaining({ name: "semantic.canvasCopy", scope: "light", value: "#ffffff" }));
  });

  it("preserves deterministic token order and source hashes and flags conflicting role candidates", () => {
    const source = JSON.stringify({
      $type: "color",
      background: { $value: "#ffffff" },
      canvas: { $value: "#eeeeee" },
    });
    const first = profile(source, "json");
    const second = profile(source, "json");

    expect(first.extractedTokens.map((token) => token.name)).toEqual(["background", "canvas"]);
    expect(first.sourceSha256).toBe(second.sourceSha256);
    expect(first.extractedTokens).toEqual(second.extractedTokens);
    expect(first.ambiguousMappings).toContainEqual(expect.objectContaining({ scope: "default", role: "color.canvas", sourceTokens: ["background", "canvas"] }));
  });

  it("keeps semantically mismatched DTCG types at manual review confidence", () => {
    const result = profile(JSON.stringify({
      $type: "dimension",
      canvas: { $value: { value: 4, unit: "px" } },
    }), "json");

    expect(result.proposedMappings).toContainEqual(expect.objectContaining({
      role: "color.canvas",
      sourceType: "dimension",
      confidence: "review",
      valueCheck: "manual_review",
    }));
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
