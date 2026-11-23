import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountSettingsPanel } from "../src/components/AccountSettingsPanel";

describe("account session inventory disclosure", () => {
  it("explains inventory omissions and the account-wide revoke guarantee", () => {
    const html = renderToStaticMarkup(createElement(AccountSettingsPanel, {
      account: {
        tenantName: "Workspace",
        email: "owner@example.test",
        role: "owner",
        emailVerified: true,
        legacyBootstrap: false,
      },
    }));

    expect(html).toContain("Signed-in sessions");
    expect(html).toContain("at most 50 active sessions");
    expect(html).toContain("may omit a sign-in if session tracking was temporarily unavailable");
    expect(html).toContain("invalidates every other session for this account");
    expect(html).toContain("including sessions not shown here");
    expect(html).toContain("sessions issued before this list was introduced");
  });
});
