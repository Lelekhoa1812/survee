import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LandingSurface } from "../src/components/LandingSurface";

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("../src/components/ui", () => ({ BrandMark: () => createElement("span", null, "KQA") }));

describe("commercial landing page", () => {
  it("offers a direct host signup and sign-in path with an accurate product workflow", () => {
    const html = renderToStaticMarkup(createElement(LandingSurface));

    expect(html).toContain("Your questionnaire, hosted and ready to share.");
    expect(html).toContain("From questionnaire to review");
    expect(html).not.toContain("From questionnaire to insight");
    expect(html).toMatch(/href="\/signup"[^>]*>Create a workspace<\/a>/);
    expect(html).toMatch(/href="\/admin\/login"[^>]*>Sign in<\/a>/);
    expect(html).toContain("self-contained HTML questionnaire");
    expect(html).toContain("Run the file checker");
    expect(html).toContain("Respondents do not need an account");
  });

  it("keeps private-link instructions visible for respondents", () => {
    const html = renderToStaticMarkup(createElement(LandingSurface));

    expect(html).toContain("Have an interview link?");
    expect(html).toContain("Open the private URL your host sent you");
    expect(html).toContain("contact your host");
  });
});
