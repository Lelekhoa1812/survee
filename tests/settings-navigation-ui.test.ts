import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsConsole } from "../src/components/SettingsConsole";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function renderSettings(mayManageLegacy: boolean) {
  const role = mayManageLegacy ? "owner" : "member";
  return renderToStaticMarkup(createElement(SettingsConsole, {
    initialKeys: [],
    loadError: false,
    canManageKeys: role === "owner",
    envToken: false,
    origin: null,
    tenantAudit: {
      axionLegacyTenantFallbackEnabled: true,
      collections: {},
      blockingIntegrity: {},
      legacyEventReferences: {},
      preflight: { tenantIdsMatchAxion: true, readyForReviewedBackfill: true },
    },
    tenantAuditError: false,
    mayManageLegacy,
    account: {
      userId: "000000000000000000000001",
      tenantName: "Axion",
      email: "admin@axiob.local",
      role,
      emailVerified: true,
      legacyBootstrap: false,
    },
  }));
}

describe("settings section navigation", () => {
  it("links to rendered sections and limits the legacy section link to owners", () => {
    const ownerHtml = renderSettings(true);
    const memberHtml = renderSettings(false);
    const ownerNav = ownerHtml.match(/<nav[^>]*aria-label="Settings sections"[^>]*>(.*?)<\/nav>/)?.[1] ?? "";
    const memberNav = memberHtml.match(/<nav[^>]*aria-label="Settings sections"[^>]*>(.*?)<\/nav>/)?.[1] ?? "";

    expect(ownerNav).not.toBe("");
    expect(memberNav).not.toBe("");

    for (const [, target] of ownerNav.matchAll(/href="#([^"]+)"/g)) {
      expect(ownerHtml).toContain(`id="${target}"`);
    }
    for (const [, target] of memberNav.matchAll(/href="#([^"]+)"/g)) {
      expect(memberHtml).toContain(`id="${target}"`);
    }

    expect(ownerNav).toContain('href="#legacy-data"');
    expect(ownerNav).toContain('href="#api-keys"');
    expect(ownerHtml).toContain('id="legacy-data"');
    expect(memberNav).not.toContain('href="#legacy-data"');
    expect(memberNav).not.toContain('href="#api-keys"');
    expect(memberHtml).not.toContain('id="legacy-data"');
    expect(memberHtml).not.toContain('id="api-keys"');
    expect(memberHtml).not.toContain("New key");
  });

  it("explains that the backup check is an owner attestation", () => {
    const html = renderSettings(true);

    expect(html).toContain("No records change during this review");
    expect(html).toContain("attestation that a current database backup is available");
    expect(html).toContain("The app cannot verify the backup");
    expect(html).toContain("Axion’s legacy fallback remains enabled");
  });

  it("explains how to complete the strict Axion tenant-filter cutover", () => {
    const html = renderSettings(true);

    expect(html).toContain("KQA_AXION_LEGACY_TENANT_FALLBACK=false");
    expect(html).toContain("zero-unscoped audit");
  });

  it("includes account session inventory and revoke-other-sessions controls", () => {
    const html = renderSettings(true);

    expect(html).toContain("Signed-in sessions");
    expect(html).toContain("Sign out other sessions");
    expect(html).toContain("sessions issued before this list was introduced");
  });
});
