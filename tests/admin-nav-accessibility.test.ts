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
    const html = renderToStaticMarkup(createElement(AdminNav, { email: "host@example.test", tenantId: "tenant-a", workspaces: [] }));

    expect(html).toMatch(/^<a class="skip-link" href="#main-content">Skip to main content<\/a><header/);
  });

  it("labels the workspace switcher and includes every membership", () => {
    const html = renderToStaticMarkup(createElement(AdminNav, {
      email: "host@example.test",
      tenantId: "tenant-a",
      workspaces: [{ tenantId: "tenant-a", name: "Axion", role: "owner" }, { tenantId: "tenant-b", name: "Research", role: "member" }],
    }));
    expect(html).toContain('aria-label="Switch workspace"');
    expect(html).toContain("Axion · owner");
    expect(html).toContain("Research · member");
  });
});
