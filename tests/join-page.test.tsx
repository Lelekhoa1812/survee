import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceInvitation: vi.fn(),
  adminSession: vi.fn(async () => null),
}));

vi.mock("@/lib/repo/workspaces", () => ({ getWorkspaceInvitation: mocks.getWorkspaceInvitation }));
vi.mock("@/lib/http", () => ({ adminSession: mocks.adminSession }));

import JoinWorkspacePage from "../src/app/join/page";

describe("workspace invitation join page", () => {
  it("offers a retry when the invitation lookup fails", async () => {
    mocks.getWorkspaceInvitation.mockRejectedValueOnce(new Error("database unavailable"));

    const page = await JoinWorkspacePage({ searchParams: Promise.resolve({ token: "invite-token" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("We couldn’t check this invitation");
    expect(html).toContain("temporarily unavailable");
    expect(html).toContain("Try again");
    expect(html).not.toContain("invalid, expired, revoked, or already used");
  });

  it("keeps an actual missing invitation distinct from a temporary outage", async () => {
    mocks.getWorkspaceInvitation.mockResolvedValueOnce(null);

    const page = await JoinWorkspacePage({ searchParams: Promise.resolve({ token: "expired-token" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("invalid, expired, revoked, or already used");
    expect(html).not.toContain("temporarily unavailable");
  });
});
