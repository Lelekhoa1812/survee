import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminNav } from "../src/components/AdminNav";

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

describe("admin navigation accessibility", () => {
  it("offers a skip link before the repeated navigation", () => {
    const html = renderToStaticMarkup(createElement(AdminNav, { email: "host@example.test" }));

    expect(html).toMatch(/^<a class="skip-link" href="#main-content">Skip to main content<\/a><header/);
  });
});
